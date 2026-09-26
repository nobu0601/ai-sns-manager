import type { ApprovalMode, ApprovalStatus, PostPlatformStatus, PostStatus } from "@prisma/client";

// SNS別の状態から投稿全体の状態を決める
export function computePostStatus(platformStatuses: PostPlatformStatus[], hasAllContent: boolean): PostStatus {
  if (platformStatuses.length === 0) return "DRAFT";
  const has = (s: PostPlatformStatus) => platformStatuses.includes(s);
  const all = (s: PostPlatformStatus) => platformStatuses.every((p) => p === s);

  if (has("POSTING")) return "POSTING";
  if (all("PUBLISHED")) return "PUBLISHED";
  if (all("CANCELLED")) return "CANCELLED";
  if (has("SCHEDULED")) return "SCHEDULED";
  if (has("FAILED")) return "FAILED";
  if (platformStatuses.every((p) => p === "PUBLISHED" || p === "CANCELLED")) return "PUBLISHED";
  return hasAllContent ? "READY" : "DRAFT";
}

// 手動作成した投稿の初期承認状態
export function initialApprovalStatus(mode: ApprovalMode, source: "manual" | "ai"): ApprovalStatus {
  if (mode === "ALWAYS") return "PENDING";
  if (mode === "AI_ONLY") return source === "ai" ? "PENDING" : "NOT_REQUIRED";
  return "NOT_REQUIRED";
}

export function isApproved(status: ApprovalStatus): boolean {
  return status === "APPROVED" || status === "NOT_REQUIRED";
}

// 編集・削除してよい状態か（投稿処理中・投稿済みは不可）
export function isEditable(status: PostStatus): boolean {
  return status !== "POSTING" && status !== "PUBLISHED";
}
