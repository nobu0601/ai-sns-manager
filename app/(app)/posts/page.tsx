import Link from "next/link";
import type { PostStatus } from "@prisma/client";
import { Badge } from "@/components/common/Badge";
import { btn } from "@/components/common/buttons";
import { PageHeader } from "@/components/common/Card";
import { requirePageUserId } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/datetime";
import { PLATFORM_LABELS } from "@/lib/errors/user-messages";
import { APPROVAL_STATUS_LABELS, PLATFORM_STATUS_LABELS, POST_STATUS_LABELS, STATUS_TONES } from "@/lib/labels";
import { listPosts } from "@/lib/posts/post-service";

export const dynamic = "force-dynamic";

const FILTERS: { value?: PostStatus; label: string }[] = [
  { label: "すべて" },
  { value: "DRAFT", label: "下書き" },
  { value: "READY", label: "準備完了" },
  { value: "SCHEDULED", label: "予約済み" },
  { value: "PUBLISHED", label: "投稿済み" },
  { value: "FAILED", label: "失敗" },
];

export default async function PostsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const userId = await requirePageUserId();
  const { status } = await searchParams;
  const current = FILTERS.find((f) => f.value === status)?.value;
  const posts = await listPosts(userId, { status: current });

  return (
    <>
      <PageHeader
        title="投稿一覧・履歴"
        description="作成した投稿と、SNSごとの投稿結果を確認できます"
        action={<Link href="/posts/new" className={btn.primary}>＋ 投稿を作る</Link>}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.label}
            href={f.value ? `/posts?status=${f.value}` : "/posts"}
            className={`rounded-full px-3 py-1 text-sm font-medium ${
              current === f.value ? "bg-brand-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {posts.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
          該当する投稿はありません
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">タイトル</th>
                <th className="px-4 py-3 font-medium">状態</th>
                <th className="px-4 py-3 font-medium">SNS別の結果</th>
                <th className="px-4 py-3 font-medium">投稿日時</th>
                <th className="px-4 py-3 font-medium">承認</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {posts.map((post) => (
                <tr key={post.id} className="hover:bg-slate-50">
                  <td className="max-w-xs px-4 py-3">
                    <Link href={`/posts/${post.id}`} className="block truncate font-medium text-slate-900 hover:text-brand-600">
                      {post.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3"><Badge tone={STATUS_TONES[post.status]}>{POST_STATUS_LABELS[post.status]}</Badge></td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {post.platforms.map((p) => (
                        <Badge key={p.id} tone={STATUS_TONES[p.status]}>
                          {PLATFORM_LABELS[p.platform]}：{PLATFORM_STATUS_LABELS[p.status]}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(post.scheduledAt)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{APPROVAL_STATUS_LABELS[post.approvalStatus]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
