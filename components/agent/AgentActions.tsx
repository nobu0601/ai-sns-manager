"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/common/Alert";
import { btn } from "@/components/common/buttons";
import { ApiError, apiFetch } from "@/lib/client/api";

export function AgentRunButton({ brandId, disabled }: { brandId: string; disabled: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <button
        type="button"
        className={btn.primary}
        disabled={pending || disabled}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            await apiFetch("/api/agent/run", { method: "POST", body: { brandId } });
            router.refresh();
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "開始できませんでした");
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? "開始しています…" : "今後7日間の投稿を作る"}
      </button>
      {error && <Alert title={error} />}
    </div>
  );
}

type Result = { postId: string; title: string; ok: boolean; message?: string };

export function ApproveRunButton({ runId, count }: { runId: string; count: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const failed = results?.filter((r) => !r.ok) ?? [];
  return (
    <div className="space-y-2">
      {count > 0 && (
      <button
        type="button"
        className={btn.primary}
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            const res = await apiFetch<{ results: Result[] }>(`/api/agent/runs/${runId}/approve`, { method: "POST", body: {} });
            setResults(res.results);
            router.refresh();
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "承認できませんでした");
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? "予約しています…" : `${count}件をまとめて承認して予約`}
      </button>
      )}
      {error && <Alert title={error} />}
      {results && failed.length === 0 && results.length > 0 && <Alert tone="success" title={`${results.length}件を予約しました`} />}
      {failed.length > 0 && <Alert tone="warning" title="予約できなかった投稿があります" messages={failed.map((f) => `${f.title}：${f.message}`)} />}
    </div>
  );
}
