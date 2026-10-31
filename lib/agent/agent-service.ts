import type { AgentConfig, AgentRunTrigger, Platform } from "@prisma/client";
import { prisma } from "@/lib/database/prisma";
import { generateDrafts } from "@/lib/ai/ai-service";
import { loadPostHistory } from "@/lib/ai/history";
import { PLATFORM_LABELS } from "@/lib/errors/user-messages";
import { AIError } from "@/lib/ai/errors";
import { draftTexts } from "@/lib/ai/quality";
import { getAIProvider } from "@/lib/ai/registry";
import type { PlanItem } from "@/lib/ai/types";
import { formatDateTime } from "@/lib/datetime";
import { ServiceError, notFound } from "@/lib/errors/service-error";
import { logger } from "@/lib/logging/logger";
import { requestMedia } from "@/lib/media/media-service";
import { createPost, schedulePost } from "@/lib/posts/post-service";
import { getJobDispatcher } from "@/lib/queue/jobs";
import { listPostableAccounts } from "@/lib/social/account-service";
import { PLATFORM_CAPABILITIES } from "@/lib/social/capabilities";
import { insightsForPlan, runAnalysisNow } from "@/lib/analytics/analysis-service";
import { checkPlan } from "./plan-check";
import { computeSlots, slotLabel } from "./slots";

export type AgentConfigInput = {
  weeklyEnabled: boolean;
  runWeekday: number;
  runTime: string;
  postsPerWeek: number;
  preferredWeekdays: number[];
  preferredTime: string;
  targetAccountIds: string[];
  generateImages: boolean;
};

// AI エージェントの投稿先にできる SNS（画像か文章で投稿できるもの。動画が必須の TikTok は除く）
export function agentSupports(platform: Platform): boolean {
  const caps = PLATFORM_CAPABILITIES[platform];
  return caps.textPost || caps.imagePost;
}

async function assertBrand(userId: string, brandId: string) {
  const brand = await prisma.brand.findFirst({ where: { id: brandId, userId } });
  if (!brand) throw notFound("ブランド");
  return brand;
}

export async function getAgentConfig(userId: string, brandId: string): Promise<AgentConfig | null> {
  await assertBrand(userId, brandId);
  return prisma.agentConfig.findUnique({ where: { brandId } });
}

export async function saveAgentConfig(userId: string, brandId: string, input: AgentConfigInput): Promise<AgentConfig> {
  await assertBrand(userId, brandId);
  const owned = await prisma.socialAccount.findMany({ where: { userId, id: { in: input.targetAccountIds } }, select: { id: true, platform: true } });
  if (owned.length !== input.targetAccountIds.length) throw notFound("投稿先のSNSアカウント");
  if (owned.some((a) => !agentSupports(a.platform))) {
    throw new ServiceError(400, "TikTok は AI エージェントの投稿先に選べません（動画が必須のため）。投稿作成画面から動画を付けて投稿してください。", "AGENT_UNSUPPORTED_PLATFORM");
  }

  const config = await prisma.agentConfig.upsert({
    where: { brandId },
    create: { userId, brandId, ...input },
    update: input,
  });
  const dispatcher = getJobDispatcher();
  try {
    if (config.weeklyEnabled) await dispatcher.upsertWeeklyAgent(config.id, config.runWeekday, config.runTime);
    else await dispatcher.removeWeeklyAgent(config.id);
  } catch (err) {
    logger.error("agent.schedule_failed", { configId: config.id, error: err instanceof Error ? err.message : String(err) });
    throw new ServiceError(503, "設定は保存しましたが、毎週の自動実行を登録できませんでした。時間をおいてもう一度保存してください。", "QUEUE_UNAVAILABLE");
  }
  return config;
}

