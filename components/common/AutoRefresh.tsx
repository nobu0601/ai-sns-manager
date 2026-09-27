"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// setTimeout の上限（約24.8日）を超える待ち時間は扱わない
const MAX_TIMEOUT_MS = 2_147_483_647;

// 投稿処理の進行中は数秒ごとに画面を更新する。
// refreshAt を渡すと、その時刻（予約時刻）に1回更新する。更新後はサーバー側の判定で進行中の更新に切り替わる
export function AutoRefresh({
  active,
  refreshAt,
  intervalMs = 4000,
}: {
  active: boolean;
  refreshAt?: string | null;
  intervalMs?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs, router]);

  useEffect(() => {
    if (active || !refreshAt) return;
    const delay = new Date(refreshAt).getTime() - Date.now();
    if (Number.isNaN(delay) || delay > MAX_TIMEOUT_MS) return;
    const timer = setTimeout(() => router.refresh(), Math.max(0, delay));
    return () => clearTimeout(timer);
  }, [active, refreshAt, router]);

  return null;
}
