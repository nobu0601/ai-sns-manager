"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/common/Alert";
import { btn, input, label } from "@/components/common/buttons";
import { ApiError, apiFetch } from "@/lib/client/api";

export type BrandFormValue = {
  id?: string;
  name: string;
  description: string;
  targetAudience: string;
  brandImage: string;
  tone: string;
  objective: string;
  avoidExpressions: string;
  keywords: string[];
  prohibitedWords: string[];
  contentPillars: string[];
};

const EMPTY: BrandFormValue = {
  name: "",
  description: "",
  targetAudience: "",
  brandImage: "",
  tone: "",
  objective: "",
  avoidExpressions: "",
  keywords: [],
  prohibitedWords: [],
  contentPillars: [],
};

// 「、」「,」改行区切りの入力をリストにする
const toList = (text: string) =>
  text
    .split(/[、,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

const TEXT_FIELDS: { key: keyof BrandFormValue; label: string; rows?: number; placeholder?: string }[] = [
  { key: "description", label: "ブランド説明", rows: 3 },
  { key: "targetAudience", label: "ターゲット", rows: 2 },
  { key: "brandImage", label: "ブランドイメージ", rows: 2 },
  { key: "tone", label: "文章トーン", placeholder: "例：おしゃれ、落ち着いた、親しみやすい" },
  { key: "objective", label: "投稿目的", rows: 2 },
  { key: "avoidExpressions", label: "避けたい表現", rows: 2 },
];

const LIST_FIELDS: { key: "keywords" | "prohibitedWords" | "contentPillars"; label: string }[] = [
  { key: "keywords", label: "使用したいキーワード" },
  { key: "prohibitedWords", label: "禁止キーワード" },
  { key: "contentPillars", label: "投稿テーマの柱（Content Pillars）" },
];

export function BrandForm({ initial, onDone }: { initial?: BrandFormValue; onDone?: () => void }) {
  const router = useRouter();
  const [value, setValue] = useState<BrandFormValue>(initial ?? EMPTY);
  const [lists, setLists] = useState({
    keywords: (initial?.keywords ?? []).join("、"),
    prohibitedWords: (initial?.prohibitedWords ?? []).join("、"),
    contentPillars: (initial?.contentPillars ?? []).join("、"),
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const body = {
      ...value,
      id: undefined,
      keywords: toList(lists.keywords),
      prohibitedWords: toList(lists.prohibitedWords),
      contentPillars: toList(lists.contentPillars),
    };
    try {
      if (initial?.id) await apiFetch(`/api/brands/${initial.id}`, { method: "PATCH", body });
      else await apiFetch("/api/brands", { method: "POST", body });
      if (!initial?.id) {
        setValue(EMPTY);
        setLists({ keywords: "", prohibitedWords: "", contentPillars: "" });
      }
      onDone?.();
      router.refresh();
    } catch (err) {
      const e2 = err instanceof ApiError ? err : new ApiError("保存できませんでした", 500);
      setError({ message: e2.message, details: e2.details });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert title={error.message} messages={error.details} />}
      <div>
        <label className={label} htmlFor="brand-name">ブランド名</label>
        <input id="brand-name" required value={value.name} onChange={(e) => setValue({ ...value, name: e.target.value })} className={input} />
      </div>
      {TEXT_FIELDS.map((f) => (
        <div key={f.key}>
          <label className={label} htmlFor={`brand-${f.key}`}>{f.label}</label>
          {f.rows ? (
            <textarea
              id={`brand-${f.key}`}
              rows={f.rows}
              value={value[f.key] as string}
              onChange={(e) => setValue({ ...value, [f.key]: e.target.value })}
              className={input}
            />
          ) : (
            <input
              id={`brand-${f.key}`}
              value={value[f.key] as string}
              placeholder={f.placeholder}
              onChange={(e) => setValue({ ...value, [f.key]: e.target.value })}
              className={input}
            />
          )}
        </div>
      ))}
      {LIST_FIELDS.map((f) => (
        <div key={f.key}>
          <label className={label} htmlFor={`brand-${f.key}`}>{f.label}（「、」区切り）</label>
          <input
            id={`brand-${f.key}`}
            value={lists[f.key]}
            onChange={(e) => setLists({ ...lists, [f.key]: e.target.value })}
            className={input}
          />
        </div>
      ))}
      <div className="flex gap-3">
        <button type="submit" disabled={pending} className={btn.primary}>{initial?.id ? "保存する" : "ブランドを追加"}</button>
        {onDone && initial?.id && (
          <button type="button" className={btn.secondary} onClick={onDone}>キャンセル</button>
        )}
      </div>
    </form>
  );
}
