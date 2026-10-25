import { FalAIProvider } from "./fal-provider";
import { MockMediaProvider } from "./mock-provider";
import type { MediaGenerationProvider } from "./types";

// MEDIA_PROVIDER_MODE が未指定なら、FAL_KEY があれば fal.ai、なければ Mock を使う
export function mediaMode(): "fal" | "mock" {
  const mode = process.env.MEDIA_PROVIDER_MODE;
  if (mode === "fal" || mode === "mock") return mode;
  return process.env.FAL_KEY?.trim() ? "fal" : "mock";
}

let override: MediaGenerationProvider | null = null;

export function getMediaProvider(): MediaGenerationProvider {
  if (override) return override;
  return mediaMode() === "fal" ? new FalAIProvider() : new MockMediaProvider();
}

export function setMediaProvider(provider: MediaGenerationProvider | null): void {
  override = provider;
}
