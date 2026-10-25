import type { AgentRunTrigger, Prisma } from "@prisma/client";
import { prisma } from "@/lib/database/prisma";
import { slotLabel } from "@/lib/agent/slots";
import { AIError } from "@/lib/ai/errors";
import { getAIProvider } from "@/lib/ai/registry";
import type { AnalysisOutput, AnalysisPostInput, PlanInsights } from "@/lib/ai/types";
import { formatDateTime } from "@/lib/datetime";
import { ServiceError, notFound } from "@/lib/errors/service-error";
import { PLATFORM_LABELS } from "@/lib/errors/user-messages";
import { logger } from "@/lib/logging/logger";
import { getJobDispatcher } from "@/lib/queue/jobs";
import { byPillar as groupByPillar, byTimeBand as groupByTimeBand, byWeekday as groupByWeekday, engagementRateOf, reactionsOf, timeBandOf } from "./aggregate";
import { getAnalytics } from "./analytics-service";
import { collectMetrics } from "./metrics-service";

// AI に渡す投稿数（新しい順）と、分析に必要な最低件数
export const ANALYSIS_MAX_POSTS = 30;
export const ANALYSIS_MIN_POSTS = 3;
// 何日前までの投稿を対象にするか
export const ANALYSIS_LOOKBACK_DAYS = 90;
// AI Agent が参考にする分析の新しさ
export const INSIGHTS_MAX_AGE_DAYS = 14;
const ANALYSIS_ATTEMPTS = 2;

export type EvidencePost = AnalysisPostInput & {
  postId: string;
  accountName: string;
  externalUrl: string | null;
};

export interface AnalysisEvidence {
  posts: EvidencePost[];
  byPillar: Awaited<ReturnType<typeof getAnalytics>>["byPillar"];
  byTimeBand: Awaited<ReturnType<typeof getAnalytics>>["byTimeBand"];
  byWeekday: Awaited<ReturnType<typeof getAnalytics>>["byWeekday"];
}

async function assertBrand(userId: string, brandId: string) {
  const brand = await prisma.brand.findFirst({ where: { id: brandId, userId } });
  if (!brand) throw notFound("ブランド");
  return brand;
}

// AI の結果を確認する：根拠（ref）が一覧に無いものは外し、根拠の無い結論は残さない。
// 作り直しが必要な問題があれば feedback に入れる
export function checkAnalysis(output: AnalysisOutput, refs: string[], pillars: string[]): { result: AnalysisOutput; feedback: string[] } {
  const known = new Set(refs);
  const keep = (evidence: string[]) => [...new Set(evidence.map((e) => e.trim()).filter((e) => known.has(e)))];
  const result: AnalysisOutput = {
    summary: output.summary.trim(),
    goodThemes: output.goodThemes.map((t) => ({ ...t, evidence: keep(t.evidence) })).filter((t) => t.evidence.length > 0).slice(0, 3),
    textTrends: output.textTrends.map((t) => ({ ...t, evidence: keep(t.evidence) })).filter((t) => t.evidence.length > 0).slice(0, 3),
    timeTrends: output.timeTrends.map((t) => ({ ...t, evidence: keep(t.evidence) })).filter((t) => t.evidence.length > 0).slice(0, 3),
    nextIdeas: output.nextIdeas.filter((i) => i.topic.trim()).slice(0, 3),
  };
  const feedback: string[] = [];
  if (!result.summary) feedback.push("summary が空です");
  if (result.nextIdeas.length === 0) feedback.push("nextIdeas（次回の投稿案）を3件作ってください");
  if (result.goodThemes.length + result.textTrends.length + result.timeTrends.length === 0) {
    feedback.push("根拠（一覧にある ref）を付けた分析がありません。evidence に P1 などの ref を入れてください");
  }
  if (pillars.length > 0) {
    const bad = result.nextIdeas.filter((i) => !pillars.includes(i.pillar)).map((i) => i.pillar);
    if (bad.length > 0) feedback.push(`nextIdeas の pillar は次のいずれかにしてください：${pillars.join("、")}（不正：${bad.join("、")}）`);
  }
  return { result, feedback };
}

// 分析を受け付けてキューに入れる（実際の処理は Worker）
export async function startAnalysis(userId: string, brandId: string) {
  await assertBrand(userId, brandId);
  const running = await prisma.analysisReport.findFirst({ where: { brandId, status: { in: ["QUEUED", "RUNNING"] } } });
  if (running) throw new ServiceError(409, "このブランドを分析中です。終わるまでお待ちください。", "ANALYSIS_RUNNING");
  const report = await prisma.analysisReport.create({ data: { userId, brandId, trigger: "MANUAL" } });
  try {
    await getJobDispatcher().enqueueAnalysis(report.id);
  } catch (err) {
    await prisma.analysisReport.update({
      where: { id: report.id },
      data: { status: "FAILED", errorMessage: "処理を開始できませんでした", finishedAt: new Date() },
    });
    logger.error("analysis.enqueue_failed", { reportId: report.id, error: err instanceof Error ? err.message : String(err) });
    throw new ServiceError(503, "分析を開始できませんでした。時間をおいてもう一度お試しください。", "QUEUE_UNAVAILABLE");
  }
  return report;
}

