/**
 * Multi-Agent System — Core Types
 *
 * Defines the contracts between the CoordinatorAgent and specialist agents.
 * No LangGraph dependencies; agents communicate via plain async function calls.
 */

export interface AgentContext {
  sessionId: string;
  query: string;
  imageUrl?: string | null;
  imageData?: string | null;
  preferences: Record<string, unknown>;
  sessionState: any;
  assistantMessageId: string;
  turnRequestId: string;
  userMessage: unknown;
  /** Sandbox / execution environment (provisioned before the turn). */
  executionEnv?: ExecutionEnv;
}

export interface ExecutionEnv {
  type: "daytona" | "docker" | "local";
  workspaceId?: string;
  containerId?: string;
  workspacePath?: string;
  filesystem?: any;
  executeCommand?: (command: string, opts?: { timeoutMs?: number }) => Promise<string>;
}

export interface AgentResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  /** Free-form metadata for the coordinator's decision logic. */
  meta?: Record<string, unknown>;
}

export interface AgentStep {
  id: string;
  agent: string;
  input: Record<string, unknown>;
  output?: AgentResult;
  startedAt: number;
  completedAt?: number;
}

export interface CoordinatorPlan {
  intent: string;
  skill: string;
  quality: string;
  tasks: AgentTask[];
  fallback?: { from: string; to: string; reason: string } | null;
}

export interface AgentTask {
  id: string;
  title: string;
  description: string;
  agent: "planner" | "coder" | "validator" | "executor" | "prompt_builder";
  dependsOn: string[];
  status: "pending" | "running" | "completed" | "failed";
  payload?: Record<string, unknown>;
}

/** Every specialist agent implements this interface. */
export interface SpecialistAgent {
  name: string;
  execute(ctx: AgentContext, input: Record<string, unknown>): Promise<AgentResult>;
}

export interface CoordinatorTurnResult {
  success: boolean;
  response: string;
  steps: AgentStep[];
  recordedScene: any | null;
  error?: string;
}
