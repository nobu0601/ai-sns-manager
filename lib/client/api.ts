// 画面から API を呼ぶ共通関数。エラー時はユーザー向けメッセージを持つ ApiError を投げる
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details: string[] = [],
  ) {
    super(message);
  }
}

export async function apiFetch<T = unknown>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? "GET",
      headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError("通信に失敗しました。ネットワーク接続を確認してください。", 0);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      data?.error?.message ?? "エラーが発生しました。時間をおいて再度お試しください。",
      res.status,
      data?.error?.details ?? [],
    );
  }
  return data as T;
}
