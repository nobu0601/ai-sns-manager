"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Platform } from "@prisma/client";
import { btn } from "@/components/common/buttons";
import { ApiError, apiFetch } from "@/lib/client/api";
import { PLATFORM_LABELS } from "@/lib/errors/user-messages";

type Props = { platform: Platform; accountId?: string; needsReauth: boolean };

export function AccountActions({ platform, accountId, needsReauth }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setPending(true);
    setError(null);
    try {
      const { authorizationUrl } = await apiFetch<{ authorizationUrl: string }>(
        `/api/social/${platform.toLowerCase()}/connect`,
        { method: "POST", body: {} },
      );
      // SNSの認可画面（Mockモードでは自アプリのコールバック）へ移動する
      window.location.assign(authorizationUrl);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "接続を開始できませんでした");
      setPending(false);
    }
  }

  async function disconnect() {
    if (!accountId || !confirm(`${PLATFORM_LABELS[platform]}との接続を切断しますか？予約中の投稿は投稿できなくなります。`)) return;
    setPending(true);
    setError(null);
    try {
      await apiFetch(`/api/social/accounts/${accountId}`, { method: "DELETE" });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "切断できませんでした");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!accountId && (
        <button className={btn.small} disabled={pending} onClick={connect}>接続</button>
      )}
      {accountId && (
        <button className={needsReauth ? btn.small + " border-amber-400 text-amber-800" : btn.small} disabled={pending} onClick={connect}>
          再認証
        </button>
      )}
      {accountId && (
        <button className={btn.small + " text-rose-700"} disabled={pending} onClick={disconnect}>切断</button>
      )}
      {error && <span role="alert" className="text-xs text-rose-700">{error}</span>}
    </div>
  );
}
