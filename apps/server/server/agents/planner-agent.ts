/**
 * Planner Agent — Decides intent, skill, quality tier, and task sequence.
 *
 * Wraps the existing deterministic intent classifier and skill registry.
 * The Coordinator may call the Planner again if a mid-turn replan is needed.
 */

import { parseIntentFromQuery } from "../pipeline/intent-classifier.js";
import { selectSkillForIntent } from "../skills/registry.js";
import { resolveRequestedQuality } from "../pipeline/utils.js";
import type { AgentContext, AgentResult, CoordinatorPlan, AgentTask } from "./types.js";

export class PlannerAgent {
  name = "planner";

  async execute(ctx: AgentContext): Promise<AgentResult<CoordinatorPlan>> {
    try {
      const query = String(ctx.query ?? "").trim();
      const parsedIntent = parseIntentFromQuery(query);

      const requestedSkill = String(ctx.preferences?.skill ?? "auto").trim().toLowerCase();
      const selection = selectSkillForIntent(parsedIntent, requestedSkill === "auto" ? undefined : requestedSkill);

      const quality = resolveRequestedQuality(
        { preferences: { quality: ctx.preferences?.quality as any } },
        selection.selectedSkill
      );

      const tasks = this.buildTasks(selection.selectedSkill, parsedIntent.intentType ?? "create");

      const plan: CoordinatorPlan = {
        intent: parsedIntent.intentType ?? "create",
        skill: selection.selectedSkill,
        quality,
        tasks,
        fallback: selection.fallbackRequired
          ? { from: requestedSkill, to: selection.selectedSkill, reason: selection.reason }
          : null,
      };

      return { success: true, data: plan, meta: { confidence: parsedIntent.confidence } };
    } catch (err: any) {
      return { success: false, error: `Planner failed: ${err.message}` };
    }
  }

  private buildTasks(skill: string, intentType: string): AgentTask[] {
    const base: AgentTask[] = [
      { id: "t1", title: "Parse Intent", description: "Analyze user request and extract structured intent.", agent: "planner", dependsOn: [], status: "completed" as const },
      { id: "t2", title: "Select Skill", description: `Skill resolved: ${skill}.`, agent: "planner", dependsOn: ["t1"], status: "completed" as const },
      { id: "t3", title: "Build Prompt", description: "Construct generation prompt with constraints.", agent: "prompt_builder", dependsOn: ["t2"], status: "pending" as const },
      { id: "t4", title: "Generate Code", description: "Generate scene code via LLM.", agent: "coder", dependsOn: ["t3"], status: "pending" as const },
      { id: "t5", title: "Validate Code", description: "Static analysis and security checks.", agent: "validator", dependsOn: ["t4"], status: "pending" as const },
      { id: "t6", title: "Execute Code", description: "Run in sandbox or client runtime.", agent: "executor", dependsOn: ["t5"], status: "pending" as const },
      { id: "t7", title: "Sync State", description: "Commit scene and broadcast updates.", agent: "executor", dependsOn: ["t6"], status: "pending" as const },
    ];

    if (intentType === "chat" || intentType === "explain") {
      // No execution needed for pure chat / explanation
      return base.filter((t) => t.id !== "t5" && t.id !== "t6" && t.id !== "t7");
    }

    return base;
  }
}
