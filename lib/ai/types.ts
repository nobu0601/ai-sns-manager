import type { Platform } from "@prisma/client";

// 投稿案の型（ブランド紹介型・共感型・ストーリー型・ノウハウ型・質問型）
export const DRAFT_STYLES = ["brand_intro", "empathy", "story", "howto", "question"] as const;
export type DraftStyle = (typeof DRAFT_STYLES)[number];

export const DRAFT_STYLE_LABELS: Record<DraftStyle, string> = {
  brand_intro: "ブランド紹介型",
  empathy: "共感型",
  story: "ストーリー型",
  howto: "ノウハウ型",
  question: "質問型",
};

// AI が返す1案。SNSごとに書き分けた文章を持つ
export interface PostDraft {
  style: DraftStyle;
  title: string;
  summary: string;
  x: { text: string };
  instagram: { caption: string; hashtags: string[] };
  threads: { text: string };
}

// AI に渡すブランド情報（Brand モデルの必要な項目）
export interface BrandContext {
  name: string;
  description: string;
  targetAudience: string;
  brandImage: string;
  tone: string;
  objective: string;
  avoidExpressions: string;
  keywords: string[];
  prohibitedWords: string[];
  contentPillars: string[];
}

export interface GenerateRequest {
  topic: string;
  objective?: string;
  brand: BrandContext | null;
  styles: DraftStyle[];
  // 品質チェックで見つかった問題（作り直しのときに渡す）
  feedback?: { style: DraftStyle; issues: string[] }[];
}

export interface GenerateResult {
  drafts: PostDraft[];
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
}

// AI の呼び出し先。Claude のほか、テスト・キー未設定時の Mock を差し替えられる
export interface AIProvider {
  readonly name: string;
  generate(request: GenerateRequest): Promise<GenerateResult>;
}

// 画面に返す投稿案（品質チェックの結果つき）
export interface CheckedDraft extends PostDraft {
  id: string;
  errors: string[];
  warnings: string[];
}

export type { Platform };
