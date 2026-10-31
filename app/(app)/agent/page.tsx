import Link from "next/link";
import { Alert } from "@/components/common/Alert";
import { AutoRefresh } from "@/components/common/AutoRefresh";
import { Badge } from "@/components/common/Badge";
import { Card, PageHeader } from "@/components/common/Card";
import { AgentRunButton, ApproveRunButton } from "@/components/agent/AgentActions";
import { AgentConfigForm, type AgentConfigValue } from "@/components/agent/AgentConfigForm";
import { agentSupports, getAgentConfig, listAgentRuns } from "@/lib/agent/agent-service";
import { aiMode } from "@/lib/ai/registry";
import { DRAFT_STYLE_LABELS, type DraftStyle } from "@/lib/ai/types";
import { requirePageUserId } from "@/lib/auth/session";
import { listBrands } from "@/lib/brands/brand-service";
import { prisma } from "@/lib/database/prisma";
import { formatDateTime } from "@/lib/datetime";
import { PLATFORM_LABELS } from "@/lib/errors/user-messages";
import { APPROVAL_STATUS_LABELS, POST_STATUS_LABELS, STATUS_TONES } from "@/lib/labels";
import { mediaMode } from "@/lib/media/registry";
import { listPostableAccounts } from "@/lib/social/account-service";

export const dynamic = "force-dynamic";

const DEFAULT_CONFIG: AgentConfigValue = {
  weeklyEnabled: false,
  runWeekday: 1,
  runTime: "09:00",
  postsPerWeek: 3,
  preferredWeekdays: [1, 3, 5],
  preferredTime: "12:00",
  targetAccountIds: [],
  generateImages: false,
};

const RUN_STATUS = {
  QUEUED: { label: "待機中", tone: "gray" },
  RUNNING: { label: "作成中", tone: "amber" },
  COMPLETED: { label: "完了", tone: "green" },
  FAILED: { label: "失敗", tone: "red" },
} as const;

type PlanEntry = { slotIndex: number; pillar: string; topic: string; style: DraftStyle; reason: string; scheduledAt: string };

