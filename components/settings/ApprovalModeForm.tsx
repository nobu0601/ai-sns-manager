"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ApprovalMode } from "@prisma/client";
import { Alert } from "@/components/common/Alert";
import { btn } from "@/components/common/buttons";
import { ApiError, apiFetch } from "@/lib/client/api";
import { APPROVAL_MODE_LABELS } from "@/lib/labels";

export function ApprovalModeForm({ current }: { current: ApprovalMode }) {
  const router = useRouter();
  const [mode, setMode] = useState<ApprovalMode>(current);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function save() {
    setPending(true);
    setMessage(null);
    try {
      await apiFetch("/api/settings", { method: "PATCH", body: { approvalMode: mode } });
      setMessage({ tone: "success", text: "保存しました" });
      router.refresh();
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof ApiError ? err.message : "保存できませんでした" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="sr-only">投稿モード</legend>
        {(Object.keys(APPROVAL_MODE_LABELS) as ApprovalMode[]).map((m) => (
          <label key={m} className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
            <input type="radio" name="approvalMode" value={m} checked={mode === m} onChange={() => setMode(m)} className="mt-1" />
            <span>
              <span className="block text-sm font-semibold text-slate-900">{APPROVAL_MODE_LABELS[m].label}</span>
              <span className="block text-xs text-slate-600">{APPROVAL_MODE_LABELS[m].description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {message && <Alert tone={message.tone} title={message.text} />}
      <button className={btn.primary} disabled={pending || mode === current} onClick={save}>保存する</button>
    </div>
  );
}
