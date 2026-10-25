import { readFileSync } from "node:fs";
import path from "node:path";
import { DRAFT_STYLE_LABELS, type BrandContext, type GenerateRequest } from "./types";

// プロンプトはコードに直書きせず prompts/ から読み込む（アプリはリポジトリのルートで起動する前提）
const PROMPT_FILES = ["post-generation/system.md", "x/guidelines.md", "instagram/guidelines.md", "threads/guidelines.md"];

let cachedSystem: string | null = null;

export function systemPrompt(): string {
  if (cachedSystem === null) {
    const dir = path.join(process.cwd(), "prompts");
    cachedSystem = PROMPT_FILES.map((f) => readFileSync(path.join(dir, f), "utf8").trim()).join("\n\n");
  }
  return cachedSystem;
}

function brandSection(brand: BrandContext | null): string {
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
