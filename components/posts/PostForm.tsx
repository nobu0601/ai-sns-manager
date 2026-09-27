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

const PLATFORM_ORDER: Platform[] = ["X", "INSTAGRAM", "THREADS"];

export type PostFormAccount = { id: string; platform: Platform; accountName: string; label: string };

export type PostFormInitial = {
  id: string;
  title: string;
  topic: string;
  brandId: string | null;
  scheduledAt: string | null;
  targets: { socialAccountId: string | null; platform: Platform; accountName: string; content: string; mediaUrls: string[] }[];
};

type Props = {
  initial?: PostFormInitial;
  brands: { id: string; name: string }[];
  approvalMode: ApprovalMode;
  // 投稿先に選べるアカウント（接続済みのもの）
  accounts: PostFormAccount[];
};

// datetime-local 用の "YYYY-MM-DDTHH:mm"（ブラウザのローカル時刻）
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const accountLabel = (a: { label: string; accountName: string }) => (a.label ? `${a.label}（${a.accountName}）` : a.accountName);

type Action = "draft" | "schedule" | "publish";

export function PostForm({ initial, brands, approvalMode, accounts }: Props) {
  const router = useRouter();
  const initialTargets = (initial?.targets ?? []).filter((t) => t.socialAccountId);
  const initialContents = Object.fromEntries(initialTargets.map((t) => [t.socialAccountId as string, t.content]));
  const initialValues = Object.values(initialContents);
  const initiallySeparate = initialValues.length > 1 && new Set(initialValues).size > 1;

  // 編集時、再接続が必要になったアカウントも選択済みとして表示する
  const choices: (PostFormAccount & { unavailable?: boolean })[] = [
    ...accounts,
    ...initialTargets
      .filter((t) => !accounts.some((a) => a.id === t.socialAccountId))
      .map((t) => ({ id: t.socialAccountId as string, platform: t.platform, accountName: t.accountName, label: "", unavailable: true })),
  ].sort((a, b) => PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform));

  const [title, setTitle] = useState(initial?.title ?? "");
  const [topic, setTopic] = useState(initial?.topic ?? "");
  const [brandId, setBrandId] = useState(initial?.brandId ?? brands[0]?.id ?? "");
  const [selected, setSelected] = useState<string[]>(initialTargets.map((t) => t.socialAccountId as string));
  const [separate, setSeparate] = useState(initiallySeparate);
  const [common, setCommon] = useState(initialValues[0] ?? "");
  const [perAccount, setPerAccount] = useState<Record<string, string>>(initialContents);
  const [imageUrl, setImageUrl] = useState(initialTargets.find((t) => t.mediaUrls.length > 0)?.mediaUrls[0] ?? "");
  const [scheduledAt, setScheduledAt] = useState(
    initial?.scheduledAt ? toLocalInput(new Date(initial.scheduledAt)) : toLocalInput(new Date(Date.now() + 60 * 60 * 1000)),
  );
  // 新規作成後に予約だけ失敗した場合、再送信で二重作成しないよう保存済みIDを覚えておく
  const [savedId, setSavedId] = useState(initial?.id);
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);

  const selectedAccounts = choices.filter((a) => selected.includes(a.id));
  const needsImage = selectedAccounts.some((a) => PLATFORM_CAPABILITIES[a.platform].requiresMedia);
  const contentFor = (id: string) => (separate ? (perAccount[id] ?? common) : common);
  const mediaFor = (platform: Platform) => (PLATFORM_CAPABILITIES[platform].requiresMedia && imageUrl.trim() ? [imageUrl.trim()] : []);

  const checks = useMemo(
    () =>
      selectedAccounts.map((a) => ({
        account: a,
        length: [...contentFor(a.id).trim()].length,
        result: validateAgainstCapabilities(
          { platform: a.platform, content: contentFor(a.id), mediaUrls: mediaFor(a.platform), idempotencyKey: "" },
          PLATFORM_CAPABILITIES[a.platform],
        ),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, separate, common, perAccount, imageUrl],
  );

  function toggleAccount(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleSeparate(next: boolean) {
    if (next) setPerAccount(Object.fromEntries(selected.map((id) => [id, perAccount[id] ?? common])));
    setSeparate(next);
  }

  async function submit(action: Action) {
    setError(null);
    if (action !== "draft") {
      const errors = checks.flatMap((c) =>
        c.result.errors.map((e) => e.replace(`${PLATFORM_LABELS[c.account.platform]}:`, `${PLATFORM_LABELS[c.account.platform]} ${c.account.accountName}:`)),
      );
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
      targets: selectedAccounts.map((a) => ({ socialAccountId: a.id, content: contentFor(a.id), mediaUrls: mediaFor(a.platform) })),
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
          <legend className={label}>投稿先のアカウント</legend>
          {choices.length === 0 ? (
            <Alert tone="warning">
              連携しているアカウントがありません。下書き保存はできますが、予約・投稿するには
              <Link href="/accounts" className="font-semibold underline">SNSアカウント画面</Link>でAPIキーを登録してください。
            </Alert>
          ) : (
            <div className="space-y-3">
              {PLATFORM_ORDER.filter((p) => choices.some((a) => a.platform === p)).map((p) => (
                <div key={p}>
                  <p className="mb-1 text-xs font-semibold text-slate-500">{PLATFORM_LABELS[p]}</p>
                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    {choices
                      .filter((a) => a.platform === p)
                      .map((a) => (
                        <label key={a.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={selected.includes(a.id)}
                            onChange={() => toggleAccount(a.id)}
                            className="h-4 w-4"
                            aria-label={`${PLATFORM_LABELS[p]} ${accountLabel(a)}`}
                          />
                          {accountLabel(a)}
                          {a.unavailable && <span className="text-xs text-rose-700">（再接続が必要）</span>}
                        </label>
                      ))}
                  </div>
                </div>
              ))}
              <p className="text-xs text-slate-500">
                同じSNSの複数アカウントにも投稿できます。アカウントの追加は<Link href="/accounts" className="underline">SNSアカウント画面</Link>から。
              </p>
            </div>
          )}
        </fieldset>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={separate} onChange={(e) => toggleSeparate(e.target.checked)} className="h-4 w-4" />
          アカウントごとに内容を変える
        </label>

        {!separate || selectedAccounts.length === 0 ? (
          <div>
            <label className={label} htmlFor="content">投稿内容</label>
            <textarea id="content" rows={7} value={common} onChange={(e) => setCommon(e.target.value)} className={input} />
          </div>
        ) : (
          selectedAccounts.map((a) => (
            <div key={a.id}>
              <label className={label} htmlFor={`content-${a.id}`}>
                {PLATFORM_LABELS[a.platform]} {accountLabel(a)} の投稿内容
              </label>
              <textarea
                id={`content-${a.id}`}
                rows={6}
                value={perAccount[a.id] ?? common}
                onChange={(e) => setPerAccount((prev) => ({ ...prev, [a.id]: e.target.value }))}
                className={input}
              />
            </div>
          ))
        )}

        {needsImage && (
          <div>
            <label className={label} htmlFor="imageUrl">画像のURL（Instagram は必須）</label>
            <input
              id="imageUrl"
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://example.com/photo.jpg"
              className={input}
            />
            <p className="mt-1 text-xs text-slate-500">インターネットから見られる https:// の画像URLを入力してください（JPEG推奨）。</p>
          </div>
        )}

        <ul className="space-y-1 text-xs">
          {checks.map((c) => {
            const max = PLATFORM_CAPABILITIES[c.account.platform].maxTextLength;
            const over = max !== null && c.length > max;
            return (
              <li key={c.account.id} className={over ? "text-rose-700" : "text-slate-500"}>
                {PLATFORM_LABELS[c.account.platform]} {c.account.accountName}：{c.length}
                {max !== null && ` / ${max}`}文字
                {c.result.warnings.map((w) => (
                  <span key={w} className="ml-2 text-amber-700">※{w.replace(`${PLATFORM_LABELS[c.account.platform]}: `, "")}</span>
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
