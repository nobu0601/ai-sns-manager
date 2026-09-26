import type { Platform } from "@prisma/client";
import { InstagramAdapter } from "./instagram/instagram-adapter";
import { MockSocialAdapter } from "./mock/mock-adapter";
import { ThreadsAdapter } from "./threads/threads-adapter";
import type { SocialPlatformAdapter } from "./types";
import { XAdapter } from "./x/x-adapter";

export const PLATFORMS: Platform[] = ["X", "INSTAGRAM", "THREADS"];

export function isMockMode(): boolean {
  return (process.env.SOCIAL_PROVIDER_MODE ?? "mock") !== "live";
}

// 新しいSNSを追加するときは、Adapter を実装してここに登録する
const liveAdapters: Record<Platform, () => SocialPlatformAdapter> = {
  X: () => new XAdapter(),
  INSTAGRAM: () => new InstagramAdapter(),
  THREADS: () => new ThreadsAdapter(),
};

export function getAdapter(platform: Platform): SocialPlatformAdapter {
  return isMockMode() ? new MockSocialAdapter(platform) : liveAdapters[platform]();
}

export function parsePlatform(value: string): Platform | null {
  const upper = value.toUpperCase();
  return (PLATFORMS as string[]).includes(upper) ? (upper as Platform) : null;
}