// 分析の本体：数値の取得 → 実績データの準備 → AI の分析 → 根拠の確認 → 保存
export async function executeAnalysis(reportId: string, now: Date = new Date()): Promise<void> {
  const report = await prisma.analysisReport.findUnique({ where: { id: reportId } });
  if (!report || report.status === "COMPLETED" || report.status === "FAILED") return;
  await prisma.analysisReport.update({ where: { id: report.id }, data: { status: "RUNNING" } });

  const fail = async (message: string, detail?: unknown) => {
    logger.warn("analysis.failed", { reportId, message, detail: detail instanceof Error ? detail.message : detail });
    await prisma.analysisReport.update({ where: { id: report.id }, data: { status: "FAILED", errorMessage: message, finishedAt: new Date() } });
  };

  try {
    const brand = await prisma.brand.findUniqueOrThrow({ where: { id: report.brandId } });
    // 最新の数値にしてから分析する（取得できないアカウントがあっても分析は続ける）
    await collectMetrics({ userId: report.userId, now });

    const data = await getAnalytics(report.userId, { brandId: brand.id, days: ANALYSIS_LOOKBACK_DAYS, now });
    const rows = data.rows.filter((r) => r.metrics).slice(0, ANALYSIS_MAX_POSTS);
    if (rows.length < ANALYSIS_MIN_POSTS) {
      return fail(
        `分析には、数値を取得できた投稿が${ANALYSIS_MIN_POSTS}件以上必要です（現在${rows.length}件）。投稿してから数時間〜1日おいて、もう一度お試しください。`,
      );
    }

    const posts: EvidencePost[] = rows.map((r, i) => ({
      ref: `P${i + 1}`,
      postId: r.postId,
      date: slotLabel(r.publishedAt),
      timeBand: timeBandOf(r.publishedAt),
      platform: PLATFORM_LABELS[r.platform],
      accountName: r.accountName,
      pillar: r.pillar,
      title: r.title,
      excerpt: r.content.replace(/\s+/g, " ").slice(0, 140),
      views: r.metrics!.views,
      likes: r.metrics!.likes,
      comments: r.metrics!.comments,
      shares: r.metrics!.shares,
      saves: r.metrics!.saves,
      reactions: reactionsOf(r.metrics),
      engagementRate: engagementRateOf(r.metrics),
      externalUrl: r.externalUrl,
    }));
    // 集計も AI に渡す投稿だけで計算し直す
    const byPillar = groupByPillar(rows);
    const byTimeBand = groupByTimeBand(rows);
    const byWeekday = groupByWeekday(rows);
    const evidence: AnalysisEvidence = { posts, byPillar, byTimeBand, byWeekday };

    const ai = getAIProvider();
    let feedback: string[] = [];
    let checked: AnalysisOutput | null = null;
    let model = "";
    for (let attempt = 0; attempt < ANALYSIS_ATTEMPTS; attempt++) {
      const output = await ai.analyze({ brand, posts, byPillar, byTimeBand, byWeekday, feedback });
      const r = checkAnalysis(output, posts.map((p) => p.ref), brand.contentPillars);
      checked = r.result;
      feedback = r.feedback;
      model = output.model;
      if (feedback.length === 0) break;
    }
    if (!checked || feedback.length > 0) return fail(`分析をうまく作れませんでした：${feedback.join(" / ")}`);

    await prisma.analysisReport.update({
      where: { id: report.id },
      data: {
        status: "COMPLETED",
        periodStart: rows[rows.length - 1].publishedAt,
        periodEnd: rows[0].publishedAt,
        postCount: rows.length,
        result: checked as unknown as Prisma.InputJsonValue,
        evidence: evidence as unknown as Prisma.InputJsonValue,
        model,
        finishedAt: new Date(),
      },
    });
    logger.info("analysis.completed", { reportId, posts: rows.length });
  } catch (err) {
    await fail(err instanceof AIError ? err.message : "分析に失敗しました。時間をおいてもう一度お試しください。", err);
  }
}

// AI Agent の毎週の自動実行の直前に、その場で分析する（失敗しても計画は続ける）
export async function runAnalysisNow(userId: string, brandId: string, trigger: AgentRunTrigger, now: Date = new Date()) {
  const running = await prisma.analysisReport.findFirst({ where: { brandId, status: { in: ["QUEUED", "RUNNING"] } } });
  if (running) return null;
  const report = await prisma.analysisReport.create({ data: { userId, brandId, trigger } });
  await executeAnalysis(report.id, now);
  return prisma.analysisReport.findUnique({ where: { id: report.id } });
}

export async function listAnalysisReports(userId: string, brandId: string, take = 5) {
  return prisma.analysisReport.findMany({ where: { userId, brandId }, orderBy: { createdAt: "desc" }, take });
}

export async function getAnalysisReport(userId: string, reportId: string) {
  const report = await prisma.analysisReport.findFirst({ where: { id: reportId, userId } });
  if (!report) throw notFound("分析結果");
  return report;
}

export async function latestCompletedReport(userId: string, brandId?: string, { maxAgeDays, now = new Date() }: { maxAgeDays?: number; now?: Date } = {}) {
  return prisma.analysisReport.findFirst({
    where: {
      userId,
      ...(brandId ? { brandId } : {}),
      status: "COMPLETED",
      ...(maxAgeDays ? { finishedAt: { gte: new Date(now.getTime() - maxAgeDays * 86_400_000) } } : {}),
    },
    include: { brand: { select: { id: true, name: true } } },
    orderBy: { finishedAt: "desc" },
  });
}

// AI Agent の計画に渡す要点
export async function insightsForPlan(userId: string, brandId: string, now: Date = new Date()): Promise<PlanInsights | null> {
  const report = await latestCompletedReport(userId, brandId, { maxAgeDays: INSIGHTS_MAX_AGE_DAYS, now });
  const result = report?.result as AnalysisOutput | null | undefined;
  if (!report || !result) return null;
  return {
    analyzedAt: formatDateTime(report.finishedAt),
    summary: result.summary,
    goodThemes: result.goodThemes.map((t) => t.theme),
    timeTrends: result.timeTrends.map((t) => t.finding),
    nextIdeas: result.nextIdeas.map((i) => ({ topic: i.topic, pillar: i.pillar })),
  };
}
