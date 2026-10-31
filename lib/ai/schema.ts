import * as z from "zod/v4";
import { DRAFT_STYLES } from "./types";

// Claude の構造化出力（output_config.format）に渡すスキーマ。
// 件数や文字数の制約はスキーマではなく、受け取った後の品質チェックで確認する
export const draftSchema = z.object({
  style: z.enum(DRAFT_STYLES),
  title: z.string().describe("管理用の短いタイトル（20字程度）"),
  summary: z.string().describe("この案の狙いを1文で"),
  x: z.object({ text: z.string() }),
  instagram: z.object({
    caption: z.string().describe("ハッシュタグを含まない本文"),
    hashtags: z.array(z.string()).describe("# 付きのハッシュタグ"),
  }),
  threads: z.object({ text: z.string() }),
  tiktok: z.object({ text: z.string().describe("動画のキャプション。文末にハッシュタグ3〜5個") }),
});

export const draftSetSchema = z.object({ drafts: z.array(draftSchema) });
export type DraftSet = z.infer<typeof draftSetSchema>;

// 画像・動画の生成プロンプト
export const mediaPromptSchema = z.object({
  prompt: z.string().describe("画像・動画生成AIに渡す英語のプロンプト"),
  script: z.string().describe("動画の場合は日本語の構成メモ。画像の場合は空文字"),
});

// AI Agent の投稿計画
export const planSchema = z.object({
  items: z.array(
    z.object({
      slotIndex: z.number().int(),
      pillar: z.string(),
      topic: z.string(),
      style: z.enum(DRAFT_STYLES),
      reason: z.string(),
      imageIdea: z.string(),
    }),
  ),
});

// 分析（Phase 4）。evidence には、根拠にした投稿の ref（P1 など）を入れる
const evidence = z.array(z.string()).describe("根拠にした投稿の ref（例：P1）");
export const analysisSchema = z.object({
  summary: z.string().describe("全体の傾向を2〜3文で"),
  goodThemes: z.array(z.object({ theme: z.string(), reason: z.string(), evidence })),
  textTrends: z.array(z.object({ finding: z.string(), evidence })),
  timeTrends: z.array(z.object({ finding: z.string(), evidence })),
  nextIdeas: z.array(
    z.object({
      title: z.string().describe("投稿案の短いタイトル"),
      topic: z.string().describe("投稿テーマ（投稿作成画面のテーマ欄に入る）"),
      pillar: z.string(),
      reason: z.string(),
    }),
  ),
});
