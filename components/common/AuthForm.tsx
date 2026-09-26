"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useState } from "react";
import { Alert } from "./Alert";
import { btn, input, label } from "./buttons";
import { apiFetch, ApiError } from "@/lib/client/api";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    try {
      if (mode === "register") {
        await apiFetch("/api/register", { method: "POST", body: { email, password, name: String(form.get("name") ?? "") } });
      }
      const result = await signIn("credentials", { email, password, redirect: false });
      if (!result || result.error) {
        setError({ message: "メールアドレスまたはパスワードが正しくありません", details: [] });
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError ? { message: err.message, details: err.details } : { message: "エラーが発生しました", details: [] },
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-bold text-brand-700">AI SNS Manager</h1>
        <p className="mt-1 text-sm text-slate-600">{mode === "login" ? "ログイン" : "アカウント登録"}</p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          {error && <Alert title={error.message} messages={error.details} />}
          {mode === "register" && (
            <div>
              <label className={label} htmlFor="name">お名前（任意）</label>
              <input id="name" name="name" className={input} autoComplete="name" />
            </div>
          )}
          <div>
            <label className={label} htmlFor="email">メールアドレス</label>
            <input id="email" name="email" type="email" required className={input} autoComplete="email" />
          </div>
          <div>
            <label className={label} htmlFor="password">パスワード{mode === "register" && "（8文字以上）"}</label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={mode === "register" ? 8 : undefined}
              className={input}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </div>
          <button type="submit" disabled={pending} className={`${btn.primary} w-full`}>
            {pending ? "処理中…" : mode === "login" ? "ログイン" : "登録してはじめる"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-slate-600">
          {mode === "login" ? (
            <>アカウントをお持ちでない方は <Link href="/register" className="font-semibold text-brand-600">新規登録</Link></>
          ) : (
            <>登録済みの方は <Link href="/login" className="font-semibold text-brand-600">ログイン</Link></>
          )}
        </p>
      </div>
    </div>
  );
}
