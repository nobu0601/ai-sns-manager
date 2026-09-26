import type { Platform } from "@prisma/client";
import type { SocialPlatformCapabilities } from "./types";

// 各SNSの機能・制約。数値は仕様変更されうるため、Adapter 実装時（Step 11〜13）に
// 公式ドキュメントで必ず再確認し、ここを更新すること。
export const PLATFORM_CAPABILITIES: Record<Platform, SocialPlatformCapabilities> = {
  X: {
    textPost: true,
    imagePost: true,
    videoPost: true,
    scheduledPost: false,
    analytics: true,
    deletePost: true,
    requiresMedia: false,
    maxTextLength: 280,
  },
  INSTAGRAM: {
    textPost: false,
    imagePost: true,
    videoPost: true,
    scheduledPost: false,
    analytics: true,
    deletePost: false,
    requiresMedia: true,
    maxTextLength: 2200,
  },
  THREADS: {
    textPost: true,
    imagePost: true,
    videoPost: true,
    scheduledPost: false,
    analytics: true,
    deletePost: true,
    requiresMedia: false,
    maxTextLength: 500,
  },
};
