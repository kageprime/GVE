import type { StateCreator } from "zustand";
import type { ChatState, UIAgentState, UIIterationState } from "./types";
import type { WorkspaceRecord, WorkspaceFileEntry } from "../../api";
import { listProviders, resolveWebSocketUrl } from "../../api";
import { queryClient } from "../../lib/query-client";
import { handleWsMessage } from "./wsMessageHandler";

export interface InfraSlice {
  connectionState: "connecting" | "open" | "closed" | "error";
  providers: any[];
  activeProviderId: string;
  agentState: UIAgentState | null;
  iterationState: UIIterationState | null;
  pendingApproval: ChatState["pendingApproval"];

  setActiveProvider: (providerId: string) => void;
  fetchProviders: () => Promise<void>;
  updateAgentState: (state: UIAgentState | null) => void;
  setAgentAnalyzing: (isAnalyzing: boolean) => void;
  clearAgentState: () => void;
  setPendingApproval: (approval: ChatState["pendingApproval"]) => void;
  updateIterationState: (state: UIIterationState | null) => void;
  abortIteration: () => void;

  _ws: WebSocket | null;
  _wsSeq: number;
  connectWebSocket: () => void;
  handleWorkspaceUpdate: (payload: any) => void;
  handleFilePatched: (payload: any) => void;
  sendApprovalResponse: (approved: boolean) => void;
}

export const createInfraSlice: StateCreator<ChatState, [], [], InfraSlice> = (set, get) => ({
  connectionState: "closed",
  providers: [],
  activeProviderId: "auto",
  agentState: null,
  iterationState: null,
  pendingApproval: null,
  _ws: null,
  _wsSeq: 0,

  setActiveProvider: (providerId) => set({ activeProviderId: providerId }),

  fetchProviders: async () => {
    try {
      const providers = await listProviders();
      set({ providers: (providers as any).providers ?? [] });
    } catch { /* provider list is non-critical */ }
  },

  updateAgentState: (state) => set({ agentState: state }),

  setAgentAnalyzing: (isAnalyzing) =>
    set((s) => ({
      agentState: s.agentState ? { ...s.agentState, isAnalyzing } : null,
    })),

  clearAgentState: () => set({ agentState: null }),

  setPendingApproval: (approval) => set({ pendingApproval: approval }),

  updateIterationState: (state) => set({ iterationState: state }),

  abortIteration: () => set({ iterationState: null }),

  connectWebSocket: () => {
    const state = get();
    if (state._ws && state._ws.readyState === WebSocket.OPEN) return;

    const wsUrl = resolveWebSocketUrl("/ws");
    set({ connectionState: "connecting" });

    const ws = new WebSocket(wsUrl);
    state._ws = ws;

    ws.onopen = () => {
      set({ connectionState: "open" });
      const sessionId = get().activeSessionId;
      if (sessionId) {
        ws.send(JSON.stringify({ type: "session.resume", payload: { sessionId, lastSeq: get()._wsSeq } }));
      }
    };


    ws.onclose = () => set({ connectionState: "closed" });

    ws.onerror = () => set({ connectionState: "error" });

    ws.onmessage = (event) => handleWsMessage(event, set, get, queryClient);
  },

  handleWorkspaceUpdate: (payload: any) => {
    if (!payload) return;
    set({
      workspaceRecord: payload.workspace ?? payload,
    });
  },

  handleFilePatched: (payload: any) => {
    if (!payload?.path) return;
    set((state) => {
      const record = state.workspaceRecord;
      if (!record || !record.files) return {};

      const updatedFiles = { ...record.files };

      if (payload.kind === "remove") {
        delete updatedFiles[payload.path];
      } else if (payload.patchedContent || payload.content) {
        updatedFiles[payload.path] = {
          ...updatedFiles[payload.path],
          path: payload.path,
          content: payload.patchedContent ?? payload.content ?? "",
          purpose: payload.explanation ?? updatedFiles[payload.path]?.purpose ?? "",
          skill: updatedFiles[payload.path]?.skill ?? "unknown",
        } as WorkspaceFileEntry;
      }

      return {
        workspaceRecord: {
          ...record,
          files: updatedFiles,
          updatedAt: new Date().toISOString(),
        } as WorkspaceRecord,
      };
    });
  },

  sendApprovalResponse: (approved: boolean) => {
    const ws = (get() as any)._ws as WebSocket | null;
    const pending = (get() as any).pendingApproval;
    if (!ws || ws.readyState !== WebSocket.OPEN || !pending) return;

    ws.send(JSON.stringify({
      type: approved ? "user:approve" : "user:reject",
      payload: {
        sessionId: pending.sessionId,
        stepId: pending.stepId,
      }
    }));

set({ pendingApproval: null });
  },

});