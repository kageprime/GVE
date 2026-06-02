/**
 * Coordinator Agent — Meta-orchestrator that routes between specialist agents.
 *
 * Replaces the rigid LangGraph DAG with a dynamic loop where the Coordinator
 * evaluates specialist results and decides next steps (retry, backtrack, proceed).
 *
 * Emits the same event shapes as the legacy tool-coordinator so the frontend
 * contract stays intact (coordinator:thinking, coordinator:tool_call,
 * coordinator:tool_result, coordinator:file_complete, coordinator:complete).
 */

import { PlannerAgent } from "./planner-agent.js";
import { CoderAgent } from "./coder-agent.js";
import { ValidatorAgent } from "./validator-agent.js";
import { ExecutorAgent } from "./executor-agent.js";
import { resolveAssetPlan } from "../pipeline/assets.js";
import { getSkillRuntimeProfile } from "../skills/loader.js";
import type { AgentContext, AgentResult, AgentStep, CoordinatorTurnResult, CoordinatorPlan } from "./types.js";

export interface CoordinatorEvent {
  type:
    | "coordinator:thinking"
    | "coordinator:tool_call"
    | "coordinator:tool_result"
    | "coordinator:scene_ready"
    | "coordinator:file_complete"
    | "coordinator:complete"
    | "coordinator:error";
  payload: Record<string, unknown>;
}

export class CoordinatorAgent {
  name = "coordinator";

  private planner = new PlannerAgent();
  private coder = new CoderAgent();
  private validator = new ValidatorAgent();
  private executor = new ExecutorAgent();

  async runTurn(
    ctx: AgentContext,
    onEvent?: (event: CoordinatorEvent) => void | Promise<void>,
    onToken?: (token: string) => void
  ): Promise<CoordinatorTurnResult> {
    const emit = (event: CoordinatorEvent) => {
      try {
        onEvent?.(event);
      } catch {
        /* best-effort */
      }
    };

    const steps: AgentStep[] = [];
    let recordedScene: any = null;
    const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];

    const agentStart = Date.now();

