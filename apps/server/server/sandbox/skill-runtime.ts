/**
 * Skill Runtime
 *
 * Executes specific skills within the sandbox environment. Now uses the
 * SkillAdapter pattern so each runtime kind (JavaScript scene, Python/Manim)
 * is handled by a dedicated adapter instead of inline branches.
 *
 * Execution flow:
 *   1. acquireSandbox   — get a sandbox from Daytona pool or dedicated manager
 *   2. prepareSandbox   — install tools, write multi-file projects, build
 *   3. dispatchExecution — use SkillAdapter to run code inside the sandbox
 *   4. releaseSandbox   — return the sandbox to the pool
 */

import { getSkillRuntimeProfile } from "../skills/loader.js";
import { recordSkillExecution } from "../skills/metrics-store.js";
import { SandboxPoolManager, toolRegistry } from "@visual-runtime/sandbox-pool";
import { DedicatedSandboxManager, setDedicatedSandboxInstance } from "./dedicated-manager.js";
import { getAdapter } from "./adapters/index.js";
import { traceEvent } from "../trace/events.js";
import { getTraceContext } from "../trace/context.js";

function parsePositiveIntEnv(rawValue: string | undefined | null, fallbackValue: number, minimum = 1): number {
  const parsed = Number.parseInt(String(rawValue ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallbackValue;
  return Math.max(minimum, parsed);
}

function parseBooleanEnv(rawValue: string | undefined | null | boolean, fallbackValue: boolean): boolean {
  if (rawValue === undefined || rawValue === null || rawValue === "") return fallbackValue;
  const normalized = String(rawValue).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallbackValue;
}

const poolManager = new SandboxPoolManager();
const dedicatedSandboxManager = new DedicatedSandboxManager(poolManager);
setDedicatedSandboxInstance(dedicatedSandboxManager);

const runtimeAcquireBudgetMs = parsePositiveIntEnv(process.env.RUNTIME_ACQUIRE_BUDGET_MS, 12_000, 1_000);

// ── Utilities ─────────────────────────────────────────────────────────

function cloneAcquireDiagnostics(diagnostics: any): any {
  if (!diagnostics || typeof diagnostics !== "object") return null;
  try { return JSON.parse(JSON.stringify(diagnostics)); } catch { return null; }
}

function resolveAcquireDeadlineAtMs(turnDeadlineAtMs: number | null): number | null {
  const now = Date.now();
  const acquireBudgetDeadlineAtMs = now + runtimeAcquireBudgetMs;
  const turnDeadline = typeof turnDeadlineAtMs === "number" && Number.isFinite(turnDeadlineAtMs) ? turnDeadlineAtMs : Number.POSITIVE_INFINITY;
  const resolved = Math.min(acquireBudgetDeadlineAtMs, turnDeadline);
  return Number.isFinite(resolved) ? resolved : null;
}

function remainingBudgetMs(deadlineAtMs: number | null): number {
  if (deadlineAtMs === null || !Number.isFinite(deadlineAtMs)) return Number.POSITIVE_INFINITY;
  return deadlineAtMs - Date.now();
}

function isMultiFileProject(code: any): code is { files: any[]; entryPoint: string } {
  return code && typeof code === "object" && Array.isArray(code.files) && code.entryPoint && code.files.length > 0;
}

async function writeProjectToFS(filesystem: any, project: any): Promise<{ success: boolean; filesWritten: number; error?: string }> {
  if (!project || !Array.isArray(project.files)) {
    return { success: false, filesWritten: 0, error: "Invalid project" };
  }
  try {
    const result = await filesystem.writeMultiple(project.files);
    return {
      success: result.success,
      filesWritten: result.written,
      error: result.failed > 0 ? `Failed to write ${result.failed} file(s)` : undefined
    };
  } catch (error: any) {
    return { success: false, filesWritten: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

function getEntryPointCode(project: any): string {
  if (!project || !project.entryPoint || !Array.isArray(project.files)) return "";
  const entry = project.files.find((f: any) => f.path === project.entryPoint);
  return entry ? entry.content : "";
}

function shouldBuildSkill(skillId: string): boolean {
  const buildableSkills = ["threejs", "babylon", "p5js", "p5.js", "d3", "d3js", "plotly", "chart.js", "chartjs", "gsap", "animation", "mermaid"];
  return buildableSkills.includes(skillId);
}

async function buildProject(buildManager: any, skillId: string, installDeps = true): Promise<{ success: boolean; buildOutput?: any; artifacts?: any; error?: string }> {
  try {
    const result = await buildManager.build(skillId, { installDeps, timeout: 60000 });
    if (!result.success) return { success: false, error: result.message || result.reason, buildOutput: result };
    return { success: true, buildOutput: result, artifacts: result.artifacts || result.buildResult?.artifacts };
  } catch (error: any) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ── Phase 4: Separated Stages ────────────────────────────────────────

interface AcquireResult {
  sandboxEnv: any;
  acquireDiagnostics: any;
  dedicatedKey: string | null;
}

async function acquireSandbox(
  skillId: string,
  turnDeadlineAtMs: number | null,
  effectiveSessionId: string | null
): Promise<AcquireResult> {
  const acquireBudgetMs = remainingBudgetMs(resolveAcquireDeadlineAtMs(turnDeadlineAtMs));
  if (acquireBudgetMs <= 0) throw new Error("Runtime budget exhausted before sandbox acquisition.");

  const traceCtx = getTraceContext();
  const dedicatedKey = dedicatedSandboxManager.getKey({ userId: traceCtx.userId ?? null, sessionId: effectiveSessionId });

  traceEvent("sandbox.acquire_start", {
    skillId,
    sessionId: effectiveSessionId,
    dedicated: dedicatedSandboxManager.isEnabled(),
    key: dedicatedKey
  });

  try {
    const acquireStartMs = Date.now();
    const sandboxEnv = dedicatedKey
      ? await dedicatedSandboxManager.acquireForKey(dedicatedKey, { skillId, turnDeadlineAtMs: resolveAcquireDeadlineAtMs(turnDeadlineAtMs) })
      : await poolManager.acquire({ skillId, turnDeadlineAtMs: resolveAcquireDeadlineAtMs(turnDeadlineAtMs) });

    traceEvent("sandbox.acquire_ok", {
      skillId,
      workspaceId: sandboxEnv?.workspaceId ?? null,
      acquireMs: Date.now() - acquireStartMs,
      key: dedicatedKey
    });

    return {
      sandboxEnv,
      acquireDiagnostics: cloneAcquireDiagnostics(sandboxEnv?._acquireDiagnostics),
      dedicatedKey
    };
  } catch (acquireError: any) {
    throw acquireError;
  }
}

async function prepareSandbox(
  sandboxEnv: any,
  code: any,
  tools: any[],
  skillId: string
): Promise<{ executionCode: string; buildArtifacts: any }> {
  // Install tools
  if (Array.isArray(tools) && tools.length > 0) {
    const normalizedTools = tools.map((t: any) => {
      if (typeof t === "string") return { name: t, version: "latest" };
      return { name: t?.npmPackage ?? t?.name ?? String(t), version: t?.version ?? "latest" };
    });
    const isCached = toolRegistry.isInstalled(sandboxEnv.workspaceId, normalizedTools);
    if (isCached) {
      toolRegistry.recordCacheHit();
    } else {
      const installResult = await poolManager.installTools(sandboxEnv.workspaceId, normalizedTools);
      if (installResult.success) toolRegistry.markInstalled(sandboxEnv.workspaceId, normalizedTools);
      else toolRegistry.markFailed(sandboxEnv.workspaceId, new Error(installResult.errors));
    }
  }

  let executionCode = code;
  let buildArtifacts = null;

  // Handle multi-file projects
  if (isMultiFileProject(code)) {
    const filesystem = poolManager.getFileSystem(sandboxEnv.workspaceId, sandboxEnv._workspace);
    const writeResult = await writeProjectToFS(filesystem, code);
    if (!writeResult.success) throw new Error(`Failed to write project files: ${writeResult.error}`);

    if (shouldBuildSkill(skillId)) {
      try {
        const buildManager = poolManager.getBuildManager(sandboxEnv.workspaceId, sandboxEnv._workspace, filesystem);
        const buildResult = await buildProject(buildManager, skillId, true);
        if (buildResult.success) buildArtifacts = buildResult.artifacts;
      } catch { /* build failure is non-fatal */ }
    }

    executionCode = getEntryPointCode(code);
    if (!executionCode) throw new Error(`Entry point code not found: ${code.entryPoint}`);
  }

  return { executionCode, buildArtifacts };
}

async function dispatchExecution(
  sandboxEnv: any,
  executionCode: string | any,
  skill: any,
  timeoutMs: number,
  maxFrames: number | undefined,
  sessionId: string | null
): Promise<any> {
  const adapter = getAdapter(skill.runtime?.adapter ?? "javascript");

  const context = {
    workspace: sandboxEnv._workspace,
    execute: (payload: string) => sandboxEnv.execute(payload)
  };

  const execStartMs = Date.now();
  const result = await adapter.execute(context, executionCode, {
    timeoutMs,
    maxFrames,
    sessionId
  });

  traceEvent("sandbox.execute_complete", {
    skillId: skill.id,
    workspaceId: sandboxEnv?.workspaceId ?? null,
    execMs: Date.now() - execStartMs,
    success: result.success,
    adapter: adapter.kind
  });

  return result;
}

async function releaseSandbox(sandboxEnv: any, dedicatedKey: string | null): Promise<void> {
  if (!sandboxEnv) return;
  if (dedicatedKey) {
    await dedicatedSandboxManager.releaseForKey(dedicatedKey, sandboxEnv).catch(() => {});
  } else {
    await poolManager.release(sandboxEnv).catch(() => {});
  }
}

// ── Public API ────────────────────────────────────────────────────────

export async function executeSkillRuntime({ skillId, code, timeoutMs, maxFrames, turnDeadlineAtMs = null, sessionId = null, tools = [] }: any) {
  const skill = getSkillRuntimeProfile(skillId);
  const startedAt = Date.now();
  const traceCtx = getTraceContext();
  const effectiveSessionId = sessionId ?? traceCtx.sessionId ?? null;

  let sandboxEnv: any = null;
  let dedicatedKey: string | null = null;
  let acquireDiagnostics: any = null;

  try {
    // ── 1. Acquire ──
    const acquireResult = await acquireSandbox(skillId, turnDeadlineAtMs, effectiveSessionId);

    sandboxEnv = acquireResult.sandboxEnv;
    acquireDiagnostics = acquireResult.acquireDiagnostics;
    dedicatedKey = acquireResult.dedicatedKey;

    // ── 2. Prepare ──
    const effectiveTools = tools.length > 0 ? tools : (skill?.dependencies ?? []);
    const { executionCode, buildArtifacts } = await prepareSandbox(sandboxEnv, code, effectiveTools, skillId);

    // ── 3. Budget check before dispatch ──
    const executionBudgetMs = remainingBudgetMs(turnDeadlineAtMs);
    if (executionBudgetMs <= 0) throw new Error("Runtime budget exhausted before sandbox execution.");

    const effectiveTimeoutMs = timeoutMs ?? 2200;

    // ── 4. Dispatch ──
    const result = await dispatchExecution(sandboxEnv, executionCode, skill, effectiveTimeoutMs, maxFrames, effectiveSessionId);

    return recordAndReturn(skillId, startedAt, {
      success: result.success,
      status: result.status,
      previewUrl: result.success ? (result.previewUrl ?? "about:blank") : null,
      outputKind: result.outputKind ?? "code",
      mediaType: result.mediaType ?? null,
      mediaUrl: result.mediaUrl ?? null,
      skillId: skill?.id,
      durationMs: Date.now() - startedAt,
      renderCount: result.renderCount || 0,
      error: result.error || null,
      buildArtifacts,
      acquireDiagnostics
    });
  } catch (error: any) {
    return recordAndReturn(skillId, startedAt, {
      success: false,
      status: "error",
      skillId: skill?.id,
      durationMs: Date.now() - startedAt,
      error: error?.message || String(error),
      acquireDiagnostics
    });
  } finally {
    // ── 5. Release ──
    await releaseSandbox(sandboxEnv, dedicatedKey);
  }
}

function recordAndReturn(skillId: string, startedAt: number, result: any): any {
  recordSkillExecution(skillId, {
    success: Boolean(result.success),
    durationMs: result.durationMs ?? 0,
    errorCode: result.errorCode ?? (result.error ? "RUNTIME_EXEC_ERROR" : null)
  });
  return result;
}

export function getSandboxRuntimeMetrics() {
  return poolManager.getMetricsSnapshot();
}

export function warmupSandboxForSkill(skillId: string) {
  if (skillId) poolManager.requestWarmup(skillId);
}

export async function shutdownSandboxRuntime(options = {}) {
  await poolManager.shutdown(options);
}

export async function cleanupAllDaytonaSandboxes() {
  return poolManager.cleanupAllOrganizationSandboxes();
}