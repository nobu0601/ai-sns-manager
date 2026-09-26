import type { ApprovalMode, ApprovalStatus, PostPlatformStatus, PostStatus, SocialAccountStatus } from "@prisma/client";

export const POST_STATUS_LABELS: Record<PostStatus, string> = {
  DRAFT: "下書き",
  GENERATING: "生成中",
  READY: "準備完了",
  SCHEDULED: "予約済み",
  POSTING: "投稿中",
  PUBLISHED: "投稿済み",
  FAILED: "失敗",
  CANCELLED: "取消",
};

export const PLATFORM_STATUS_LABELS: Record<PostPlatformStatus, string> = {
  DRAFT: "未予約",
  SCHEDULED: "予約済み",
  POSTING: "投稿中",
  PUBLISHED: "投稿済み",
  FAILED: "失敗",
  CANCELLED: "取消",
};

export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  PENDING: "承認待ち",
  APPROVED: "承認済み",
  REJECTED: "却下",
  NOT_REQUIRED: "承認不要",
};

export const APPROVAL_MODE_LABELS: Record<ApprovalMode, { label: string; description: string }> = {
  ALWAYS: { label: "常に承認", description: "すべての投稿で、投稿前にあなたの承認が必要です（推奨）" },
  AI_ONLY: { label: "AI生成後のみ承認", description: "AIが作った投稿だけ承認が必要です。手動で作った投稿は承認不要です" },
  AUTO: { label: "完全自動", description: "承認なしで投稿します。AIが作った投稿もそのまま投稿されます" },
};

export const ACCOUNT_STATUS_LABELS: Record<SocialAccountStatus, string> = {
  CONNECTED: "接続済み",
  EXPIRED: "再認証が必要",
  DISCONNECTED: "未接続",
};

export type Tone = "gray" | "blue" | "green" | "amber" | "red" | "violet";

export const STATUS_TONES: Record<PostStatus | PostPlatformStatus, Tone> = {
  DRAFT: "gray",
  GENERATING: "violet",
  READY: "blue",
  SCHEDULED: "violet",
  POSTING: "amber",
  PUBLISHED: "green",
  FAILED: "red",
  CANCELLED: "gray",
};
