import { describe, expect, it } from "vitest";
import { classifyHttpError } from "@/lib/social/http";
import { InstagramAdapter } from "@/lib/social/instagram/instagram-adapter";
import { ThreadsAdapter } from "@/lib/social/threads/threads-adapter";
import { buildOAuth1Header, percentEncode } from "@/lib/social/x/oauth1";
import { XAdapter } from "@/lib/social/x/x-adapter";

type Call = { url: string; method: string; headers: Record<string, string>; body: string };

// 実際のSNSには接続せず、送ったリクエストを記録して決まった応答を返す
function fakeFetch(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({
      url: String(input),
      method: init.method ?? "GET",
      headers: (init.headers as Record<string, string>) ?? {},
      body: init.body ? String(init.body) : "",
    });
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  }) as typeof fetch;
  return { impl, calls };
}

const noWait = { attempts: 3, intervalMs: 0, sleep: async () => {} };

describe("OAuth 1.0a 署名（X）", () => {
  it("RFC 3986 のパーセントエンコード", () => {
    expect(percentEncode("Hello Ladies + Gentlemen, a signed OAuth request!")).toBe(
      "Hello%20Ladies%20%2B%20Gentlemen%2C%20a%20signed%20OAuth%20request%21",
    );
    expect(percentEncode("~-._")).toBe("~-._");
  });

  it("X（旧Twitter）開発者ドキュメントの署名例と同じ署名になる", () => {
    const header = buildOAuth1Header(
      "POST",
      "https://api.twitter.com/1.1/statuses/update.json?include_entities=true",
      {
        consumerKey: "xvz1evFS4wEEPTGEFPHBog",
        consumerSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
        token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
        tokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
      },
      {
        formParams: { status: "Hello Ladies + Gentlemen, a signed OAuth request!" },
        nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
        timestamp: "1318622958",
      },
    );
    expect(header).toContain(`oauth_signature="${percentEncode("hCtSmYh+iHYCEqBWrE7C7hYmtUk=")}"`);
  });
});

const xCreds = { apiKey: "ck", apiSecret: "cs", accessToken: "at", accessTokenSecret: "ats" };

describe("XAdapter", () => {
  it("キー確認：GET /2/users/me を OAuth 1.0a で呼ぶ", async () => {
    const { impl, calls } = fakeFetch([{ body: { data: { id: "123", name: "Lounge", username: "loungeplus" } } }]);
    const account = await new XAdapter(impl).verifyCredentials(xCreds);
    expect(account).toEqual({ accountName: "@loungeplus", externalAccountId: "123" });
    expect(calls[0].url).toBe("https://api.x.com/2/users/me");
    expect(calls[0].headers.Authorization).toMatch(/^OAuth .*oauth_consumer_key="ck".*oauth_token="at"/);
  });

  it("投稿：POST /2/tweets に JSON {text} を送り、投稿URLを組み立てる", async () => {
    const { impl, calls } = fakeFetch([{ status: 201, body: { data: { id: "999", text: "hi" } } }]);
    const result = await new XAdapter(impl).createPost(
      { platform: "X", content: "こんにちは", idempotencyKey: "k" },
      xCreds,
      { accountName: "@loungeplus", externalAccountId: "123" },
    );
    expect(calls[0]).toMatchObject({ url: "https://api.x.com/2/tweets", method: "POST", body: JSON.stringify({ text: "こんにちは" }) });
    expect(calls[0].headers["Content-Type"]).toBe("application/json");
    expect(result).toMatchObject({ externalPostId: "999", externalUrl: "https://x.com/loungeplus/status/999" });
  });

  it("キーが足りないと AUTH エラー（通信しない）", async () => {
    const { impl, calls } = fakeFetch([]);
    await expect(new XAdapter(impl).verifyCredentials({ accessToken: "only" })).rejects.toMatchObject({ kind: "AUTH" });
    expect(calls).toHaveLength(0);
  });

  it.each([
    [401, "AUTH"],
    [403, "PERMISSION"],
    [429, "RATE_LIMIT"],
    [503, "TRANSIENT"],
    [400, "CONTENT"],
  ])("HTTP %i は %s に分類", async (status, kind) => {
    const { impl } = fakeFetch([{ status, body: { title: "error" } }]);
    await expect(new XAdapter(impl).verifyCredentials(xCreds)).rejects.toMatchObject({ kind });
  });
});

