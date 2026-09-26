import { PLATFORM_LABELS } from "@/lib/errors/user-messages";
import type { PlatformPost, SocialPlatformCapabilities, ValidationResult } from "./types";

// capabilities に基づく共通チェック。SNS固有のチェックは各 Adapter で追加する。
export function validateAgainstCapabilities(
  post: PlatformPost,
  capabilities: SocialPlatformCapabilities,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const name = PLATFORM_LABELS[post.platform];
  const content = post.content.trim();
  const hasMedia = (post.mediaUrls?.length ?? 0) > 0;

  if (!content && !hasMedia) errors.push(`${name}: 投稿内容を入力してください`);

  // 絵文字・サロゲートペアを1文字として数える（SNS側の厳密な数え方とは異なる場合がある）
  const length = [...content].length;
  if (capabilities.maxTextLength !== null && length > capabilities.maxTextLength) {
    errors.push(`${name}: ${capabilities.maxTextLength}文字以内にしてください（現在${length}文字）`);
  }

  if (capabilities.requiresMedia && !hasMedia) {
    warnings.push(`${name}: 実際の投稿には画像または動画が必要です（メディア添付は Phase 3 で対応予定）`);
  }

  return { valid: errors.length === 0, errors, warnings };
}
