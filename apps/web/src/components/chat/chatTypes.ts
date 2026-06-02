import type { Session, SessionMessage } from "../../stores";
import type { AgentFileEntry, AgentToolLogEntry } from "../../stores/chat/types";

export type ThoughtItem = {
  text: string;
  step: string;
  timestamp: number;
  meta?: string[];
  toolName?: string | null;
};

export type DisplayMessage = {
  message: SessionMessage;
  thoughts: ThoughtItem[];
  sceneId?: string;
  promptContext?: string;
  skill?: string;
  assistantSource?: string;
  assistantWarning?: boolean;
  errorCode?: string;
  agentFiles?: AgentFileEntry[];
  agentToolLog?: AgentToolLogEntry[];
};

export type SceneVersionRecord = NonNullable<Session["currentScene"]>;
