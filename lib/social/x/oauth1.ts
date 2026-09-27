import { createHmac, randomBytes } from "node:crypto";

// OAuth 1.0a（HMAC-SHA1）の Authorization ヘッダーを作る。
// X 公式SDK（@xdevplatform/xdk）の OAuth1 実装と同じ手順：
// 署名対象 = メソッド & URL（クエリなし）& 「OAuthパラメータ＋クエリ（＋フォームbody）」を並べた文字列。JSON の body は含めない
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export type OAuth1Keys = { consumerKey: string; consumerSecret: string; token: string; tokenSecret: string };

export function buildOAuth1Header(
  method: string,
  url: string,
  keys: OAuth1Keys,
  options: { formParams?: Record<string, string>; nonce?: string; timestamp?: string } = {},
): string {
  const parsed = new URL(url);
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: keys.consumerKey,
    oauth_nonce: options.nonce ?? randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: options.timestamp ?? String(Math.floor(Date.now() / 1000)),
    oauth_token: keys.token,
    oauth_version: "1.0",
  };
  const all: [string, string][] = [
    ...Object.entries(oauthParams),
    ...[...parsed.searchParams.entries()],
    ...Object.entries(options.formParams ?? {}),
  ];
  const paramString = all
    .map(([k, v]) => [percentEncode(k), percentEncode(v)] as const)
    .sort(([ak, av], [bk, bv]) => (ak === bk ? (av < bv ? -1 : 1) : ak < bk ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const baseUrl = `${parsed.origin}${parsed.pathname}`;
  const signatureBase = `${method.toUpperCase()}&${percentEncode(baseUrl)}&${percentEncode(paramString)}`;
  const signingKey = `${percentEncode(keys.consumerSecret)}&${percentEncode(keys.tokenSecret)}`;
  const signature = createHmac("sha1", signingKey).update(signatureBase).digest("base64");

  const header = { ...oauthParams, oauth_signature: signature };
  return (
    "OAuth " +
    Object.entries(header)
      .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
      .join(", ")
  );
}
