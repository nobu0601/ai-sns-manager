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
  const [stats, recent] = await Promise.all([getDashboardStats(userId), listPosts(userId)]);

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
