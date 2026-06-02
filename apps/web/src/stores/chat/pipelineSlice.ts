import type { StateCreator } from "zustand";
import type { ChatState, SessionTaskProgress, ActionBlock, TaskCheckpoint, SessionMessage } from "./types";
import {
  nowIso,
  upsertMessage,
} from "./helpers";

export interface PipelineSlice {
  isSending: boolean;
  activeRequestId: string | null;
  thinkingText: string | null;
  thinkingStep: string;
  thinkingToolName: string | null;
  showScrollToLatest: boolean;
  taskProgressBySession: Record<string, SessionTaskProgress>;
  actionBlocksByMessage: Record<string, ActionBlock[]>;
  currentTurnCheckpoints: TaskCheckpoint[];
  currentMessageId: string | null;

  setIsSending: (value: boolean) => void;
  setActiveRequestId: (id: string | null) => void;
  setThinking: (text: string | null, step?: string, toolName?: string | null) => void;
  addMessage: (sessionId: string, message: SessionMessage) => void;
  stopTurn: () => void;
  setActionBlocks: (messageId: string, blocks: ActionBlock[]) => void;
  updateActionBlock: (messageId: string, blockId: string, updates: Partial<ActionBlock>) => void;
  setCurrentTurnCheckpoints: (checkpoints: TaskCheckpoint[]) => void;
  setCurrentMessageId: (messageId: string | null) => void;
  clearActionBlocks: (messageId: string) => void;
}

export const createPipelineSlice: StateCreator<ChatState, [], [], PipelineSlice> = (set, get) => ({
  isSending: false,
  activeRequestId: null,
  thinkingText: null,
  thinkingStep: "idle",
  thinkingToolName: null,
  showScrollToLatest: true,
  taskProgressBySession: {},
  actionBlocksByMessage: {},
  currentTurnCheckpoints: [],
  currentMessageId: null,

  setIsSending: (value) =>
    set({
      isSending: value,
      ...(value ? { agentFiles: [], agentToolLog: [] } : {}),
    }),

  setActiveRequestId: (id) => set({ activeRequestId: id }),

  setThinking: (text, step, toolName) =>
    set({ thinkingText: text, thinkingStep: step ?? "thinking", thinkingToolName: toolName ?? null }),

  addMessage: (sessionId, message) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [sessionId]: upsertMessage(state.messages[sessionId] ?? [], message),
      },
    })),

  stopTurn: () => {
    const requestId = (get() as any).activeRequestId;
    const sessionId = (get() as any).activeSessionId;
    const ws = (get() as any)._ws as WebSocket | null;
    const abortedAt = nowIso();

    if (ws && ws.readyState === WebSocket.OPEN && requestId && sessionId) {
      try {
        ws.send(JSON.stringify({
          type: "turn.abort",
          payload: { sessionId, requestId }
        }));
      } catch {}
    }

    set((state) => ({
      isSending: false,
      activeRequestId: null,
      thinkingText: null,
      thinkingStep: "turn_aborted",
    }));
  },

  setActionBlocks: (messageId, blocks) =>
    set((state) => ({
      actionBlocksByMessage: { ...state.actionBlocksByMessage, [messageId]: blocks },
    })),

  updateActionBlock: (messageId, blockId, updates) =>
    set((state) => ({
      actionBlocksByMessage: {
        ...state.actionBlocksByMessage,
        [messageId]: (state.actionBlocksByMessage[messageId] || []).map((b) =>
          b.id === blockId ? { ...b, ...updates } : b
        ),
      },
    })),

  setCurrentTurnCheckpoints: (checkpoints) => set({ currentTurnCheckpoints: checkpoints }),

  setCurrentMessageId: (messageId) => set({ currentMessageId: messageId }),

  clearActionBlocks: (messageId) =>
    set((state) => {
      const { [messageId]: _omitted, ...remaining } = state.actionBlocksByMessage;
      void _omitted;
      return { actionBlocksByMessage: remaining };
    }),
});