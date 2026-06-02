import {
  appendOrchestrationTrace,
  appendSessionMessage,
  listSessionMessages,
  recordSceneVersion,
  buildSceneUpdatePayload,
  setSessionStatus,
  updateSessionMessage
} from "../../state/session.js";
import { broadcastEvent, broadcastThought } from "../../ws/streaming.js";
import { buildAgentActivity } from "./agent-activity.js";
import { buildAssistantMessageMeta } from "./turn-execution-helpers.js";
import { buildTurnLifecyclePayload, buildTurnResultSummary } from "./turn-summary.js";
import { CoordinatorAgent, type CoordinatorEvent } from "../../agents/coordinator-agent.js";
import { getTraceContext } from "../../trace/context.js";

export type AgentTurnParams = {
  sessionId: string;
  content: string;
  imageUrl: string | null;
  imageData: string | null;
  sessionState: any;
  effectivePreferences: Record<string, unknown>;
  assistantMessageId: string;
  turnRequestId: string;
  userMessage: unknown;
};

/**
 * Agent turn path — routes to the tool-using coordinator with live streaming.
 *
 * Every coordinator event is mapped to existing broadcast primitives so the
 * frontend sees real-time progress without any new WebSocket handler code.
 *
 * Phase 2: Records scene versions and emits standard events (scene:update,
 * generation:complete, code:update) so the frontend preview panel works.
 */
