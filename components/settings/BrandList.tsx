"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { btn } from "@/components/common/buttons";
import { ApiError, apiFetch } from "@/lib/client/api";
import { BrandForm, type BrandFormValue } from "./BrandForm";

type Brand = BrandFormValue & { id: string; isSample: boolean };

export function BrandList({ brands }: { brands: Brand[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(brand: Brand) {
    if (!confirm(`「${brand.name}」を削除しますか？（投稿は残ります）`)) return;
    try {
      await apiFetch(`/api/brands/${brand.id}`, { method: "DELETE" });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "削除できませんでした");
    }
  }

  if (brands.length === 0) return <p className="text-sm text-slate-600">まだブランドがありません。下のフォームから追加してください。</p>;

  return (
    <ul className="space-y-3">
      {error && <li role="alert" className="text-sm text-rose-700">{error}</li>}
      {brands.map((b) => (
        <li key={b.id} className="rounded-lg border border-slate-200 p-4">
          {editing === b.id ? (
            <BrandForm initial={b} onDone={() => setEditing(null)} />
          ) : (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">
                  {b.name}
                  {b.isSample && <span className="ml-2 rounded bg-slate-100 px-1.5 text-xs font-normal text-slate-600">サンプル</span>}
                </p>
                {b.description && <p className="mt-1 text-sm text-slate-600">{b.description}</p>}
                {b.contentPillars.length > 0 && (
                  <p className="mt-2 text-xs text-slate-500">テーマの柱：{b.contentPillars.join("・")}</p>
                )}
              </div>
              <div className="flex gap-2">
                <button className={btn.small} onClick={() => setEditing(b.id)}>編集</button>
                <button className={btn.small + " text-rose-700"} onClick={() => remove(b)}>削除</button>
              </div>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
