import type { Platform } from "@prisma/client";

// 画面の入力欄の定義（アカウント追加・キー更新で使う）。サーバー側の検証にも使う
export type CredentialField = { key: string; label: string; help?: string };

export const CREDENTIAL_FIELDS: Record<Platform, CredentialField[]> = {
  X: [
    { key: "apiKey", label: "API Key", help: "X 開発者ポータルの「Keys and tokens」→ Consumer Keys" },
    { key: "apiSecret", label: "API Key Secret" },
    { key: "accessToken", label: "Access Token", help: "同じ画面の Authentication Tokens。権限は Read and Write で発行してください" },
    { key: "accessTokenSecret", label: "Access Token Secret" },
  ],
  THREADS: [
    { key: "accessToken", label: "アクセストークン", help: "Meta のアプリで発行した Threads の長期アクセストークン（threads_basic と threads_content_publish の権限が必要）" },
  ],
  INSTAGRAM: [
    { key: "accessToken", label: "アクセストークン", help: "Instagram ログインで発行した長期アクセストークン（プロアカウントのみ。instagram_business_basic と instagram_business_content_publish の権限が必要）" },
  ],
};

// 画面表示用に末尾4文字だけ残す
export function credentialHint(value: string): string {
  const v = value.trim();
  return v.length <= 4 ? "••••" : `••••${v.slice(-4)}`;
}
