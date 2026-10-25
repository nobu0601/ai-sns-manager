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

// 画像・動画の生成プロンプト作成の依頼
export interface MediaPromptRequest {
  type: "IMAGE" | "VIDEO";
  idea: string;
  aspectRatio: string;
  brand: BrandContext | null;
}

export interface MediaPromptResult {
  prompt: string;
  script: string;
  model: string;
}

// AI Agent の計画（決まった投稿枠ごとにテーマを割り当てる）
export interface PlanSlot {
  index: number;
  label: string; // 例：10/27(月) 12:00
}

export interface PlanHistoryItem {
  date: string;
  title: string;
  topic: string;
  pillar: string | null;
  status: string;
}

export interface PlanRequest {
  brand: BrandContext;
  slots: PlanSlot[];
  history: PlanHistoryItem[];
  // 最新の分析（あれば）。テーマ選びの参考にする。投稿日時は変えない
  insights?: PlanInsights | null;
  feedback?: string[];
}

export interface PlanItem {
  slotIndex: number;
  pillar: string;
  topic: string;
  style: DraftStyle;
  reason: string;
  imageIdea: string;
}

export interface PlanResult {
  items: PlanItem[];
  model: string;
}

// 分析（Phase 4）：AI に渡す実績データ。ref（P1, P2…）で投稿を指し、AI の結論の根拠にする
export interface AnalysisPostInput {
  ref: string;
  date: string; // 例：10/27(月) 12:00
  timeBand: string;
  platform: string;
  pillar: string | null;
  title: string;
  excerpt: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  reactions: number | null;
  engagementRate: number | null;
}

export interface AnalysisGroupInput {
  key: string;
  posts: number;
  avgViews: number | null;
  avgReactions: number | null;
  avgEngagementRate: number | null;
}

export interface AnalysisRequest {
  brand: BrandContext;
  posts: AnalysisPostInput[];
  byPillar: AnalysisGroupInput[];
  byTimeBand: AnalysisGroupInput[];
  byWeekday: AnalysisGroupInput[];
  feedback?: string[];
}

export interface AnalysisFinding {
  finding: string;
  evidence: string[]; // 根拠の投稿の ref
}

export interface AnalysisIdea {
  title: string;
  topic: string;
  pillar: string;
  reason: string;
}

export interface AnalysisOutput {
  summary: string;
  goodThemes: { theme: string; reason: string; evidence: string[] }[];
  textTrends: AnalysisFinding[];
  timeTrends: AnalysisFinding[];
  nextIdeas: AnalysisIdea[];
}

export interface AnalysisResult extends AnalysisOutput {
  model: string;
}

// AI Agent の計画に渡す、最新の分析の要点
export interface PlanInsights {
  analyzedAt: string;
  summary: string;
  goodThemes: string[];
  timeTrends: string[];
  nextIdeas: { topic: string; pillar: string }[];
}

// AI の呼び出し先。Claude のほか、テスト・キー未設定時の Mock を差し替えられる
export interface AIProvider {
  readonly name: string;
  generate(request: GenerateRequest): Promise<GenerateResult>;
  mediaPrompt(request: MediaPromptRequest): Promise<MediaPromptResult>;
  planWeek(request: PlanRequest): Promise<PlanResult>;
  analyze(request: AnalysisRequest): Promise<AnalysisResult>;
}

// 画面に返す投稿案（品質チェックの結果つき）
export interface CheckedDraft extends PostDraft {
  id: string;
  errors: string[];
  warnings: string[];
}

export type { Platform };
