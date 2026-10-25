"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert } from "@/components/common/Alert";
import { btn } from "@/components/common/buttons";
import { ApiError, apiFetch } from "@/lib/client/api";

// 数値の取得は Worker で行うため、開始後しばらくは数秒ごとに画面を更新する
const FOLLOW_UP_REFRESHES = 6;
const FOLLOW_UP_INTERVAL_MS = 4000;

export function RefreshMetricsButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!started) return;
    let count = 0;
    const timer = setInterval(() => {
      router.refresh();
      if (++count >= FOLLOW_UP_REFRESHES) {
        clearInterval(timer);
        setStarted(false);
      }
    }, FOLLOW_UP_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [started, router]);

  return (
    <div className="space-y-2">
      <button
        type="button"
        className={btn.secondary}
        disabled={pending || started}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            await apiFetch("/api/analytics/refresh", { method: "POST", body: {} });
            setStarted(true);
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "開始できませんでした");
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? "開始しています…" : started ? "取得しています…" : "数値を更新"}
      </button>
      {started && <p role="status" className="text-xs text-slate-500">SNSから数値を取得しています。数十秒で画面に反映されます。</p>}
      {error && <Alert title={error} />}
    </div>
  );
}

export function AnalyzeButton({ brandId, disabled }: { brandId: string; disabled: boolean }) {
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
            await apiFetch("/api/analytics/analyze", { method: "POST", body: { brandId } });
            router.refresh();
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "開始できませんでした");
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? "開始しています…" : "AIで分析する"}
      </button>
      {error && <Alert title={error} />}
    </div>
  );
}
