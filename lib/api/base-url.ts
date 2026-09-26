// OAuth のリダイレクトURIなどに使う公開URL。リバースプロキシ配下では AUTH_URL を設定する
export function appBaseUrl(request: Request): string {
  return (process.env.AUTH_URL ?? new URL(request.url).origin).replace(/\/$/, "");
}

export function oauthRedirectUri(request: Request, platform: string): string {
  return `${appBaseUrl(request)}/api/social/${platform.toLowerCase()}/callback`;
}
