/**
 * Executor Agent — Runs generated code in the sandbox / client runtime.
 *
 * Wraps executeSkillRuntime and records execution metrics.
 */

import { executeSkillRuntime } from "../sandbox/skill-runtime.js";
import type { AgentContext, AgentResult } from "./types.js";

export interface ExecutorInput {
  code: string;
  skill: string;
  sessionId: string;
  timeoutMs?: number;
  turnDeadlineAtMs?: number | null;
  profile?: any;
}

export interface ExecutorOutput {
  success: boolean;
  previewUrl: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  outputKind: string;
  error: string | null;
  durationMs: number;
}

const JS_SKILL_IDS = new Set(["threejs", "p5js", "p5.js", "d3js", "d3", "animejs", "anime.js"]);
const clientRenderingEnabled =
  process.env.CLIENT_RENDERING_ENABLED !== "false" &&
  process.env.CLIENT_RENDERING_ENABLED !== "0";

function isJsSkill(skillId: string): boolean {
  return JS_SKILL_IDS.has(skillId);
}

export class ExecutorAgent {
  name = "executor";

  async execute(ctx: AgentContext, input: ExecutorInput): Promise<AgentResult<ExecutorOutput>> {
    try {
      const profile = input.profile;
      const isClientRendered = clientRenderingEnabled && (!profile || profile.runtime?.adapter?.startsWith("mock-"));

      // For JS skills with client rendering enabled, skip sandbox execution
      // and let the browser handle rendering directly.
      if (isClientRendered) {
        const output: ExecutorOutput = {
          success: true,
          previewUrl: null, // Browser constructs its own preview
          mediaUrl: null,
          mediaType: null,
          outputKind: "code",
          error: null,
          durationMs: 0,
        };
        return {
          success: true,
          data: output,
          meta: { renderCount: 0, buildArtifacts: null, source: "client-rendering" },
        };
      }

      const result = await executeSkillRuntime({
        skillId: input.skill,
        code: input.code,
        sessionId: input.sessionId,
        timeoutMs: input.timeoutMs ?? profile?.runtime?.timeoutMs ?? 2200,
        maxFrames: profile?.runtime?.maxFrames ?? undefined,
        turnDeadlineAtMs: input.turnDeadlineAtMs ?? null,
      });

      const output: ExecutorOutput = {
        success: Boolean(result.success),
        previewUrl: result.previewUrl ?? null,
        mediaUrl: result.mediaUrl ?? null,
        mediaType: result.mediaType ?? null,
        outputKind: result.outputKind ?? "code",
        error: result.error ?? null,
        durationMs: result.durationMs ?? 0,
      };

      return {
        success: output.success,
        data: output,
        error: output.success ? undefined : (output.error || "Execution failed without error details"),
        meta: { renderCount: result.renderCount, buildArtifacts: result.buildArtifacts },
      };
    } catch (err: any) {
      return { success: false, error: `Executor failed: ${err.message}` };
    }
  }
}
