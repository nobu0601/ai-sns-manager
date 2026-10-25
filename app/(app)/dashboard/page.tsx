import Link from "next/link";
import { Badge } from "@/components/common/Badge";
import { btn } from "@/components/common/buttons";
import { Card, PageHeader } from "@/components/common/Card";
import { requirePageUserId } from "@/lib/auth/session";
import { getDashboardStats } from "@/lib/dashboard/dashboard-service";
import { formatDateTime } from "@/lib/datetime";
import { PLATFORM_LABELS } from "@/lib/errors/user-messages";
import { POST_STATUS_LABELS, STATUS_TONES } from "@/lib/labels";
import { listPosts } from "@/lib/posts/post-service";
import { listAgentRuns } from "@/lib/agent/agent-service";
import { PLATFORMS } from "@/lib/social/registry";

export const dynamic = "force-dynamic";

function Stat({ label, value, href }: { label: string; value: string; href?: string }) {
  const body = (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-600">{label}</p>
      <p className="mt-2 text-3xl font-bold text-slate-900">{value}</p>
    </div>
  );
  return href ? <Link href={href} className="block hover:opacity-90">{body}</Link> : body;
}

export default async function DashboardPage() {
  const userId = await requirePageUserId();
  const [stats, recent, runs] = await Promise.all([getDashboardStats(userId), listPosts(userId), listAgentRuns(userId, undefined, 1)]);
  const latestRun = runs[0];
  const waitingApproval = latestRun?.posts.filter((p) => p.approvalStatus === "PENDING" && (p.status === "READY" || p.status === "DRAFT")) ?? [];

  return (
    <>
      <PageHeader
        title="ダッシュボード"
        description="投稿の状況をひと目で確認できます"
        action={<Link href="/posts/new" className={btn.primary}>＋ 投稿を作る</Link>}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="今日の投稿" value={`${stats.todayCount}件`} href="/calendar" />
        <Stat label="予約投稿" value={`${stats.scheduledCount}件`} href="/posts?status=SCHEDULED" />
        <Stat label="今月の投稿" value={`${stats.monthPublished}件`} href="/posts?status=PUBLISHED" />
        <Stat label="投稿成功率（今月）" value={stats.successRate === null ? "-" : `${stats.successRate}%`} />
      </div>

      <Card
        title="AIエージェント"
        className="mt-6"
        action={<Link href="/agent" className="text-sm font-semibold text-brand-600">開く</Link>}
      >
        {!latestRun ? (
          <p className="text-sm text-slate-600">
            AIが今後7日間の投稿テーマ・投稿文・画像・日時をまとめて計画します。
            <Link href="/agent" className="ml-1 font-semibold text-brand-600">AIエージェントを使ってみる</Link>
          </p>
        ) : (
          <div className="space-y-2 text-sm">
            <p className="text-slate-600">
              最新の計画（{latestRun.brand.name}・{formatDateTime(latestRun.createdAt)}）：
              {latestRun.status === "COMPLETED" ? `${latestRun.posts.length}件の投稿` : latestRun.status === "FAILED" ? "失敗" : "作成中"}
            </p>
            {waitingApproval.length > 0 && (
              <p className="font-semibold text-amber-800">
                承認待ちの投稿が {waitingApproval.length} 件あります。
                <Link href={`/agent?brandId=${latestRun.brandId}`} className="ml-1 underline">確認して承認する</Link>
              </p>
            )}
            <ul className="space-y-1">
              {latestRun.posts.slice(0, 3).map((p) => (
                <li key={p.id} className="truncate text-slate-700">
                  <span className="mr-2 text-xs text-slate-500">{formatDateTime(p.scheduledAt)}</span>
                  <Link href={`/posts/${p.id}`} className="hover:text-brand-600">{p.title}</Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="接続SNS" action={<Link href="/accounts" className="text-sm font-semibold text-brand-600">管理する</Link>}>
          <ul className="space-y-3">
            {PLATFORMS.map((p) => {
              const list = stats.accounts.filter((a) => a.platform === p);
              const connected = list.filter((a) => a.status === "CONNECTED").length;
              const needsAttention = list.length - connected;
              return (
                <li key={p} className="flex items-center justify-between gap-3">
                  <span className="font-medium">{PLATFORM_LABELS[p]}</span>
                  <span className={`text-right text-sm ${needsAttention ? "text-rose-700" : connected ? "text-emerald-700" : "text-slate-500"}`}>
                    {list.length === 0
                      ? "○ 未接続"
                      : `● ${connected}アカウント接続済み${needsAttention ? `（${needsAttention}件 要確認）` : ""}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card
          title="最近の投稿"
          className="lg:col-span-2"
          action={<Link href="/posts" className="text-sm font-semibold text-brand-600">すべて見る</Link>}
        >
          {recent.length === 0 ? (
            <p className="text-sm text-slate-600">
              まだ投稿がありません。<Link href="/posts/new" className="font-semibold text-brand-600">最初の投稿を作りましょう</Link>
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {recent.slice(0, 6).map((post) => (
                <li key={post.id} className="flex items-center justify-between gap-3 py-2.5">
                  <Link href={`/posts/${post.id}`} className="min-w-0 truncate font-medium text-slate-800 hover:text-brand-600">
                    {post.title}
                  </Link>
                  <div className="flex shrink-0 items-center gap-2 text-xs text-slate-500">
                    {post.scheduledAt && <span>{formatDateTime(post.scheduledAt)}</span>}
                    <Badge tone={STATUS_TONES[post.status]}>{POST_STATUS_LABELS[post.status]}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {stats.draftCount > 0 && (
            <p className="mt-3 text-xs text-slate-500">下書き・未予約の投稿が {stats.draftCount} 件あります</p>
          )}
        </Card>
      </div>
    </>
  );
}
