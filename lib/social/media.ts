import type { MediaType } from "@prisma/client";

// URL の拡張子から画像か動画かを推測する（種類が保存されていない場合の補助）
const VIDEO_EXT = /\.(mp4|mov|m4v|webm)(\?|#|$)/i;

export function inferMediaType(url: string): MediaType {
  return VIDEO_EXT.test(url) ? "VIDEO" : "IMAGE";
}

// 投稿に添付する1件目のメディア（このアプリは1投稿につき画像または動画1つ）
export function primaryMedia(post: { mediaUrls?: string[]; mediaType?: MediaType | null }): { url: string; type: MediaType } | null {
  const url = post.mediaUrls?.[0];
  if (!url) return null;
  return { url, type: post.mediaType ?? inferMediaType(url) };
}
