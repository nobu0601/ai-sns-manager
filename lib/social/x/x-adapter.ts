import { PLATFORM_CAPABILITIES } from "../capabilities";
import { SocialPublishError } from "../errors";
import { callApi, type FetchLike } from "../http";
import { validateAgainstCapabilities } from "../validate";
import type {
  PlatformCredentials,
  PlatformPost,
  PublishedPost,
  SocialPlatformAdapter,
  ValidationResult,
  VerifiedAccount,
  XCredentials,
} from "../types";
import { buildOAuth1Header } from "./oauth1";

// X API v2。仕様は X 公式SDK（@xdevplatform/xdk）で確認：
//   ベースURL https://api.x.com / 投稿 POST /2/tweets（JSON {text}）→ {data:{id,text}}
//   自分の情報 GET /2/users/me → {data:{id,name,username}}
//   認証は OAuth 1.0a ユーザーコンテキスト（UserToken）
const BASE_URL = "https://api.x.com";

function toXCredentials(credentials: PlatformCredentials): XCredentials {
  const c = credentials as Partial<XCredentials>;
  if (!c.apiKey || !c.apiSecret || !c.accessToken || !c.accessTokenSecret) {
    throw new SocialPublishError("AUTH", "X", "missing X credentials");
  }
  return c as XCredentials;
}

export class XAdapter implements SocialPlatformAdapter {
  readonly platform = "X" as const;
  readonly capabilities = PLATFORM_CAPABILITIES.X;

  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  private headers(method: string, url: string, c: XCredentials): Record<string, string> {
    return {
      Authorization: buildOAuth1Header(method, url, {
        consumerKey: c.apiKey,
        consumerSecret: c.apiSecret,
        token: c.accessToken,
        tokenSecret: c.accessTokenSecret,
      }),
    };
  }

  async verifyCredentials(credentials: PlatformCredentials): Promise<VerifiedAccount> {
    const c = toXCredentials(credentials);
    const url = `${BASE_URL}/2/users/me`;
    const res = await callApi<{ data?: { id: string; username: string } }>("X", this.fetchImpl, url, {
      method: "GET",
      headers: this.headers("GET", url, c),
    });
    if (!res.data?.id) throw new SocialPublishError("AUTH", "X", "unexpected /2/users/me response", res);
    return { accountName: `@${res.data.username}`, externalAccountId: res.data.id };
  }

  async createPost(post: PlatformPost, credentials: PlatformCredentials, account: VerifiedAccount): Promise<PublishedPost> {
    const c = toXCredentials(credentials);
    const url = `${BASE_URL}/2/tweets`;
    const res = await callApi<{ data?: { id: string; text: string } }>("X", this.fetchImpl, url, {
      method: "POST",
      headers: { ...this.headers("POST", url, c), "Content-Type": "application/json" },
      body: JSON.stringify({ text: post.content }),
    });
    if (!res.data?.id) throw new SocialPublishError("UNKNOWN", "X", "unexpected /2/tweets response", res);
    const handle = account.accountName.replace(/^@/, "");
    return {
      externalPostId: res.data.id,
      externalUrl: `https://x.com/${handle}/status/${res.data.id}`,
      publishedAt: new Date(),
      raw: res,
    };
  }

  async validatePost(post: PlatformPost): Promise<ValidationResult> {
    return validateAgainstCapabilities(post, this.capabilities);
  }
}
