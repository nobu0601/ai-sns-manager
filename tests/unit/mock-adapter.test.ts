import { describe, expect, it } from "vitest";
import { MOCK_DENIED_CODE, MOCK_TRIGGERS, MockSocialAdapter } from "@/lib/social/mock/mock-adapter";
import { SocialPublishError } from "@/lib/social/errors";
import type { ConnectedAccount } from "@/lib/social/types";

const account: ConnectedAccount = {
  platform: "X",
  accountName: "@test",
  externalAccountId: "x1",
  accessToken: "token",
};
const post = (content: string) => ({ platform: "X" as const, content, idempotencyKey: "p1:X" });

describe("MockSocialAdapter", () => {
  it("OAuth: 認可URLは state 付きでコールバックへ戻る", async () => {
    const adapter = new MockSocialAdapter("X");
    const req = await adapter.getAuthorizationUrl({ state: "abc", redirectUri: "http://localhost:3000/api/social/x/callback" });
    const url = new URL(req.url);
    expect(url.pathname).toBe("/api/social/x/callback");
    expect(url.searchParams.get("state")).toBe("abc");
    expect(url.searchParams.get("code")).toMatch(/^mock-code-/);
  });

  it("OAuth: コールバックでアカウント情報とトークンを返す", async () => {
    const connected = await new MockSocialAdapter("THREADS").handleCallback({ code: "mock-code-1" });
    expect(connected.platform).toBe("THREADS");
    expect(connected.accessToken).toMatch(/^mock-access-/);
  });

  it("OAuth: 拒否コードなら AUTH エラー", async () => {
    await expect(new MockSocialAdapter("X").handleCallback({ code: MOCK_DENIED_CODE })).rejects.toMatchObject({ kind: "AUTH" });
  });

  it("投稿成功をシミュレーションする", async () => {
    const result = await new MockSocialAdapter("X").createPost(post("こんにちは"));
    expect(result.externalPostId).toMatch(/^mock-x-/);
    expect(result.externalUrl).toContain(result.externalPostId);
  });

  it.each([
    [MOCK_TRIGGERS.authError, "AUTH", false],
    [MOCK_TRIGGERS.contentError, "CONTENT", false],
    [MOCK_TRIGGERS.transientError, "TRANSIENT", true],
  ])("%s で %s エラー（retryable=%s）", async (trigger, kind, retryable) => {
    const err = await new MockSocialAdapter("X").createPost(post(`テスト ${trigger}`)).catch((e) => e);
    expect(err).toBeInstanceOf(SocialPublishError);
    expect(err.kind).toBe(kind);
    expect(err.retryable).toBe(retryable);
  });

  it("MOCK_TRANSIENT_FAILURE_RATE に従って一時失敗する", async () => {
    process.env.MOCK_TRANSIENT_FAILURE_RATE = "0.5";
    try {
      await expect(new MockSocialAdapter("X", () => 0.1).createPost(post("a"))).rejects.toMatchObject({ kind: "TRANSIENT" });
      await expect(new MockSocialAdapter("X", () => 0.9).createPost(post("a"))).resolves.toBeDefined();
    } finally {
      process.env.MOCK_TRANSIENT_FAILURE_RATE = "0";
    }
  });

  it("refreshToken で新しいトークンを返す", async () => {
    const refreshed = await new MockSocialAdapter("X").refreshToken(account);
    expect(refreshed.accessToken).not.toBe(account.accessToken);
  });
});
