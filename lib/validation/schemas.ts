import { z } from "zod";

export const platformSchema = z.enum(["X", "INSTAGRAM", "THREADS"]);

// 投稿先（SNSアカウント）ごとの内容
const targetSchema = z.object({
  socialAccountId: z.string().min(1),
  content: z.string().max(10000, "投稿内容が長すぎます"),
  mediaUrls: z.array(z.string().trim().min(1).max(2000)).max(10).default([]),
});

export const postInputSchema = z.object({
  title: z.string().trim().min(1, "投稿タイトルを入力してください").max(200),
  topic: z.string().trim().max(1000).default(""),
  brandId: z.string().nullable().optional(),
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

const stringList = z.array(z.string().trim().min(1).max(100)).max(50).default([]);

export const brandInputSchema = z.object({
  name: z.string().trim().min(1, "ブランド名を入力してください").max(100),
  description: z.string().max(2000).default(""),
  targetAudience: z.string().max(1000).default(""),
  brandImage: z.string().max(1000).default(""),
  tone: z.string().max(500).default(""),
  objective: z.string().max(1000).default(""),
  avoidExpressions: z.string().max(1000).default(""),
  keywords: stringList,
  prohibitedWords: stringList,
  contentPillars: stringList,
});
export type BrandInput = z.infer<typeof brandInputSchema>;

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
