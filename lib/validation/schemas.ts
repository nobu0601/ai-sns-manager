import { z } from "zod";

export const platformSchema = z.enum(["X", "INSTAGRAM", "THREADS"]);

// 投稿先（SNSアカウント）ごとの内容
const targetSchema = z.object({
  socialAccountId: z.string().min(1),
  content: z.string().max(10000, "投稿内容が長すぎます"),
  mediaUrls: z.array(z.string().trim().min(1).max(2000)).max(10).default([]),
  mediaType: z.enum(["IMAGE", "VIDEO"]).nullable().optional(),
});

export const postInputSchema = z.object({
  title: z.string().trim().min(1, "投稿タイトルを入力してください").max(200),
  topic: z.string().trim().max(1000).default(""),
  brandId: z.string().nullable().optional(),
  // AI が作った案を採用した場合に、使ったモデルと型を付ける
  aiGenerated: z
    .object({ model: z.string().max(100), style: z.string().max(50) })
    .nullable()
    .optional(),
  targets: z
    .array(targetSchema)
    .min(1, "投稿先のアカウントを1つ以上選択してください")
    .refine((list) => new Set(list.map((t) => t.socialAccountId)).size === list.length, "同じアカウントが重複しています"),
});
export type PostInput = z.infer<typeof postInputSchema>;

export const scheduleInputSchema = z.object({
  scheduledAt: z.coerce.date({ message: "投稿日時が正しくありません" }),
  // 作成者本人が「予約する」を押した場合は承認として扱う
  approve: z.boolean().optional(),
});

export const publishInputSchema = z.object({ approve: z.boolean().optional() });

// ブランドの文章の上限（1欄あたり）。詳しく書けるよう大きめにしている。毎回 AI に渡すため上限だけは残す
export const BRAND_TEXT_MAX = 10000;
const brandText = (label: string) =>
  z.string().max(BRAND_TEXT_MAX, `${label}は${BRAND_TEXT_MAX.toLocaleString("ja-JP")}字以内にしてください`).default("");
const stringList = (label: string) =>
  z
    .array(z.string().trim().min(1).max(200, `${label}は1つ200字以内にしてください`))
    .max(100, `${label}は100個までにしてください`)
    .default([]);

export const brandInputSchema = z.object({
  name: z.string().trim().min(1, "ブランド名を入力してください").max(200, "ブランド名は200字以内にしてください"),
  description: brandText("ブランド説明"),
  targetAudience: brandText("ターゲット"),
  brandImage: brandText("ブランドイメージ"),
  tone: brandText("文章トーン"),
  objective: brandText("投稿目的"),
  avoidExpressions: brandText("避けたい表現"),
  keywords: stringList("使用したいキーワード"),
  prohibitedWords: stringList("禁止キーワード"),
  contentPillars: stringList("投稿テーマの柱"),
});
export type BrandInput = z.infer<typeof brandInputSchema>;

export const draftRequestSchema = z.object({
  topic: z.string().trim().max(1000).default(""),
  objective: z.string().trim().max(500).optional(),
  brandId: z.string().nullable().optional(),
  styles: z.array(z.enum(["brand_intro", "empathy", "story", "howto", "question"])).max(5).optional(),
});

export const mediaRequestSchema = z.object({
  type: z.enum(["IMAGE", "VIDEO"]),
  idea: z.string().trim().min(1, "作りたい画像・動画のイメージを入力してください").max(500),
  aspectRatio: z.enum(["1:1", "4:5", "9:16", "16:9"]).default("1:1"),
  brandId: z.string().nullable().optional(),
  postId: z.string().nullable().optional(),
});

const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "時刻は HH:mm の形式で入力してください");

export const agentConfigSchema = z.object({
  weeklyEnabled: z.boolean(),
  runWeekday: z.number().int().min(0).max(6),
  runTime: timeString,
  postsPerWeek: z.number().int().min(1, "週1回以上にしてください").max(7, "週7回までです"),
  preferredWeekdays: z.array(z.number().int().min(0).max(6)).max(7),
  preferredTime: timeString,
  targetAccountIds: z.array(z.string()).max(20),
  generateImages: z.boolean(),
});

const credentialValues = z.record(z.string(), z.string().max(2000));

export const accountCreateSchema = z.object({
  label: z.string().trim().max(50).optional(),
  brandId: z.string().nullable().optional(),
  credentials: credentialValues,
});

export const accountUpdateSchema = z.object({
  label: z.string().trim().max(50).optional(),
  brandId: z.string().nullable().optional(),
  credentials: credentialValues.optional(),
});

export const settingsInputSchema = z.object({
  approvalMode: z.enum(["ALWAYS", "AI_ONLY", "AUTO"]),
});

export const registerInputSchema = z.object({
  name: z.string().trim().max(100).optional(),
  email: z.string().trim().toLowerCase().email("メールアドレスの形式が正しくありません"),
  password: z.string().min(8, "パスワードは8文字以上にしてください").max(200),
});
