/**
 * Coder Agent — Generates or modifies scene code via LLM.
 *
 * Wraps prompt construction + LLM code generation.
 * The Coordinator feeds it a built prompt and receives raw code back.
 */

import { buildToolAwareSystemPrompt } from "../pipeline/prompts.js";
import { resolveAssetPlan, buildAssetPolicyText, buildAssetCatalogText, buildQualityContractText } from "../pipeline/assets.js";
import { executeWithProviderFailover } from "../pipeline/failover.js";
import { streamChatCompletion } from "../llm/streaming.js";
import type { AgentContext, AgentResult } from "./types.js";

export interface CoderInput {
  query: string;
  skill: string;
  quality: string;
  mode?: "generate" | "modify";
  currentCode?: string | null;
  assetPlan?: any;
  onToken?: (token: string) => void;
  profile?: any;
}

export interface CoderOutput {
  code: string;
  rawResponse: string;
  providerId: string;
}

export class CoderAgent {
  name = "coder";

  async execute(ctx: AgentContext, input: CoderInput): Promise<AgentResult<CoderOutput>> {
    try {
      const isModify = input.mode === "modify" && Boolean(input.currentCode);
      const systemPrompt = this.buildSystemPrompt(input.skill, input.quality, input.assetPlan, input.profile);

      const textContent = isModify
        ? `[MODE: MODIFY] The user wants to modify the existing scene. Do NOT create a new scene unless explicitly asked. Preserve existing functionality and only change what is requested.\n\nCurrent scene code:\n\`\`\`javascript\n${input.currentCode}\n\`\`\`\n\nUser instruction: ${input.query}`
        : `User query: ${input.query}\nSelected skill: ${input.skill}\nRequested quality: ${input.quality}`;

      const resolvedImageUrl = ctx.imageUrl || (ctx.imageData ? `data:image/png;base64,${ctx.imageData}` : null);
      const userMessage: any = resolvedImageUrl
        ? [
            { type: "text", text: textContent },
            { type: "image_url", image_url: { url: resolvedImageUrl, detail: "low" } }
          ]
        : textContent;

      const completion = await executeWithProviderFailover({
        operationName: "CoderAgent",
        filter: { preferredProviderId: String(ctx.preferences?.provider ?? "").trim() || undefined },
        mode: "thinking",
        retryDelays: [250, 750],
        executeProvider: async ({ provider, retryDelays }: { provider: any; retryDelays: number[] }) => {
          const streamOptions: any = { mode: "thinking", retryDelays };
          if (input.onToken) {
            streamOptions.callbacks = { onToken: input.onToken };
          }
          const result = await streamChatCompletion(
            provider,
            {
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage },
              ],
            },
            streamOptions
          );
          if (!result.content) throw new Error("Empty completion from provider.");
          return result;
        },
      });

      // Extract code blocks
      const code = this.extractCode(completion.value.content ?? "");

      return {
        success: true,
        data: {
          code,
          rawResponse: completion.value.content ?? "",
          providerId: completion.provider?.id ?? "unknown",
        },
      };
    } catch (err: any) {
      return { success: false, error: `Coder failed: ${err.message}` };
    }
  }

  private buildSystemPrompt(skill: string, quality: string, assetPlan?: any, profile?: any): string {
    const lines = [
      "You are a senior JavaScript visual generation agent.",
      "Generate runnable JavaScript scene code only.",
      `Skill: ${skill}. Quality: ${quality}.`,
      "Do not include markdown fences or prose.",
      "Avoid eval, Function constructors, network calls, and unsafe APIs.",
    ];

    if (profile?.templates?.sceneBootstrap) {
      lines.push(
        "",
        "=== RUNTIME GLOBALS ===",
        "The following variables are pre-initialized by the runtime. Do NOT redeclare or re-initialize them:",
        profile.templates.sceneBootstrap
      );
    }

    if (profile?.bootstrapScript) {
      lines.push(
        "",
        "=== RUNTIME INITIALIZATION ===",
        profile.bootstrapScript
      );
    }

    if (profile?.runtime?.maxFrames) {
      lines.push(`Max frames for animation: ${profile.runtime.maxFrames}.`);
    }

    if (assetPlan) {
      lines.push("", "Asset catalog:", buildAssetCatalogText(assetPlan));
      lines.push("Asset policy:", buildAssetPolicyText(assetPlan));
    }

    return lines.join("\n");
  }

  private extractCode(raw: string): string {
    const fenceMatch = raw.match(/```(?:javascript|js)?\n([\s\S]*?)```/);
    if (fenceMatch) return fenceMatch[1]?.trim() ?? raw.trim();
    return raw.trim();
  }
}
