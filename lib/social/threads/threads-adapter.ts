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

// Threads API。仕様は Meta 公式サンプル（github.com/fbsamples/threads_api）で確認：
//   ベースURL https://graph.threads.com/（バージョンは任意）
//   自分の情報 GET me?fields=id,username
//   投稿 POST me/threads（media_type=TEXT, text）→ コンテナID → POST me/threads_publish（creation_id）
//   コンテナの状態 GET {id}?fields=status,error_message / 投稿のURL GET {id}?fields=permalink
type WaitOptions = Parameters<GraphClient["waitForContainer"]>[2];

export class ThreadsAdapter implements SocialPlatformAdapter {
  readonly platform = "THREADS" as const;
  readonly capabilities = PLATFORM_CAPABILITIES.THREADS;

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly waitOptions: WaitOptions = {},
  ) {}

  private client(credentials: PlatformCredentials): GraphClient {
    const token = (credentials as Partial<TokenCredentials>).accessToken;
    if (!token) throw new SocialPublishError("AUTH", "THREADS", "missing access token");
    return new GraphClient("THREADS", withVersion("https://graph.threads.com", process.env.THREADS_API_VERSION), token, this.fetchImpl);
  }

  async verifyCredentials(credentials: PlatformCredentials): Promise<VerifiedAccount> {
    const me = await this.client(credentials).get<{ id?: string; username?: string }>("me", { fields: "id,username" });
    if (!me.id) throw new SocialPublishError("AUTH", "THREADS", "unexpected me response", me);
    return { accountName: `@${me.username ?? me.id}`, externalAccountId: me.id };
  }

  async createPost(post: PlatformPost, credentials: PlatformCredentials, account: VerifiedAccount): Promise<PublishedPost> {
    const graph = this.client(credentials);
    const container = await graph.post<{ id?: string }>("me/threads", { media_type: "TEXT", text: post.content });
    if (!container.id) throw new SocialPublishError("UNKNOWN", "THREADS", "no container id", container);
    await graph.waitForContainer(container.id, "status", this.waitOptions);
    const published = await graph.post<{ id?: string }>("me/threads_publish", { creation_id: container.id });
    if (!published.id) throw new SocialPublishError("UNKNOWN", "THREADS", "no published id", published);

    // 投稿URLは取得できなくても投稿自体は成功しているため、失敗しても続行する
    const permalink = await graph
      .get<{ permalink?: string }>(published.id, { fields: "permalink" })
      .then((r) => r.permalink)
      .catch(() => undefined);
    return {
      externalPostId: published.id,
      externalUrl: permalink ?? `https://www.threads.net/${account.accountName}`,
      publishedAt: new Date(),
      raw: { containerId: container.id, id: published.id },
    };
  }

  async validatePost(post: PlatformPost): Promise<ValidationResult> {
    return validateAgainstCapabilities(post, this.capabilities);
  }
}
