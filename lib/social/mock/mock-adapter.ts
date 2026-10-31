import { createHash, randomUUID } from "node:crypto";
import type { Platform } from "@prisma/client";
import { PLATFORM_CAPABILITIES } from "../capabilities";
import { SocialPublishError } from "../errors";
import { validateAgainstCapabilities } from "../validate";
import type {
  MetricsTarget,
  PlatformCredentials,
  PlatformPost,
  PostMetricsResult,
  RecentPost,
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
// キーにこの文字列を含めると、分析の数値を取得する権限がないアカウントとして扱う（X のプラン不足などの再現）
export const MOCK_NO_METRICS_KEY = "nometrics";

// 投稿IDから決まる 0〜1 の値（同じ投稿なら毎回同じ数値になる）
function seeded(id: string, salt: string): number {
  return parseInt(createHash("sha256").update(`${salt}:${id}`).digest("hex").slice(0, 8), 16) / 0xffffffff;
}

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

  private assertMetricsAllowed(credentials: PlatformCredentials) {
    if (Object.values(credentials).some((v) => String(v).includes(MOCK_NO_METRICS_KEY))) {
      throw new SocialPublishError("PERMISSION", this.platform, "Mock: metrics not available for this plan (403)");
    }
  }

  // 投稿IDから決まる架空の数値。SNS ごとに、実際の API が返す指標だけを埋める（返さない指標は null）
  async fetchPostMetrics(targets: MetricsTarget[], credentials: PlatformCredentials): Promise<PostMetricsResult> {
    this.assertMetricsAllowed(credentials);
    const result: PostMetricsResult = new Map();
    for (const { externalPostId: id } of targets) {
      const views = 200 + Math.round(seeded(id, "views") * 3000);
      const likes = Math.round(views * (0.01 + seeded(id, "likes") * 0.06));
      const comments = Math.round(likes * seeded(id, "comments") * 0.3);
      const shares = Math.round(likes * seeded(id, "shares") * 0.2);
      const saves = this.platform === "THREADS" ? null : Math.round(likes * seeded(id, "saves") * 0.4);
      const reach = this.platform === "INSTAGRAM" ? Math.round(views * 0.7) : null;
      const raw: Record<string, number> = { views, likes, comments, shares, ...(saves !== null ? { saves } : {}), ...(reach !== null ? { reach } : {}) };
      result.set(id, { views, reach, likes, comments, shares, saves, clicks: null, raw });
    }
    return result;
  }

  async fetchFollowerCount(credentials: PlatformCredentials, account: VerifiedAccount): Promise<number> {
    this.assertMetricsAllowed(credentials);
    // 日ごとに少しずつ増える架空のフォロワー数
    const days = Math.floor(Date.now() / 86_400_000);
    return 500 + Math.round(seeded(account.externalAccountId, "followers") * 2000) + (days % 365) * 2;
  }

  // SNS にある過去の投稿（架空）。アカウントごとに決まった2件を返す
  async fetchRecentPosts(_credentials: PlatformCredentials, account: VerifiedAccount, limit: number): Promise<RecentPost[]> {
    const day = 86_400_000;
    const base = Date.UTC(2026, 9, 1);
    return [
      { externalPostId: `${account.externalAccountId}-past-1`, text: "（Mock）以前の投稿：雨の日でも静かに作業できる場所をご紹介しました。", publishedAt: new Date(base - day), permalink: null },
      { externalPostId: `${account.externalAccountId}-past-2`, text: "（Mock）以前の投稿：ドリンク飲み放題で、長時間の作業も快適です。", publishedAt: new Date(base - 3 * day), permalink: null },
    ].slice(0, limit);
  }

  async validatePost(post: PlatformPost): Promise<ValidationResult> {
    return validateAgainstCapabilities(post, this.capabilities);
  }
}
