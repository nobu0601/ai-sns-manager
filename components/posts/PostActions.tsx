"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ApprovalStatus, PostStatus } from "@prisma/client";
import { Alert } from "@/components/common/Alert";
import { btn, input } from "@/components/common/buttons";
import { ApiError, apiFetch } from "@/lib/client/api";

type Props = {
  postId: string;
  status: PostStatus;
  approvalStatus: ApprovalStatus;
  editable: boolean;
  hasRetryable: boolean;
};

function defaultLocal(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PostActions({ postId, status, approvalStatus, editable, hasRetryable }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);
  const [scheduledAt, setScheduledAt] = useState(defaultLocal);

  async function run(key: string, path: string, method = "POST", body: unknown = {}) {
    setPending(key);
    setError(null);
    try {
      await apiFetch(`/api/posts/${postId}${path}`, { method, body: method === "DELETE" ? undefined : body });
      if (method === "DELETE") {
        router.push("/posts");
      }
      router.refresh();
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError("エラーが発生しました", 500);
      setError({ message: e.message, details: e.details });
    } finally {
      setPending(null);
    }
  }

  const needsApproval = approvalStatus === "PENDING" || approvalStatus === "REJECTED";
  const canSchedule = editable && status !== "SCHEDULED";

  return (
    <div className="space-y-4">
      {error && <Alert title={error.message} messages={error.details} />}

      {editable && needsApproval && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <span>{approvalStatus === "REJECTED" ? "この投稿は却下されています。" : "この投稿は承認待ちです。"}</span>
          <button className={btn.primary} disabled={pending !== null} onClick={() => run("approve", "/approve")}>
            承認する
          </button>
          {approvalStatus === "PENDING" && (
            <button className={btn.danger} disabled={pending !== null} onClick={() => run("reject", "/reject")}>
              却下する
            </button>
          )}
        </div>
      )}

      {canSchedule && (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="scheduledAt" className="mb-1 block text-xs font-medium text-slate-600">投稿日時</label>
            <input id="scheduledAt" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className={input} />
          </div>
          <button
            className={btn.primary}
            disabled={pending !== null || needsApproval}
            onClick={() => run("schedule", "/schedule", "POST", { scheduledAt: new Date(scheduledAt).toISOString() })}
          >
            {hasRetryable ? "この日時で再予約" : "予約する"}
          </button>
          <button className={btn.secondary} disabled={pending !== null || needsApproval} onClick={() => run("publish", "/publish")}>
            {hasRetryable ? "今すぐ再投稿" : "今すぐ投稿"}
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {status === "SCHEDULED" && (
          <button className={btn.secondary} disabled={pending !== null} onClick={() => run("cancel", "/cancel")}>
            予約を取り消す
          </button>
        )}
        {editable && (
          <Link href={`/posts/${postId}/edit`} className={btn.secondary}>編集する</Link>
        )}
        {status !== "POSTING" && (
          <button
            className={btn.danger}
            disabled={pending !== null}
            onClick={() => {
              if (confirm("この投稿を削除しますか？（SNSに投稿済みの内容は削除されません）")) run("delete", "", "DELETE");
            }}
          >
            削除
          </button>
        )}
      </div>
    </div>
  );
}