    try {
      // ── 1. PLAN ──
      emit({ type: "coordinator:thinking", payload: { iteration: 0, messageCount: 2, compressed: false } });
      const planResult = await this.runAgentStep(steps, "planner", ctx, {});
      if (!planResult.success || !planResult.data) {
        throw new Error(`Planner failed: ${planResult.error ?? "no error details"}`);
      }
      const plan = planResult.data as CoordinatorPlan;
      const planCallId = `call-plan-${Date.now()}`;
      toolCalls.push({ id: planCallId, name: "planner", arguments: {} });
      emit({ type: "coordinator:tool_call", payload: { callId: planCallId, name: "planner", arguments: {}, iteration: 1 } });
      emit({
        type: "coordinator:tool_result",
        payload: { callId: planCallId, name: "planner", success: true, output: `Plan ready: ${plan.skill} (${plan.quality}).`, durationMs: Date.now() - agentStart, rawResult: { type: "plan", skill: plan.skill, quality: plan.quality, tasks: plan.tasks, fallback: plan.fallback } },
      });

      // ── 2. BUILD PROMPT ──
      const assetPlan = resolveAssetPlan({ selectedSkill: plan.skill, sourceText: ctx.query });
      const skillProfile = getSkillRuntimeProfile(plan.skill);

      // ── 3. CODE GENERATION ──
      const mode = plan.intent === "modify" ? "modify" : "generate";
      const coderInput = {
        query: ctx.query,
        skill: plan.skill,
        quality: plan.quality,
        mode,
        currentCode: mode === "modify" ? (ctx.sessionState?.currentScene?.code ?? null) : null,
        assetPlan,
        profile: skillProfile,
      };
      const coderCallId = `call-coder-${Date.now()}`;
      toolCalls.push({ id: coderCallId, name: "coder", arguments: coderInput });
      emit({ type: "coordinator:thinking", payload: { iteration: 1, messageCount: 4 } });
      emit({ type: "coordinator:tool_call", payload: { callId: coderCallId, name: "coder", arguments: coderInput, iteration: 1 } });

      const codeResult = await this.runAgentStep(steps, "coder", ctx, { ...coderInput, onToken });
      if (!codeResult.success || !codeResult.data) {
        throw new Error(`Coder failed: ${codeResult.error ?? "no error details"}`);
      }
      let currentCode = (codeResult.data as any).code as string;
      emit({
        type: "coordinator:tool_result",
        payload: { callId: coderCallId, name: "coder", success: true, output: `Generated ${currentCode.length} chars of ${plan.skill} code.`, durationMs: Date.now() - agentStart, rawResult: { type: "code", language: plan.skill, snippet: currentCode.slice(0, 1200), lines: currentCode.split("\n").length } },
      });

      // Stream the code to the client immediately so the scene starts rendering
      // while validation runs in the background.
      emit({
        type: "coordinator:scene_ready",
        payload: {
          code: currentCode,
          skill: plan.skill,
          sceneId: `scene-${Date.now()}`,
          source: "generate",
        },
      });

      // ── 4. VALIDATION LOOP ──
      const maxValidationRetries = 2;
      for (let attempt = 0; attempt <= maxValidationRetries; attempt++) {
        const valCallId = `call-validator-${Date.now()}-${attempt}`;
        toolCalls.push({ id: valCallId, name: "validator", arguments: { codeLength: currentCode.length } });
        emit({ type: "coordinator:tool_call", payload: { callId: valCallId, name: "validator", arguments: {}, iteration: 2 + attempt } });

        const valResult = await this.runAgentStep(steps, "validator", ctx, {
          code: currentCode,
          skill: plan.skill,
          quality: plan.quality,
          userQuery: ctx.query,
        });

        const valData = valResult.data as any;
        const valSuccess = Boolean(valResult.success && !valData?.canRetry);
        const valOutput = valData?.feedback ?? valResult.error ?? "Validation completed.";
        emit({
          type: "coordinator:tool_result",
          payload: { callId: valCallId, name: "validator", success: valSuccess, output: valOutput, durationMs: Date.now() - agentStart, rawResult: { type: "validation", score: valData?.qualityScore ?? 0, errors: valData?.validation?.errors ?? [], warnings: valData?.validation?.warnings ?? [], canRetry: valData?.canRetry ?? false } },
        });

        if (valSuccess) break;

        if (attempt === maxValidationRetries) {
          throw new Error(`Validation failed after ${attempt + 1} attempts: ${valOutput}`);
        }

        // Retry coder with feedback
        const retryCallId = `call-coder-retry-${Date.now()}-${attempt}`;
        toolCalls.push({ id: retryCallId, name: "coder", arguments: {} });
        emit({ type: "coordinator:tool_call", payload: { callId: retryCallId, name: "coder", arguments: {}, iteration: 3 + attempt } });

        const retryResult = await this.runAgentStep(steps, "coder", ctx, {
          ...coderInput,
          query: `Fix the following issues and regenerate the scene code:\n${valOutput}\n\nOriginal request: ${ctx.query}`,
          mode: "modify",
          currentCode,
        });
        if (!retryResult.success || !retryResult.data) {
          throw new Error(`Coder retry failed: ${retryResult.error ?? "no error details"}`);
        }
        currentCode = (retryResult.data as any).code as string;
        emit({
          type: "coordinator:tool_result",
          payload: { callId: retryCallId, name: "coder", success: true, output: `Regenerated ${currentCode.length} chars after validation feedback.`, durationMs: Date.now() - agentStart, rawResult: { type: "code", language: plan.skill, snippet: currentCode.slice(0, 1200), lines: currentCode.split("\n").length, isFix: true } },
        });

        // Stream the updated code immediately so the client sees fixes in real time
        emit({
          type: "coordinator:scene_ready",
          payload: {
            code: currentCode,
            skill: plan.skill,
            sceneId: `scene-${Date.now()}`,
            source: "modify",
          },
        });
      }

      // ── 5. EXECUTION ──
      const execCallId = `call-executor-${Date.now()}`;
      toolCalls.push({ id: execCallId, name: "executor", arguments: { skill: plan.skill } });
      emit({ type: "coordinator:tool_call", payload: { callId: execCallId, name: "executor", arguments: {}, iteration: 5 } });

      const execResult = await this.runAgentStep(steps, "executor", ctx, {
        code: currentCode,
        skill: plan.skill,
        sessionId: ctx.sessionId,
        timeoutMs: skillProfile?.runtime?.timeoutMs ?? 2200,
        profile: skillProfile,
      });

      if (!execResult.success || !execResult.data) {
        const execError = execResult.error ?? "Execution returned no data.";
        emit({
          type: "coordinator:tool_result",
          payload: { callId: execCallId, name: "executor", success: false, output: execError, durationMs: Date.now() - agentStart, rawResult: { type: "execution", success: false, error: execError, logs: [] } },
        });

        // One-shot fix attempt
        const fixCallId = `call-coder-fix-${Date.now()}`;
        toolCalls.push({ id: fixCallId, name: "coder", arguments: {} });
        emit({ type: "coordinator:tool_call", payload: { callId: fixCallId, name: "coder", arguments: {}, iteration: 6 } });

        const fixResult = await this.runAgentStep(steps, "coder", ctx, {
          ...coderInput,
          query: `The code failed at runtime with this error:\n${execError}\n\nPlease fix it and regenerate. Original request: ${ctx.query}`,
          mode: "modify",
          currentCode,
        });
        if (!fixResult.success || !fixResult.data) {
          throw new Error(`Execution failed and fix attempt failed: ${execError}`);
        }
        currentCode = (fixResult.data as any).code as string;
        emit({
          type: "coordinator:tool_result",
          payload: { callId: fixCallId, name: "coder", success: true, output: "Regenerated code after runtime error.", durationMs: Date.now() - agentStart, rawResult: { type: "code", language: plan.skill, snippet: currentCode.slice(0, 1200), lines: currentCode.split("\n").length, isFix: true, fixReason: execError } },
        });

        // Re-validate after fix
        const revalCallId = `call-validator-fix-${Date.now()}`;
        toolCalls.push({ id: revalCallId, name: "validator", arguments: {} });
        emit({ type: "coordinator:tool_call", payload: { callId: revalCallId, name: "validator", arguments: {}, iteration: 7 } });
        const reval = await this.runAgentStep(steps, "validator", ctx, { code: currentCode, skill: plan.skill, quality: plan.quality, userQuery: ctx.query });
        const revalData = reval.data as any;
        const revalSuccess = Boolean(reval.success && !revalData?.canRetry);
        emit({
          type: "coordinator:tool_result",
          payload: { callId: revalCallId, name: "validator", success: revalSuccess, output: revalData?.feedback ?? reval.error ?? "Re-validation completed.", durationMs: Date.now() - agentStart, rawResult: { type: "validation", score: revalData?.qualityScore ?? 0, errors: revalData?.validation?.errors ?? [], warnings: revalData?.validation?.warnings ?? [], canRetry: false } },
        });
        if (!revalSuccess) throw new Error("Execution fix failed re-validation.");

        // Re-execute after fix
        const reexecCallId = `call-executor-fix-${Date.now()}`;
        toolCalls.push({ id: reexecCallId, name: "executor", arguments: {} });
        emit({ type: "coordinator:tool_call", payload: { callId: reexecCallId, name: "executor", arguments: {}, iteration: 8 } });
        const reexec = await this.runAgentStep(steps, "executor", ctx, { code: currentCode, skill: plan.skill, sessionId: ctx.sessionId, timeoutMs: skillProfile?.runtime?.timeoutMs ?? 2200, profile: skillProfile });
        if (!reexec.success || !reexec.data) {
          const execErr = reexec.error || (reexec.data as any)?.error || "Execution retry returned no data";
          throw new Error(`Execution retry failed: ${execErr}`);
        }
        const reexecData = reexec.data as { previewUrl?: string; mediaUrl?: string; durationMs?: number } | undefined;
        emit({
          type: "coordinator:tool_result",
          payload: { callId: reexecCallId, name: "executor", success: true, output: "Execution succeeded after fix.", durationMs: Date.now() - agentStart, rawResult: { type: "execution", success: true, previewUrl: reexecData?.previewUrl ?? null, mediaUrl: reexecData?.mediaUrl ?? null, durationMs: reexecData?.durationMs ?? 0 } },
        });
        recordedScene = this.buildSceneSnapshot(ctx, currentCode, plan, reexec.data as any);
      } else {
        const execData = execResult.data as { previewUrl?: string; mediaUrl?: string; durationMs?: number } | undefined;
        emit({
          type: "coordinator:tool_result",
          payload: { callId: execCallId, name: "executor", success: true, output: "Execution succeeded.", durationMs: Date.now() - agentStart, rawResult: { type: "execution", success: true, previewUrl: execData?.previewUrl ?? null, mediaUrl: execData?.mediaUrl ?? null, durationMs: execData?.durationMs ?? 0 } },
        });
        recordedScene = this.buildSceneSnapshot(ctx, currentCode, plan, execResult.data as any);
      }

      // Emit file_complete for scene preview
      if (recordedScene?.previewUrl || recordedScene?.mediaUrl) {
        emit({
          type: "coordinator:file_complete",
          payload: {
            path: recordedScene.sceneId,
            previewUrl: recordedScene.previewUrl ?? recordedScene.mediaUrl ?? null,
            lines: currentCode.split("\n").length,
          },
        });
      }

      emit({
        type: "coordinator:complete",
        payload: {
          response: recordedScene?.explanation ?? "Scene generated successfully.",
          totalToolCalls: toolCalls.length,
          iterations: steps.length,
          terminated: true,
        },
      });

      return {
        success: true,
        response: recordedScene?.explanation ?? "Scene generated successfully.",
        steps,
        recordedScene,
      };
    } catch (err: any) {
      emit({ type: "coordinator:error", payload: { error: err.message } });
      return { success: false, response: "", steps, recordedScene: null, error: err.message };
    }
  }

  private async runAgentStep(
    steps: AgentStep[],
    agentName: string,
    ctx: AgentContext,
    input: Record<string, unknown>
  ): Promise<AgentResult> {
    const step: AgentStep = { id: `step-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, agent: agentName, input, startedAt: Date.now() };
    let result: AgentResult;
    try {
      switch (agentName) {
        case "planner":
          result = await this.planner.execute(ctx);
          break;
        case "coder":
          result = await this.coder.execute(ctx, input as any);
          break;
        case "validator":
          result = await this.validator.execute(ctx, input as any);
          break;
        case "executor":
          result = await this.executor.execute(ctx, input as any);
          break;
        default:
          result = { success: false, error: `Unknown agent: ${agentName}` };
      }
    } catch (err: any) {
      result = { success: false, error: err.message };
    }
    step.output = result;
    step.completedAt = Date.now();
    steps.push(step);
    return result;
  }

  private buildSceneSnapshot(ctx: AgentContext, code: string, plan: CoordinatorPlan, execData: any): any {
    return {
      sceneId: `scene-${Date.now()}`,
      code,
      previewUrl: execData.previewUrl ?? null,
      outputKind: execData.outputKind ?? "code",
      mediaType: execData.mediaType ?? null,
      mediaUrl: execData.mediaUrl ?? null,
      skill: plan.skill,
      explanation: ctx.query,
      source: plan.intent === "modify" ? "modify" : "generate",
      messageId: ctx.assistantMessageId,
    };
  }
}
