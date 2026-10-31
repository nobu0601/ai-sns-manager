import { PLATFORM_CAPABILITIES } from "../capabilities";
import { SocialPublishError } from "../errors";
import type { FetchLike } from "../http";
import { GraphClient, collectPerPost, toRecentPosts, withVersion } from "../meta/graph";
import { primaryMedia } from "../media";
import { readInsights, toMetricValues } from "../metrics/values";
import { validateAgainstCapabilities } from "../validate";
import type {
  MetricsTarget,
  PlatformCredentials,
  PlatformPost,
  PostMetricsResult,
  RecentPost,
  PublishedPost,
  SocialPlatformAdapter,
  TokenCredentials,
  ValidationResult,
  VerifiedAccount,
} from "../types";

// Threads API。仕様は Meta 公式サンプル（github.com/fbsamples/threads_api）で確認：
//   ベースURL https://graph.threads.com/（バージョンは任意）
//   自分の情報 GET me?fields=id,username
//   投稿 POST me/threads（media_type=TEXT|IMAGE|VIDEO, text, image_url / video_url）→ コンテナID → POST me/threads_publish（creation_id）
//   コンテナの状態 GET {id}?fields=status,error_message / 投稿のURL GET {id}?fields=permalink
//   分析（権限 threads_manage_insights が必要）：
//     投稿 GET {id}/insights?metric=views,likes,replies,reposts,quotes,shares → data[].values[0].value
//     フォロワー数 GET me/threads_insights?metric=followers_count → data[].total_value.value
//   過去の投稿 GET me/threads?fields=id,text,timestamp,permalink&limit=… → data[]（公式サンプルの /threads と同じ）
const POST_METRICS = "views,likes,replies,reposts,quotes,shares";
type WaitOptions = Parameters<GraphClient["waitForContainer"]>[2];
const VIDEO_WAIT = { attempts: 60, intervalMs: 5000 };

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
    const media = primaryMedia(post);
    const params: Record<string, string> = { text: post.content };
    if (!media) params.media_type = "TEXT";
    else if (media.type === "IMAGE") Object.assign(params, { media_type: "IMAGE", image_url: media.url });
    else Object.assign(params, { media_type: "VIDEO", video_url: media.url });

    const container = await graph.post<{ id?: string }>("me/threads", params);
    if (!container.id) throw new SocialPublishError("UNKNOWN", "THREADS", "no container id", container);
    // 動画は処理に時間がかかるため、長めに待つ
    await graph.waitForContainer(container.id, "status", media?.type === "VIDEO" ? { ...VIDEO_WAIT, ...this.waitOptions } : this.waitOptions);
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

  async fetchPostMetrics(targets: MetricsTarget[], credentials: PlatformCredentials): Promise<PostMetricsResult> {
    const graph = this.client(credentials);
    return collectPerPost(targets, async (id) => {
      const raw = readInsights(await graph.get(`${id}/insights`, { metric: POST_METRICS }));
      return toMetricValues(raw, {
        views: ["views"],
        likes: ["likes"],
        comments: ["replies"],
        shares: ["reposts", "quotes", "shares"],
      });
    });
  }

  async fetchFollowerCount(credentials: PlatformCredentials): Promise<number> {
    const raw = readInsights(await this.client(credentials).get("me/threads_insights", { metric: "followers_count" }));
    if (typeof raw.followers_count !== "number") throw new SocialPublishError("UNKNOWN", "THREADS", "no followers_count");
    return raw.followers_count;
  }

  async fetchRecentPosts(credentials: PlatformCredentials, _account: VerifiedAccount, limit: number): Promise<RecentPost[]> {
    const res = await this.client(credentials).get<{ data?: { id?: string; text?: string; timestamp?: string; permalink?: string }[] }>(
      "me/threads",
      { fields: "id,text,timestamp,permalink", limit: String(limit) },
    );
    return toRecentPosts((res.data ?? []).map((p) => ({ id: p.id, text: p.text, timestamp: p.timestamp, permalink: p.permalink })));
  }

  async validatePost(post: PlatformPost): Promise<ValidationResult> {
    return validateAgainstCapabilities(post, this.capabilities);
  }
}
