export {
  CURATED_THREEJS_ASSETS,
  MODEL_SUBJECT_PATTERN,
  resolveModelCategories,
  getModelCandidateUrls,
  type CuratedAsset,
} from "./model-catalog.js";

export type SkillId = "threejs" | "p5js" | "d3js" | "animejs" | "manim";
export type SkillPreference = SkillId | "auto";

export interface GenerateRequest {
  query: string;
  sessionId?: string;
  preferences?: {
    skill?: SkillPreference;
    quality?: "draft" | "standard" | "high";
    provider?: string;
  };
}

export interface SceneAssetCandidate {
  id: string;
  url: string;
  note?: string;
}

export interface SceneAssetFallbackPolicy {
  allowInternetFallback: boolean;
  requireFallbackWarning: boolean;
  requireInlineFallbackComment: boolean;
}

export interface SceneAssetPlan {
  manifestVersion: string;
  skill: string;
  requestedQuality: "draft" | "standard" | "high";
  strategy: "runtime-native" | "hybrid" | "model-first";
  subjectNeedsModel: boolean;
  categories: string[];
  catalog: Record<string, SceneAssetCandidate[]>;
  curatedCandidates: SceneAssetCandidate[];
  fallbackPolicy: SceneAssetFallbackPolicy;
  runtimeHelpers: string[];
}