// 実行を受け付けてキューに入れる（実際の処理は Worker）
export async function startAgentRun(userId: string, brandId: string, trigger: AgentRunTrigger = "MANUAL") {
  await assertBrand(userId, brandId);
  const config = await prisma.agentConfig.findUnique({ where: { brandId } });
  if (!config || config.targetAccountIds.length === 0) {
    throw new ServiceError(400, "先に AI エージェントの設定で、投稿先のアカウントを選んで保存してください。", "AGENT_NOT_CONFIGURED");
  }
  const running = await prisma.agentRun.findFirst({ where: { brandId, status: { in: ["QUEUED", "RUNNING"] } } });
  if (running) throw new ServiceError(409, "このブランドの計画を作成中です。終わるまでお待ちください。", "AGENT_RUNNING");

  const run = await prisma.agentRun.create({ data: { userId, brandId, trigger } });
  try {
    await getJobDispatcher().enqueueAgentRun(run.id);
  } catch (err) {
    await prisma.agentRun.update({
      where: { id: run.id },
      data: { status: "FAILED", errorMessage: "処理を開始できませんでした", finishedAt: new Date() },
    });
    logger.error("agent.enqueue_failed", { runId: run.id, error: err instanceof Error ? err.message : String(err) });
    throw new ServiceError(503, "処理を開始できませんでした。時間をおいてもう一度お試しください。", "QUEUE_UNAVAILABLE");
  }
  return run;
}

// 毎週の自動実行から呼ばれる
export async function startWeeklyRun(configId: string): Promise<string | null> {
  const config = await prisma.agentConfig.findUnique({ where: { id: configId } });
  if (!config || !config.weeklyEnabled) return null;
  // 手動の実行と重ならないようにする
  const running = await prisma.agentRun.findFirst({ where: { brandId: config.brandId, status: { in: ["QUEUED", "RUNNING"] } } });
  if (running) {
    logger.info("agent.weekly_skipped", { configId, runningRunId: running.id });
    return null;
  }
  const run = await prisma.agentRun.create({ data: { userId: config.userId, brandId: config.brandId, trigger: "SCHEDULED" } });
  return run.id;
}

const PLAN_ATTEMPTS = 2;

