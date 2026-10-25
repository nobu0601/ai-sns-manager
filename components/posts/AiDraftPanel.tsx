"use client";

import { useState } from "react";
import { Alert } from "@/components/common/Alert";
import { Badge } from "@/components/common/Badge";
import { btn, input, label } from "@/components/common/buttons";
import { instagramContent } from "@/lib/ai/quality";
import { DRAFT_STYLE_LABELS, type CheckedDraft, type DraftStyle } from "@/lib/ai/types";
import { ApiError, apiFetch } from "@/lib/client/api";

type DraftResponse = { drafts: CheckedDraft[]; model: string; provider: string };

type Props = {
  topic: string;
  brandId: string;
  onAdopt: (draft: CheckedDraft, meta: { model: string; style: DraftStyle }) => void;
};

// AI に投稿案を作らせ、採用・再生成・削除を選ぶ
export function AiDraftPanel({ topic, brandId, onAdopt }: Props) {
  const [objective, setObjective] = useState("");
  const [drafts, setDrafts] = useState<CheckedDraft[]>([]);
  const [meta, setMeta] = useState<{ model: string; provider: string } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adopted, setAdopted] = useState<string | null>(null);

  async function request(styles?: DraftStyle[]): Promise<DraftResponse> {
    return apiFetch<DraftResponse>("/api/ai/drafts", {
      method: "POST",
      body: { topic, objective: objective || undefined, brandId: brandId || null, styles },
    });
  }

  async function generateAll() {
    setPending("all");
    setError(null);
    setAdopted(null);
    try {
      const res = await request();
      setDrafts(res.drafts);
      setMeta({ model: res.model, provider: res.provider });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "投稿案を作れませんでした");
    } finally {
      setPending(null);
    }
  }

  async function regenerate(draft: CheckedDraft) {
    setPending(draft.id);
    setError(null);
    try {
      const res = await request([draft.style]);
      const next = res.drafts[0];
      if (next) setDrafts((prev) => prev.map((d) => (d.id === draft.id ? next : d)));
      setMeta({ model: res.model, provider: res.provider });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "作り直せませんでした");
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-brand-100 bg-brand-50/60 p-5 shadow-sm" aria-labelledby="ai-panel-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="ai-panel-title" className="text-base font-semibold text-slate-900">AIで投稿案を作る</h2>
        {meta?.provider === "mock" && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">AIはMockモード（APIキー未設定）</span>
        )}
      </div>
      <p className="text-xs text-slate-600">
        上の「投稿テーマ」と「ブランド」の設定をもとに、5つの型（{Object.values(DRAFT_STYLE_LABELS).join("・")}）で案を作り、X・Instagram・Threads 向けに書き分けます。
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <label className={label} htmlFor="ai-objective">今回の目的（任意）</label>
          <input
            id="ai-objective"
            value={objective}
            maxLength={500}
            placeholder="例：平日昼の利用を増やしたい"
            onChange={(e) => setObjective(e.target.value)}
            className={input}
          />
        </div>
        <button type="button" className={btn.primary} disabled={pending !== null} onClick={generateAll}>
          {pending === "all" ? "作成中…（30秒ほどかかります）" : drafts.length > 0 ? "5案を作り直す" : "5案を生成"}
        </button>
      </div>

      {error && <Alert title={error} />}
      {adopted && <Alert tone="success" title="案を採用しました。下の投稿内容を確認・編集してください。" />}

      {drafts.length > 0 && (
        <ul className="grid gap-4 lg:grid-cols-2">
          {drafts.map((d) => (
            <li key={d.id} className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="violet">{DRAFT_STYLE_LABELS[d.style]}</Badge>
                <p className="font-semibold text-slate-900">{d.title}</p>
              </div>
              <p className="text-xs text-slate-500">{d.summary}</p>
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-xs font-semibold text-slate-500">X</dt>
                  <dd className="whitespace-pre-wrap break-words text-slate-800">{d.x.text}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-slate-500">Instagram</dt>
                  <dd className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-slate-800">{instagramContent(d)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-slate-500">Threads</dt>
                  <dd className="whitespace-pre-wrap break-words text-slate-800">{d.threads.text}</dd>
                </div>
              </dl>
              {d.errors.length > 0 && <Alert title="直しきれなかった問題があります" messages={d.errors} />}
              {d.warnings.length > 0 && <Alert tone="warning" messages={d.warnings} />}
              <div className="mt-auto flex flex-wrap gap-2">
                <button
                  type="button"
                  className={btn.small + " border-brand-500 text-brand-700"}
                  disabled={pending !== null}
                  onClick={() => {
                    onAdopt(d, { model: meta?.model ?? "", style: d.style });
                    setAdopted(d.id);
                  }}
                >
                  採用
                </button>
                <button type="button" className={btn.small} disabled={pending !== null} onClick={() => regenerate(d)}>
                  {pending === d.id ? "作成中…" : "この案を再生成"}
                </button>
                <button
                  type="button"
                  className={btn.small + " text-rose-700"}
                  disabled={pending !== null}
                  onClick={() => setDrafts((prev) => prev.filter((x) => x.id !== d.id))}
                >
                  削除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {meta && drafts.length > 0 && (
        <p className="text-xs text-slate-500">
          AIが作った文章は、事実関係（営業時間・価格など）を必ず確認してから投稿してください。{meta.provider === "claude" && `使用モデル：${meta.model}`}
        </p>
      )}
    </section>
  );
}
