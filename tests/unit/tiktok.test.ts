import { describe, expect, it } from "vitest";
import { choosePrivacyLevel, planChunks, TikTokAdapter } from "@/lib/social/tiktok/tiktok-adapter";
import { exchangeCode, needsRefresh, refreshTokens } from "@/lib/social/tiktok/tiktok-api";
import { authorizeUrl } from "@/lib/social/tiktok/tiktok-connect";
import type { PlatformCredentials, SocialPlatformAdapter } from "@/lib/social/types";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

// 実際の TikTok には接続せず、送ったリクエストを記録して決まった応答を返す
function fakeFetch(responses: Array<{ status?: number; body?: unknown; bytes?: Uint8Array; headers?: Record<string, string> }>) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), method: init.method ?? "GET", headers: (init.headers as Record<string, string>) ?? {}, body: init.body });
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    if (next.bytes) return new Response(new Blob([next.bytes as unknown as ArrayBuffer]), { status: next.status ?? 200, headers: next.headers });
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), { status: next.status ?? 200 });
  }) as typeof fetch;
  return { impl, calls };
}

const far = new Date(Date.now() + 86400_000).toISOString();
const creds = { accessToken: "act", refreshToken: "rft", openId: "open-1", accessTokenExpiresAt: far, refreshTokenExpiresAt: far } as unknown as PlatformCredentials;
const ok = { error: { code: "ok", message: "" } };
const noWait = { attempts: 3, intervalMs: 0 };

describe("TikTok のログイン（Login Kit）とトークン", () => {
  it("許可画面の URL：client_key・scope（user.info.basic,video.publish）・redirect_uri・state", () => {
    const url = new URL(authorizeUrl("ck", "https://app.example.com/api/social/tiktok/callback", "st"));
    expect(url.origin + url.pathname).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_key: "ck",
      response_type: "code",
      scope: "user.info.basic,video.publish",
      redirect_uri: "https://app.example.com/api/social/tiktok/callback",
      state: "st",
    });
  });

  it("code の交換と更新は POST /v2/oauth/token/（form）。期限を日時にして返す", async () => {
    const now = new Date("2026-10-31T00:00:00Z");
    const body = { access_token: "a", refresh_token: "r", open_id: "o", expires_in: 86400, refresh_expires_in: 31536000, scope: "user.info.basic,video.publish" };
    const { impl, calls } = fakeFetch([{ body }, { body }]);
    const c = await exchangeCode({ clientKey: "ck", clientSecret: "cs" }, "code1", "https://x/cb", { fetchImpl: impl, now });
    expect(calls[0].url).toBe("https://open.tiktokapis.com/v2/oauth/token/");
    expect(Object.fromEntries(calls[0].body as URLSearchParams)).toEqual({
      client_key: "ck",
      client_secret: "cs",
      code: "code1",
      grant_type: "authorization_code",
      redirect_uri: "https://x/cb",
    });
    expect(c).toMatchObject({ accessToken: "a", refreshToken: "r", openId: "o", accessTokenExpiresAt: "2026-11-01T00:00:00.000Z" });
    await refreshTokens({ clientKey: "ck", clientSecret: "cs" }, "r", { fetchImpl: impl, now });
    expect(Object.fromEntries(calls[1].body as URLSearchParams)).toMatchObject({ grant_type: "refresh_token", refresh_token: "r" });
  });

  it("トークンが返らないときは接続エラー（AUTH）", async () => {
    const { impl } = fakeFetch([{ body: { error: "invalid_grant", error_description: "expired" } }]);
    await expect(refreshTokens({ clientKey: "ck", clientSecret: "cs" }, "r", { fetchImpl: impl })).rejects.toMatchObject({ kind: "AUTH" });
  });

  it("期限の5分前になったら更新する", () => {
    const now = new Date("2026-10-31T00:00:00Z");
    const c = (min: number) => ({ accessTokenExpiresAt: new Date(now.getTime() + min * 60_000).toISOString() }) as never;
    expect(needsRefresh(c(10), now)).toBe(false);
    expect(needsRefresh(c(4), now)).toBe(true);
  });
});

