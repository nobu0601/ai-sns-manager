import { createHash, randomUUID } from "node:crypto";
import type { Platform } from "@prisma/client";
import { PLATFORM_CAPABILITIES } from "../capabilities";
import { SocialPublishError } from "../errors";
import { validateAgainstCapabilities } from "../validate";
import type {
  PlatformCredentials,
  PlatformPost,
  PublishedPost,
  SocialPlatformAdapter,
  ValidationResult,
  VerifiedAccount,
} from "../types";

// 本物のSNS APIを呼ばずに、キー確認・投稿成功・投稿失敗をシミュレーションする。
// 投稿本文に以下のタグを含めると、対応する失敗を再現できる。
export const MOCK_TRIGGERS = {
  authError: "#mock-auth-error",
  contentError: "#mock-content-error",
  transientError: "#mock-transient-error",
} as const;

// キーにこの文字列を含めると「無効なキー」として扱う
export const MOCK_INVALID_KEY = "invalid";

export class MockSocialAdapter implements SocialPlatformAdapter {
  readonly capabilities;

  constructor(
    readonly platform: Platform,
    private readonly random: () => number = Math.random,
  ) {
    this.capabilities = PLATFORM_CAPABILITIES[platform];
  }

  async verifyCredentials(credentials: PlatformCredentials): Promise<VerifiedAccount> {
    const values = Object.values(credentials).map(String);
    if (values.length === 0 || values.some((v) => !v.trim() || v.includes(MOCK_INVALID_KEY))) {
      throw new SocialPublishError("AUTH", this.platform, "Mock: invalid credentials (code 190)");
    }
    // 同じキーなら同じアカウント、違うキーなら別アカウントとして扱う
    const id = createHash("sha256").update(values.join("|")).digest("hex").slice(0, 8);
    return { accountName: `@mock_${this.platform.toLowerCase()}_${id.slice(0, 4)}`, externalAccountId: `mock-${id}` };
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

  async validatePost(post: PlatformPost): Promise<ValidationResult> {
    return validateAgainstCapabilities(post, this.capabilities);
  }
}