// Agent の本体：履歴の確認 → 投稿枠の決定 → 分析の反映 → テーマの計画 → 投稿文の生成 → 画像の生成 → 投稿の作成 → 承認待ち（または予約）
export async function executeAgentRun(runId: string, now: Date = new Date()): Promise<void> {
  const run = await prisma.agentRun.findUnique({ where: { id: runId } });
  if (!run || run.status === "COMPLETED" || run.status === "FAILED") return;
  await prisma.agentRun.update({ where: { id: run.id }, data: { status: "RUNNING" } });

  const fail = async (message: string, detail?: unknown) => {
    logger.warn("agent.run_failed", { runId, message, detail: detail instanceof Error ? detail.message : detail });
    await prisma.agentRun.update({ where: { id: run.id }, data: { status: "FAILED", errorMessage: message, finishedAt: new Date() } });
  };

  try {
    const [brand, config, user] = await Promise.all([
      prisma.brand.findUniqueOrThrow({ where: { id: run.brandId } }),
      prisma.agentConfig.findUnique({ where: { brandId: run.brandId } }),
      prisma.user.findUniqueOrThrow({ where: { id: run.userId }, select: { approvalMode: true } }),
    ]);
    if (!config) return fail("AI エージェントの設定がありません");
    const postable = await listPostableAccounts(run.userId);
    const targets = postable.filter((a) => config.targetAccountIds.includes(a.id) && agentSupports(a.platform));
    if (targets.length === 0) return fail("投稿先のアカウントが接続されていません。SNSアカウント画面で確認してください。");

    // 1. 投稿履歴（最近30件）
    const recent = await prisma.post.findMany({
      where: { userId: run.userId, brandId: brand.id },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { title: true, topic: true, contentPillar: true, status: true, scheduledAt: true, createdAt: true },
    });
    const history = recent.map((p) => ({
      date: formatDateTime(p.scheduledAt ?? p.createdAt),
      title: p.title,
      topic: p.topic,
      pillar: p.contentPillar,
      status: p.status,
    }));

    // 2. 投稿枠（日時はユーザー設定から決める。既に予定がある日は避ける）
    const busy = await prisma.post.findMany({
      where: { userId: run.userId, brandId: brand.id, scheduledAt: { gte: now }, status: { notIn: ["CANCELLED", "FAILED"] } },
      select: { scheduledAt: true },
    });
    const slots = computeSlots({
      now,
      postsPerWeek: config.postsPerWeek,
      preferredWeekdays: config.preferredWeekdays,
      preferredTime: config.preferredTime,
      busyDates: busy.map((b) => b.scheduledAt!).filter(Boolean),
    });
    if (slots.length === 0) return fail("今後7日間に空いている投稿枠がありません（すでに投稿予定がある日は避けています）");

    // 3. 分析の反映：毎週の自動実行では、計画の直前に分析する。最新の分析（14日以内）をテーマ選びの参考にする
    if (run.trigger === "SCHEDULED") {
      try {
        await runAnalysisNow(run.userId, brand.id, "SCHEDULED", now);
      } catch (err) {
        logger.warn("agent.analysis_failed", { runId, error: err instanceof Error ? err.message : String(err) });
      }
    }
    const insights = await insightsForPlan(run.userId, brand.id, now);
    // これまでの投稿の本文（SNS から読み込んだ過去の投稿を含む）。テーマを重ねないために渡す
    const pastPosts = (await loadPostHistory(run.userId, brand.id)).map((h) => ({
      label: `${slotLabel(h.date)} ${PLATFORM_LABELS[h.platform]}`,
      text: h.text,
    }));

    // 4. テーマの計画（ルール違反があれば指摘して作り直させる）
    const ai = getAIProvider();
    let items: PlanItem[] = [];
    let feedback: string[] = [];
    for (let attempt = 0; attempt < PLAN_ATTEMPTS; attempt++) {
      const plan = await ai.planWeek({
        brand,
        slots: slots.map((d, i) => ({ index: i, label: slotLabel(d) })),
        history,
        pastPosts,
        insights,
        feedback,
      });
      feedback = checkPlan(plan.items, slots.length, brand.contentPillars);
      items = plan.items;
      if (feedback.length === 0) break;
    }
    if (feedback.length > 0) return fail(`計画をうまく作れませんでした：${feedback.join(" / ")}`);
    items = [...items].sort((a, b) => a.slotIndex - b.slotIndex);
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        periodStart: slots[0],
        periodEnd: slots[slots.length - 1],
        plan: items.map((i) => ({ ...i, scheduledAt: slots[i.slotIndex].toISOString() })),
      },
    });

    // 5〜7. 投稿文の生成 → 投稿の作成 → 画像の生成
    const needsImage = config.generateImages || targets.some((t) => PLATFORM_CAPABILITIES[t.platform].requiresMedia);
    const created: string[] = [];
    const problems: string[] = [];
    for (const item of items) {
      const at = slots[item.slotIndex];
      try {
        const result = await generateDrafts(run.userId, { topic: item.topic, objective: brand.objective, brandId: brand.id, styles: [item.style] });
        const draft = result.drafts[0];
        const texts = draftTexts(draft);
        const post = await createPost(run.userId, {
          title: draft.title || item.topic,
          topic: item.topic,
          brandId: brand.id,
          aiGenerated: { model: result.model, style: item.style },
          targets: targets.map((t) => ({ socialAccountId: t.id, content: texts[t.platform as Platform], mediaUrls: [] })),
        });
        await prisma.post.update({
          where: { id: post.id },
          data: { scheduledAt: at, agentRunId: run.id, contentPillar: item.pillar },
        });
        created.push(post.id);
        if (draft.errors.length > 0) problems.push(`${slotLabel(at)}：${draft.errors.join(" / ")}`);

        if (needsImage && item.imageIdea.trim()) {
          const aspectRatio = targets.some((t) => t.platform === "INSTAGRAM") ? "4:5" : "1:1";
          await requestMedia(run.userId, { type: "IMAGE", idea: item.imageIdea, aspectRatio, brandId: brand.id, postId: post.id });
        } else if (user.approvalMode === "AUTO") {
          // 完全自動モード：承認なしで予約する（画像を作る場合は、画像ができた時点で予約する）
          await schedulePost(run.userId, post.id, { scheduledAt: at });
        }
      } catch (err) {
        const message = err instanceof ServiceError || err instanceof AIError ? err.message : "投稿の作成に失敗しました";
        problems.push(`${slotLabel(at)}：${message}`);
        logger.warn("agent.item_failed", { runId, slot: item.slotIndex, error: err instanceof Error ? err.message : String(err) });
      }
    }

    if (created.length === 0) return fail(`投稿を作れませんでした：${problems.join(" / ")}`);
    const mode = user.approvalMode === "AUTO" ? "完全自動モードのため、承認なしで予約します" : "内容を確認して承認すると予約されます";
    const summary = [
      `${slotLabel(slots[0])}〜${slotLabel(slots[slots.length - 1])}の投稿を${created.length}件作りました。${mode}。`,
      ...(insights ? [`${insights.analyzedAt}の分析（反応が良かったテーマ・次回の投稿案）を参考にしました。`] : []),
      ...(needsImage ? ["画像もAIで作成し、できあがった投稿から自動で添付します。"] : []),
      ...(problems.length > 0 ? [`確認が必要な点：${problems.join(" / ")}`] : []),
    ].join("\n");
    await prisma.agentRun.update({ where: { id: run.id }, data: { status: "COMPLETED", summary, finishedAt: new Date() } });
    logger.info("agent.run_completed", { runId, posts: created.length, problems: problems.length });
  } catch (err) {
    await fail(err instanceof AIError ? err.message : "計画の作成に失敗しました。時間をおいてもう一度お試しください。", err);
  }
}

