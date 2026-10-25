import { PLATFORM_CAPABILITIES } from "@/lib/social/capabilities";
import { platformTextLength } from "@/lib/social/text-length";
import type { Platform } from "@prisma/client";
import type { BrandContext, PostDraft } from "./types";

// ハッシュタグの目安。Instagram の 30 個は投稿の上限、それ以外は読みやすさのための目安（超えても警告のみ）
const HASHTAG_LIMIT_INSTAGRAM = 30;
const HASHTAG_GUIDE: Record<Platform, number> = { X: 2, INSTAGRAM: 15, THREADS: 1 };

const URL_PATTERN = /https?:\/\/\S+|www\.\S+/i;
const HASHTAG_PATTERN = /#[^\s#]+/g;

// Instagram に実際に投稿する文章（本文＋ハッシュタグ）
export function instagramContent(draft: PostDraft): string {
  const tags = draft.instagram.hashtags.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ");
  return tags ? `${draft.instagram.caption.trim()}\n\n${tags}` : draft.instagram.caption.trim();
}

// 案に含まれる、SNSごとの最終的な文章
export function draftTexts(draft: PostDraft): Record<Platform, string> {
  return { X: draft.x.text.trim(), INSTAGRAM: instagramContent(draft), THREADS: draft.threads.text.trim() };
}

const LABEL: Record<Platform, string> = { X: "X", INSTAGRAM: "Instagram", THREADS: "Threads" };

// 禁止ワードを含むか（大文字小文字・全角半角の違いは無視する）
export function findProhibitedWords(text: string, words: string[]): string[] {
  const normalized = text.normalize("NFKC").toLowerCase();
  return words.filter((w) => w.trim() && normalized.includes(w.normalize("NFKC").toLowerCase()));
}

// 1案の品質チェック。errors は作り直しの対象、warnings は画面で注意を促すだけ
export function checkDraft(draft: PostDraft, brand: BrandContext | null): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const texts = draftTexts(draft);

  for (const platform of Object.keys(texts) as Platform[]) {
    const text = texts[platform];
    const caps = PLATFORM_CAPABILITIES[platform];
    const name = LABEL[platform];
    if (!text) {
      errors.push(`${name}の文章が空です`);
      continue;
    }
    const length = platformTextLength(text, caps);
    if (caps.maxTextLength !== null && length > caps.maxTextLength) {
      errors.push(`${name}の文章が長すぎます（${length}/${caps.maxTextLength}文字）`);
    }
    if (URL_PATTERN.test(text)) warnings.push(`${name}の文章にURLが含まれています。リンク先が正しいか確認してください`);
    const tagCount = platform === "INSTAGRAM" ? draft.instagram.hashtags.length : (text.match(HASHTAG_PATTERN) ?? []).length;
    if (platform === "INSTAGRAM" && tagCount > HASHTAG_LIMIT_INSTAGRAM) {
      errors.push(`Instagramのハッシュタグが多すぎます（${tagCount}個。上限は${HASHTAG_LIMIT_INSTAGRAM}個）`);
    } else if (tagCount > HASHTAG_GUIDE[platform]) {
      warnings.push(`${name}のハッシュタグが多めです（${tagCount}個。目安は${HASHTAG_GUIDE[platform]}個まで）`);
    }
  }

  const banned = findProhibitedWords(Object.values(texts).join("\n"), brand?.prohibitedWords ?? []);
  if (banned.length > 0) errors.push(`禁止キーワード「${banned.join("」「")}」が含まれています`);
  return { errors, warnings };
}

// 案どうしで X の文章が同じものを探す（作り直しの対象）
export function findDuplicates(drafts: PostDraft[]): Set<number> {
  const seen = new Map<string, number>();
  const dup = new Set<number>();
  drafts.forEach((d, i) => {
    const key = d.x.text.replace(/\s+/g, "");
    if (seen.has(key)) dup.add(i);
    else seen.set(key, i);
  });
  return dup;
}
