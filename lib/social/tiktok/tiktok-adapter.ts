import { PLATFORM_CAPABILITIES } from "../capabilities";
import { SocialPublishError } from "../errors";
import type { FetchLike } from "../http";
import { primaryMedia } from "../media";
import { validateAgainstCapabilities } from "../validate";
import type {
  PlatformCredentials,
  PlatformPost,
  PostMetricsResult,
  PublishedPost,
  RecentPost,
  SocialPlatformAdapter,
  ValidationResult,
  VerifiedAccount,
} from "../types";
import { tiktokJson, type TikTokCredentials } from "./tiktok-api";

// TikTok Content Posting API（Direct Post・動画のみ）。仕様は TikTok for Developers の公式ドキュメントで確認：
//   投稿者の情報 POST /v2/post/publish/creator_info/query/ → creator_username, privacy_level_options, max_video_post_duration_sec
//   投稿の開始 POST /v2/post/publish/video/init/（post_info{title, privacy_level, …}, source_info{source: FILE_UPLOAD, video_size, chunk_size, total_chunk_count}）
//             → data.publish_id, data.upload_url
//   動画の送信 PUT upload_url（Content-Range: bytes 先頭-末尾/全体）。5MB 未満は1回で、それ以上は 5〜64MB ずつ（最後は128MBまで）
//   状態の確認 POST /v2/post/publish/status/fetch/（publish_id）→ status: PUBLISH_COMPLETE / FAILED（fail_reason）
//   審査前のアプリからの投稿は「自分だけに表示」（SELF_ONLY）に限られる
const MIN_CHUNK = 5 * 1024 * 1024;
const CHUNK = 10 * 1024 * 1024;
const STATUS_WAIT = { attempts: 60, intervalMs: 5000 };

type CreatorInfo = { data?: { creator_username?: string; creator_nickname?: string; privacy_level_options?: string[] } };

function toTikTokCredentials(credentials: PlatformCredentials): TikTokCredentials {
  const c = credentials as Partial<TikTokCredentials>;
  if (!c.accessToken || !c.openId) throw new SocialPublishError("AUTH", "TIKTOK", "missing TikTok token");
  return c as TikTokCredentials;
}

// 投稿の公開範囲。審査が通るまでは SELF_ONLY。審査後は TIKTOK_PRIVACY_LEVEL=PUBLIC_TO_EVERYONE にする
export function choosePrivacyLevel(options: string[], wanted = process.env.TIKTOK_PRIVACY_LEVEL || "SELF_ONLY"): string {
  if (options.includes(wanted)) return wanted;
  if (options.includes("SELF_ONLY")) return "SELF_ONLY";
  if (options.length === 0) throw new SocialPublishError("PERMISSION", "TIKTOK", "no privacy_level_options");
  return options[0];
}

// 送信の区切り方（公式の規則：5MB 未満は全体を1回、それ以上は chunk_size で切り、端数は最後に含める）
export function planChunks(size: number): { chunkSize: number; count: number; ranges: [number, number][] } {
  if (size < MIN_CHUNK) return { chunkSize: size, count: 1, ranges: [[0, size - 1]] };
  const count = Math.max(1, Math.floor(size / CHUNK));
  const ranges: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const start = i * CHUNK;
    const end = i === count - 1 ? size - 1 : start + CHUNK - 1;
    ranges.push([start, end]);
  }
  return { chunkSize: CHUNK, count, ranges };
}