export interface SceneVersion {
  versionId: string;
  version: number;
  artifactId?: string;
  artifactVersion?: number;
  sceneId: string;
  code: string | null;
  previewUrl: string | null;
  skill: string | null;
  outputKind?: "code" | "media";
  mediaType?: string | null;
  mediaUrl?: string | null;
  mediaArtifactId?: string | null;
  mediaDurationMs?: number | null;
  mediaFps?: number | null;
  mediaResolution?: string | null;
  mediaBytes?: number | null;
  assetPlan?: SceneAssetPlan | null;
  explanation: string | null;
  messageId?: string | null;
  source: string;
  streaming?: boolean;
  streamingComplete?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactSummary {
  artifactId: string;
  title: string;
  revisionCount: number;
  revisionPointer: number;
  isCurrent: boolean;
  createdAt: string;
  updatedAt: string;
  latestSceneId: string | null;
  latestSkill: string | null;
}

export interface SessionSceneState {
  sessionId: string;
  sceneId: string | null;
  versionCount: number;
  versionPointer?: number;
  revisionCount?: number;
  revisionPointer?: number;
  artifactCount?: number;
  artifactPointer?: number;
  currentArtifactId?: string | null;
  canUndo?: boolean;
  canRedo?: boolean;
  canPreviousArtifact?: boolean;
  canNextArtifact?: boolean;
  currentScene: SceneVersion | null;
  versions: SceneVersion[];
  sceneVersions?: SceneVersion[];
  artifacts?: ArtifactSummary[];
  messages?: SessionMessage[];
  orchestrationTrace?: Array<{ id: string; step: string; payload: unknown; createdAt: string }>;
  status?: "idle" | "parsing" | "selecting" | "generating" | "executing";
  visualGoals?: Array<{ id: string; category: string; severity: string; description: string }>;
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
  skill: string;
  generatedAt?: string;
  history?: FileRevision[];
}

export interface WorkspaceRecord {
  files: Record<string, WorkspaceFileEntry>;
  entryPoint: string;
  dependencies: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface SessionMessage {
  id: string;
  role: "user" | "assistant" | "system" | "thought";
  content: string;
  kind: string | null;
  meta: string[];
  error?: SessionMessageError | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionMessageError {
  code: string;
  title: string;
  userMessage: string;
  retryable: boolean;
  suggestedAction?: string | null;
  technicalDetail?: string | null;
  stage?: string | null;
}

export interface SessionMessagesResponse {
  sessionId: string;
  messages: SessionMessage[];
}

export interface SessionListResponse {
  sessions: SessionSceneState[];
}

export interface CreateSessionResponse {
  sessionId: string;
  websocketUrl: string;
  sceneState: SessionSceneState;
}

export interface ChatTurnRequest {
  content?: string;
  imageUrl?: string;
  imageData?: string;
  mode?: 'generate' | 'modify' | 'explain' | 'debug' | 'chat';
  requestId?: string;
  clientMessageId?: string;
  preferences?: {
    skill?: SkillPreference;
    quality?: "draft" | "standard" | "high";
    provider?: string;
    instant?: boolean;
  };
}

export interface LlmProviderAttempt {
  providerId: string;
  model: string;
  status: "success" | "failed";
  reason?: string | null;
  retryable?: boolean;
}

export interface LlmSourceMetadata {
  providerId: string | null;
  model: string | null;
  fallbackUsed: boolean;
  attemptCount: number;
  attempts?: LlmProviderAttempt[];
}

export interface ChatTurnResponse {
  sessionId: string;
  mode: "chat" | "clarify" | "explain" | "generate" | "modify";
  intent: {
    rawQuery: string;
    intentType: string;
    targetDomain: string;
    entities: Array<{ kind: string; name: string }>;
    constraints: Array<{ name: string; value: string }>;
    confidence: number;
    ambiguous: boolean;
    clarificationPrompt: string | null;
  };
  userMessage: SessionMessage;
  assistantMessage: SessionMessage;
  assistantSource?: string | null;
  assistantWarning?: string | null;
  assistantLlm?: LlmSourceMetadata | null;
  sceneState: SessionSceneState;
  messages: SessionMessage[];
  result: GenerateResponse | ModifyResponse | null;
}

export interface SkillCapability {
  name: string;
  description?: string;
}

export interface SkillCatalogItem {
  id: string;
  name: string;
  version: string;
  description: string;
  domainFocus: string[];
  capabilities: string[];
  executionReliability: number;
  warmPoolAvailability: number;
  safeDefault: boolean;
}

export interface SkillCatalogResponse {
  skills: SkillCatalogItem[];
}

export interface LlmProviderItem {
  id: string;
  name: string;
  state: "healthy" | "cooldown" | "disabled";
}

export interface ProviderListResponse {
  providers: LlmProviderItem[];
}

export type GveTaskAction =
  | "parse_intent"
  | "select_skill"
  | "build_prompt"
  | "generate_code"
  | "validate_code"
  | "provision_sandbox"
  | "analyze_quality"
  | "autonomous_patching"
  | "execute_code"
  | "sync_state";

export type GveTaskStatus = "pending" | "running" | "completed" | "failed";

export interface GveTask {
  id: string;
  title: string;
  description: string;
  action: GveTaskAction;
  command: string;
  status: GveTaskStatus;
  dependsOn: string[];
}

export interface TaskPlanResponse {
  planId: string;
  summary: string;
  tasks: GveTask[];
}

export interface TaskExecutionResponse {
  planId: string;
  taskId: string;
  status: Exclude<GveTaskStatus, "pending">;
  output: string;
  artifact?: string;
}

export interface ThoughtStreamEvent {
  sessionId: string;
  step: string;
  thought: string;
  token: string;
  isFinal: boolean;
  requestId?: string | null;
  messageId?: string | null;
}

export interface AgentActivityEvent {
  id: string;
  sessionId: string;
  messageId?: string | null;
  step: string;
  status: GveTaskStatus;
  tone?: "progress" | "success" | "error";
  text: string;
  technicalDetail?: string | null;
  createdAt: string;
}

export interface GenerateResponse {
  sceneId: string;
  previewUrl: string;
  code: string;
  skill: string;
  generationSource?: string | null;
  generationWarning?: string | null;
  llmTrace?: LlmSourceMetadata | null;
  outputKind?: "code" | "media";
  mediaType?: string | null;
  mediaUrl?: string | null;
  mediaArtifactId?: string | null;
  mediaDurationMs?: number | null;
  mediaFps?: number | null;
  mediaResolution?: string | null;
  mediaBytes?: number | null;
  assetPlan?: SceneAssetPlan | null;
  explanation: string;
  sessionId: string;
  sceneVersion: number;
  versionCount: number;
  sceneState: SessionSceneState;
  modifyOutcome?: "applied" | "applied_after_retry" | "rejected_noop";
  noopReason?: string | null;
  retriedAfterNoop?: boolean;
  runtime?: {
    success: boolean;
    status: "completed" | "timeout" | "error" | "skipped" | "degraded";
    previewUrl: string | null;
    skillId: string;
    skillName: string;
    outputKind?: "code" | "media";
    mediaType?: string | null;
    mediaUrl?: string | null;
    mediaArtifactId?: string | null;
    mediaDurationMs?: number | null;
    mediaFps?: number | null;
    mediaResolution?: string | null;
    mediaBytes?: number | null;
    dependencyCount: number;
    durationMs: number;
    renderCount: number;
    frameCount: number;
    warning?: string | null;
    error?: string | null;
    logs: Array<{ level: string; message: string; timestamp: string }>;
    summary: { childCount: number; types: string[] };
    frameBudgetReached?: boolean;
  };
  diff?: {
    instruction: string;
    currentVersion: number;
    changed: boolean;
    changeSummary: string;
    source: string;
    patch?: string;
    addedLines?: number;
    removedLines?: number;
    changedLines?: number;
  };
}

export interface ModifyRequest {
  sessionId: string;
  instruction: string;
  runMode?: "modify" | "rerun";
  codeOverride?: string;
  preferences?: {
    skill?: SkillPreference;
    quality?: "draft" | "standard" | "high";
    provider?: string;
  };
}

export interface ModifyResponse extends GenerateResponse {}

export interface UndoRedoResponse {
  success: boolean;
  sceneState: SessionSceneState;
  error?: string;
  message?: string;
}

export interface ArtifactTimelineEntry {
  artifactId: string;
  title: string;
  isCurrent: boolean;
  revisions: Array<SceneVersion & { isCurrent: boolean }>;
}

export interface VersionListResponse {
  sessionId: string;
  artifactCount?: number;
  artifactPointer?: number;
  currentArtifactId?: string | null;
  versionCount: number;
  versionPointer: number;
  revisionCount?: number;
  revisionPointer?: number;
  versions: Array<SceneVersion & { isCurrent: boolean }>;
  artifacts?: ArtifactSummary[];
  artifactTimeline?: ArtifactTimelineEntry[];
}

export type GenerationMode = "one-shot" | "polish" | "agentic";
export type IterationStopReason = "threshold_met" | "budget_exhausted" | "unrecoverable" | "user_abort";

export interface StaticScore {
  syntaxValid: boolean;
  apiCompliant: boolean;
  securityPass: boolean;
  complexity: number;
  score: number;
}

export interface RuntimeScore {
  fps: number;
  frameStability: number;
  memoryGrowthRate: number;
  errorCount: number;
  warningCount: number;
  startupTimeMs: number;
  score: number;
}

export interface VisualScore {
  materialRichness: number;
  lightingLayers: number;
  motionContinuity: number;
  colorHarmony: number;
  compositionScore: number;
  score: number;
}

export interface SemanticScore {
  intentFulfillment: number;
  skillAppropriateness: number;
  promptAdherence: number;
  score: number;
}

export interface QualitySignals {
  static: StaticScore;
  runtime: RuntimeScore;
  visual?: VisualScore;
  semantic?: SemanticScore;
  composite: number;
}

export interface PatchGoal {
  id: string;
  category: "static" | "runtime" | "visual" | "semantic";
  severity: "critical" | "warning" | "suggestion";
  description: string;
  suggestedFix?: string;
}

export interface IterationState {
  iterationNumber: number;
  candidateCode: string;
  candidateSceneId: string;
  staticScore: StaticScore;
  runtimeScore: RuntimeScore;
  visualScore?: VisualScore;
  semanticScore?: SemanticScore;
  qualitySignals: QualitySignals;
  patchGoals?: PatchGoal[];
  generationDurationMs: number;
  validationDurationMs: number;
  stopReason?: IterationStopReason;
  isFinal: boolean;
  createdAt: string;
}

export interface QualityReport {
  finalScore: number;
  threshold: number;
  totalIterations: number;
  budgetUsed: number;
  budgetTotal: number;
  stopReason: IterationStopReason;
  scoreBreakdown: {
    static: number;
    runtime: number;
    visual: number;
    semantic: number;
  };
  improvements: Array<{
    iteration: number;
    scoreBefore: number;
    scoreAfter: number;
    changes: string[];
  }>;
}

export interface IterationPreferences {
  mode: GenerationMode;
  maxIterations: number;
  qualityThreshold: number;
  autoRepair: boolean;
  showIterations: boolean;
}

export interface GenerateRequestV2 extends GenerateRequest {
  preferences?: {
    skill?: SkillPreference;
    quality?: "draft" | "standard" | "high";
    mode?: GenerationMode;
    maxIterations?: number;
    qualityThreshold?: number;
  };
}

export interface IterationUpdateEvent {
  type: "iteration:update";
  payload: {
    sessionId: string;
    iteration: IterationState;
    progress: {
      current: number;
      total: number;
      phase: "generating" | "validating" | "scoring" | "patching";
    };
  };
}

export interface ToolDefinition {
  id: string;
  name: string;
  version: string;
  description: string;
  installCommand: string;
  cdnUrl?: string;
  category: "core" | "utility" | "visual" | "audio" | "community";
  reputation: "official" | "verified" | "community";
  dependencies?: string[];
  sizeEstimateMb: number;
}

export interface ToolRegistryResponse {
  tools: ToolDefinition[];
  categories: string[];
}

export interface SandboxExecutionRequest {
  sessionId: string;
  code: string;
  skill: string;
  tools?: string[];
  budget: {
    maxDurationMs: number;
    maxMemoryMb: number;
    maxCpuPercent: number;
  };
  assets?: string[];
  executionMode: "probe" | "full";
}

export interface SandboxMetrics {
  durationMs: number;
  memoryPeakMb: number;
  cpuAvgPercent: number;
  fpsAvg: number;
  fpsMin: number;
  fpsMax: number;
  frameCount: number;
  errorCount: number;
  warningCount: number;
  renderTimeMs: number;
}

export interface SandboxArtifact {
  type: "code" | "preview" | "log" | "metric" | "asset";
  name: string;
  path: string;
  sizeBytes: number;
  contentType: string;
  url: string;
}

export interface SandboxExecutionResponse {
  success: boolean;
  executionId: string;
  previewUrl: string | null;
  artifacts: SandboxArtifact[];
  metrics: SandboxMetrics;
  logs: Array<{
    level: "debug" | "info" | "warn" | "error";
    message: string;
    timestamp: string;
    source?: string;
  }>;
  error?: string | null;
  errorDetails?: string | null;
}

export interface SandboxStatus {
  status: "pending" | "provisioning" | "running" | "completed" | "failed" | "cleaned_up";
  containerId?: string;
  resources: {
    cpuPercent: number;
    memoryUsedMb: number;
    diskUsedMb: number;
  };
  toolsInstalled: string[];
  uptimeSeconds: number;
}

export type AgentRole =
  | "orchestrator"
  | "scene_architect"
  | "material_designer"
  | "animator"
  | "optimizer"
  | "tester";

export interface AgentTask {
  id: string;
  role: AgentRole;
  taskType: "generate" | "validate" | "optimize" | "repair" | "review";
  description: string;
  inputArtifacts: string[];
  outputArtifacts: string[];
  dependencies: string[];
  status: "pending" | "running" | "completed" | "failed";
  budget: {
    maxIterations: number;
    maxDurationMs: number;
  };
  result?: {
    success: boolean;
    score: number;
    notes: string[];
  };
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface MultiAgentWorkflow {
  workflowId: string;
  sessionId: string;
  intent: string;
  agents: AgentTask[];
  currentAgent?: AgentRole;
  overallProgress: number;
  status: "planning" | "executing" | "reviewing" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
}

export interface AutonomousDecision {
  decisionType: "continue" | "patch" | "escalate" | "abort" | "request_clarification";
  reasoning: string;
  confidence: number;
  action?: {
    type: string;
    parameters: Record<string, unknown>;
  };
  requiresApproval: boolean;
}

export interface ApiKeyRecord {
  id: string;
  userId: string;
  name: string;
  scopes: string[];
  createdAt: string;
}

export interface CreateApiKeyResponse {
  data: {
    id: string;
    name: string;
    key: string;
    scopes: string[];
    created_at: string;
  };
  error: null;
}

export interface ListApiKeysResponse {
  data: ApiKeyRecord[];
  error: null;
}

export interface DeleteApiKeyResponse {
  data: { deleted: boolean };
  error: null;
}
