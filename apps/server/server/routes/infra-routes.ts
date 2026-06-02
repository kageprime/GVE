import { Router } from "express";
import { requireAuthOrApiKey, resolveUserId, handleError } from "./api-helpers.js";
import { getDaytonaEnvPreflight } from "../env.js";
import { getPool } from "../llm/pool.js";
import { getSandboxRuntimeMetrics, cleanupAllDaytonaSandboxes } from "../sandbox/skill-runtime.js";
import { getSkillCatalog } from "../skills/registry.js";
import { streamMediaArtifact } from "./media.js";
import { planTasks, executeTask } from "../pipeline/index.js";
import { broadcastEvent } from "../ws/streaming.js";
import { getCacheStats } from "../cache-manager.js";
import { wsClients } from "../ws/handler.js";
import { startupDaytonaPreflight } from "../startup-preflight.js";
import { metrics, computeP95Latency } from "../lib/metrics.js";
import { getSessionUsage, getUserDailyTokenUsage, getGlobalTokenTotals, getTokenLimitConfig } from "../state/token-usage.js";
import { getOrCreateInternalSession } from "../state/session.js";
import { getDedicatedSandboxStatus } from "../sandbox/dedicated-manager.js";
import { requestSchema } from "../pipeline/utils.js";
import { executeRequestSchema } from "../pipeline/task-planning.js";
import { apiKeyRepo } from "../db/repositories/apikey-repo.js";

export const infraRouter = Router();

infraRouter.get("/", (_req: any, res: any) => {
  res.json({ status: "ok", backend: "js", message: "Visual Engine API" });
});

infraRouter.get("/healthz", (_req: any, res: any) => {
  const daytonaPreflight = getDaytonaEnvPreflight();
  const pool = getPool();
  const poolStatus = pool.getStatus();
  res.json({
    status: "ok",
    backend: "js",
    orchestration: "multi-agent",
    llm: {
      pool: {
        enabledProviders: poolStatus.providers.filter((p: any) => p.state !== "disabled").length,
        totalProviders: poolStatus.providers.length,
        totalGenerations: poolStatus.totalGenerations,
        fallbackCount: poolStatus.fallbackCount,
      },
    },
    runtime: {
      daytona: daytonaPreflight,
    },
    metrics: {
      errors: metrics.errors,
      p95LatencyMs: computeP95Latency(),
    },
  });
});

infraRouter.get("/metrics", (_req: any, res: any) => {
  const sandboxMetrics = getSandboxRuntimeMetrics();
  const poolStatus = getPool().getStatus();
  res.json({
    pool: poolStatus,
    sandbox: sandboxMetrics,
    errors: metrics.errors,
    p95LatencyMs: computeP95Latency(),
    wsConnections: wsClients.size,
  });
});

infraRouter.get("/api/v1/sandboxes/status", (_req: any, res: any) => {
  const sandboxMetrics = getSandboxRuntimeMetrics();
  const dedicatedStatus = getDedicatedSandboxStatus();
  res.json({ pool: sandboxMetrics, dedicated: dedicatedStatus });
});

infraRouter.post("/api/v1/sandboxes/cleanup", requireAuthOrApiKey, async (_req: any, res: any) => {
  try {
    const result = await cleanupAllDaytonaSandboxes();
    res.json({ success: true, ...result });
  } catch (error) {
    handleError(error, res);
  }
});

infraRouter.get("/api/v1/skills", (_req: any, res: any) => {
  const skills = getSkillCatalog();
  res.json({ skills });
});

infraRouter.get("/api/v1/providers", (_req: any, res: any) => {
  const poolStatus = getPool().getStatus();
  const providers = poolStatus.providers.map((p: any) => ({
    id: p.id,
    name: p.name,
    state: p.state,
  }));
  res.json({ providers });
});

infraRouter.get("/api/v1/usage", requireAuthOrApiKey, (req: any, res: any) => {
  const userId = resolveUserId(req);
  const sessionId = req.query.sessionId ? String(req.query.sessionId) : null;

  const response: any = {
    limits: getTokenLimitConfig(),
    global: getGlobalTokenTotals(),
  };

  if (userId) response.userDaily = getUserDailyTokenUsage(userId);
  if (sessionId) {
    const sessionState = getOrCreateInternalSession(sessionId);
    response.session = getSessionUsage(sessionId);
  }

  res.json(response);
});

infraRouter.get("/api/v1/media/:mediaKey", (req: any, res: any) => {
  streamMediaArtifact(req, res, (req.params as any).mediaKey);
});

infraRouter.post("/api/v1/tasks/plan", requireAuthOrApiKey, async (req: any, res: any) => {
  try {
    const validated = requestSchema.parse(req.body);
    const tasks = await planTasks(validated);
    broadcastEvent("tasks:planned", { planId: validated?.planId, sessions: validated?.sessions, tasks });
    res.json({ success: true, tasks });
  } catch (error) {
    handleError(error, res);
  }
});

infraRouter.post("/api/v1/tasks/execute", requireAuthOrApiKey, async (req: any, res: any) => {
  try {
    const validated = executeRequestSchema.parse(req.body);
    broadcastEvent("task:started", { planId: validated.planId, taskId: validated.task.id });
    const result = await executeTask(validated);
    broadcastEvent("task:completed", { planId: validated.planId, taskId: validated.task.id, result });
    res.json({ success: true, result });
  } catch (error) {
    broadcastEvent("task:failed", { planId: req.body?.planId, taskId: req.body?.task?.id, message: error instanceof Error ? error.message : "Unknown task error" });
    handleError(error, res);
  }
});

