"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Platform, SocialAccountStatus } from "@prisma/client";
import { btn } from "@/components/common/buttons";
import { ApiError, apiFetch } from "@/lib/client/api";
import { formatDateTime } from "@/lib/datetime";
import { PLATFORM_LABELS } from "@/lib/errors/user-messages";
import { ACCOUNT_STATUS_LABELS } from "@/lib/labels";
import { AccountKeyForm } from "./AccountKeyForm";

export type AccountItem = {
  id: string;
  platform: Platform;
  accountName: string;
  label: string;
  credentialHint: string;
  status: SocialAccountStatus;
  isMock: boolean;
  lastCheckedAt: Date | null;
  lastError: string | null;
  brandId: string | null;
};

type Props = {
  platform: Platform;
  accounts: AccountItem[];
  brands: { id: string; name: string }[];
  mockMode: boolean;
};

// 1つのSNSの連携アカウント一覧と操作（追加・キー更新・接続確認・切断）
export function AccountList({ platform, accounts, brands, mockMode }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const brandName = (id: string | null) => brands.find((b) => b.id === id)?.name;

  async function run(key: string, action: () => Promise<unknown>, success: string) {
    setPending(key);
    setMessage(null);
    try {
      await action();
      setMessage({ tone: "ok", text: success });
      router.refresh();
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof ApiError ? err.message : "操作できませんでした" });
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby={`h-${platform}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={`h-${platform}`} className="text-base font-semibold text-slate-900">
          {PLATFORM_LABELS[platform]}
          <span className="ml-2 text-sm font-normal text-slate-500">{accounts.length}アカウント</span>
        </h2>
        {editing !== "new" && (
          <button className={btn.small} onClick={() => setEditing("new")}>＋ アカウントを追加</button>
        )}
      </div>

      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={`mb-3 text-sm ${message.tone === "error" ? "text-rose-700" : "text-emerald-700"}`}>
          {message.text}
        </p>
      )}

      {editing === "new" && (
        <div className="mb-4">
          <AccountKeyForm platform={platform} brands={brands} onDone={() => setEditing(null)} />
        </div>
      )}

      {accounts.length === 0 ? (
        editing !== "new" && <p className="text-sm text-slate-500">○ 未接続です。「アカウントを追加」からAPIキーを登録してください。</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {accounts.map((a) => {
            const usable = a.status === "CONNECTED" && a.isMock === mockMode;
            return (
              <li key={a.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 text-sm">
                    <p className="font-medium text-slate-900">
                      {a.label ? `${a.label}（${a.accountName}）` : a.accountName}
                      {a.isMock && <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs text-amber-800">Mock</span>}
                    </p>
                    <p className={`mt-0.5 ${usable ? "text-emerald-700" : "text-rose-700"}`}>
                      {usable ? "● " : "○ "}
                      {a.isMock !== mockMode ? "現在のモードでは使えません" : ACCOUNT_STATUS_LABELS[a.status]}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      キー {a.credentialHint || "-"} ・ 最終確認 {formatDateTime(a.lastCheckedAt)}
                      {brandName(a.brandId) && ` ・ ブランド ${brandName(a.brandId)}`}
                    </p>
                    {a.lastError && a.status !== "CONNECTED" && <p className="mt-1 text-xs text-rose-700">{a.lastError}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className={btn.small}
                      disabled={pending !== null}
                      onClick={() => run(`verify-${a.id}`, () => apiFetch(`/api/social/accounts/${a.id}/verify`, { method: "POST", body: {} }), `${a.accountName} の接続を確認しました`)}
                    >
                      {pending === `verify-${a.id}` ? "確認中…" : "接続確認"}
                    </button>
                    <button className={btn.small} disabled={pending !== null} onClick={() => setEditing(a.id)}>
                      キーを更新
                    </button>
                    <button
                      className={`${btn.small} text-rose-700`}
                      disabled={pending !== null}
                      onClick={() => {
                        if (confirm(`${a.accountName} との連携を解除しますか？保存したキーは削除され、このアカウントへの予約投稿は実行されなくなります。`)) {
                          run(`delete-${a.id}`, () => apiFetch(`/api/social/accounts/${a.id}`, { method: "DELETE" }), `${a.accountName} の連携を解除しました`);
                        }
                      }}
                    >
                      切断
                    </button>
                  </div>
                </div>
                {editing === a.id && (
                  <div className="mt-3">
                    <AccountKeyForm platform={platform} brands={brands} account={a} onDone={() => setEditing(null)} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
