import { PLATFORM_CAPABILITIES } from "@/lib/social/capabilities";
import { platformTextLength } from "@/lib/social/text-length";
import type { Platform } from "@prisma/client";
import type { BrandContext, PostDraft } from "./types";

// ハッシュタグの目安（どのSNSも5個程度）。外れても警告のみ。Instagram の 30 個は投稿の上限（エラー）
const HASHTAG_LIMIT_INSTAGRAM = 30;
export const HASHTAG_RANGE = { min: 3, max: 7 };

const URL_PATTERN = /https?:\/\/\S+|www\.\S+/i;
const HASHTAG_PATTERN = /#[^\s#]+/g;

// Instagram に実際に投稿する文章（本文＋ハッシュタグ）
export function instagramContent(draft: PostDraft): string {
  const tags = draft.instagram.hashtags.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ");
  return tags ? `${draft.instagram.caption.trim()}\n\n${tags}` : draft.instagram.caption.trim();
}

// 案に含まれる、SNSごとの最終的な文章
export function draftTexts(draft: PostDraft): Record<Platform, string> {
  return { X: draft.x.text.trim(), INSTAGRAM: instagramContent(draft), THREADS: draft.threads.text.trim(), TIKTOK: draft.tiktok.text.trim() };
}

const LABEL: Record<Platform, string> = { X: "X", INSTAGRAM: "Instagram", THREADS: "Threads", TIKTOK: "TikTok" };

// 禁止ワードを含むか（大文字小文字・全角半角の違いは無視する）
export function findProhibitedWords(text: string, words: string[]): string[] {
  const normalized = text.normalize("NFKC").toLowerCase();
  return words.filter((w) => w.trim() && normalized.includes(w.normalize("NFKC").toLowerCase()));
}

// 投稿にちょうどよい長さ（文字数。Instagram はハッシュタグを除いた本文）。
// 上限（capabilities.maxTextLength）とは別の「読みやすさの目安」。外れたら作り直す
export const RECOMMENDED_LENGTH: Record<Platform, { min: number; max: number }> = {
  X: { min: 50, max: 100 },
  INSTAGRAM: { min: 150, max: 700 },
  THREADS: { min: 50, max: 250 },
  TIKTOK: { min: 30, max: 150 },
};

// 目安と比べる本文（Instagram はハッシュタグを除く）
function bodyText(draft: PostDraft, platform: Platform): string {
  if (platform === "INSTAGRAM") return draft.instagram.caption.trim();
  const text = platform === "X" ? draft.x.text : platform === "TIKTOK" ? draft.tiktok.text : draft.threads.text;
  return text.replace(HASHTAG_PATTERN, "").trim();
}

export function lengthIssue(draft: PostDraft, platform: Platform): string | null {
  const length = [...bodyText(draft, platform)].length;
  const { min, max } = RECOMMENDED_LENGTH[platform];
  if (length < min) return `${LABEL[platform]}の文章が短すぎます（${length}字。${min}〜${max}字にしてください）`;
  if (length > max) return `${LABEL[platform]}の文章が長すぎます（${length}字。${min}〜${max}字にしてください）`;
  return null;
}

// 文章の似ている度合い（0〜1）。日本語でも使えるよう、2文字ずつの組み合わせの重なりで比べる
function bigrams(text: string): Set<string> {
  const t = text.normalize("NFKC").toLowerCase().replace(HASHTAG_PATTERN, "").replace(/[\s\p{P}\p{S}]/gu, "");
  const set = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  return set;
}

export function similarity(a: string, b: string): number {
  const x = bigrams(a);
  const y = bigrams(b);
  if (x.size === 0 || y.size === 0) return 0;
  let common = 0;
  for (const g of x) if (y.has(g)) common++;
  return common / Math.min(x.size, y.size);
}

// これ以上似ていたら「過去の投稿と被っている」とみなして作り直す
export const SIMILARITY_THRESHOLD = 0.6;
// 短すぎる文章は比べない（定型のあいさつなどで誤判定しないため）
const MIN_COMPARE_LENGTH = 20;

// 過去の投稿と似すぎている文章を探す
export function findSimilarPast(
  draft: PostDraft,
  history: { text: string; label: string }[],
): string[] {
  const issues: string[] = [];
  const texts = draftTexts(draft);
  for (const platform of Object.keys(texts) as Platform[]) {
    const body = bodyText(draft, platform);
    if ([...body].length < MIN_COMPARE_LENGTH) continue;
    const hit = history.find((h) => [...h.text].length >= MIN_COMPARE_LENGTH && similarity(body, h.text) >= SIMILARITY_THRESHOLD);
    if (hit) issues.push(`${LABEL[platform]}の文章が、過去の投稿（${hit.label}）と似すぎています。テーマや切り口、言い回しを変えてください`);
  }
  return issues;
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
    } else {
      const issue = lengthIssue(draft, platform);
      if (issue) errors.push(issue);
    }
    if (URL_PATTERN.test(text)) warnings.push(`${name}の文章にURLが含まれています。リンク先が正しいか確認してください`);
    const tagCount = platform === "INSTAGRAM" ? draft.instagram.hashtags.length : (text.match(HASHTAG_PATTERN) ?? []).length;
    if (platform === "INSTAGRAM" && tagCount > HASHTAG_LIMIT_INSTAGRAM) {
      errors.push(`Instagramのハッシュタグが多すぎます（${tagCount}個。上限は${HASHTAG_LIMIT_INSTAGRAM}個）`);
    } else if (tagCount > HASHTAG_RANGE.max) {
      warnings.push(`${name}のハッシュタグが多めです（${tagCount}個。目安は5個程度）`);
    } else if (tagCount < HASHTAG_RANGE.min) {
      warnings.push(`${name}のハッシュタグが少なめです（${tagCount}個。目安は5個程度）`);
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
