"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Platform } from "@prisma/client";
import { Alert } from "@/components/common/Alert";
import { btn, input, label } from "@/components/common/buttons";
import { ApiError, apiFetch } from "@/lib/client/api";
import { PLATFORM_LABELS } from "@/lib/errors/user-messages";
import { CREDENTIAL_FIELDS } from "@/lib/social/credential-fields";

type Props = {
  platform: Platform;
  brands: { id: string; name: string }[];
  // 指定するとキーの差し替え（再認証）。未指定なら新規追加
  account?: { id: string; label: string; brandId: string | null };
  onDone: () => void;
};

// APIキーを入力してアカウントを連携する（キーはブラウザに残さず、送信後に入力欄を空にする）
export function AccountKeyForm({ platform, brands, account, onDone }: Props) {
  const router = useRouter();
  const fields = CREDENTIAL_FIELDS[platform];
  const [values, setValues] = useState<Record<string, string>>({});
  const [accountLabel, setAccountLabel] = useState(account?.label ?? "");
  const [brandId, setBrandId] = useState(account?.brandId ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);
  const idPrefix = `${platform}-${account?.id ?? "new"}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const body = { label: accountLabel, brandId: brandId || null, credentials: values };
    try {
      if (account) await apiFetch(`/api/social/accounts/${account.id}`, { method: "PATCH", body });
      else await apiFetch(`/api/social/${platform.toLowerCase()}/connect`, { method: "POST", body });
      setValues({});
      onDone();
      router.refresh();
    } catch (err) {
      const e2 = err instanceof ApiError ? err : new ApiError("連携できませんでした", 500);
      setError({ message: e2.message, details: e2.details });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4" autoComplete="off">
      <p className="text-sm font-semibold text-slate-800">
        {account ? `${PLATFORM_LABELS[platform]} のキーを入力し直す` : `${PLATFORM_LABELS[platform]} のアカウントを追加`}
      </p>
      {error && <Alert title={error.message} messages={error.details} />}
      {fields.map((f) => (
        <div key={f.key}>
          <label className={label} htmlFor={`${idPrefix}-${f.key}`}>{f.label}</label>
          <input
            id={`${idPrefix}-${f.key}`}
            type="password"
            required
            autoComplete="off"
            spellCheck={false}
            value={values[f.key] ?? ""}
            onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
            className={input}
          />
          {f.help && <p className="mt-1 text-xs text-slate-500">{f.help}</p>}
        </div>
      ))}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor={`${idPrefix}-label`}>表示名（任意）</label>
          <input
            id={`${idPrefix}-label`}
            value={accountLabel}
            maxLength={50}
            placeholder="例：Lounge+ 公式"
            onChange={(e) => setAccountLabel(e.target.value)}
            className={input}
          />
        </div>
        {brands.length > 0 && (
          <div>
            <label className={label} htmlFor={`${idPrefix}-brand`}>ブランド（任意）</label>
            <select id={`${idPrefix}-brand`} value={brandId} onChange={(e) => setBrandId(e.target.value)} className={input}>
              <option value="">指定しない</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      <p className="text-xs text-slate-500">
        「連携する」を押すと、入力したキーで{PLATFORM_LABELS[platform]}に問い合わせて確認します。キーは暗号化して保存し、画面には末尾4文字だけを表示します。
      </p>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={btn.primary}>{pending ? "確認中…" : account ? "キーを更新する" : "連携する"}</button>
        <button type="button" disabled={pending} onClick={onDone} className={btn.secondary}>キャンセル</button>
      </div>
    </form>
  );
}
