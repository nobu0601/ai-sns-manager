"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Platform } from "@prisma/client";
import { Alert } from "@/components/common/Alert";
import { btn, input, label } from "@/components/common/buttons";
import { ApiError, apiFetch } from "@/lib/client/api";
import { PLATFORM_LABELS } from "@/lib/errors/user-messages";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
// 月曜始まりで並べる
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export type AgentConfigValue = {
  weeklyEnabled: boolean;
  runWeekday: number;
  runTime: string;
  postsPerWeek: number;
  preferredWeekdays: number[];
  preferredTime: string;
  targetAccountIds: string[];
  generateImages: boolean;
};

type Props = {
  brandId: string;
  initial: AgentConfigValue;
  accounts: { id: string; platform: Platform; accountName: string; label: string }[];
};

export function AgentConfigForm({ brandId, initial, accounts }: Props) {
  const router = useRouter();
  const [value, setValue] = useState<AgentConfigValue>(initial);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string; details?: string[] } | null>(null);
  const set = <K extends keyof AgentConfigValue>(key: K, v: AgentConfigValue[K]) => setValue((prev) => ({ ...prev, [key]: v }));
  const toggle = (list: number[] | string[], item: number | string) =>
    (list as (number | string)[]).includes(item) ? (list as (number | string)[]).filter((x) => x !== item) : [...list, item];
  const hasInstagram = accounts.some((a) => value.targetAccountIds.includes(a.id) && a.platform === "INSTAGRAM");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      await apiFetch(`/api/agent/config?brandId=${encodeURIComponent(brandId)}`, { method: "PUT", body: value });
      setMessage({ tone: "success", text: "保存しました" });
      router.refresh();
    } catch (err) {
      const e2 = err instanceof ApiError ? err : new ApiError("保存できませんでした", 500);
      setMessage({ tone: "error", text: e2.message, details: e2.details });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-5">
      <fieldset>
        <legend className={label}>投稿先のアカウント</legend>
        {accounts.length === 0 ? (
          <p className="text-sm text-slate-500">接続済みのアカウントがありません。SNSアカウント画面で登録してください。</p>
        ) : (
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {accounts.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={value.targetAccountIds.includes(a.id)}
                  onChange={() => set("targetAccountIds", toggle(value.targetAccountIds, a.id) as string[])}
                />
                {PLATFORM_LABELS[a.platform]} {a.label ? `${a.label}（${a.accountName}）` : a.accountName}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="postsPerWeek">投稿頻度</label>
          <select id="postsPerWeek" className={input} value={value.postsPerWeek} onChange={(e) => set("postsPerWeek", Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={n}>週{n}回</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="preferredTime">投稿する時刻</label>
          <input id="preferredTime" type="time" className={input} value={value.preferredTime} onChange={(e) => set("preferredTime", e.target.value)} />
        </div>
      </div>

      <fieldset>
        <legend className={label}>投稿したい曜日（足りない場合は他の曜日も使います）</legend>
        <div className="flex flex-wrap gap-3">
          {WEEK_ORDER.map((d) => (
            <label key={d} className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={value.preferredWeekdays.includes(d)}
                onChange={() => set("preferredWeekdays", toggle(value.preferredWeekdays, d) as number[])}
              />
              {WEEKDAYS[d]}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1 h-4 w-4" checked={value.generateImages} onChange={(e) => set("generateImages", e.target.checked)} />
        <span>
          投稿ごとに画像も AI で作る
          <span className="block text-xs text-slate-500">
            {hasInstagram ? "Instagram は画像が必須のため、この設定に関係なく画像を作ります。" : "fal.ai の利用料金がかかります。"}
          </span>
        </span>
      </label>

      <div className="rounded-lg border border-slate-200 p-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" className="h-4 w-4" checked={value.weeklyEnabled} onChange={(e) => set("weeklyEnabled", e.target.checked)} />
          毎週自動で、今後7日間の投稿を作る
        </label>
        {value.weeklyEnabled && (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label className={label} htmlFor="runWeekday">実行する曜日</label>
              <select id="runWeekday" className={input} value={value.runWeekday} onChange={(e) => set("runWeekday", Number(e.target.value))}>
                {WEEK_ORDER.map((d) => (
                  <option key={d} value={d}>{WEEKDAYS[d]}曜日</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="runTime">時刻</label>
              <input id="runTime" type="time" className={input} value={value.runTime} onChange={(e) => set("runTime", e.target.value)} />
            </div>
            <p className="text-xs text-slate-500">日本時間。Worker（npm run worker）が起動している必要があります。</p>
          </div>
        )}
      </div>

      {message && <Alert tone={message.tone} title={message.text} messages={message.details} />}
      <button type="submit" className={btn.primary} disabled={pending}>{pending ? "保存中…" : "設定を保存"}</button>
    </form>
  );
}