export async function executeAgentTurnPath(params: AgentTurnParams) {
  const {
    sessionId,
    content,
    imageUrl,
    imageData,
    sessionState,
    effectivePreferences,
    assistantMessageId,
    turnRequestId,
    userMessage
  } = params;

  const thoughtContextBase = { requestId: turnRequestId, messageId: assistantMessageId };
  const stepDurationsMs: Record<string, number> = {};

  const forcedMode = String(effectivePreferences?.mode ?? "").trim().toLowerCase();

  // ── Start ──
  broadcastEvent("turn:started", { sessionId, content, mode: "agent" });
  broadcastEvent("agent:activity", buildAgentActivity({
    sessionId,
    messageId: assistantMessageId,
    step: "agent_thinking",
    status: "running",
    payload: { content }
  }));

  await broadcastThought(sessionId, "turn_started", {
    ...thoughtContextBase,
    query: content,
    llmThoughts: null
  });

  setSessionStatus(sessionId, "planning" as any);
  const agentStart = Date.now();

  // ── Provision sandbox for tool calls ──
  // When SKILL_RUNTIME=daytona, use Daytona sandboxes for all file/shell
  // operations. Otherwise, fall back to local Docker containers.
  const skillRuntime = process.env.SKILL_RUNTIME ?? "docker";
  const useDaytona = skillRuntime === "daytona";
  let dedicatedKey: string | null = null;
  let daytonaEnv: any = null;

  if (useDaytona) {
    try {
      const { getDedicatedSandboxInstance } = await import(
        "../../sandbox/dedicated-manager.js"
      );
      const { createSandboxFileSystem } = await import(
        "@visual-runtime/sandbox-pool"
      );
      const { setWorkspace: setDaytonaWs } = await import(
        "../../sandbox/daytona-workspace-store.js"
      );
      const dedicatedMgr = getDedicatedSandboxInstance();
      if (dedicatedMgr) {
        const traceCtx = getTraceContext();
        dedicatedKey = dedicatedMgr.getKey({ userId: traceCtx?.userId, sessionId }) ?? `session:${sessionId}`;
        daytonaEnv = await dedicatedMgr.acquireForKey(dedicatedKey, {
          skillId: "manim",
        });
        const filesystem = createSandboxFileSystem(
          daytonaEnv.workspaceId,
          daytonaEnv._workspace
        );

        // Create session-scoped working directory
        const sessionDir = `/home/user/projects/${sessionId}`;
        try {
          await daytonaEnv._workspace.process.executeCommand(`mkdir -p "${sessionDir}"`);
        } catch {
          // Best-effort directory creation
        }

        setDaytonaWs(sessionId, {
          workspaceId: daytonaEnv.workspaceId,
          workspace: daytonaEnv._workspace,
          filesystem,
          executeCommand: (cmd: string, opts?: { timeoutMs?: number }) => daytonaEnv._workspace.process.executeCommand(cmd, opts),
          nativeFs: daytonaEnv._workspace.fs,
          sessionDir,
        });
        console.log(
          `[AgentTurn] Provisioned Daytona sandbox for ${sessionId}: workspace=${daytonaEnv.workspaceId} key=${dedicatedKey}`
        );
      }
    } catch (daytonaErr: any) {
      console.warn(
        `[AgentTurn] Daytona provisioning failed for ${sessionId}, falling back to Docker: ${daytonaErr?.message ?? daytonaErr}`
      );
    }
  }

  if (!useDaytona || !daytonaEnv) {
    const { createSandbox, activeContainers } = await import(
      "../../sandbox/manager.js"
    );
    if (!activeContainers.has(sessionId)) {
      try {
        const containerInfo = await createSandbox({
          sessionId,
          keepAlive: true,
        });
        try {
          const { exec: _exec } = await import("child_process");
          const { promisify: _prom } = await import("util");
          await _prom(_exec)(
            `chmod -R 777 "${containerInfo.workspacePath}"`
          );
        } catch (permErr: any) {
          console.warn(
            `[AgentTurn] chmod workspace failed (non-fatal): ${permErr?.message ?? permErr}`
          );
        }
        console.log(
          `[AgentTurn] Provisioned Docker sandbox for ${sessionId}: container=${containerInfo.containerId.slice(0, 8)}`
        );
      } catch (sandboxErr: any) {
        console.warn(
          `[AgentTurn] Failed to provision sandbox for ${sessionId}: ${sandboxErr?.message ?? sandboxErr}`
        );
      }
    }
  }

  // ── Execute multi-agent turn with live event streaming ──
  const { CoordinatorAgent } = await import("../../agents/coordinator-agent.js");
  const coordinator = new CoordinatorAgent();
  const result = await coordinator.runTurn(
    {
      sessionId,
      query: content,
      imageUrl,
      imageData,
      preferences: effectivePreferences,
      sessionState,
      assistantMessageId,
      turnRequestId,
      userMessage: content,
    },
    async (event: CoordinatorEvent) => {
      switch (event.type) {
        case "coordinator:thinking": {
          await broadcastThought(sessionId, "agent_thinking", {
            ...thoughtContextBase,
            query: content,
            detail: `Iteration ${event.payload.iteration}`,
            llmThoughts: null
          });
          break;
        }

        case "coordinator:tool_call": {
          await broadcastThought(sessionId, "agent_tool_called", {
            ...thoughtContextBase,
            query: content,
            toolName: event.payload.name,
            llmThoughts: null
          });
          broadcastEvent("agent:activity", buildAgentActivity({
            sessionId,
            messageId: assistantMessageId,
            step: `tool_call_${event.payload.name}`,
            status: "running",
            payload: { tool: event.payload.name, callId: event.payload.callId }
          }));
          break;
        }

        case "coordinator:tool_result": {
          const status = event.payload.success ? "completed" : "failed";
          await broadcastThought(sessionId, event.payload.success ? "agent_tool_result" : "turn_error", {
            ...thoughtContextBase,
            query: content,
            toolName: event.payload.name,
            detail: String(event.payload.output ?? "").slice(0, 200),
            llmThoughts: null
          });
          broadcastEvent("agent:activity", buildAgentActivity({
            sessionId,
            messageId: assistantMessageId,
            step: `tool_result_${event.payload.name}`,
            status,
            payload: {
              tool: event.payload.name,
              callId: event.payload.callId,
              success: event.payload.success,
              durationMs: event.payload.durationMs
            }
          }));

          // Also emit raw tool:result for any direct consumers
          broadcastEvent("tool:result", {
            sessionId,
            callId: event.payload.callId,
            tool: event.payload.name,
            success: event.payload.success,
            output: event.payload.output,
            durationMs: event.payload.durationMs,
            rawResult: event.payload.rawResult ?? null,
          });
          break;
        }

        case "coordinator:file_complete": {
          broadcastEvent("agent:file_complete", {
            sessionId,
            path: event.payload.path,
            previewUrl: event.payload.previewUrl,
            lines: event.payload.lines ?? 0
          });
          broadcastEvent("agent:activity", buildAgentActivity({
            sessionId,
            messageId: assistantMessageId,
            step: "file_complete",
            status: "completed",
            payload: {
              path: event.payload.path,
              previewUrl: event.payload.previewUrl,
              lines: event.payload.lines
            }
          }));
          break;
        }

        case "coordinator:scene_ready": {
          broadcastEvent("scene:update", {
            sessionId,
            scene: {
              code: event.payload.code,
              skill: event.payload.skill,
              sceneId: event.payload.sceneId,
              streaming: false,
              streamingComplete: true,
            },
          });
          break;
        }

        case "coordinator:complete": {
          stepDurationsMs.agent = Date.now() - agentStart;
          await broadcastThought(sessionId, "turn_complete", {
            ...thoughtContextBase,
            query: content,
            detail: `${event.payload.totalToolCalls} tool calls across ${event.payload.iterations} iteration(s)`,
            llmThoughts: null
          });
          break;
        }

        case "coordinator:error": {
          stepDurationsMs.agent = Date.now() - agentStart;
          await broadcastThought(sessionId, "turn_error", {
            ...thoughtContextBase,
            query: content,
            error: event.payload.error,
            llmThoughts: null
          });
          break;
        }
      }
    },
    (token: string) => {
      broadcastEvent("message.append", {
        sessionId,
        message: {
          id: assistantMessageId,
          role: "assistant",
          content: token,
          kind: "streaming"
        }
      });
    }
  );

  // Ensure step duration is recorded even if no complete event fired
  if (!stepDurationsMs.agent) {
    stepDurationsMs.agent = Date.now() - agentStart;
  }

  let assistantText = result.response ?? "";

  // Record scene if the coordinator produced one
  const rawScene = result.recordedScene;

  // Snapshot workspace file tree into the scene if Daytona is active
  if (rawScene && daytonaEnv?.nativeFs) {
    try {
      const sessionDir = daytonaEnv.sessionDir ?? `/home/user/projects/${sessionId}`;
      const fileList = await daytonaEnv.nativeFs.listFiles(sessionDir);
      const files: Record<string, any> = {};
      for (const file of (fileList ?? [])) {
        files[file.path ?? file.name] = {
          path: file.path ?? file.name,
          size: file.size ?? 0,
          isDir: file.isDir ?? false,
          modifiedAt: file.modTime ?? new Date().toISOString(),
        };
      }
      rawScene.workspace = {
        files,
        entryPoint: "index.html",
        dependencies: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    } catch {
      // Best-effort workspace snapshot
    }
  }

  const recordedScene = rawScene ? recordSceneVersion(sessionId, rawScene) : null;

  // If a scene was recorded, always present a clean scene description.
  if (recordedScene?.currentScene?.code) {
    const sceneDesc = recordedScene.currentScene.explanation ?? recordedScene.currentScene.sceneId ?? "scene";
    assistantText = `${sceneDesc}\n\nPreview is available in the workspace.`;
  } else if (!assistantText || assistantText === "No response generated.") {
    if (result.error) {
      assistantText = `Agent encountered an error: ${result.error}`;
    } else {
      assistantText = "No response generated.";
    }
  }

  // ── Finalize assistant message ──
  const turnResult = {
    sceneId: recordedScene?.currentScene?.sceneId ?? null,
    skill: recordedScene?.currentScene?.skill ?? null,
    sceneVersion: recordedScene?.currentScene?.version ?? null,
    previewUrl: recordedScene?.currentScene?.previewUrl ?? null,
    outputKind: recordedScene?.currentScene?.outputKind ?? null
  };

  const assistantMessage = await updateSessionMessage(sessionId, assistantMessageId, {
    content: assistantText,
    kind: forcedMode === "modify" ? "modify" : "agent",
    error: result.success ? null : { message: result.error },
    meta: buildAssistantMessageMeta(turnRequestId, {
      mode: forcedMode === "modify" ? "modify" : "agent",
      assistantSource: "agent-coordinator",
      result: result.success ? turnResult : null
    }, null)
  }) ?? await appendSessionMessage(sessionId, {
    id: assistantMessageId,
    role: "assistant",
    content: assistantText,
    kind: forcedMode === "modify" ? "modify" : "agent",
    error: result.success ? null : { message: result.error },
    meta: buildAssistantMessageMeta(turnRequestId, {
      mode: forcedMode === "modify" ? "modify" : "agent",
      assistantSource: "agent-coordinator",
      result: result.success ? turnResult : null
    }, null)
  });

  broadcastEvent("message.append", { sessionId, message: assistantMessage });

  // Emit generation / code events if a scene was recorded
  if (recordedScene && recordedScene.currentScene) {
    const isModify = forcedMode === "modify";
    broadcastEvent(isModify ? "code:update" : "generation:complete", {
      sessionId,
      sceneId: recordedScene.currentScene.sceneId,
      previewUrl: recordedScene.currentScene.previewUrl,
      skill: recordedScene.currentScene.skill,
      code: recordedScene.currentScene.code,
      sceneVersion: recordedScene.currentScene.version ?? 0,
      mode: isModify ? "modify" : "generate",
      explanation: recordedScene.currentScene.explanation ?? assistantText
    });
  }

  // ── Turn summary ──
  const turnSummary = buildTurnResultSummary(
    forcedMode === "modify" ? "modify" : "agent",
    result.success ? { ...turnResult, code: recordedScene?.currentScene?.code ?? null, outputKind: recordedScene?.currentScene?.outputKind ?? null } : null,
    sessionState,
    {
      assistantSource: "agent-coordinator",
      assistantWarning: null,
      assistantLlm: null
    }
  );

  await broadcastThought(sessionId, "turn_complete", {
    ...thoughtContextBase,
    query: content,
    llmThoughts: null
  });

  appendOrchestrationTrace(sessionId, {
    step: "turn_complete",
    payload: {
      sessionId,
      mode: forcedMode === "modify" ? "modify" : "agent",
      messageCount: listSessionMessages(sessionId).length,
      toolCalls: result.steps?.length ?? 0,
      toolResults: 0,
      agentSuccess: result.success,
      agentError: result.error ?? null,
      durationMs: stepDurationsMs.agent
    }
  });

  setSessionStatus(sessionId, "idle");

  const turnEventType = result.success ? "turn:complete" : "turn:error";

  broadcastEvent(turnEventType, {
    sessionId,
    requestId: turnRequestId,
    mode: forcedMode === "modify" ? "modify" : "agent",
    messageCount: listSessionMessages(sessionId).length,
    ...buildTurnLifecyclePayload(turnSummary),
    timings: { stepDurationsMs },
    error: result.success ? null : { message: result.error },
    message: result.success ? null : (result.error ?? "Agent turn failed"),
    agentMeta: {
      toolCalls: result.steps?.length ?? 0,
      toolResults: 0
    }
  });

  broadcastEvent("agent:activity", buildAgentActivity({
    sessionId,
    messageId: assistantMessageId,
    step: "turn_complete",
    status: result.success ? "completed" : "failed",
    payload: result.success ? {} : { error: result.error }
  }));

  // ── Release Daytona workspace ──
  if (dedicatedKey && daytonaEnv) {
    try {
      const { removeWorkspace: removeDaytonaWs } = await import(
        "../../sandbox/daytona-workspace-store.js"
      );
      const { getDedicatedSandboxInstance } = await import(
        "../../sandbox/dedicated-manager.js"
      );
      const dedicatedMgr = getDedicatedSandboxInstance();
      if (dedicatedMgr) {
        await dedicatedMgr.releaseForKey(dedicatedKey, daytonaEnv);
      }
      removeDaytonaWs(sessionId);
    } catch (releaseErr: any) {
      console.warn(
        `[AgentTurn] Daytona release failed (non-fatal): ${releaseErr?.message ?? releaseErr}`
      );
    }
  }

  return {
    sessionId,
    mode: forcedMode === "modify" ? "modify" : "agent",
    intent: null,
    assistantSource: "agent-coordinator" as string | null,
    assistantWarning: null as boolean | null,
    assistantLlm: null as string | null,
    userMessage,
    assistantMessage,
    sceneState: recordedScene ?? sessionState,
    messages: listSessionMessages(sessionId),
    result: {
      toolCalls: result.steps?.length ?? 0,
      toolResults: 0,
      agentSuccess: result.success,
      agentError: result.error ?? null,
      sceneId: turnResult.sceneId,
      code: recordedScene?.currentScene?.code ?? null
    },
    turnSummary,
    stepDurationsMs
  };
}
