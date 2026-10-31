import { readFileSync } from "node:fs";
import path from "node:path";
import {
  DRAFT_STYLE_LABELS,
  type AnalysisGroupInput,
  type AnalysisRequest,
  type BrandContext,
  type GenerateRequest,
  type HistoryEntry,
  type MediaPromptRequest,
  type PlanRequest,
} from "./types";

// プロンプトはコードに直書きせず prompts/ から読み込む（アプリはリポジトリのルートで起動する前提）
const PROMPT_FILES = ["post-generation/system.md", "x/guidelines.md", "instagram/guidelines.md", "threads/guidelines.md"];

let cachedSystem: string | null = null;
const cachedFiles = new Map<string, string>();

// prompts/ 以下の1ファイルを読む
export function promptFile(relativePath: string): string {
  let text = cachedFiles.get(relativePath);
  if (text === undefined) {
    text = readFileSync(path.join(process.cwd(), "prompts", relativePath), "utf8").trim();
    cachedFiles.set(relativePath, text);
  }
  return text;
}

export function systemPrompt(): string {
  if (cachedSystem === null) {
    const dir = path.join(process.cwd(), "prompts");
    cachedSystem = PROMPT_FILES.map((f) => readFileSync(path.join(dir, f), "utf8").trim()).join("\n\n");
  }
  return cachedSystem;
}

export function brandSection(brand: BrandContext | null): string {
  if (!brand) return "# ブランド情報\n（未設定。一般的で落ち着いたトーンで書いてください）";
  const list = (items: string[]) => (items.length > 0 ? items.join("、") : "（なし）");
  const text = (v: string) => v.trim() || "（未設定）";
  return [
    "# ブランド情報",
    `- ブランド名：${brand.name}`,
    `- 説明：${text(brand.description)}`,
    `- ターゲット：${text(brand.targetAudience)}`,
    `- ブランドイメージ：${text(brand.brandImage)}`,
    `- 文章トーン：${text(brand.tone)}`,
    `- 投稿目的：${text(brand.objective)}`,
    `- 避けたい表現：${text(brand.avoidExpressions)}`,
    `- 使いたいキーワード：${list(brand.keywords)}`,
    `- 禁止キーワード（絶対に使わない）：${list(brand.prohibitedWords)}`,
    `- 投稿テーマの柱：${list(brand.contentPillars)}`,
  ].join("\n");
}

// ユーザー入力（テーマなど）はブランド情報と分けて、データとして渡す
export function userPrompt(request: GenerateRequest): string {
  const styles = request.styles.map((s) => `${s}（${DRAFT_STYLE_LABELS[s]}）`).join("、");
  const parts = [
    brandSection(request.brand),
    "# 今回の投稿",
    `- テーマ：${request.topic.trim() || "（指定なし。ブランドの投稿テーマの柱から選んでください）"}`,
    ...(request.objective?.trim() ? [`- 今回の目的：${request.objective.trim()}`] : []),
    "",
    ...historySection(request.history, "# これまでの投稿（新しい順。内容・切り口・言い回しを重ねず、流れを踏まえてください）"),
    "",
    `次の型で、投稿案を ${request.styles.length} 案作ってください（この順番で、各型1案ずつ）：${styles}`,
  ];
  if (request.feedback && request.feedback.length > 0) {
    parts.push(
      "",
      "# 前回の案で見つかった問題（必ず直してください）",
      ...request.feedback.map((f) => `- ${f.style}：${f.issues.join(" / ")}`),
    );
  }
  return parts.join("\n");
}

// これまでの投稿（本文は長いので先頭だけ）
export function historySection(history: HistoryEntry[] | undefined, title: string): string[] {
  if (!history || history.length === 0) return [];
  return [
    "",
    title,
    ...history.map((h) => `- ${h.label}：${h.text.replace(/\s+/g, " ").slice(0, 160)}`),
  ];
}

export function mediaUserPrompt(request: MediaPromptRequest): string {
  return [
    brandSection(request.brand),
    `# 作りたい${request.type === "VIDEO" ? "動画" : "画像"}`,
    `- イメージ：${request.idea.trim()}`,
    `- 縦横比：${request.aspectRatio}`,
  ].join("\n");
}