/* ─── API Key Management ─── */

infraRouter.post("/api/v1/auth/api-keys", requireAuthOrApiKey, async (req: any, res: any) => {
  try {
    const userId = resolveUserId(req);
    const name = String(req.body?.name ?? "").trim() || "Unnamed Key";
    const scopes = Array.isArray(req.body?.scopes) ? req.body.scopes : ["*"];
    const { row, plainKey } = await apiKeyRepo.generate(userId!, name, scopes);
    res.json({
      data: {
        id: row.id,
        name: row.name,
        key: plainKey,
        scopes: JSON.parse(row.scopes),
        created_at: row.created_at,
      },
      error: null,
    });
  } catch (error) {
    handleError(error, res);
  }
});

infraRouter.get("/api/v1/auth/api-keys", requireAuthOrApiKey, async (req: any, res: any) => {
  try {
    const userId = resolveUserId(req);
    const keys = await apiKeyRepo.listByUser(userId!);
    res.json({ data: keys, error: null });
  } catch (error) {
    handleError(error, res);
  }
});

infraRouter.delete("/api/v1/auth/api-keys/:id", requireAuthOrApiKey, async (req: any, res: any) => {
  try {
    const userId = resolveUserId(req);
    const id = String(req.params.id);
    const deleted = await apiKeyRepo.delete(id, userId!);
    if (!deleted) {
      res.status(404).json({ error: "NOT_FOUND", message: "API key not found." });
      return;
    }
    res.json({ data: { deleted: true }, error: null });
  } catch (error) {
    handleError(error, res);
  }
});

/* ─── Workspace File API ─── */

infraRouter.get("/api/v1/workspace/tree", requireAuthOrApiKey, async (req: any, res: any) => {
  try {
    const sessionId = String(req.query.sessionId ?? "").trim();
    if (!sessionId) {
      res.status(400).json({ error: "BAD_REQUEST", message: "sessionId required" });
      return;
    }

    const { getWorkspace } = await import("../sandbox/daytona-workspace-store.js");
    const ws = getWorkspace(sessionId);
    if (!ws?.nativeFs) {
      res.status(404).json({ error: "NOT_FOUND", message: "No active workspace for session" });
      return;
    }

    const sessionDir = ws.sessionDir ?? `/home/user/projects/${sessionId}`;
    const files = await ws.nativeFs.listFiles(sessionDir);
    res.json({
      success: true,
      path: sessionDir,
      files: (files ?? []).map((f: any) => ({
        name: f.name ?? f.path?.split("/").pop(),
        path: f.path ?? f.name,
        size: f.size ?? 0,
        isDir: f.isDir ?? false,
        modifiedAt: f.modTime ?? new Date().toISOString(),
      })),
    });
  } catch (error) {
    handleError(error, res);
  }
});

infraRouter.get("/api/v1/workspace/file", requireAuthOrApiKey, async (req: any, res: any) => {
  try {
    const filePath = String(req.query.path ?? "").trim();
    const sessionId = String(req.query.sessionId ?? "").trim();
    if (!filePath || !sessionId) {
      res.status(400).json({ error: "BAD_REQUEST", message: "path and sessionId required" });
      return;
    }

    const { getWorkspace } = await import("../sandbox/daytona-workspace-store.js");
    const ws = getWorkspace(sessionId);
    if (!ws?.nativeFs) {
      res.status(404).json({ error: "NOT_FOUND", message: "No active workspace for session" });
      return;
    }

    const content = await ws.nativeFs.downloadFile(filePath);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(content.toString("utf-8"));
  } catch (error) {
    handleError(error, res);
  }
});

infraRouter.post("/api/v1/workspace/file", requireAuthOrApiKey, async (req: any, res: any) => {
  try {
    const { path: filePath, content, sessionId } = req.body ?? {};
    if (!filePath || !content || !sessionId) {
      res.status(400).json({ error: "BAD_REQUEST", message: "path, content, and sessionId required" });
      return;
    }

    const { getWorkspace } = await import("../sandbox/daytona-workspace-store.js");
    const ws = getWorkspace(sessionId);
    if (!ws?.nativeFs) {
      res.status(404).json({ error: "NOT_FOUND", message: "No active workspace for session" });
      return;
    }

    await ws.nativeFs.uploadFile(Buffer.from(content, "utf-8"), filePath);
    res.json({ success: true, path: filePath });
  } catch (error) {
    handleError(error, res);
  }
});

infraRouter.delete("/api/v1/workspace/file", requireAuthOrApiKey, async (req: any, res: any) => {
  try {
    const filePath = String(req.query.path ?? "").trim();
    const sessionId = String(req.query.sessionId ?? "").trim();
    if (!filePath || !sessionId) {
      res.status(400).json({ error: "BAD_REQUEST", message: "path and sessionId required" });
      return;
    }

    const { getWorkspace } = await import("../sandbox/daytona-workspace-store.js");
    const ws = getWorkspace(sessionId);
    if (!ws?.nativeFs) {
      res.status(404).json({ error: "NOT_FOUND", message: "No active workspace for session" });
      return;
    }

    await ws.nativeFs.deleteFile(filePath, true);
    res.json({ success: true, deleted: true, path: filePath });
  } catch (error) {
    handleError(error, res);
  }
});