import {
  type AgentActivityEvent,
  type GveTask,
  type GveTaskAction,
  type GveTaskStatus,
  type SessionMessage as ApiSessionMessage,
  type SessionSceneState,
  type IterationState as SharedIterationState,
  type QualityReport,
  type IterationStopReason,
  type LlmProviderItem,
  type WorkspaceRecord,
  type WorkspaceFileEntry
} from '../../api';
import type { ActionBlock, TaskCheckpoint } from '../../types/actionBlocks';

export type { ActionBlock, TaskCheckpoint };

export type Session = SessionSceneState;
export type LiveConnectionState = 'connecting' | 'open' | 'closed' | 'error';
export type SceneHistoryCommand = 'undo' | 'redo' | 'artifact.previous' | 'artifact.next' | 'version.previous' | 'version.next';
export type WorkspacePanelView = 'preview' | 'code' | 'files' | 'workspace' | 'diff';
export type TurnLifecycleStatus = 'idle' | 'running' | 'completed' | 'failed';
export type MediaLifecycleStage = 'idle' | 'queued' | 'generating' | 'executing' | 'syncing' | 'ready' | 'error';

export interface LiveThoughtState {
  text: string;
  step: string;
  updatedAt: string;
  requestId?: string | null;
  messageId?: string | null;
  durationMs?: number | null;
  stepLabel?: string | null;
  detail?: string | null;
  status?: string | null;
}

export interface StageEventEntry {
  id: string;
  source: 'orchestration' | 'activity' | 'task' | 'error';
  step: string;
  status: GveTaskStatus;
  text: string;
  detail: string | null;
  createdAt: string;
}

export type StageEventMap = Record<GveTaskAction, StageEventEntry[]>;

export interface SessionTaskProgress {
  sessionId: string;
  planId: string | null;
  tasks: GveTask[];
  activities: AgentActivityEvent[];
  stageEventsByAction: StageEventMap;
  activeStageAction: GveTaskAction | null;
  currentStep: string | null;
  currentStepStatus: GveTaskStatus | null;
  liveThought: LiveThoughtState | null;
  turnStatus: TurnLifecycleStatus;
  activeRequestId: string | null;
  mediaStage: MediaLifecycleStage;
  mediaStatusText: string | null;
  mediaType: string | null;
  mediaUrl: string | null;
  lastUpdatedAt: string;
  lastTerminalAt: string | null;
}

export type SessionMessage = ApiSessionMessage;

export interface AgentFileEntry {
  path: string;
  previewUrl: string | null;
  lines: number | null;
  createdAt: string;
}

export interface SearchToolResult {
  type: "search";
  query: string;
  answer?: string | null;
  results?: Array<{ title: string; url: string; snippet: string; score?: number; image?: string | null }>;
}

export interface PlanToolResult {
  type: "plan";
  skill: string;
  quality: string;
  tasks?: Array<{ id: string; title: string; description: string; agent: string; status: string }>;
  fallback?: { from: string; to: string; reason: string } | null;
}

export interface CodeToolResult {
  type: "code";
  language: string;
  snippet: string;
  lines: number;
  isFix?: boolean;
  fixReason?: string;
}

export interface ValidationToolResult {
  type: "validation";
  score: number;
  errors: Array<{ code?: string; message: string; line?: number }>;
  warnings: Array<{ code?: string; message: string; line?: number }>;
  canRetry: boolean;
}

export interface ExecutionToolResult {
  type: "execution";
  success: boolean;
  previewUrl?: string | null;
  mediaUrl?: string | null;
  durationMs?: number;
  error?: string | null;
  logs?: string[];
}

export type ToolRawResult = SearchToolResult | PlanToolResult | CodeToolResult | ValidationToolResult | ExecutionToolResult;

export interface AgentToolLogEntry {
  id: string;
  tool: string;
  status: "running" | "success" | "error";
  output: string;
  durationMs: number;
  timestamp: string;
  rawResult?: ToolRawResult | null;
}

export interface ComposerImageAttachment {
  name: string;
  mimeType: string;
  sizeBytes: number;
  dataBase64: string;
  previewUrl: string;
}

export interface UIIterationState {
  isIterating: boolean;
  currentIteration: number;
  maxIterations: number;
  currentScore: number;
  threshold: number;
  phase: "generating" | "validating" | "scoring" | "patching" | "finalizing";
  iterations: SharedIterationState[];
  qualityReport: QualityReport | null;
  stopReason: IterationStopReason | null;
  sessionId: string;
}

export interface AgentResult {
  id: string;
  name: string;
  score: number; // 0-100 confidence
  findings: string[]; // Top 2-3 key findings
  recommendations: Array<{
    action: string;
    impact: number; // 0-20 (potential score improvement)
    confidence: number; // 0-100
    category: 'structure' | 'performance' | 'visual' | 'api' | 'safety';
  }>;
}

export interface UIAgentState {
  isAnalyzing: boolean;
  results: Record<string, AgentResult>; // architect, materialDesigner, animator, optimizer, tester
  consensus: number; // 0-100 (% agents agreeing)
  shouldAutoApply: boolean; // true if consensus >= 80
  recommendations: Array<{
    agentId: string;
    action: string;
    impact: number;
    confidence: number;
    category: string;
    priority: number;
  }>;
  memory: Array<{
    iteration: number;
    pattern: string;
    frequency: number;
    resolved: boolean;
  }>;
  lastAnalyzedAt: string | null;
}