export default async function AgentPage({ searchParams }: { searchParams: Promise<{ brandId?: string }> }) {
  const userId = await requirePageUserId();
  const brands = await listBrands(userId);
  if (brands.length === 0) {
    return (
      <>
        <PageHeader title="AIエージェント" />
        <Alert tone="info" title="先にブランドを登録してください">
          AIエージェントはブランドの説明・トーン・投稿テーマの柱をもとに投稿を計画します。
          <Link href="/settings" className="ml-1 font-semibold underline">設定画面</Link>からブランドを追加してください。
        </Alert>
      </>
    );
  }

  const { brandId: requested } = await searchParams;
  const brand = brands.find((b) => b.id === requested) ?? brands[0];
  const [config, accounts, runs, user] = await Promise.all([
    getAgentConfig(userId, brand.id),
    listPostableAccounts(userId),
    listAgentRuns(userId, brand.id, 5),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { approvalMode: true } }),
  ]);
  const postIds = runs.flatMap((r) => r.posts.map((p) => p.id));
  const pendingMedia = postIds.length
    ? await prisma.media.count({ where: { postId: { in: postIds }, status: { in: ["PENDING", "GENERATING"] } } })
    : 0;
  const busy = runs.some((r) => r.status === "QUEUED" || r.status === "RUNNING");

  return (
    <>
      <AutoRefresh active={busy || pendingMedia > 0} />
      <PageHeader
        title="AIエージェント"
        description="ブランド情報と投稿履歴をもとに、今後7日間の投稿テーマ・投稿文・画像・日時をまとめて計画します"
      />

      {brands.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {brands.map((b) => (
            <Link
              key={b.id}
              href={`/agent?brandId=${b.id}`}
              className={`rounded-full px-3 py-1 text-sm font-medium ${b.id === brand.id ? "bg-brand-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}
            >
              {b.name}
            </Link>
          ))}
        </div>
      )}

      <div className="mb-4 space-y-2">
        {aiMode() === "mock" && <Alert tone="warning" title="AIはMockモードです（ANTHROPIC_API_KEY 未設定）。決まった例文で計画を作ります。" />}
        {mediaMode() === "mock" && <Alert tone="warning" title="画像生成はMockモードです（FAL_KEY 未設定）。仮の画像を添付します。" />}
        {brand.contentPillars.length === 0 && (
          <Alert tone="info" title="ブランドに「投稿テーマの柱」を登録すると、テーマの偏りを防げます（設定画面）" />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card title={`${brand.name} の設定`} className="lg:col-span-2">
          <AgentConfigForm
            brandId={brand.id}
            accounts={accounts.filter((a) => agentSupports(a.platform))}
            initial={
              config
                ? {
                    weeklyEnabled: config.weeklyEnabled,
                    runWeekday: config.runWeekday,
                    runTime: config.runTime,
                    postsPerWeek: config.postsPerWeek,
                    preferredWeekdays: config.preferredWeekdays,
                    preferredTime: config.preferredTime,
                    targetAccountIds: config.targetAccountIds,
                    generateImages: config.generateImages,
                  }
                : DEFAULT_CONFIG
            }
          />
        </Card>

        <div className="space-y-6 lg:col-span-3">
          <Card title="計画を作る">
            <p className="mb-3 text-sm text-slate-600">
              {user.approvalMode === "AUTO"
                ? "投稿モードが「完全自動」のため、作った投稿は承認なしで予約されます。"
                : "作った投稿は「承認待ち」になります。内容を確認して承認すると、計画した日時で予約されます。"}
            </p>
            <AgentRunButton brandId={brand.id} disabled={!config || config.targetAccountIds.length === 0 || busy} />
            {(!config || config.targetAccountIds.length === 0) && (
              <p className="mt-2 text-xs text-slate-500">先に左の設定で投稿先のアカウントを選び、保存してください。</p>
            )}
          </Card>

          {runs.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600">まだ実行していません</p>
          ) : (
            runs.map((run) => {
              const status = RUN_STATUS[run.status];
              const plan = (run.plan as PlanEntry[] | null) ?? [];
              const waiting = run.posts.filter((p) => p.approvalStatus === "PENDING" && (p.status === "READY" || p.status === "DRAFT"));
              return (
                <Card
                  key={run.id}
                  title={`${formatDateTime(run.createdAt)} の実行（${run.trigger === "SCHEDULED" ? "毎週の自動実行" : "手動"}）`}
                  action={<Badge tone={status.tone}>{status.label}</Badge>}
                >
                  {run.status === "RUNNING" || run.status === "QUEUED" ? (
                    <p role="status" className="text-sm text-slate-600">テーマを決めて投稿文を作っています。1〜3分ほどかかります…</p>
                  ) : run.status === "FAILED" ? (
                    <Alert title={run.errorMessage ?? "失敗しました"} />
                  ) : (
                    <div className="space-y-4">
                      {run.summary && <p className="whitespace-pre-wrap text-sm text-slate-700">{run.summary}</p>}
                      {/* 承認後に画面が更新されても結果の表示が消えないよう、常に置いておく */}
                      <ApproveRunButton runId={run.id} count={waiting.length} />
                      <ul className="divide-y divide-slate-100">
                        {run.posts.map((post) => {
                          const entry = plan.find((p) => p.scheduledAt === post.scheduledAt?.toISOString());
                          const thumb = post.platforms.find((p) => p.mediaUrls[0] && p.mediaType !== "VIDEO")?.mediaUrls[0];
                          return (
                            <li key={post.id} className="flex gap-3 py-3">
                              {thumb ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={thumb} alt="" className="h-16 w-16 shrink-0 rounded object-cover" />
                              ) : (
                                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded bg-slate-100 text-[10px] text-slate-400">画像なし</div>
                              )}
                              <div className="min-w-0 flex-1 text-sm">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-xs text-slate-500">{formatDateTime(post.scheduledAt)}</span>
                                  {post.contentPillar && <Badge tone="violet">{post.contentPillar}</Badge>}
                                  {entry && <Badge>{DRAFT_STYLE_LABELS[entry.style]}</Badge>}
                                  <Badge tone={STATUS_TONES[post.status]}>{POST_STATUS_LABELS[post.status]}</Badge>
                                  <span className="text-xs text-slate-500">{APPROVAL_STATUS_LABELS[post.approvalStatus]}</span>
                                </div>
                                <Link href={`/posts/${post.id}`} className="mt-1 block truncate font-medium text-slate-900 hover:text-brand-600">
                                  {post.title}
                                </Link>
                                {entry?.reason && <p className="text-xs text-slate-500">{entry.reason}</p>}
                                <p className="text-xs text-slate-400">
                                  {post.platforms.map((p) => `${PLATFORM_LABELS[p.platform]} ${p.accountName}`).join("・")}
                                </p>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                      {pendingMedia > 0 && <p role="status" className="text-xs text-slate-500">画像を生成中です（{pendingMedia}件）。できあがると自動で添付されます。</p>}
                    </div>
                  )}
                </Card>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