export function planUserPrompt(request: PlanRequest): string {
  const history =
    request.history.length > 0
      ? request.history.map((h) => `- ${h.date}｜${h.pillar ?? "（柱なし）"}｜${h.title}（${h.topic || "テーマなし"}）｜${h.status}`).join("\n")
      : "（まだ投稿はありません）";
  const parts = [
    brandSection(request.brand),
    "# 最近の投稿（新しい順）",
    history,
    ...historySection(request.pastPosts, "# これまでの投稿の本文（SNS にある過去の投稿を含む。同じテーマを繰り返さず、流れの続きになるテーマを選んでください）"),
    "# 今回の投稿枠（日時は変更しない）",
    ...request.slots.map((s) => `- slotIndex ${s.index}：${s.label}`),
    "",
    `すべての投稿枠（${request.slots.length}件）に、1件ずつ計画を割り当ててください。`,
    request.brand.contentPillars.length > 0
      ? `pillar は次のいずれかにしてください：${request.brand.contentPillars.join("、")}`
      : "pillar は、ブランドに合う投稿テーマの柱を短い言葉で付けてください。",
  ];
  if (request.insights) {
    const i = request.insights;
    parts.push(
      "",
      `# 最近の分析（${i.analyzedAt}・参考情報。投稿日時は変更しない）`,
      `- 要約：${i.summary}`,
      ...(i.goodThemes.length ? [`- 反応が良かったテーマ：${i.goodThemes.join("、")}`] : []),
      ...(i.timeTrends.length ? [`- 時間帯の傾向：${i.timeTrends.join(" / ")}`] : []),
      ...(i.nextIdeas.length ? [`- 次回の投稿案：${i.nextIdeas.map((n) => `${n.topic}（${n.pillar}）`).join("、")}`] : []),
      "反応が良かったテーマや次回の投稿案を優先して使ってください。ただし pillar の偏りのルールは守ってください。",
    );
  }
  if (request.feedback?.length) parts.push("", "# 前回の計画で見つかった問題（必ず直してください）", ...request.feedback.map((f) => `- ${f}`));
  return parts.join("\n");
}

const num = (v: number | null) => (v === null ? "-" : String(v));
const groupTable = (title: string, groups: AnalysisGroupInput[]) => [
  `# ${title}（平均）`,
  ...(groups.length
    ? groups.map((g) => `- ${g.key}：${g.posts}件｜表示 ${num(g.avgViews)}｜反応 ${num(g.avgReactions)}｜反応率 ${num(g.avgEngagementRate)}%`)
    : ["（データなし）"]),
];

// 分析の依頼。数値は SNS から取得した実績で、「-」は SNS から取得できない項目
export function analysisUserPrompt(request: AnalysisRequest): string {
  const parts = [
    brandSection(request.brand),
    "# 投稿ごとの実績（新しい順。「-」は取得できない項目）",
    ...request.posts.map(
      (p) =>
        `- ${p.ref}｜${p.date}（${p.timeBand}）｜${p.platform}｜柱：${p.pillar ?? "なし"}｜${p.title}｜` +
        `表示 ${num(p.views)}・いいね ${num(p.likes)}・コメント ${num(p.comments)}・シェア ${num(p.shares)}・保存 ${num(p.saves)}｜` +
        `反応 ${num(p.reactions)}・反応率 ${num(p.engagementRate)}%\n  本文：${p.excerpt}`,
    ),
    "",
    ...groupTable("投稿テーマの柱ごと", request.byPillar),
    "",
    ...groupTable("時間帯ごと", request.byTimeBand),
    "",
    ...groupTable("曜日ごと", request.byWeekday),
    "",
    "evidence には、上の一覧にある ref（P1 など）だけを使ってください。",
  ];
  if (request.feedback?.length) parts.push("", "# 前回の分析で見つかった問題（必ず直してください）", ...request.feedback.map((f) => `- ${f}`));
  return parts.join("\n");
}