const runInclude = {
  brand: { select: { id: true, name: true } },
  posts: {
    orderBy: { scheduledAt: "asc" as const },
    include: { platforms: { select: { platform: true, accountName: true, status: true, mediaUrls: true, mediaType: true } } },
  },
};

export async function listAgentRuns(userId: string, brandId?: string, take = 10) {
  return prisma.agentRun.findMany({
    where: { userId, ...(brandId ? { brandId } : {}) },
    include: runInclude,
    orderBy: { createdAt: "desc" },
    take,
  });
}

export async function getAgentRun(userId: string, runId: string) {
  const run = await prisma.agentRun.findFirst({ where: { id: runId, userId }, include: runInclude });
  if (!run) throw notFound("実行記録");
  return run;
}

// 計画された投稿をまとめて承認し、計画した日時で予約する
export async function approveAgentRun(userId: string, runId: string) {
  const run = await getAgentRun(userId, runId);
  const results: { postId: string; title: string; ok: boolean; message?: string }[] = [];
  for (const post of run.posts) {
    if (post.status !== "READY" && post.status !== "DRAFT") continue;
    if (!post.scheduledAt || post.scheduledAt <= new Date()) {
      results.push({ postId: post.id, title: post.title, ok: false, message: "計画した日時を過ぎています。投稿の画面で日時を選んで予約してください" });
      continue;
    }
    try {
      await schedulePost(userId, post.id, { scheduledAt: post.scheduledAt, approve: true });
      results.push({ postId: post.id, title: post.title, ok: true });
    } catch (err) {
      const message = err instanceof ServiceError ? [err.message, ...(err.details ?? [])].join(" ") : "予約できませんでした";
      results.push({ postId: post.id, title: post.title, ok: false, message });
    }
  }
  return results;
}

// Worker 起動時に、毎週の自動実行の登録を DB の設定に合わせる
export async function reconcileWeeklySchedules(): Promise<number> {
  const configs = await prisma.agentConfig.findMany();
  const dispatcher = getJobDispatcher();
  for (const c of configs) {
    if (c.weeklyEnabled) await dispatcher.upsertWeeklyAgent(c.id, c.runWeekday, c.runTime);
    else await dispatcher.removeWeeklyAgent(c.id);
  }
  return configs.filter((c) => c.weeklyEnabled).length;
}
