import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AIError } from "./errors";
import type * as z from "zod/v4";
import { analysisUserPrompt, mediaUserPrompt, planUserPrompt, promptFile, systemPrompt, userPrompt } from "./prompts";
import { analysisSchema, draftSetSchema, mediaPromptSchema, planSchema } from "./schema";
import type {
  AIProvider,
  AnalysisRequest,
  AnalysisResult,
  GenerateRequest,
  GenerateResult,
  MediaPromptRequest,
  MediaPromptResult,
  PlanRequest,
  PlanResult,
} from "./types";

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

  // 構造化出力で1回呼び出す共通処理
  private async call<T extends z.ZodType>(schema: T, system: string, user: string): Promise<{ output: z.infer<T>; model: string; usage: { inputTokens: number; outputTokens: number } }> {
    let response;
    try {
      response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system,
        messages: [{ role: "user", content: user }],
        output_config: { effort: this.effort, format: betaZodOutputFormat(schema) },
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
      output: response.parsed_output as z.infer<T>,
      model: response.model,
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
    };
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const { output, model, usage } = await this.call(draftSetSchema, systemPrompt(), userPrompt(request));
    return { drafts: output.drafts, model, usage };
  }

  async mediaPrompt(request: MediaPromptRequest): Promise<MediaPromptResult> {
    const system = promptFile(request.type === "VIDEO" ? "video/system.md" : "image/system.md");
    const { output, model } = await this.call(mediaPromptSchema, system, mediaUserPrompt(request));
    return { prompt: output.prompt, script: request.type === "VIDEO" ? output.script : "", model };
  }

  async planWeek(request: PlanRequest): Promise<PlanResult> {
    const { output, model } = await this.call(planSchema, promptFile("agent/system.md"), planUserPrompt(request));
    return { items: output.items, model };
  }

  async analyze(request: AnalysisRequest): Promise<AnalysisResult> {
    const { output, model } = await this.call(analysisSchema, promptFile("analytics/system.md"), analysisUserPrompt(request));
    return { ...output, model };
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
