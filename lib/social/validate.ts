import { PLATFORM_LABELS } from "@/lib/errors/user-messages";
import { primaryMedia } from "./media";
import { platformTextLength } from "./text-length";
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

  if (!content && !(capabilities.requiresMedia && hasMedia)) errors.push(`${name}: 投稿内容を入力してください`);

  // SNS の数え方で数える（X は日本語を2文字として数える）
  const length = platformTextLength(content, capabilities);
  if (capabilities.maxTextLength !== null && length > capabilities.maxTextLength) {
    const note = capabilities.lengthCounting === "x-weighted" ? "。日本語は1文字を2文字として数えます" : "";
    errors.push(`${name}: ${capabilities.maxTextLength}文字以内にしてください（現在${length}文字${note}）`);
  }

  if (capabilities.requiresMedia && !hasMedia) {
    errors.push(`${name}: 画像または動画を添付してください（${name}は画像・動画なしでは投稿できません）`);
  }
  const media = primaryMedia(post);
  if (media?.type === "VIDEO" && !capabilities.videoPost) errors.push(`${name}: 動画の投稿には対応していません`);
  if (media?.type === "IMAGE" && !capabilities.imagePost) errors.push(`${name}: 画像の投稿には対応していません`);
  if ((post.mediaUrls?.length ?? 0) > 1) errors.push(`${name}: 添付できる画像・動画は1つまでです`);
  for (const url of post.mediaUrls ?? []) {
    if (!/^https:\/\/\S+$/.test(url)) errors.push(`${name}: 画像のURLは https:// で始まる公開URLにしてください`);
  }

  return { valid: errors.length === 0, errors, warnings };
}
