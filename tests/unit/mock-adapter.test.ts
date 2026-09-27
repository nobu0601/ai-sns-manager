import { describe, expect, it } from "vitest";
import { MOCK_INVALID_KEY, MOCK_TRIGGERS, MockSocialAdapter } from "@/lib/social/mock/mock-adapter";
import { SocialPublishError } from "@/lib/social/errors";

const post = (content: string) => ({ platform: "X" as const, content, idempotencyKey: "p1:a1" });
const account = { accountName: "@mock", externalAccountId: "mock-1" };
const creds = { accessToken: "token-abc" };

describe("MockSocialAdapter", () => {
  it("キー確認：同じキーは同じアカウント、違うキーは別アカウントになる", async () => {
    const adapter = new MockSocialAdapter("THREADS");
    const a = await adapter.verifyCredentials({ accessToken: "key-1" });
    const b = await adapter.verifyCredentials({ accessToken: "key-1" });
    const c = await adapter.verifyCredentials({ accessToken: "key-2" });
    expect(a).toEqual(b);
    expect(a.externalAccountId).not.toBe(c.externalAccountId);
    expect(a.accountName).toMatch(/^@mock_threads_/);
  });

  it("キー確認：無効なキー・空のキーは AUTH エラー", async () => {
    const adapter = new MockSocialAdapter("X");
    await expect(adapter.verifyCredentials({ accessToken: `x-${MOCK_INVALID_KEY}` })).rejects.toMatchObject({ kind: "AUTH" });
    await expect(adapter.verifyCredentials({ accessToken: " " })).rejects.toMatchObject({ kind: "AUTH" });
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

  it("Instagram は画像なしだと投稿前チェックでエラー", async () => {
    const result = await new MockSocialAdapter("INSTAGRAM").validatePost({ platform: "INSTAGRAM", content: "a", idempotencyKey: "k" });
    expect(result.valid).toBe(false);
    void creds;
    void account;
  });
});
