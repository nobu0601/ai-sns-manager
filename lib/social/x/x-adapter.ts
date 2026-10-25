import { PLATFORM_CAPABILITIES } from "../capabilities";
import { SocialPublishError } from "../errors";
import { callApi, type FetchLike } from "../http";
import { primaryMedia } from "../media";
import { toMetricValues } from "../metrics/values";
import { validateAgainstCapabilities } from "../validate";
import type {
  MetricsTarget,
  PlatformCredentials,
  PlatformPost,
  PostMetricsResult,
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
//   画像：POST /2/media/upload（JSON {media: base64, media_category: "tweet_image"}）→ {data:{id}}
//   動画：POST /2/media/upload/initialize → /2/media/upload/{id}/append（分割）→ /2/media/upload/{id}/finalize
//        → GET /2/media/upload?media_id=…&command=STATUS で processing_info.state が succeeded になるまで待つ
//   添付：POST /2/tweets の media.media_ids
//   分析：GET /2/tweets?ids=…（最大100件）&post.fields=public_metrics
//        → public_metrics {impression_count, like_count, reply_count, repost_count, quote_count, bookmark_count}
//        （X 公式ドキュメント「Get Posts by IDs」と SDK の PostsClient.getByIds で確認）
//        フォロワー数 GET /2/users/me?user.fields=public_metrics → public_metrics.followers_count
//        X の利用プランによっては取得できない（402 / 403 → PERMISSION）
const BASE_URL = "https://api.x.com";
// 動画の分割サイズ（base64 にする前のバイト数）
const CHUNK_BYTES = 4 * 1024 * 1024;
// 1回の分析リクエストで問い合わせる投稿数の上限（公式仕様の ids の上限）
const METRICS_BATCH = 100;

type TweetsLookup = {
  data?: { id: string; public_metrics?: Record<string, number> }[];
  errors?: { resource_id?: string; value?: string; detail?: string; title?: string }[];
};

type ProcessingInfo = { state?: string; check_after_secs?: number };
type UploadResponse = { data?: { id: string; processing_info?: ProcessingInfo } };

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

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  private async postJson<T>(url: string, c: XCredentials, body: unknown): Promise<T> {
    return callApi<T>("X", this.fetchImpl, url, {
      method: "POST",
      headers: { ...this.headers("POST", url, c), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  // 生成サービスなどの公開URLからファイルを取得する
  private async download(url: string): Promise<{ bytes: Buffer; contentType: string }> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, { signal: AbortSignal.timeout(60_000) });
    } catch {
      throw new SocialPublishError("TRANSIENT", "X", "media download failed");
    }
    if (!res.ok) throw new SocialPublishError("CONTENT", "X", `media download failed: HTTP ${res.status}`);
    return { bytes: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "" };
  }

  private async uploadImage(url: string, c: XCredentials): Promise<string> {
    const { bytes } = await this.download(url);
    const res = await this.postJson<UploadResponse>(`${BASE_URL}/2/media/upload`, c, {
      media: bytes.toString("base64"),
      media_category: "tweet_image",
    });
    if (!res.data?.id) throw new SocialPublishError("UNKNOWN", "X", "no media id", res);
    return res.data.id;
  }

  private async uploadVideo(url: string, c: XCredentials): Promise<string> {
    const { bytes, contentType } = await this.download(url);
    const init = await this.postJson<UploadResponse>(`${BASE_URL}/2/media/upload/initialize`, c, {
      media_type: contentType.startsWith("video/") ? contentType.split(";")[0] : "video/mp4",
      total_bytes: bytes.length,
      media_category: "tweet_video",
    });
    const id = init.data?.id;
    if (!id) throw new SocialPublishError("UNKNOWN", "X", "no media id", init);

    for (let offset = 0, index = 0; offset < bytes.length; offset += CHUNK_BYTES, index++) {
      await this.postJson(`${BASE_URL}/2/media/upload/${encodeURIComponent(id)}/append`, c, {
        media: bytes.subarray(offset, offset + CHUNK_BYTES).toString("base64"),
        segment_index: index,
      });
    }
    const finalized = await this.postJson<UploadResponse>(`${BASE_URL}/2/media/upload/${encodeURIComponent(id)}/finalize`, c, {});
    let info = finalized.data?.processing_info;
    // 動画の処理が終わるまで待つ（最大およそ5分）
    for (let i = 0; info && info.state !== "succeeded" && i < 60; i++) {
      if (info.state === "failed") throw new SocialPublishError("CONTENT", "X", "video processing failed", info);
      await this.sleep(Math.max(1, info.check_after_secs ?? 5) * 1000);
      const statusUrl = `${BASE_URL}/2/media/upload?media_id=${encodeURIComponent(id)}&command=STATUS`;
      const status = await callApi<UploadResponse>("X", this.fetchImpl, statusUrl, {
        method: "GET",
        headers: this.headers("GET", statusUrl, c),
      });
      info = status.data?.processing_info;
    }
    if (info && info.state !== "succeeded") throw new SocialPublishError("TRANSIENT", "X", "video processing timeout");
    return id;
  }

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
    const media = primaryMedia(post);
    const mediaId = media ? await (media.type === "VIDEO" ? this.uploadVideo(media.url, c) : this.uploadImage(media.url, c)) : null;
    const res = await this.postJson<{ data?: { id: string; text: string } }>(`${BASE_URL}/2/tweets`, c, {
      text: post.content,
      ...(mediaId ? { media: { media_ids: [mediaId] } } : {}),
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

  private async getJson<T>(url: string, c: XCredentials): Promise<T> {
    return callApi<T>("X", this.fetchImpl, url, { method: "GET", headers: this.headers("GET", url, c) });
  }

  async fetchPostMetrics(targets: MetricsTarget[], credentials: PlatformCredentials): Promise<PostMetricsResult> {
    const c = toXCredentials(credentials);
    const result: PostMetricsResult = new Map();
    for (let i = 0; i < targets.length; i += METRICS_BATCH) {
      const ids = targets.slice(i, i + METRICS_BATCH).map((t) => t.externalPostId);
      const qs = new URLSearchParams({ ids: ids.join(","), "post.fields": "public_metrics" });
      const res = await this.getJson<TweetsLookup>(`${BASE_URL}/2/tweets?${qs}`, c);
      for (const tweet of res.data ?? []) {
        const raw = Object.fromEntries(Object.entries(tweet.public_metrics ?? {}).filter(([, v]) => typeof v === "number"));
        result.set(
          tweet.id,
          toMetricValues(raw, {
            views: ["impression_count"],
            likes: ["like_count"],
            comments: ["reply_count"],
            // 旧名 retweet_count が返る場合にも対応する
            shares: ["repost_count", "retweet_count", "quote_count"],
            saves: ["bookmark_count"],
          }),
        );
      }
      for (const err of res.errors ?? []) {
        const id = err.resource_id ?? err.value;
        if (id && !result.has(id)) result.set(id, { error: err.detail ?? err.title ?? "not found" });
      }
    }
    return result;
  }

  async fetchFollowerCount(credentials: PlatformCredentials): Promise<number> {
    const c = toXCredentials(credentials);
    const res = await this.getJson<{ data?: { public_metrics?: { followers_count?: number } } }>(
      `${BASE_URL}/2/users/me?${new URLSearchParams({ "user.fields": "public_metrics" })}`,
      c,
    );
    const count = res.data?.public_metrics?.followers_count;
    if (typeof count !== "number") throw new SocialPublishError("UNKNOWN", "X", "no followers_count", res);
    return count;
  }

  async validatePost(post: PlatformPost): Promise<ValidationResult> {
    return validateAgainstCapabilities(post, this.capabilities);
  }
}
