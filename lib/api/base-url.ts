// アプリの公開URL。リバースプロキシ配下では AUTH_URL を設定する
export function appBaseUrl(request: Request): string {
  return (process.env.AUTH_URL ?? new URL(request.url).origin).replace(/\/$/, "");
}

