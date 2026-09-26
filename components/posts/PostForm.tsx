"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { ApprovalMode, Platform } from "@prisma/client";
import { Alert } from "@/components/common/Alert";
import { btn, input, label } from "@/components/common/buttons";
import { ApiError, apiFetch } from "@/lib/client/api";
import { PLATFORM_LABELS } from "@/lib/errors/user-messages";
import { PLATFORM_CAPABILITIES } from "@/lib/social/capabilities";
import { validateAgainstCapabilities } from "@/lib/social/validate";

const ALL_PLATFORMS: Platform[] = ["X", "INSTAGRAM", "THREADS"];

export type PostFormInitial = {
  id: string;
  title: string;
  topic: string;
  brandId: string | null;
  scheduledAt: string | null;
  platforms: { platform: Platform; content: string }[];
};

type Props = {
  initial?: PostFormInitial;
  brands: { id: string; name: string }[];
  approvalMode: ApprovalMode;
  connected: Platform[];
};

// datetime-local 用の "YYYY-MM-DDTHH:mm"（ブラウザのローカル時刻）
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

type Action = "draft" | "schedule" | "publish";

export function PostForm({ initial, brands, approvalMode, connected }: Props) {
  const router = useRouter();
  const initialContents = Object.fromEntries((initial?.platforms ?? []).map((p) => [p.platform, p.content]));
  const initialValues = Object.values(initialContents);
  const initiallySeparate = initialValues.length > 1 && new Set(initialValues).size > 1;

  const [title, setTitle] = useState(initial?.title ?? "");
  const [topic, setTopic] = useState(initial?.topic ?? "");
  const [brandId, setBrandId] = useState(initial?.brandId ?? brands[0]?.id ?? "");
  const [selected, setSelected] = useState<Platform[]>(
    initial ? initial.platforms.map((p) => p.platform) : ALL_PLATFORMS.filter((p) => connected.includes(p)),
  );
  const [separate, setSeparate] = useState(initiallySeparate);
  const [common, setCommon] = useState(initialValues[0] ?? "");
  const [perPlatform, setPerPlatform] = useState<Record<string, string>>(initialContents);
  const [scheduledAt, setScheduledAt] = useState(
    initial?.scheduledAt ? toLocalInput(new Date(initial.scheduledAt)) : toLocalInput(new Date(Date.now() + 60 * 60 * 1000)),
  );
  // 新規作成後に予約だけ失敗した場合、再送信で二重作成しないよう保存済みIDを覚えておく
  const [savedId, setSavedId] = useState(initial?.id);
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);

  const contentFor = (p: Platform) => (separate ? (perPlatform[p] ?? common) : common);

  const checks = useMemo(
    () =>
      selected.map((p) => ({
        platform: p,
        length: [...contentFor(p).trim()].length,
        result: validateAgainstCapabilities({ platform: p, content: contentFor(p), idempotencyKey: "" }, PLATFORM_CAPABILITIES[p]),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, separate, common, perPlatform],
  );

  function togglePlatform(p: Platform) {
    setSelected((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : ALL_PLATFORMS.filter((x) => x === p || prev.includes(x))));
  }

  function toggleSeparate(next: boolean) {
    if (next) setPerPlatform(Object.fromEntries(selected.map((p) => [p, perPlatform[p] ?? common])));
    setSeparate(next);
  }

  async function submit(action: Action) {
    setError(null);
    if (action !== "draft") {
      const errors = checks.flatMap((c) => c.result.errors);
      if (errors.length > 0) {
        setError({ message: "投稿内容を確認してください", details: errors });
        return;
      }
    }
    setPending(action);
    const body = {
      title,
      topic,
      brandId: brandId || null,
      platforms: selected.map((p) => ({ platform: p, content: contentFor(p) })),
    };
    let postId = savedId;
    try {
      const saved = savedId
        ? await apiFetch<{ post: { id: string } }>(`/api/posts/${savedId}`, { method: "PATCH", body })
        : await apiFetch<{ post: { id: string } }>("/api/posts", { method: "POST", body });
      postId = saved.post.id;
      setSavedId(postId);

      // 作成者本人が予約・投稿ボタンを押した場合は、この内容を承認したものとして扱う
      if (action === "schedule") {
        await apiFetch(`/api/posts/${postId}/schedule`, {
          method: "POST",
          body: { scheduledAt: new Date(scheduledAt).toISOString(), approve: true },
        });
      } else if (action === "publish") {
        await apiFetch(`/api/posts/${postId}/publish`, { method: "POST", body: { approve: true } });
      }
      router.push(`/posts/${postId}?done=${action}`);
      router.refresh();
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError("エラーが発生しました", 500);
      // 保存は成功して予約だけ失敗した場合は、保存済みであることを伝える
      const savedNote = postId ? "（入力内容は下書きとして保存されています）" : "";
      setError({ message: e.message + savedNote, details: e.details });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setPending(null);
    }
  }

  const missingAccounts = selected.filter((p) => !connected.includes(p));

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit("schedule");
      }}
    >
      {error && <Alert title={error.message} messages={error.details} />}

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <label className={label} htmlFor="title">投稿タイトル（管理用・SNSには表示されません）</label>
          <input id="title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
        </div>
        <div>
          <label className={label} htmlFor="topic">投稿テーマ</label>
          <input
            id="topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="例：Lounge+の紹介"
            className={input}
          />
        </div>
        {brands.length > 0 && (
          <div>
            <label className={label} htmlFor="brand">ブランド</label>
            <select id="brand" value={brandId} onChange={(e) => setBrandId(e.target.value)} className={input}>
              <option value="">指定しない</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        )}
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <fieldset>
          <legend className={label}>対象SNS</legend>
          <div className="flex flex-wrap gap-4">
            {ALL_PLATFORMS.map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={selected.includes(p)} onChange={() => togglePlatform(p)} className="h-4 w-4" />
                {PLATFORM_LABELS[p]}
                {!connected.includes(p) && <span className="text-xs text-slate-500">（未接続）</span>}
              </label>
            ))}
          </div>
        </fieldset>
        {missingAccounts.length > 0 && (
          <Alert tone="warning">
            {missingAccounts.map((p) => PLATFORM_LABELS[p]).join("・")} のアカウントが未接続です。下書き保存はできますが、予約・投稿するには
            <Link href="/accounts" className="font-semibold underline">アカウント画面</Link>から接続してください。
          </Alert>
        )}

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={separate} onChange={(e) => toggleSeparate(e.target.checked)} className="h-4 w-4" />
          SNSごとに内容を変える
        </label>

        {!separate ? (
          <div>
            <label className={label} htmlFor="content">投稿内容</label>
            <textarea id="content" rows={7} value={common} onChange={(e) => setCommon(e.target.value)} className={input} />
          </div>
        ) : (
          selected.map((p) => (
            <div key={p}>
              <label className={label} htmlFor={`content-${p}`}>{PLATFORM_LABELS[p]} の投稿内容</label>
              <textarea
                id={`content-${p}`}
                rows={6}
                value={perPlatform[p] ?? common}
                onChange={(e) => setPerPlatform((prev) => ({ ...prev, [p]: e.target.value }))}
                className={input}
              />
            </div>
          ))
        )}

        <ul className="space-y-1 text-xs">
          {checks.map((c) => {
            const max = PLATFORM_CAPABILITIES[c.platform].maxTextLength;
            const over = max !== null && c.length > max;
            return (
              <li key={c.platform} className={over ? "text-rose-700" : "text-slate-500"}>
                {PLATFORM_LABELS[c.platform]}：{c.length}{max !== null && ` / ${max}`}文字
                {c.result.warnings.map((w) => (
                  <span key={w} className="ml-2 text-amber-700">※{w.replace(`${PLATFORM_LABELS[c.platform]}: `, "")}</span>
                ))}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="max-w-xs">
          <label className={label} htmlFor="scheduledAt">投稿日時</label>
          <input
            id="scheduledAt"
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className={input}
          />
        </div>
        {approvalMode !== "AUTO" && (
          <p className="text-xs text-slate-500">
            「予約する」「今すぐ投稿」を押すと、この内容をあなたが承認したものとして扱います。
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={pending !== null || selected.length === 0} className={btn.primary}>
            {pending === "schedule" ? "予約中…" : "予約する"}
          </button>
          <button type="button" disabled={pending !== null || selected.length === 0} onClick={() => submit("publish")} className={btn.secondary}>
            {pending === "publish" ? "送信中…" : "今すぐ投稿"}
          </button>
          <button type="button" disabled={pending !== null || selected.length === 0} onClick={() => submit("draft")} className={btn.secondary}>
            {pending === "draft" ? "保存中…" : "下書き保存"}
          </button>
        </div>
      </section>
    </form>
  );
}
