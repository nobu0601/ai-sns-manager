import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AIError } from "./errors";
import { systemPrompt, userPrompt } from "./prompts";
import { draftSetSchema } from "./schema";
import type { AIProvider, GenerateRequest, GenerateResult } from "./types";

export const DEFAULT_MODEL = "claude-sonnet-5-5";
type Effort = "low" | "medium" | "high" | "xhigh" | "max";

// Claude（Anthropic）で投稿案を作る。JSON Schema の構造化出力で受け取る。
// 安全上の理由でモデルが断った場合に備え、サーバー側のフォールバック（fallbacks: "default"）を有効にしている
export class ClaudeProvider implements AIProvider {
  readonly name = "claude";
  private readonly client: Anthropic;

  constructor(
    private readonly model: string = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
    private readonly effort: Effort = (process.env.ANTHROPIC_EFFORT as Effort) || "medium",
    client?: Anthropic,
  ) {
    // キーは ANTHROPIC_API_KEY から SDK が読み込む。リトライ（429・5xx）は SDK に任せる
    this.client = client ?? new Anthropic({ maxRetries: 2 });
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    let response;
    try {
      response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: systemPrompt(),
        messages: [{ role: "user", content: userPrompt(request) }],
        output_config: { effort: this.effort, format: betaZodOutputFormat(draftSetSchema) },
      });
    } catch (err) {
      throw toAIError(err);
    }

    if (response.stop_reason === "refusal") {
      throw new AIError("REFUSAL", response.stop_details?.category ?? undefined);
    }
    if (response.stop_reason === "max_tokens" || !response.parsed_output) {
      throw new AIError("INVALID_OUTPUT", `stop_reason=${response.stop_reason}`);
    }
    return {
      drafts: response.parsed_output.drafts,
      model: response.model,
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
    };
  }
}

function toAIError(err: unknown): AIError {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new AIError("AUTH", err.message);
  }
  if (err instanceof Anthropic.RateLimitError) return new AIError("RATE_LIMIT", err.message);
  if (err instanceof Anthropic.BadRequestError) return new AIError("INVALID_OUTPUT", err.message);
  if (err instanceof Anthropic.APIError) return new AIError("UNAVAILABLE", `${err.status} ${err.message}`);
  if (err instanceof Error && /api ?key|apiKey|authentication/i.test(err.message)) {
    return new AIError("NOT_CONFIGURED", err.message);
  }
  return new AIError("UNAVAILABLE", err instanceof Error ? err.message : String(err));
}
