import { useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listSessionMessages,
  sendSessionMessage,
  type SessionMessagesResponse,
  type ChatTurnResponse,
  type ChatTurnRequest,
} from "../../api";
import { useChatStore, type SessionMessage } from "../../stores";
import { nowIso, createClientMessageId, mergeMessages, dedupeMessages } from "../../stores/chat/helpers";

const MESSAGES_KEY = "messages" as const;

// Ref shared across hook instances to guard against React StrictMode double-fires
const _activeSendRef = { requestId: "" };

export function mapApiMessages(apiResponse: SessionMessagesResponse): SessionMessage[] {
  const apiMessages = apiResponse.messages ?? [];
  return apiMessages.map((m: any) => ({
    id: m.messageId || m.id || createClientMessageId("msg"),
    role: m.role,
    content: m.content,
    kind: m.kind || undefined,
    meta: m.meta || undefined,
    error: m.error || null,
    createdAt: m.createdAt || nowIso(),
    updatedAt: m.updatedAt || m.createdAt || nowIso(),
  }));
}

export function useSessionMessages(sessionId: string | null) {
  return useQuery({
    queryKey: [MESSAGES_KEY, sessionId],
    queryFn: async (): Promise<SessionMessage[]> => {
      if (!sessionId) return [];
      const response = await listSessionMessages(sessionId);
      return mapApiMessages(response);
    },
    enabled: Boolean(sessionId),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
}

export function useInvalidateMessages(sessionId: string | null) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: [MESSAGES_KEY, sessionId] });
  };
}

/**
 * Syncs fetched messages from TanStack Query into Zustand.
 * This bridges server state (React Query) with UI real-time state (Zustand).
 * WebSocket streaming updates still write directly to Zustand during active turns.
 */
export function useMessageSync(sessionId: string | null) {
  const { data, isSuccess, dataUpdatedAt, isFetching } = useSessionMessages(sessionId);
  const setMessages = useChatStore((s) => s.setMessages);
  const lastSyncedAtRef = useRef<number>(0);

  useEffect(() => {
    if (!isSuccess || !data || !sessionId) return;
    // Don't overwrite Zustand during an active turn to avoid losing streaming content.
    const state = useChatStore.getState();
    if (state.isSending && state.messages[sessionId]?.length) return;
    // Only sync when the query data has actually been refreshed (e.g. after refetch).
    // This prevents wiping WS-driven messages (thoughts, streaming chunks) when
    // isSending flips to false before the refetch completes.
    if (dataUpdatedAt <= lastSyncedAtRef.current) return;
    lastSyncedAtRef.current = dataUpdatedAt;

    // Merge Query cache into Zustand (upsert by ID). CRITICAL: never overwrite
    // non-empty content with empty content. WebSocket handlers may have already
    // received the final message content, while the Query cache refetch can
    // return stale empty placeholders if the server hasn't persisted the update yet.
    const current = useChatStore.getState().messages[sessionId] ?? [];
    const currentById = new Map(current.map((m) => [m.id, m]));

    const merged = data.map((incoming) => {
      const existing = currentById.get(incoming.id);
      if (!existing) return incoming;
      const preserveContent =
        existing.content &&
        (!incoming.content || incoming.content === "") &&
        existing.role === incoming.role;
      return preserveContent
        ? { ...incoming, content: existing.content, kind: existing.kind || incoming.kind }
        : incoming;
    });

    const mergedIds = new Set(merged.map((m) => m.id));
    const preserved = current.filter((m) => !mergedIds.has(m.id));

    const final = dedupeMessages([...merged, ...preserved]);
    setMessages(sessionId, final);
  }, [data, isSuccess, dataUpdatedAt, sessionId, setMessages]);

  return { isFetching };
}

// ── sendMessage mutation with optimistic updates ──

export type SendMessageVars = {
  content: string;
  mode?: "modify" | "generate" | "explain" | "debug" | "chat";
  imageUrl?: string;
  imageData?: string;
  requestId?: string;
  clientMessageId?: string;
};