export class TikTokAdapter implements SocialPlatformAdapter {
  readonly platform = "TIKTOK" as const;
  readonly capabilities = PLATFORM_CAPABILITIES.TIKTOK;

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private readonly statusWait = STATUS_WAIT,
  ) {}

  private creatorInfo(c: TikTokCredentials) {
    return tiktokJson<CreatorInfo>(this.fetchImpl, "/v2/post/publish/creator_info/query/", c.accessToken);
  }

  async verifyCredentials(credentials: PlatformCredentials): Promise<VerifiedAccount> {
    const c = toTikTokCredentials(credentials);
    const info = await this.creatorInfo(c);
    const name = info.data?.creator_username ?? info.data?.creator_nickname ?? c.openId;
    return { accountName: `@${name}`, externalAccountId: c.openId };
  }

  private async download(url: string): Promise<{ bytes: Buffer; contentType: string }> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, { signal: AbortSignal.timeout(120_000) });
    } catch {
      throw new SocialPublishError("TRANSIENT", "TIKTOK", "media download failed");
    }
    if (!res.ok) throw new SocialPublishError("CONTENT", "TIKTOK", `media download failed: HTTP ${res.status}`);
    const type = res.headers.get("content-type")?.split(";")[0] || "video/mp4";
    return { bytes: Buffer.from(await res.arrayBuffer()), contentType: type.startsWith("video/") ? type : "video/mp4" };
  }

  async createPost(post: PlatformPost, credentials: PlatformCredentials): Promise<PublishedPost> {
    const c = toTikTokCredentials(credentials);
    const media = primaryMedia(post);
    if (!media || media.type !== "VIDEO") throw new SocialPublishError("CONTENT", "TIKTOK", "video is required");

    const info = await this.creatorInfo(c);
    const privacy = choosePrivacyLevel(info.data?.privacy_level_options ?? []);
    const { bytes, contentType } = await this.download(media.url);
    const plan = planChunks(bytes.length);

    const init = await tiktokJson<{ data?: { publish_id?: string; upload_url?: string } }>(this.fetchImpl, "/v2/post/publish/video/init/", c.accessToken, {
      post_info: { title: post.content, privacy_level: privacy, brand_content_toggle: false },
      source_info: { source: "FILE_UPLOAD", video_size: bytes.length, chunk_size: plan.chunkSize, total_chunk_count: plan.count },
    });
    const publishId = init.data?.publish_id;
    const uploadUrl = init.data?.upload_url;
    if (!publishId || !uploadUrl) throw new SocialPublishError("UNKNOWN", "TIKTOK", "no publish_id / upload_url", init);

    for (const [start, end] of plan.ranges) {
      let res: Response;
      try {
        res = await this.fetchImpl(uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": contentType,
            "Content-Length": String(end - start + 1),
            "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
          },
          body: new Uint8Array(bytes.subarray(start, end + 1)),
          signal: AbortSignal.timeout(300_000),
        });
      } catch {
        throw new SocialPublishError("TRANSIENT", "TIKTOK", "video upload failed");
      }
      if (res.status !== 201 && res.status !== 206) {
        throw new SocialPublishError(res.status >= 500 ? "TRANSIENT" : "CONTENT", "TIKTOK", `video upload failed: HTTP ${res.status}`);
      }
    }

    // TikTok 側の処理が終わるまで待つ
    for (let i = 0; i < this.statusWait.attempts; i++) {
      const status = await tiktokJson<{ data?: { status?: string; fail_reason?: string; publicaly_available_post_id?: (string | number)[] } }>(
        this.fetchImpl,
        "/v2/post/publish/status/fetch/",
        c.accessToken,
        { publish_id: publishId },
      );
      const s = status.data?.status;
      if (s === "PUBLISH_COMPLETE") {
        const publicId = status.data?.publicaly_available_post_id?.[0];
        // 公開された投稿のIDは「全体公開で審査を通過した投稿」にだけ付く。無いときは publish_id を記録する
        return { externalPostId: publicId ? String(publicId) : publishId, publishedAt: new Date(), raw: { publish_id: publishId, privacy } };
      }
      if (s === "FAILED") {
        const reason = status.data?.fail_reason ?? "";
        throw new SocialPublishError(reason === "internal" ? "TRANSIENT" : "CONTENT", "TIKTOK", `TikTok publish failed: ${reason}`, status.data);
      }
      await this.sleep(this.statusWait.intervalMs);
    }
    throw new SocialPublishError("TRANSIENT", "TIKTOK", "TikTok publish not finished in time");
  }

  async validatePost(post: PlatformPost): Promise<ValidationResult> {
    return validateAgainstCapabilities(post, this.capabilities);
  }

  // 分析と過去の投稿の読み込みは、TikTok では今は行わない（別の権限と審査が必要なため）
  async fetchPostMetrics(): Promise<PostMetricsResult> {
    return new Map();
  }

  async fetchFollowerCount(): Promise<number> {
    throw new SocialPublishError("NOT_IMPLEMENTED", "TIKTOK", "TikTok follower count is not supported");
  }

  async fetchRecentPosts(): Promise<RecentPost[]> {
    return [];
  }
}
