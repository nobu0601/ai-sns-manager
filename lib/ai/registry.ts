import { ClaudeProvider } from "./claude-provider";
import { MockAIProvider } from "./mock-provider";
import type { AIProvider } from "./types";

// AI_PROVIDER_MODE が未指定なら、ANTHROPIC_API_KEY があれば Claude、なければ Mock を使う
export function aiMode(): "claude" | "mock" {
  const mode = process.env.AI_PROVIDER_MODE;
  if (mode === "claude" || mode === "mock") return mode;
  return process.env.ANTHROPIC_API_KEY?.trim() ? "claude" : "mock";
}

let override: AIProvider | null = null;

export function getAIProvider(): AIProvider {
  if (override) return override;
  return aiMode() === "claude" ? new ClaudeProvider() : new MockAIProvider();
}

// テスト用に差し替える
export function setAIProvider(provider: AIProvider | null): void {
  override = provider;
}
