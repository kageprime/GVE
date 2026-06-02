import { nowIso } from "./helpers";
import type { AgentResult } from "./types";

export function handleWsMessage(
  event: MessageEvent,
  set: (partial: any) => void,
  get: () => any,
  queryClient: any,
): void {
  try {
    const msg = JSON.parse(event.data);
    const seq = Number(msg.seq ?? 0);
    if (seq > get()._wsSeq) set({ _wsSeq: seq } as any);

    switch (msg.type) {
      case "thought:stream": {
        const thoughtText = msg.payload?.thought || "";
        const step = msg.payload?.step || "thinking";
        const toolName = msg.payload?.toolName || null;
        const isFinal = msg.payload?.isFinal ?? false;
        const sessionId = msg.payload?.sessionId;
        set({
          thinkingText: thoughtText || null,
          thinkingStep: step,
          thinkingToolName: toolName,
        });

        const isTrivialLifecycle =
          (step === "turn_started" || step === "turn_complete") &&
          (!msg.payload?.detail || msg.payload?.detail === "");

        if (isFinal && thoughtText && sessionId && !isTrivialLifecycle) {
          const requestId = msg.payload?.requestId ?? null;
          const messageId = msg.payload?.messageId ?? null;
          const stepLabel = msg.payload?.stepLabel ?? null;
          const durationMs = msg.payload?.durationMs ?? null;
          const detail = msg.payload?.detail ?? null;
          const thoughtMessageId = `thought-${step}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;

          const meta = [
            step,
            requestId ? `requestId:${requestId}` : null,
            messageId ? `messageId:${messageId}` : null,
            stepLabel ? `stepLabel:${stepLabel}` : null,
            durationMs ? `durationMs:${durationMs}` : null,
            detail ? `detail:${detail}` : null,
            "status:completed"
          ].filter((m): m is string => Boolean(m));

          (get() as any).addMessage(sessionId, {
            id: thoughtMessageId,
            role: "thought",
            content: thoughtText,
            kind: "thought",
            meta,
            error: null,
            createdAt: nowIso(),
            updatedAt: nowIso(),
          });

          queryClient.invalidateQueries({ queryKey: ["messages", sessionId] });
        }
        break;
      }

      case "message:append":
      case "message.append": {
        const p = msg.payload;
        const m = p?.message;
        const sessionId = p?.sessionId;
        if (!sessionId || !m) break;

        const messageId = m.messageId || m.id;
        if (!messageId || m.content == null) break;

        const state = get() as any;
        const existing = state.messages[sessionId] || [];
        const targetIndex = existing.findIndex((msg: any) => msg.id === messageId);
        if (targetIndex >= 0) {
          const target = existing[targetIndex];
          const isStreaming = target.kind === "streaming" && m.kind === "streaming";
          const nextContent = isStreaming ? target.content + m.content : m.content;
          const nextKind = m.kind || target.kind || "message";

          const updated = [...existing];
          updated[targetIndex] = {
            ...target,
            ...m,
            content: nextContent,
            kind: nextKind,
            updatedAt: nowIso(),
          };
          set({ messages: { ...state.messages, [sessionId]: updated } });
        } else {
          state.addMessage(sessionId, {
            id: messageId,
            role: m.role || "assistant",
            content: m.content,
            kind: m.kind || "message",
            meta: m.meta || [],
            error: m.error || null,
            createdAt: m.createdAt || nowIso(),
            updatedAt: m.createdAt || nowIso(),
          });
        }

        const cacheKey = ["messages", sessionId];
        const cached = queryClient.getQueryData(cacheKey) as any[] ?? [];
        const cachedIndex = cached.findIndex((msg: any) =>
          (msg.id || msg.messageId) === messageId
        );
        if (cachedIndex >= 0) {
          const nextContentCached = cached[cachedIndex].kind === "streaming" && m.kind === "streaming"
            ? cached[cachedIndex].content + m.content
            : m.content;
          const nextKindCached = m.kind || cached[cachedIndex].kind || "message";
          const updatedCache = [...cached];
          updatedCache[cachedIndex] = {
            ...updatedCache[cachedIndex],
            content: nextContentCached,
            kind: nextKindCached,
            meta: m.meta || updatedCache[cachedIndex].meta || [],
            updatedAt: nowIso(),
          };
          queryClient.setQueryData(cacheKey, updatedCache);
        }
        break;
      }
      case "message:update": {
        const p = msg.payload;
        const m = p?.message;
        const sessionId = p?.sessionId;
        if (!sessionId || !m) break;

        const messageId = m.messageId || m.id;
        if (!messageId) break;

        const state = get() as any;
        const existing = state.messages[sessionId] || [];
        const updates = { ...m, id: messageId };
        delete (updates as any).messageId;

        const targetIndex = existing.findIndex((msg: any) => msg.id === messageId);
        if (targetIndex >= 0) {
          const updated = [...existing];
          updated[targetIndex] = { ...existing[targetIndex], ...updates, updatedAt: nowIso() };
          set({ messages: { ...state.messages, [sessionId]: updated } });
        }

        const cacheKey = ["messages", sessionId];
        const cached = queryClient.getQueryData(cacheKey) as any[] ?? [];
        const cachedIndex = cached.findIndex((msg: any) =>
          (msg.id || msg.messageId) === messageId
        );
        if (cachedIndex >= 0) {
          const updatedCache = [...cached];
          updatedCache[cachedIndex] = {
            ...updatedCache[cachedIndex],
            ...updates,
            updatedAt: nowIso(),
          };
          queryClient.setQueryData(cacheKey, updatedCache);
        }
        break;
      }

      case "scene:update":
      case "code:update":
      case "generation:complete": {
        const p = msg.payload;
        const sessionId = p?.sessionId;
        if (!sessionId) break;

        const scene = p?.scene ?? null;
        const versions = p?.versions ?? [];
        const versionPointer = p?.currentVersionIndex ?? undefined;
        const workspace = p?.workspace ?? null;
        const previewUrl = p?.previewUrl ?? null;
        const sceneVersion = p?.sceneVersion ?? undefined;
        const mode = p?.mode ?? undefined;
        const skill = p?.skill ?? scene?.skill ?? null;
        const code = p?.code ?? scene?.code ?? null;
        const explanation = p?.explanation ?? null;

        set((state: any) => {
          const existing = state.sessions.find((s: any) => s.sessionId === sessionId);
          if (!existing) {
            const entry = {
              sessionId,
              sceneId: scene?.sceneId ?? null,
              versionCount: versions.length || 0,
              versionPointer: versionPointer ?? (versions.length > 0 ? versions.length - 1 : undefined),
              revisionCount: 0,
              artifactCount: 0,
              currentScene: scene ? {
                ...(scene ?? {}),
                code: code ?? scene?.code ?? null,
                skill: skill ?? scene?.skill ?? null,
                previewUrl: previewUrl ?? scene?.previewUrl ?? null,
                version: sceneVersion ?? scene?.version ?? undefined,
                streaming: false,
                streamingComplete: true,
              } : null,
              versions,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            return {
              sessions: [...state.sessions, entry],
              workspaceRecord: workspace ?? state.workspaceRecord,
            };
          }

          const mergedScene = scene
            ? { ...(existing.currentScene || {}), ...scene, code: code ?? scene?.code ?? existing.currentScene?.code, previewUrl: previewUrl ?? scene?.previewUrl ?? existing.currentScene?.previewUrl, streaming: false, streamingComplete: true }
            : existing.currentScene;

          return {
            sessions: state.sessions.map((s: any) =>
              s.sessionId === sessionId
                ? {
                    ...s,
                    currentScene: mergedScene,
                    versions: versions.length > 0 ? versions : s.versions,
                    versionPointer: versionPointer ?? s.versionPointer,
                    versionCount: versions.length > 0 ? versions.length : s.versionCount,
                  }
                : s
            ),
            workspaceRecord: workspace ?? state.workspaceRecord,
          };
        });

        const st = get() as any;
        if (sessionId === st.activeSessionId && st.panelOpen && st.panelView === "code") {
          st.openPanel("preview");
        }
        break;
      }

      case "agent:intent_ready": {
        const p = msg.payload;
        if (!p) break;
        set({
          thinkingStep: `intent_detected`,
          thinkingText: `Detected ${p.projectType} project (${p.complexity}) in ${p.domain} domain`,
        });
        break;
      }

      case "agent:plan_ready": {
        const p = msg.payload;
        if (!p?.files) break;
        const fileList = p.files.map((f: any) => f.path).join(", ");
        set({
          thinkingStep: "plan_ready",
          thinkingText: `Planned ${p.files.length} files: ${fileList}`,
        });
        break;
      }

      case "agent:file_start": {
        const p = msg.payload;
        if (!p?.path) break;
        set({
          thinkingStep: `generating_${p.path}`,
          thinkingText: `Generating ${p.path}...`,
        });
        break;
      }

      case "agent:file_complete": {
        const p = msg.payload;
        if (!p?.path) break;
        set((state: any) => ({
          thinkingStep: `file_complete`,
          thinkingText: `Completed ${p.path} (${p.lines} lines)`,
          agentFiles: [
            ...state.agentFiles,
            {
              path: p.path,
              previewUrl: p.previewUrl ?? null,
              lines: p.lines ?? null,
              createdAt: new Date().toISOString(),
            },
          ],
        }));
        break;
      }

      case "agent:validation_failed": {
        const p = msg.payload;
        if (!p?.errors) break;
        const errorCount = p.errors.length;
        set({
          thinkingStep: "validation_failed",
          thinkingText: `Validation found ${errorCount} error${errorCount !== 1 ? "s" : ""} â€” debugging...`,
        });
        break;
      }

      case "agent:patch_applied": {
        const p = msg.payload;
        if (!p?.path) break;
        set({
          thinkingStep: "patch_applied",
          thinkingText: `Patched ${p.path}`,
        });
        break;
      }

      case "agent:iteration_complete": {
        const p = msg.payload;
        if (!p) break;
        set({
          thinkingStep: "iteration_complete",
          thinkingText: `Iteration ${p.iteration}/${p.maxIterations} complete â€” ${p.errorsRemaining} errors remaining`,
        });
        break;
      }

      case "agent:complete": {
        const p = msg.payload;
        if (!p) break;
        set({
          isSending: false,
          activeRequestId: null,
          thinkingText: p.success
            ? `Generated ${p.fileCount} files successfully`
            : `Generation completed with ${p.fileCount} files`,
          thinkingStep: p.success ? "agent_complete" : "agent_partial",
          thinkingToolName: null,
        });
        break;
      }

      case "turn:complete": {
        const sessionId = msg.payload?.sessionId;
        if (!sessionId) break;
        set({
          isSending: false,
          activeRequestId: null,
          thinkingText: null,
          thinkingStep: "turn_complete",
          thinkingToolName: null,
        });
        queryClient.invalidateQueries({ queryKey: ["messages", sessionId] });
        queryClient.invalidateQueries({ queryKey: ["sessions"] });
        break;
      }

      case "turn:error": {
        const sessionId = msg.payload?.sessionId;
        if (!sessionId) break;
        set({
          isSending: false,
          activeRequestId: null,
          thinkingText: null,
          thinkingStep: "turn_error",
          thinkingToolName: null,
          sessionsError: normalizeErrorText(msg.payload?.error, "An error occurred during processing."),
        });
        queryClient.invalidateQueries({ queryKey: ["messages", sessionId] });
        queryClient.invalidateQueries({ queryKey: ["sessions"] });
        break;
      }

      case "turn:aborted":
        set({
          isSending: false,
          activeRequestId: null,
          thinkingText: null,
          thinkingStep: "turn_aborted",
          thinkingToolName: null,
        });
        break;

      case "orchestration:step":
        if (msg.payload?.step) {
          set({
            thinkingStep: msg.payload.step,
            thinkingText: msg.payload.description || msg.payload.step,
          });
        }
        break;

      case "workspace:update":
        (get() as any).handleWorkspaceUpdate(msg.payload);
        break;

      case "file:patched":
        (get() as any).handleFilePatched(msg.payload);
        break;

      case "workspace:analysis":
        if (msg.payload) {
          const p = msg.payload;
          set((s: any) => ({
            iterationState: s.iterationState
              ? {
                  ...s.iterationState,
                  currentIteration: p.iteration ?? s.iterationState.currentIteration,
                  currentScore: p.compositeScore ?? s.iterationState.currentScore,
                  phase: p.compositeScore !== undefined
                    ? (p.compositeScore >= (s.iterationState.threshold ?? 80) ? "finalizing" : "scoring")
                    : s.iterationState.phase,
                }
              : null,
          }));
        }
        break;

      case "iteration:update":
        if (msg.payload) {
          set((s: any) => ({
            iterationState: s.iterationState
              ? {
                  ...s.iterationState,
                  currentIteration: (msg.payload.progress?.current ?? s.iterationState.currentIteration),
                  phase: msg.payload.progress?.phase ?? s.iterationState.phase,
                  currentScore: msg.payload.iteration?.qualitySignals?.composite ?? s.iterationState.currentScore,
                }
              : null,
          }));
        }
        break;

      case "agentState": {
        const p = msg.payload;
        if (p?.isAnalyzing === true) {
          (get() as any).setAgentAnalyzing(true);
        } else if (p?.isAnalyzing === false) {
          (get() as any).setAgentAnalyzing(false);
        }
        break;
      }

      case "agent:analysis_complete": {
        const p = msg.payload;
        if (!p) break;
        const results: Record<string, AgentResult> = {};
        if (p.results && typeof p.results === "object") {
          for (const [key, val] of Object.entries(p.results as Record<string, any>)) {
            results[key] = {
              id: val.id || key,
              name: val.name || key,
              score: typeof val.score === "number" ? val.score : 0,
              findings: Array.isArray(val.findings) ? val.findings : [],
              recommendations: Array.isArray(val.recommendations)
                ? val.recommendations.map((r: any) => ({
                    action: typeof r === "string" ? r : (r.action ?? r.description ?? ""),
                    impact: typeof r.impact === "number" ? r.impact : (typeof r.severity === "number" ? r.severity : 5),
                    confidence: typeof r.confidence === "number" ? r.confidence : 50,
                    category: r.category ?? "structure",
                  }))
                : [],
            };
          }
        }
        const consensus = typeof p.consensus === "number" ? p.consensus : 0;
        const recs = Array.isArray(p.recommendations)
          ? p.recommendations.map((r: any, i: number) => ({
              agentId: r.agent ?? r.agentId ?? "unknown",
              action: typeof r === "string" ? r : (r.action ?? r.description ?? ""),
              impact: typeof r.impact === "number" ? r.impact : (typeof r.priority === "number" ? (5 - r.priority) * 4 : 5),
              confidence: typeof r.confidence === "number" ? r.confidence : 50,
              category: r.category ?? "structure",
              priority: r.priority ?? i,
            }))
          : [];
        (get() as any).updateAgentState({
          isAnalyzing: false,
          results,
          consensus,
          shouldAutoApply: consensus >= 80,
          recommendations: recs,
          memory: [],
          lastAnalyzedAt: new Date().toISOString(),
        });
        break;
      }

      case "agent:activity": {
        const p = msg.payload;
        if (p?.step && p?.text) {
          set({
            thinkingStep: p.step,
            thinkingText: p.text,
            thinkingToolName: p.tool ?? null,
          });
        }
        break;
      }

      case "tool:result": {
        const p = msg.payload;
        if (!p?.tool) break;
        set((state: any) => ({
          agentToolLog: [
            ...state.agentToolLog,
            {
              id: p.callId || `tool-${Date.now()}`,
              tool: p.tool,
              status: p.success ? "success" : "error",
              output: String(p.output ?? "").slice(0, 500),
              durationMs: p.durationMs ?? 0,
              timestamp: new Date().toISOString(),
              rawResult: p.rawResult ?? null,
            },
          ],
        }));
        break;
      }

      case "agent:approval_request": {
        const p = msg.payload;
        if (p?.sessionId && p?.stepId) {
          set({
            pendingApproval: {
              sessionId: p.sessionId,
              stepId: p.stepId,
              step: p.step || "unknown",
              description: p.description || "The agent needs your approval to continue.",
              deadline: p.deadline || Date.now() + 300_000,
            },
          });
        }
        break;
      }

      case "agent:approval_result": {
        const p = msg.payload;
        if (p?.resolved) {
          set({ pendingApproval: null });
        }
        break;
      }

      case "client:patch_result": {
        const p = msg.payload;
        if (p?.accepted && p?.patchedCode) {
          set((s: any) => {
            const session = s.sessions.find((sess: any) => sess.sessionId === p.sessionId);
            if (!session) return {};
            
            const updatedSessions = s.sessions.map((sess: any) => {
              if (sess.sessionId !== p.sessionId) return sess;
              return {
                ...sess,
                currentScene: {
                  ...(sess.currentScene || {}),
                  code: p.patchedCode,
                  patched: true,
                  patchIteration: p.iteration ?? 1,
                },
              };
            });

            return { sessions: updatedSessions };
          });
        }
        break;
      }

      case "client:vision_result": {
        const p = msg.payload;
        if (!p?.sessionId) break;

        const visualGoals = Array.isArray(p?.visualGoals) ? p.visualGoals : [];
        set((s: any) => {
          const updatedSessions = s.sessions.map((sess: any) => {
            if (sess.sessionId !== p.sessionId) return sess;
            return {
              ...sess,
              visualGoals,
            };
          });
          return { sessions: updatedSessions };
        });
        break;
      }
    }
  } catch { /* ws message parse failures are non-critical */ }
}

function normalizeErrorText(raw: unknown, fallback: string): string {
  if (!raw) return fallback;
  if (typeof raw === "string") return raw;
  if (typeof raw === "object" && raw !== null) {
    const e = raw as Record<string, unknown>;
    return String(e.userMessage || e.message || e.title || e.code || fallback);
  }
  return String(raw);
}