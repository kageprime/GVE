import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import type { ChatState } from "./types";
import { createSessionSlice } from "./sessionSlice";
import { createComposerSlice } from "./composerSlice";
import { createPipelineSlice } from "./pipelineSlice";
import { createInfraSlice } from "./infraSlice";
import { createSupabaseStorage } from "./supabaseStorage";

const storage = createSupabaseStorage("terranet-chat-storage");

export const useChatStore = create<ChatState>()(
  devtools(
    persist(
      (...a) => ({
        ...createSessionSlice(...a),
        ...createComposerSlice(...a),
        ...createPipelineSlice(...a),
        ...createInfraSlice(...a),

        initialize: async () => {
          const state = a[1]();
          if ((state as any).isBootstrapping) return;

          // Always connect WebSocket on every init — connection state should reflect reality
          state.connectWebSocket?.();

          if ((state as any).hasInitialized) {
            return;
          }
          a[0]({ isBootstrapping: true } as any);
          try {
            // Sessions load via React Query; only fetch providers here
            await (state as any).fetchProviders?.();
            a[0]({ hasInitialized: true, isBootstrapping: false } as any);
          } catch {
            a[0]({ isBootstrapping: false } as any);
          }
        },

        sendSceneCommand: async (_command: any) => {},
      }),
      {
        name: "terranet-chat-storage",
        version: 1,
        migrate: (persistedState, _version) => persistedState as ChatState,
        partialize: (state): Partial<ChatState> => ({
          activeSessionId: state.activeSessionId,
          isSidebarCollapsed: state.isSidebarCollapsed,
          panelWidth: state.panelWidth,
        }),
        storage: storage as any,
      }
    ),
    { name: "chat-store" }
  )
);