export function useSendMessage() {
  const qc = useQueryClient();
  const setIsSending = useChatStore((s) => s.setIsSending);
  const setActiveRequestId = useChatStore((s) => s.setActiveRequestId);
  const setThinking = useChatStore((s) => s.setThinking);
  const addMessage = useChatStore((s) => s.addMessage);
  const setComposerValue = useChatStore((s) => s.setComposerValue);
  const setComposerImage = useChatStore((s) => s.setComposerImage);
  const setSessionsError = useChatStore((s) => s.setSessionsError);

  return useMutation({
    mutationKey: ["sendMessage"],
    retry: 0,

    mutationFn: async (vars: SendMessageVars): Promise<ChatTurnResponse> => {
      const sessionId = useChatStore.getState().activeSessionId;
      if (!sessionId) throw new Error("No active session");
      // Use IDs provided by the caller so optimistic and server messages share the same ID.
      const requestId = vars.requestId || `req-ws-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      // StrictMode guard: if this exact request is already in-flight, abort.
      if (_activeSendRef.requestId === requestId) {
        throw new Error("Duplicate mutation suppressed");
      }
      _activeSendRef.requestId = requestId;
      const userMessageId = vars.clientMessageId || createClientMessageId("user");
      const payload: ChatTurnRequest = {
        content: vars.content,
        mode: vars.mode ?? "generate",
        imageUrl: vars.imageUrl,
        imageData: vars.imageData,
        requestId,
        clientMessageId: userMessageId,
      };
      try {
        return await sendSessionMessage(sessionId, payload);
      } finally {
        _activeSendRef.requestId = "";
      }
    },

    onMutate: async (vars) => {
      const sessionId = useChatStore.getState().activeSessionId;
      if (!sessionId) return { previousMessages: [] as SessionMessage[], requestId: "", userMessageId: "" };

      // Cancel any in-flight refetch so it doesn't overwrite our optimistic update
      await qc.cancelQueries({ queryKey: [MESSAGES_KEY, sessionId] });

      // Reuse IDs provided by the caller; generate fallbacks only if absent.
      const requestId = vars.requestId || `req-ws-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const userMessageId = vars.clientMessageId || createClientMessageId("user");
      const userMessage: SessionMessage = {
        id: userMessageId,
        role: "user",
        content: vars.content,
        kind: "message",
        meta: [`requestId:${requestId}`],
        error: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };

      // Snapshot previous messages for rollback
      const previousMessages = qc.getQueryData<SessionMessage[]>([MESSAGES_KEY, sessionId]) ?? [];

      // Optimistically update Query cache
      qc.setQueryData([MESSAGES_KEY, sessionId], [...previousMessages, userMessage]);

      // Optimistically update Zustand (legacy UI reads from here)
      addMessage(sessionId, userMessage);

      // Set UI state
      setIsSending(true);
      setActiveRequestId(requestId);
      setThinking("Analyzing your request...", "turn_started");

      // Clear composer
      setComposerValue("");
      setComposerImage(null);

      return { previousMessages, requestId, userMessageId, sessionId };
    },

    onSuccess: (data, vars, context) => {
      if (!context || !context.sessionId) return;
      if (data?.messages && data.messages.length > 0) {
        // 1. Map server messages using messageId (server schema) with id fallback.
        const mapped = data.messages.map((m: any) => {
          const id = m.messageId || m.id || createClientMessageId("msg");
          const meta = m.meta || [];
          return {
            id,
            role: m.role,
            content: m.content,
            kind: m.kind,
            meta,
            error: m.error || null,
            requestId: getMetaValue(meta, "requestId:"),
            createdAt: m.createdAt || nowIso(),
            updatedAt: m.updatedAt || nowIso(),
          };
        });

        // 2. Update Query cache immediately so useMessageSync doesn't flash stale data
        qc.setQueryData([MESSAGES_KEY, context.sessionId], mapped);

        // 3. Merge server response into Zustand: update existing messages by ID,
        //    add new ones, and remove orphaned optimistics. This handles the case
        //    where WebSocket streaming placeholders have empty content and need
        //    to be filled by the REST response.
        const current = useChatStore.getState().messages[context.sessionId] ?? [];
        const optimisticId = vars.clientMessageId || context.userMessageId;
        const requestId = vars.requestId || context.requestId;

        // Build a map of server messages by ID
        const serverById = new Map(mapped.map((m) => [m.id, m]));

        // Update existing messages: if a message exists in both current and server,
        // use the server version (which has the final content).
        const updated = current.map((msg) => {
          const serverMsg = serverById.get(msg.id);
          if (serverMsg) {
            // Prefer server content (final) over streaming placeholder (empty/partial)
            return {
              ...msg,
              ...serverMsg,
              // Preserve the actual content if server has it; otherwise keep current
              content: serverMsg.content || msg.content,
              kind: serverMsg.kind || msg.kind,
            };
          }
          return msg;
        });

        // Remove optimistic user message if the server returned a different ID for it.
        const serverHasOptimisticId = serverById.has(optimisticId);
        const cleaned = serverHasOptimisticId
          ? updated
          : updated.filter((msg) => msg.id !== optimisticId);

        // Add any truly new messages from the server response.
        const currentIds = new Set(cleaned.map((msg) => msg.id));
        const delta = mapped.filter((m) => !currentIds.has(m.id));

        let merged = mergeMessages(cleaned, delta);
        merged = dedupeMessages(merged);
        useChatStore.getState().setMessages(context.sessionId, merged);
      }
      setIsSending(false);
      setActiveRequestId(null);
      setThinking(null, "turn_complete");
    },

    onError: (error, _vars, context) => {
      if (!context || !context.sessionId) return;
      // Rollback Query cache
      qc.setQueryData([MESSAGES_KEY, context.sessionId], context.previousMessages);

      const errorMessage = error instanceof Error ? error.message : "Unable to send message.";

      // Add error message to Zustand
      addMessage(context.sessionId, {
        id: createClientMessageId("error"),
        role: "assistant",
        content: errorMessage,
        kind: "error",
        meta: [`error:${errorMessage}`],
        error: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });

      setSessionsError(errorMessage);
      setIsSending(false);
      setActiveRequestId(null);
      setThinking(null, "turn_error");
    },

    onSettled: (_data, _error, _vars, context) => {
      const sessionId = context?.sessionId;
      if (!sessionId) return;
      qc.invalidateQueries({ queryKey: ["sessions"] });
      qc.invalidateQueries({ queryKey: [MESSAGES_KEY, sessionId] });
    },
  });
}

function getMetaValue(meta: string[] | undefined, prefix: string): string | null {
  if (!Array.isArray(meta)) return null;
  const matched = meta.find((entry) => entry.startsWith(prefix));
  if (!matched) return null;
  const parsed = matched.slice(prefix.length).trim();
  return parsed || null;
}