export interface ChatState {
  // Sessions
  sessions: Session[];
  activeSessionId: string | null;
  hasInitialized: boolean;
  isBootstrapping: boolean;
  sessionsError: string | null;
  
  // Messages by session
  messages: Record<string, SessionMessage[]>;

  // Session task progress
  taskProgressBySession: Record<string, SessionTaskProgress>;
  
  // Action Blocks (per message, keyed by messageId)
  actionBlocksByMessage: Record<string, ActionBlock[]>;
  currentTurnCheckpoints: TaskCheckpoint[];
  currentMessageId: string | null;
  
  // UI State
  connectionState: LiveConnectionState;
  isSending: boolean;
  activeRequestId: string | null;
  thinkingText: string | null;
  thinkingStep: string;
  thinkingToolName: string | null;
  showScrollToLatest: boolean;
  iterationState: UIIterationState | null;
  agentState: UIAgentState | null;

  // Agent Approval Gate
  pendingApproval: {
    sessionId: string;
    stepId: string;
    step: string;
    description: string;
    deadline: number;
  } | null;

  // Workspace Panel State (new simplified system)
  panelOpen: boolean;
  panelView: WorkspacePanelView | null;
  panelWidth: number;

  // Multi-File Workspace State
  workspaceRecord: WorkspaceRecord | null;
  selectedWorkspaceFile: string | null;
  workspaceOpen: boolean;

  // Agent Mode — per-turn file tracking
  agentFiles: AgentFileEntry[];
  agentToolLog: AgentToolLogEntry[];

  // Theater Mode (New Cinematic Preview)
  activeArtifactId: string | null;
  
  // Composer
  composerValue: string;
  composerImage: ComposerImageAttachment | null;
  isSlashMenuOpen: boolean;

  // Provider selection
  providers: LlmProviderItem[];
  activeProviderId: string;
  
  // WebSocket
  _ws: WebSocket | null;
  _wsSeq: number;

  // Actions
  isSidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  cycleTheaterArtifact: (direction: "next" | "prev") => void;
  
  initialize: () => Promise<void>;
  fetchProviders: () => Promise<void>;
  createNewSession: () => Promise<Session | null>;
  selectSession: (sessionId: string) => void;
  sendSceneCommand: (command: SceneHistoryCommand) => Promise<void>;
  selectSceneVersion: (versionId: string) => Promise<boolean>;
  rerunScene: (options?: { codeOverride?: string | null }) => Promise<boolean>;
  setCurrentSceneCode: (sessionId: string, code: string) => void;
  stopTurn: () => void;
  connectWebSocket: () => void;
  startDraftSession: () => void;
  setActiveSession: (sessionId: string | null) => void;
  addSession: (session: Session) => void;
  addMessage: (sessionId: string, message: SessionMessage) => void;
  setMessages: (sessionId: string, messages: SessionMessage[]) => void;
  setIsSending: (value: boolean) => void;
  setActiveRequestId: (id: string | null) => void;
  setThinking: (text: string | null, step?: string) => void;
  setComposerValue: (value: string) => void;
  setComposerImage: (image: ComposerImageAttachment | null) => void;
  clearComposerImage: () => void;
  setActiveProvider: (providerId: string) => void;
  
  // Panel Actions (new)
  openPanel: (view: WorkspacePanelView) => void;
  closePanel: () => void;
  togglePanel: (view: WorkspacePanelView) => void;
  setPanelWidth: (width: number) => void;
  
  // Iteration Actions
  updateIterationState: (state: UIIterationState | null) => void;
  abortIteration: () => void;
  
  // Agent Actions
  updateAgentState: (state: UIAgentState | null) => void;
  setAgentAnalyzing: (isAnalyzing: boolean) => void;
  clearAgentState: () => void;
  setPendingApproval: (approval: ChatState["pendingApproval"]) => void;
  
  // Action Block Actions
  setActionBlocks: (messageId: string, blocks: ActionBlock[]) => void;
  updateActionBlock: (messageId: string, blockId: string, updates: Partial<ActionBlock>) => void;
  setCurrentTurnCheckpoints: (checkpoints: TaskCheckpoint[]) => void;
  setCurrentMessageId: (messageId: string | null) => void;
  clearActionBlocks: (messageId: string) => void;
  
  setSessionsError: (error: string | null) => void;
  clearSession: (sessionId: string) => void;
  sendApprovalResponse: (approved: boolean) => void;

  // Theater Mode Actions
  openTheaterMode: (artifactId: string) => void;
  closeTheaterMode: () => void;

  // Workspace Actions
  setWorkspaceRecord: (record: WorkspaceRecord | null) => void;
  selectWorkspaceFile: (path: string) => void;
  openWorkspace: () => void;
  closeWorkspace: () => void;
  toggleWorkspace: () => void;

  // Agent Mode Actions
  addAgentFile: (file: AgentFileEntry) => void;
  clearAgentFiles: () => void;
  addAgentToolLog: (entry: AgentToolLogEntry) => void;
  clearAgentToolLog: () => void;
}
