/**
 * Validator Agent — Checks generated code for syntax, security, and quality.
 *
 * Wraps the existing AST-based validator and optional quality analyzer.
 */

import { validateCode, type ValidationResult } from "../quality/validator.js";
import { analyzeQuality } from "../quality/analyzer.js";
import type { AgentContext, AgentResult } from "./types.js";

export interface ValidatorInput {
  code: string;
  skill: string;
  quality: string;
  userQuery?: string;
}

export interface ValidatorOutput {
  validation: ValidationResult;
  qualityScore?: number;
  canRetry: boolean;
  feedback: string;
}

export class ValidatorAgent {
  name = "validator";

  async execute(_ctx: AgentContext, input: ValidatorInput): Promise<AgentResult<ValidatorOutput>> {
    try {
      const validation = validateCode(
        input.code,
        input.skill,
        {
          requestedQuality: input.quality,
          userQuery: input.userQuery,
          enforceQuality: true,
        }
      );

      let qualityScore: number | undefined;
      try {
        const signals = analyzeQuality({ code: input.code, skill: input.skill, prompt: input.userQuery ?? "" });
        qualityScore = signals.composite ?? undefined;
      } catch {
        // Quality analyzer is best-effort
      }

      const canRetry = !validation.valid || validation.errors.length > 0;
      const feedback = this.buildFeedback(validation, qualityScore);

      return {
        success: validation.valid && !canRetry,
        data: { validation, qualityScore, canRetry, feedback },
        meta: { errors: validation.errors.length, warnings: validation.warnings.length },
      };
    } catch (err: any) {
      return { success: false, error: `Validator failed: ${err.message}` };
    }
  }

  private buildFeedback(v: ValidationResult, score?: number): string {
    const parts: string[] = [];
    if (v.errors.length) parts.push(`Errors: ${v.errors.map((e) => `[${e.code}] ${e.message}`).join("; ")}`);
    if (v.warnings.length) parts.push(`Warnings: ${v.warnings.map((w) => `[${w.code}] ${w.message}`).join("; ")}`);
    if (score !== undefined) parts.push(`Quality score: ${score}/100.`);
    return parts.join("\n") || "Validation passed.";
  }
}