describe("TikTok の動画投稿（Content Posting API・Direct Post）", () => {
  it("5MB 未満は1回、それ以上は 10MB ずつで端数は最後に含める", () => {
    expect(planChunks(1000)).toEqual({ chunkSize: 1000, count: 1, ranges: [[0, 999]] });
    const mb = 1024 * 1024;
    const p = planChunks(25 * mb + 5);
    expect(p.chunkSize).toBe(10 * mb);
    expect(p.count).toBe(2);
    expect(p.ranges).toEqual([
      [0, 10 * mb - 1],
      [10 * mb, 25 * mb + 4],
    ]);
  });

  it("公開範囲：設定した範囲が選べなければ「自分だけに表示」", () => {
    expect(choosePrivacyLevel(["PUBLIC_TO_EVERYONE", "SELF_ONLY"], "SELF_ONLY")).toBe("SELF_ONLY");
    expect(choosePrivacyLevel(["PUBLIC_TO_EVERYONE", "SELF_ONLY"], "PUBLIC_TO_EVERYONE")).toBe("PUBLIC_TO_EVERYONE");
    expect(choosePrivacyLevel(["SELF_ONLY"], "PUBLIC_TO_EVERYONE")).toBe("SELF_ONLY");
  });

  it("投稿者の情報 → 動画の取得 → 投稿の開始（FILE_UPLOAD）→ PUT で送信 → 完了まで状態を確認", async () => {
    const video = new Uint8Array(1234);
    const { impl, calls } = fakeFetch([
      { body: { data: { creator_username: "lounge", privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"] }, ...ok } },
      { bytes: video, headers: { "content-type": "video/mp4" } },
      { body: { data: { publish_id: "pub-1", upload_url: "https://upload.example/u1" }, ...ok } },
      { status: 201 },
      { body: { data: { status: "PROCESSING_UPLOAD" }, ...ok } },
      { body: { data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: [] }, ...ok } },
    ]);
    const adapter: SocialPlatformAdapter = new TikTokAdapter(impl, async () => {}, noWait);
    const result = await adapter.createPost(
      { platform: "TIKTOK", content: "週末の過ごし方 #大阪", mediaUrls: ["https://cdn.example/v.mp4"], mediaType: "VIDEO", idempotencyKey: "k" },
      creds,
      { accountName: "@lounge", externalAccountId: "open-1" },
    );
    expect(calls[0].url).toBe("https://open.tiktokapis.com/v2/post/publish/creator_info/query/");
    expect(calls[0].headers.Authorization).toBe("Bearer act");
    expect(calls[2].url).toBe("https://open.tiktokapis.com/v2/post/publish/video/init/");
    expect(JSON.parse(calls[2].body as string)).toEqual({
      post_info: { title: "週末の過ごし方 #大阪", privacy_level: "SELF_ONLY", brand_content_toggle: false },
      source_info: { source: "FILE_UPLOAD", video_size: 1234, chunk_size: 1234, total_chunk_count: 1 },
    });
    expect(calls[3]).toMatchObject({ url: "https://upload.example/u1", method: "PUT" });
    expect(calls[3].headers["Content-Range"]).toBe("bytes 0-1233/1234");
    expect(JSON.parse(calls[4].body as string)).toEqual({ publish_id: "pub-1" });
    expect(result.externalPostId).toBe("pub-1");
  });

  it("画像は投稿できない（動画のみ）", async () => {
    const adapter = new TikTokAdapter(fakeFetch([]).impl);
    const v = await adapter.validatePost({ platform: "TIKTOK", content: "a", mediaUrls: ["https://cdn.example/a.jpg"], mediaType: "IMAGE", idempotencyKey: "k" });
    expect(v.errors.join()).toContain("画像の投稿には対応していません");
  });

  it("審査前のアプリの制限・期限切れは、それぞれ権限エラー・接続エラーになる", async () => {
    const forbidden = fakeFetch([{ status: 403, body: { error: { code: "unaudited_client_can_only_post_to_private_accounts" } } }]);
    await expect(new TikTokAdapter(forbidden.impl).verifyCredentials(creds)).rejects.toMatchObject({ kind: "PERMISSION" });
    const expired = fakeFetch([{ status: 401, body: { error: { code: "access_token_invalid" } } }]);
    await expect(new TikTokAdapter(expired.impl).verifyCredentials(creds)).rejects.toMatchObject({ kind: "AUTH" });
  });

  it("TikTok 側の処理が失敗したら、その理由で失敗にする", async () => {
    const { impl } = fakeFetch([
      { body: { data: { privacy_level_options: ["SELF_ONLY"] }, ...ok } },
      { bytes: new Uint8Array(10), headers: { "content-type": "video/mp4" } },
      { body: { data: { publish_id: "p", upload_url: "https://u" }, ...ok } },
      { status: 201 },
      { body: { data: { status: "FAILED", fail_reason: "duration_check_failed" }, ...ok } },
    ]);
    await expect(
      (new TikTokAdapter(impl, async () => {}, noWait) as SocialPlatformAdapter).createPost(
        { platform: "TIKTOK", content: "x", mediaUrls: ["https://cdn.example/v.mp4"], mediaType: "VIDEO", idempotencyKey: "k" },
        creds,
        { accountName: "@a", externalAccountId: "o" },
      ),
    ).rejects.toMatchObject({ kind: "CONTENT", message: "TikTok publish failed: duration_check_failed" });
  });
});
