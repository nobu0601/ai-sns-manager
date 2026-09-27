import { PLATFORM_CAPABILITIES } from "../capabilities";
import { SocialPublishError } from "../errors";
import type { FetchLike } from "../http";
import { GraphClient, withVersion } from "../meta/graph";
import { validateAgainstCapabilities } from "../validate";
import type {
  PlatformCredentials,
  PlatformPost,
  PublishedPost,
  SocialPlatformAdapter,
  TokenCredentials,
  ValidationResult,
  VerifiedAccount,
} from "../types";

// Instagram API with Instagram Login（プロアカウント向け）。
// 公式ドキュメント（Content Publishing / Media Publish）の内容：
//   ホスト graph.instagram.com
//   画像の投稿：POST {ig-user-id}/media（image_url, caption）→ コンテナID
//             GET {container-id}?fields=status_code が FINISHED になるまで待つ
//             POST {ig-user-id}/media_publish（creation_id）
//   必要な権限：instagram_business_basic, instagram_business_content_publish
type WaitOptions = Parameters<GraphClient["waitForContainer"]>[2];

export class InstagramAdapter implements SocialPlatformAdapter {
  readonly platform = "INSTAGRAM" as const;
  readonly capabilities = PLATFORM_CAPABILITIES.INSTAGRAM;

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly waitOptions: WaitOptions = {},
  ) {}

  private client(credentials: PlatformCredentials): GraphClient {
    const token = (credentials as Partial<TokenCredentials>).accessToken;
    if (!token) throw new SocialPublishError("AUTH", "INSTAGRAM", "missing access token");
    return new GraphClient("INSTAGRAM", withVersion("https://graph.instagram.com", process.env.INSTAGRAM_API_VERSION), token, this.fetchImpl);
  }

  async verifyCredentials(credentials: PlatformCredentials): Promise<VerifiedAccount> {
    const me = await this.client(credentials).get<{ id?: string; user_id?: string; username?: string }>("me", {
      fields: "user_id,username",
    });
    const igUserId = me.user_id ?? me.id;
    if (!igUserId) throw new SocialPublishError("AUTH", "INSTAGRAM", "unexpected me response", me);
    return { accountName: `@${me.username ?? igUserId}`, externalAccountId: igUserId };
  }

  async createPost(post: PlatformPost, credentials: PlatformCredentials, account: VerifiedAccount): Promise<PublishedPost> {
    const imageUrl = post.mediaUrls?.[0];
    if (!imageUrl) throw new SocialPublishError("CONTENT", "INSTAGRAM", "image_url is required");
    const graph = this.client(credentials);
    const igUserId = account.externalAccountId;

    const container = await graph.post<{ id?: string }>(`${igUserId}/media`, { image_url: imageUrl, caption: post.content });
    if (!container.id) throw new SocialPublishError("UNKNOWN", "INSTAGRAM", "no container id", container);
    await graph.waitForContainer(container.id, "status_code", this.waitOptions);
    const published = await graph.post<{ id?: string }>(`${igUserId}/media_publish`, { creation_id: container.id });
    if (!published.id) throw new SocialPublishError("UNKNOWN", "INSTAGRAM", "no published id", published);

    const permalink = await graph
      .get<{ permalink?: string }>(published.id, { fields: "permalink" })
      .then((r) => r.permalink)
      .catch(() => undefined);
    return {
      externalPostId: published.id,
      externalUrl: permalink,
      publishedAt: new Date(),
      raw: { containerId: container.id, id: published.id },
    };
  }

  async validatePost(post: PlatformPost): Promise<ValidationResult> {
    return validateAgainstCapabilities(post, this.capabilities);
  }
}