describe("ThreadsAdapter", () => {
  it("キー確認：GET me?fields=id,username", async () => {
    const { impl, calls } = fakeFetch([{ body: { id: "t1", username: "lounge" } }]);
    const account = await new ThreadsAdapter(impl).verifyCredentials({ accessToken: "secret-token" });
    expect(account).toEqual({ accountName: "@lounge", externalAccountId: "t1" });
    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe("https://graph.threads.com/me");
    expect(url.searchParams.get("fields")).toBe("id,username");
  });

  it("投稿：コンテナ作成 → 状態確認 → 公開 → 投稿URL取得", async () => {
    const { impl, calls } = fakeFetch([
      { body: { id: "c1" } },
      { body: { status: "FINISHED" } },
      { body: { id: "p1" } },
      { body: { permalink: "https://www.threads.net/@lounge/post/abc" } },
    ]);
    const result = await new ThreadsAdapter(impl, noWait).createPost(
      { platform: "THREADS", content: "こんにちは", idempotencyKey: "k" },
      { accessToken: "secret-token" },
      { accountName: "@lounge", externalAccountId: "t1" },
    );
    expect(calls.map((c) => `${c.method} ${c.url.split("?")[0]}`)).toEqual([
      "POST https://graph.threads.com/me/threads",
      "GET https://graph.threads.com/c1",
      "POST https://graph.threads.com/me/threads_publish",
      "GET https://graph.threads.com/p1",
    ]);
    const createBody = new URLSearchParams(calls[0].body);
    expect(createBody.get("media_type")).toBe("TEXT");
    expect(createBody.get("text")).toBe("こんにちは");
    expect(new URLSearchParams(calls[2].body).get("creation_id")).toBe("c1");
    expect(result).toMatchObject({ externalPostId: "p1", externalUrl: "https://www.threads.net/@lounge/post/abc" });
  });

  it("コンテナがエラーなら CONTENT エラー", async () => {
    const { impl } = fakeFetch([{ body: { id: "c1" } }, { body: { status: "ERROR", error_message: "bad" } }]);
    await expect(
      new ThreadsAdapter(impl, noWait).createPost(
        { platform: "THREADS", content: "x", idempotencyKey: "k" },
        { accessToken: "t" },
        { accountName: "@a", externalAccountId: "1" },
      ),
    ).rejects.toMatchObject({ kind: "CONTENT" });
  });

  it("Meta のエラーコード 190 は AUTH。例外メッセージにトークンを含めない", async () => {
    const { impl } = fakeFetch([{ status: 400, body: { error: { code: 190, message: "Invalid OAuth access token" } } }]);
    const err = await new ThreadsAdapter(impl).verifyCredentials({ accessToken: "secret-token" }).catch((e) => e);
    expect(err.kind).toBe("AUTH");
    expect(err.message).not.toContain("secret-token");
  });
});

describe("InstagramAdapter", () => {
  it("キー確認：GET me?fields=user_id,username（graph.instagram.com）", async () => {
    const { impl, calls } = fakeFetch([{ body: { id: "app-scoped", user_id: "178", username: "loungeplus" } }]);
    const account = await new InstagramAdapter(impl).verifyCredentials({ accessToken: "t" });
    expect(account).toEqual({ accountName: "@loungeplus", externalAccountId: "178" });
    expect(calls[0].url.startsWith("https://graph.instagram.com/me?")).toBe(true);
  });

  it("投稿：{id}/media → status_code 確認 → {id}/media_publish", async () => {
    const { impl, calls } = fakeFetch([
      { body: { id: "c1" } },
      { body: { status_code: "IN_PROGRESS" } },
      { body: { status_code: "FINISHED" } },
      { body: { id: "m1" } },
      { body: { permalink: "https://www.instagram.com/p/xyz/" } },
    ]);
    const result = await new InstagramAdapter(impl, noWait).createPost(
      { platform: "INSTAGRAM", content: "キャプション", mediaUrls: ["https://example.com/a.jpg"], idempotencyKey: "k" },
      { accessToken: "t" },
      { accountName: "@loungeplus", externalAccountId: "178" },
    );
    expect(calls.map((c) => `${c.method} ${c.url.split("?")[0]}`)).toEqual([
      "POST https://graph.instagram.com/178/media",
      "GET https://graph.instagram.com/c1",
      "GET https://graph.instagram.com/c1",
      "POST https://graph.instagram.com/178/media_publish",
      "GET https://graph.instagram.com/m1",
    ]);
    const body = new URLSearchParams(calls[0].body);
    expect(body.get("image_url")).toBe("https://example.com/a.jpg");
    expect(body.get("caption")).toBe("キャプション");
    expect(result).toMatchObject({ externalPostId: "m1", externalUrl: "https://www.instagram.com/p/xyz/" });
  });

  it("画像がなければ通信せずに CONTENT エラー", async () => {
    const { impl, calls } = fakeFetch([]);
    await expect(
      new InstagramAdapter(impl).createPost(
        { platform: "INSTAGRAM", content: "a", idempotencyKey: "k" },
        { accessToken: "t" },
        { accountName: "@a", externalAccountId: "1" },
      ),
    ).rejects.toMatchObject({ kind: "CONTENT" });
    expect(calls).toHaveLength(0);
  });
});

describe("HTTPエラーの分類", () => {
  it("Meta の code 190 は HTTP 400 でも AUTH", () => {
    expect(classifyHttpError(400, { error: { code: 190 } })).toBe("AUTH");
    expect(classifyHttpError(400, { error: { code: 100 } })).toBe("CONTENT");
  });
});
