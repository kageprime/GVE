/**
 * Session domain types — the source of truth for session/artifact/version shapes.
 */

export type SkillId = "threejs" | "p5js" | "d3js" | "animejs" | "manim";

export interface WorkspaceRecord {
  files: Record<string, WorkspaceFileEntry>;
  entryPoint: string;
  dependencies: string[];
  createdAt: string;
  updatedAt: string;
}

export interface FileRevision {
  version: number;
  content: string;
  createdAt: string;
  agentAction: "generate" | "patch" | "user-edit";
}

export interface WorkspaceFileEntry {
  path: string;
  content: string;
  purpose: string;
  skill: SkillId;
  generatedAt: string;
  history: FileRevision[];
}

export interface WorkspaceRecord {
  files: Record<string, WorkspaceFileEntry>;
  entryPoint: string;
  dependencies: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SceneVersion {
  versionId: string;
  version: number;
  artifactId: string;
  artifactVersion: number;
  source: "generate" | "modify" | "image-to-code" | "fallback";
  sceneId: string;
  code: string | null;
  previewUrl: string | null;
  skill: string | null;
  outputKind: string | null;
  explanation?: string | null;
  mediaType: string | null;
  mediaUrl: string | null;
  workspace: WorkspaceRecord | null;
  createdAt: string;
  updatedAt: string;
}

export interface Artifact {
  artifactId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  revisions: SceneVersion[];
  revisionPointer: number;
}

export type SessionStatus = "idle" | "generating" | "modifying" | "error" | "parsing" | "planning" | "executing";

export interface SessionMessage {
  messageId: string;
  role: "user" | "assistant" | "system";
  content: string;
  kind?: string;
  error?: any;
  meta?: string[];
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface TraceEntry {
  step: string;
  detail?: string;
  payload?: any;
  timestamp: string;
  duration?: number;
}

export interface InternalSessionState {
  sessionId: string;
  ownerId?: string | null;
  status: SessionStatus;
  artifacts: Artifact[];
  artifactPointer: number;
  currentScene: SceneVersion | null;
  workspace: WorkspaceRecord | null;
  messages: SessionMessage[];
  orchestrationTrace: TraceEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface SessionState extends InternalSessionState {
  versionCount: number;
  versionPointer: number;
  revisionCount: number;
  revisionPointer: number;
  artifactCount: number;
  currentArtifactId: string | null;
  canUndo: boolean;
  canRedo: boolean;
  canPreviousArtifact: boolean;
  canNextArtifact: boolean;
  versions: SceneVersion[];
  sceneVersions: SceneVersion[];
  sceneId: string | null;
}

export interface SessionResponse {
  session: SessionState;
  websocketUrl: string;
}

export interface SceneUpdatePayload {
  type: "scene_update";
  sessionId: string;
  scene: SceneVersion | null;
  versions: SceneVersion[];
  currentVersionIndex: number;
}

export interface CodeUpdatePayload {
  type: "code_update";
  sessionId: string;
  code: string | null;
  skill: string | null;
  outputKind: string | null;
}
