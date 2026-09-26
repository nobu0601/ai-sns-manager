import { randomUUID } from "node:crypto";
import type { Platform } from "@prisma/client";
import { PLATFORM_CAPABILITIES } from "../capabilities";
import { SocialPublishError } from "../errors";
import { validateAgainstCapabilities } from "../validate";
import type {
  AuthorizationRequest,
  ConnectedAccount,
  PlatformPost,
  PublishedPost,
  SocialPlatformAdapter,
  ValidationResult,
} from "../types";

// 本物のSNS APIを呼ばずに OAuth・投稿成功・投稿失敗をシミュレーションする。
// 投稿本文に以下のタグを含めると、対応する失敗を再現できる。
export const MOCK_TRIGGERS = {
  authError: "#mock-auth-error",
  contentError: "#mock-content-error",
  transientError: "#mock-transient-error",
} as const;

export const MOCK_DENIED_CODE = "mock-denied";

export class MockSocialAdapter implements SocialPlatformAdapter {
  readonly capabilities;

  constructor(
    readonly platform: Platform,
    private readonly random: () => number = Math.random,
  ) {
    this.capabilities = PLATFORM_CAPABILITIES[platform];
  }

  async getAuthorizationUrl(input: { state: string; redirectUri: string }): Promise<AuthorizationRequest> {
    // 本物の認可画面の代わりに、自アプリのコールバックへ直接戻す
    const url = new URL(input.redirectUri);
    url.searchParams.set("code", `mock-code-${randomUUID()}`);
    url.searchParams.set("state", input.state);
    return { url: url.toString(), state: input.state };
  }

  async handleCallback(input: { code: string }): Promise<ConnectedAccount> {
    if (input.code === MOCK_DENIED_CODE) {
      throw new SocialPublishError("AUTH", this.platform, "Mock: 認可が拒否されました");
    }
    const handle = this.platform.toLowerCase();
    return {
      platform: this.platform,
      accountName: `@loungeplus_${handle}_mock`,
      externalAccountId: `mock-${handle}-account`,
      accessToken: `mock-access-${randomUUID()}`,
      refreshToken: `mock-refresh-${randomUUID()}`,
      tokenExpiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      scopes: ["mock.write"],
    };
  }

  async refreshToken(account: ConnectedAccount): Promise<ConnectedAccount> {
    return {
      ...account,
      accessToken: `mock-access-${randomUUID()}`,
      tokenExpiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    };
  }

  async createPost(post: PlatformPost): Promise<PublishedPost> {
    if (post.content.includes(MOCK_TRIGGERS.authError)) {
      throw new SocialPublishError("AUTH", this.platform, "Mock: token expired (code 190)");
    }
    if (post.content.includes(MOCK_TRIGGERS.contentError)) {
      throw new SocialPublishError("CONTENT", this.platform, "Mock: invalid content");
    }
    if (post.content.includes(MOCK_TRIGGERS.transientError)) {
      throw new SocialPublishError("TRANSIENT", this.platform, "Mock: 503 Service Unavailable");
    }
    const rate = Number(process.env.MOCK_TRANSIENT_FAILURE_RATE ?? 0);
    if (rate > 0 && this.random() < rate) {
      throw new SocialPublishError("TRANSIENT", this.platform, "Mock: random transient failure");
    }

    const externalPostId = `mock-${this.platform.toLowerCase()}-${randomUUID()}`;
    return {
      externalPostId,
      externalUrl: `https://mock.example.com/${this.platform.toLowerCase()}/${externalPostId}`,
      publishedAt: new Date(),
      raw: { mock: true, idempotencyKey: post.idempotencyKey },
    };
  }

  async deletePost(): Promise<void> {
    // Mock では何もしない
  }

  async validatePost(post: PlatformPost): Promise<ValidationResult> {
    return validateAgainstCapabilities(post, this.capabilities);
  }
}
