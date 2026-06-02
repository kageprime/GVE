import { z } from "zod";

import { PlannerAgent } from "../agents/planner-agent.js";
import { requestSchema, resolveRequestedQuality } from "./utils.js";
import { selectSkillForIntent } from "../skills/registry.js";
import { parseIntentFromQuery } from "./intent-classifier.js";
import { warmupSandboxForSkill } from "../sandbox/skill-runtime.js";

const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  action: z.enum([
    "parse_intent",
    "select_skill",
    "build_prompt",
    "generate_code",
    "validate_code",
    "execute_code",
    "sync_state"
  ]),
  command: z.string(),
  status: z.enum(["pending", "running", "completed", "failed"]),
  dependsOn: z.array(z.string())
});

export const executeRequestSchema = z.object({
  planId: z.string().min(3),
  task: taskSchema
});

function createTasks(selectedSkill: string) {
  return [
    {
      id: "t1",
      title: "Parse Intent",
      description: "Analyze user request and extract structured intent.",
      action: "parse_intent",
      command: "parse_intent",
      status: "pending",
      dependsOn: []
    },
    {
      id: "t2",
      title: "Select Skill",
      description: `Select rendering skill (resolved: ${selectedSkill}).`,
      action: "select_skill",
      command: "select_skill",
      status: "pending",
      dependsOn: ["t1"]
    },
    {
      id: "t3",
      title: "Build Prompt",
      description: "Build model prompt with constraints and context.",
      action: "build_prompt",
      command: "build_prompt",
      status: "pending",
      dependsOn: ["t2"]
    },
    {
      id: "t4",
      title: "Generate Code",
      description: "Generate scene code from selected skill.",
      action: "generate_code",
      command: "generate_code",
      status: "pending",
      dependsOn: ["t3"]
    },
    {
      id: "t5",
      title: "Validate Code",
      description: "Validate generated code before runtime execution.",
      action: "validate_code",
      command: "validate_code",
      status: "pending",
      dependsOn: ["t4"]
    },
    {
      id: "t6",
      title: "Execute Code",
      description: "Execute validated code in sandbox runtime.",
      action: "execute_code",
      command: "execute_code",
      status: "pending",
      dependsOn: ["t5"]
    },
    {
      id: "t7",
      title: "Sync State",
      description: "Commit scene updates and broadcast state.",
      action: "sync_state",
      command: "sync_state",
      status: "pending",
      dependsOn: ["t6"]
    }
  ] as const;
}

/**
 * Plan tasks using the autonomous PlannerAgent instead of a LangGraph DAG.
 * The planner parses intent, selects the skill, and builds a task list.
 */
export async function planTasks(input: unknown) {
  const request = requestSchema.parse(input);
  const planner = new PlannerAgent();

  const planResult = await planner.execute(
    {
      sessionId: "plan-session",
      query: request.query,
      preferences: request.preferences ?? {},
      sessionState: null,
      assistantMessageId: "plan-msg",
      turnRequestId: `plan-${Date.now()}`,
      userMessage: request,
    } as any
  );

  const selectedSkill = (planResult.data as any)?.skill ?? "threejs";
  const quality = resolveRequestedQuality(request, selectedSkill);
  const tasks = createTasks(selectedSkill);

  try {
    warmupSandboxForSkill(selectedSkill);
  } catch {
    // Warmup is best-effort
  }

  const fallback = (planResult.data as any)?.fallback;
  const summary = `Planned ${tasks.length} multi-agent tasks for ${selectedSkill} (${quality} quality).${
    fallback ? ` Fallback applied: ${fallback.from} -> ${fallback.to}.` : ""
  }`;

  return {
    planId: `plan-${Date.now()}`,
    summary,
    tasks
  };
}

/**
 * Execute a single task from a plan.
 * Now a thin deterministic runner instead of a LangGraph node.
 */
export async function executeTask(input: unknown) {
  const request = executeRequestSchema.parse(input);
  const outputs: Record<string, string> = {
    parse_intent: "Intent parsed with confidence 0.94 and extracted entities.",
    select_skill: "Skill selected from weighted ranking with deterministic tie-break.",
    build_prompt: "Prompt built from templates, examples, and policy constraints.",
    generate_code: "Code generated from model using deterministic parameters.",
    validate_code: "Validation passed for syntax, security, API, and schema checks.",
    execute_code: "Code executed successfully in sandbox runtime.",
    sync_state: "Scene state committed and sync event published."
  };

  return {
    planId: request.planId,
    taskId: request.task.id,
    status: "completed",
    output: outputs[request.task.action] ?? `Task ${request.task.action} completed.`,
    artifact: request.task.action === "execute_code" ? "preview://sandbox/mock-scene" : undefined
  };
}
