import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert } from "@/components/common/Alert";
import { AutoRefresh } from "@/components/common/AutoRefresh";
import { Badge } from "@/components/common/Badge";
import { Card, PageHeader } from "@/components/common/Card";
import { PostActions } from "@/components/posts/PostActions";
import { requirePageUserId } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/datetime";
import { PLATFORM_LABELS } from "@/lib/errors/user-messages";
import { APPROVAL_STATUS_LABELS, PLATFORM_STATUS_LABELS, POST_STATUS_LABELS, STATUS_TONES } from "@/lib/labels";
import { getPost } from "@/lib/posts/post-service";
import { isEditable } from "@/lib/posts/status";

export const dynamic = "force-dynamic";

const DONE_MESSAGES: Record<string, string> = {
  draft: "下書きを保存しました",
  schedule: "投稿を予約しました",
  publish: "投稿を開始しました。完了までしばらくお待ちください",
};

const LOG_TONES = { INFO: "gray", SUCCESS: "green", WARNING: "amber", ERROR: "red" } as const;

export default async function PostDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const userId = await requirePageUserId();
  const { id } = await params;
  const { done } = await searchParams;
  const post = await getPost(userId, id).catch(() => null);
  if (!post) redirect("/posts");

  const editable = isEditable(post.status) && !post.platforms.some((p) => p.status === "PUBLISHED");
  const inProgress = post.status === "POSTING" || post.platforms.some((p) => p.status === "POSTING" || (p.status === "SCHEDULED" && p.errorMessage));
  const soon = post.status === "SCHEDULED" && post.scheduledAt && post.scheduledAt.getTime() - Date.now() < 60_000;
  const logs = post.platforms
    .flatMap((p) => p.logs.map((l) => ({ ...l, platform: p.platform })))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return (
    <>
      <AutoRefresh
        active={Boolean(inProgress || soon)}
        refreshAt={post.status === "SCHEDULED" ? post.scheduledAt?.toISOString() : null}
      />
      <PageHeader
        title={post.title}
        description={post.topic ? `テーマ：${post.topic}` : undefined}
        action={<Link href="/posts" className="text-sm font-semibold text-brand-600">← 投稿一覧</Link>}
      />
      {done && DONE_MESSAGES[done] && (
        <div className="mb-4"><Alert tone="success" title={DONE_MESSAGES[done]} /></div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="状態">
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-slate-500">投稿状態</dt>
                <dd className="mt-1"><Badge tone={STATUS_TONES[post.status]}>{POST_STATUS_LABELS[post.status]}</Badge></dd>
              </div>
              <div>
                <dt className="text-slate-500">承認</dt>
                <dd className="mt-1">{APPROVAL_STATUS_LABELS[post.approvalStatus]}</dd>
              </div>
              <div>
                <dt className="text-slate-500">投稿日時</dt>
                <dd className="mt-1">{formatDateTime(post.scheduledAt)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">ブランド</dt>
                <dd className="mt-1">{post.brand?.name ?? "-"}</dd>
              </div>
            </dl>
            <div className="mt-5 border-t border-slate-100 pt-5">
              <PostActions
                postId={post.id}
                status={post.status}
                approvalStatus={post.approvalStatus}
                editable={editable}
                hasRetryable={post.platforms.some((p) => p.status === "FAILED")}
              />
            </div>
          </Card>

          {post.platforms.map((p) => (
            <Card
              key={p.id}
              title={PLATFORM_LABELS[p.platform]}
              action={<Badge tone={STATUS_TONES[p.status]}>{PLATFORM_STATUS_LABELS[p.status]}</Badge>}
            >
              <p className="whitespace-pre-wrap break-words text-sm text-slate-800">{p.content || "（内容なし）"}</p>
              {p.errorMessage && (
                <div className="mt-4">
                  <Alert tone={p.status === "FAILED" ? "error" : "warning"} title={p.errorMessage}>
                    {p.status === "FAILED" && p.errorMessage.includes("再接続") && (
                      <Link href="/accounts" className="mt-2 inline-block font-semibold underline">再接続する</Link>
                    )}
                  </Alert>
                </div>
              )}
              {p.status === "PUBLISHED" && (
                <p className="mt-4 text-sm text-emerald-700">
                  {formatDateTime(p.publishedAt)} に投稿しました
                  {p.externalUrl && (
                    <> ・ <a href={p.externalUrl} target="_blank" rel="noreferrer" className="font-semibold underline">投稿を見る</a></>
                  )}
                </p>
              )}
              {p.attempts > 0 && <p className="mt-2 text-xs text-slate-500">投稿試行回数：{p.attempts}回</p>}
            </Card>
          ))}
        </div>

        <Card title="投稿ログ">
          {logs.length === 0 ? (
            <p className="text-sm text-slate-500">ログはまだありません</p>
          ) : (
            <ol className="space-y-3">
              {logs.map((l) => (
                <li key={l.id} className="text-sm">
                  <div className="flex items-center gap-2">
                    <Badge tone={LOG_TONES[l.status]}>{PLATFORM_LABELS[l.platform]}</Badge>
                    <span className="text-xs text-slate-500">{formatDateTime(l.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-slate-700">{l.message}</p>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}
