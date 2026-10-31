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
    lengthCounting: "x-weighted",
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
    lengthCounting: "codepoints",
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
    lengthCounting: "codepoints",
  },
  // TikTok：動画のみ（Content Posting API の Direct Post）。キャプションは最大2200（UTF-16 単位。公式ドキュメント）
  TIKTOK: {
    textPost: false,
    imagePost: false,
    videoPost: true,
    scheduledPost: false,
    analytics: false,
    deletePost: false,
    requiresMedia: true,
    maxTextLength: 2200,
    lengthCounting: "codepoints",
  },
};
