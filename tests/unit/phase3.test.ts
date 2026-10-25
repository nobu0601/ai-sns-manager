import { describe, expect, it } from "vitest";
import { checkPlan } from "@/lib/agent/plan-check";
import { computeSlots, slotLabel } from "@/lib/agent/slots";
import type { PlanItem } from "@/lib/ai/types";
import { MediaGenerationError } from "@/lib/media/errors";
import { FalAIProvider } from "@/lib/media/fal-provider";
import { weeklyCron } from "@/lib/queue/jobs";
import { PLATFORM_CAPABILITIES } from "@/lib/social/capabilities";
import { InstagramAdapter } from "@/lib/social/instagram/instagram-adapter";
import { inferMediaType, primaryMedia } from "@/lib/social/media";
import { ThreadsAdapter } from "@/lib/social/threads/threads-adapter";
import { validateAgainstCapabilities } from "@/lib/social/validate";
import { XAdapter } from "@/lib/social/x/x-adapter";

// 2026-10-26(月) 08:00 JST
const MONDAY_8AM = new Date("2026-10-25T23:00:00.000Z");

describe("投稿枠の計算（AI スケジュール）", () => {
  it("選んだ曜日・時刻で、今後7日間に週の回数分の枠を作る", () => {
    const slots = computeSlots({ now: MONDAY_8AM, postsPerWeek: 3, preferredWeekdays: [1, 3, 5], preferredTime: "12:00" });
    expect(slots.map(slotLabel)).toEqual(["10/26(月) 12:00", "10/28(水) 12:00", "10/30(金) 12:00"]);
  });

  it("予定がある日は避け、足りなければ他の曜日で補う", () => {
    const busy = [new Date("2026-10-28T05:00:00.000Z")]; // 水曜
    const slots = computeSlots({ now: MONDAY_8AM, postsPerWeek: 3, preferredWeekdays: [1, 3, 5], preferredTime: "12:00", busyDates: busy });
    const labels = slots.map(slotLabel);
    expect(labels).toHaveLength(3);
    expect(labels).toContain("10/26(月) 12:00");
    expect(labels).toContain("10/30(金) 12:00");
    expect(labels.some((l) => l.includes("(水)"))).toBe(false);
  });

  it("1時間以内の枠は使わない。選んだ曜日が7日間に無ければ他の曜日を使う", () => {
    const at1130 = new Date("2026-10-26T02:30:00.000Z"); // 月曜 11:30
    // 今日の 12:00 は1時間以内、来週の月曜は7日間の外 → 火曜で補う
    const slots = computeSlots({ now: at1130, postsPerWeek: 1, preferredWeekdays: [1], preferredTime: "12:00" });
    expect(slots.map(slotLabel)).toEqual(["10/27(火) 12:00"]);
  });

  it("週7回なら7日分の枠", () => {
    expect(computeSlots({ now: MONDAY_8AM, postsPerWeek: 7, preferredWeekdays: [], preferredTime: "19:30" })).toHaveLength(7);
  });

  it("毎週の自動実行の cron 式（日本時間で解釈する）", () => {
    expect(weeklyCron(1, "09:05")).toBe("5 9 * * 1");
  });
});

const item = (over: Partial<PlanItem>): PlanItem => ({
  slotIndex: 0,
  pillar: "カフェ",
  topic: "t",
  style: "story",
  reason: "r",
  imageIdea: "i",
  ...over,
});

describe("計画のチェック", () => {
  it("正しい計画はエラーなし", () => {
    expect(checkPlan([item({ slotIndex: 0 }), item({ slotIndex: 1, pillar: "ラウンジ" })], 2, ["カフェ", "ラウンジ"])).toEqual([]);
  });

  it("枠の抜け・重複・登録されていない柱を見つける", () => {
    const errors = checkPlan([item({ slotIndex: 0 }), item({ slotIndex: 0, pillar: "不明" })], 2, ["カフェ"]).join();
    expect(errors).toContain("投稿枠 0 が重複");
    expect(errors).toContain("投稿枠 1 に計画がありません");
    expect(errors).toContain("「不明」は登録されていません");
  });

  it("同じ柱が偏っているとエラー", () => {
    const items = [0, 1, 2].map((i) => item({ slotIndex: i }));
    expect(checkPlan(items, 3, ["カフェ", "ラウンジ", "大阪情報"]).join()).toContain("偏っています");
  });
});

describe("メディアの種類", () => {
  it("拡張子から動画を判定し、保存された種類を優先する", () => {
    expect(inferMediaType("https://x/a.mp4")).toBe("VIDEO");
    expect(inferMediaType("https://x/a.jpg?w=1")).toBe("IMAGE");
    expect(primaryMedia({ mediaUrls: ["https://x/a"], mediaType: "VIDEO" })).toEqual({ url: "https://x/a", type: "VIDEO" });
    expect(primaryMedia({ mediaUrls: [] })).toBeNull();
  });

  it("Instagram は動画（リール）でも可。添付は1つまで", () => {
    const ig = (mediaUrls: string[]) =>
      validateAgainstCapabilities({ platform: "INSTAGRAM", content: "c", mediaUrls, mediaType: "VIDEO", idempotencyKey: "k" }, PLATFORM_CAPABILITIES.INSTAGRAM);
    expect(ig(["https://x/a.mp4"]).valid).toBe(true);
    expect(ig(["https://x/a.mp4", "https://x/b.mp4"]).errors.join()).toContain("1つまで");
  });
});

// fal.ai クライアントの代わりに、呼び出しを記録して決まった結果を返す
function fakeFal(data: unknown, error?: unknown) {
  const calls: { id: string; input: Record<string, unknown> }[] = [];
  const client = {
    subscribe: async (id: string, options: { input: Record<string, unknown> }) => {
      calls.push({ id, input: options.input });
      if (error) throw error;
      return { data, requestId: "r1" };
    },
  };
  return { client: client as never, calls };
}

describe("FalAIProvider", () => {
  const withKey = async (fn: () => Promise<void>) => {
    const original = process.env.FAL_KEY;
    process.env.FAL_KEY = "test-key";
    try {
      await fn();
    } finally {
      process.env.FAL_KEY = original;
    }
  };

  it("画像：FLUX に prompt・サイズを渡し、images[0].url を返す", () =>
    withKey(async () => {
      const { client, calls } = fakeFal({ images: [{ url: "https://fal.media/a.jpg" }] });
      const result = await new FalAIProvider(undefined, undefined, client).generateImage("a cafe", { aspectRatio: "9:16" });
      expect(result).toEqual({ url: "https://fal.media/a.jpg", model: "fal-ai/flux-1/schnell" });
      expect(calls[0]).toEqual({
        id: "fal-ai/flux-1/schnell",
        input: { prompt: "a cafe", image_size: "portrait_16_9", num_images: 1, output_format: "jpeg" },
      });
    }));

  it("動画：Kling に長さ（10秒）と縦横比を渡し、video.url を返す", () =>
    withKey(async () => {
      const { client, calls } = fakeFal({ video: { url: "https://fal.media/v.mp4" } });
      const result = await new FalAIProvider(undefined, undefined, client).generateVideo("coffee", { aspectRatio: "4:5", durationSeconds: 10 });
      expect(result.url).toBe("https://fal.media/v.mp4");
      expect(calls[0].id).toBe("fal-ai/kling-video/v2.5-turbo/pro/text-to-video");
      expect(calls[0].input).toEqual({ prompt: "coffee", duration: "10", aspect_ratio: "9:16" });
    }));

  it("キー未設定なら通信せず NOT_CONFIGURED、401 は AUTH", async () => {
    const { client, calls } = fakeFal({});
    const original = process.env.FAL_KEY;
    process.env.FAL_KEY = "";
    try {
      await expect(new FalAIProvider(undefined, undefined, client).generateImage("x", { aspectRatio: "1:1" })).rejects.toMatchObject({ kind: "NOT_CONFIGURED" });
      expect(calls).toHaveLength(0);
    } finally {
      process.env.FAL_KEY = original;
    }
    await withKey(async () => {
      const failing = fakeFal({}, Object.assign(new Error("Unauthorized"), { status: 401 }));
      const err = await new FalAIProvider(undefined, undefined, failing.client).generateImage("x", { aspectRatio: "1:1" }).catch((e) => e);
      expect(err).toBeInstanceOf(MediaGenerationError);
      expect(err.kind).toBe("AUTH");
    });
  });
});

type Call = { url: string; method: string; body: string; headers: Record<string, string> };
function fakeFetch(responses: Array<{ status?: number; body?: unknown; raw?: Uint8Array; contentType?: string }>) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), method: init.method ?? "GET", body: init.body ? String(init.body) : "", headers: (init.headers as Record<string, string>) ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    if (next.raw) return new Response(new Blob([new Uint8Array(next.raw)]), { status: 200, headers: { "content-type": next.contentType ?? "application/octet-stream" } });
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  }) as typeof fetch;
  return { impl, calls };
}
const noWait = { attempts: 3, intervalMs: 0, sleep: async () => {} };
const account = { accountName: "@lounge", externalAccountId: "178" };

describe("画像・動画の投稿（各SNS）", () => {
  it("Threads：画像は media_type=IMAGE と image_url", async () => {
    const { impl, calls } = fakeFetch([{ body: { id: "c1" } }, { body: { status: "FINISHED" } }, { body: { id: "p1" } }, { body: { permalink: "https://threads.net/p" } }]);
    await new ThreadsAdapter(impl, noWait).createPost(
      { platform: "THREADS", content: "本文", mediaUrls: ["https://fal.media/a.jpg"], mediaType: "IMAGE", idempotencyKey: "k" },
      { accessToken: "t" },
      account,
    );
    const body = new URLSearchParams(calls[0].body);
    expect(body.get("media_type")).toBe("IMAGE");
    expect(body.get("image_url")).toBe("https://fal.media/a.jpg");
    expect(body.get("text")).toBe("本文");
  });

  it("Instagram：動画は media_type=REELS と video_url", async () => {
    const { impl, calls } = fakeFetch([{ body: { id: "c1" } }, { body: { status_code: "FINISHED" } }, { body: { id: "m1" } }, { body: {} }]);
    await new InstagramAdapter(impl, noWait).createPost(
      { platform: "INSTAGRAM", content: "キャプション", mediaUrls: ["https://fal.media/v.mp4"], mediaType: "VIDEO", idempotencyKey: "k" },
      { accessToken: "t" },
      account,
    );
    const body = new URLSearchParams(calls[0].body);
    expect(body.get("media_type")).toBe("REELS");
    expect(body.get("video_url")).toBe("https://fal.media/v.mp4");
    expect(body.has("image_url")).toBe(false);
  });

  const xCreds = { apiKey: "ck", apiSecret: "cs", accessToken: "at", accessTokenSecret: "ats" };

  it("X：画像をダウンロード → base64 でアップロード → media_ids を付けて投稿", async () => {
    const { impl, calls } = fakeFetch([
      { raw: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" },
      { body: { data: { id: "m1" } } },
      { status: 201, body: { data: { id: "t1", text: "hi" } } },
    ]);
    await new XAdapter(impl).createPost(
      { platform: "X", content: "本文", mediaUrls: ["https://fal.media/a.jpg"], mediaType: "IMAGE", idempotencyKey: "k" },
      xCreds,
      account,
    );
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET https://fal.media/a.jpg",
      "POST https://api.x.com/2/media/upload",
      "POST https://api.x.com/2/tweets",
    ]);
    expect(JSON.parse(calls[1].body)).toEqual({ media: Buffer.from([1, 2, 3]).toString("base64"), media_category: "tweet_image" });
    expect(calls[1].headers.Authorization).toMatch(/^OAuth /);
    expect(JSON.parse(calls[2].body)).toEqual({ text: "本文", media: { media_ids: ["m1"] } });
  });

  it("X：動画は initialize → append → finalize → 処理完了を待ってから投稿", async () => {
    const { impl, calls } = fakeFetch([
      { raw: new Uint8Array(10), contentType: "video/mp4" },
      { body: { data: { id: "v1" } } },
      { body: {} },
      { body: { data: { id: "v1", processing_info: { state: "pending", check_after_secs: 1 } } } },
      { body: { data: { id: "v1", processing_info: { state: "succeeded" } } } },
      { status: 201, body: { data: { id: "t1", text: "hi" } } },
    ]);
    await new XAdapter(impl, async () => {}).createPost(
      { platform: "X", content: "本文", mediaUrls: ["https://fal.media/v.mp4"], mediaType: "VIDEO", idempotencyKey: "k" },
      xCreds,
      account,
    );
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET https://fal.media/v.mp4",
      "POST https://api.x.com/2/media/upload/initialize",
      "POST https://api.x.com/2/media/upload/v1/append",
      "POST https://api.x.com/2/media/upload/v1/finalize",
      "GET https://api.x.com/2/media/upload?media_id=v1&command=STATUS",
      "POST https://api.x.com/2/tweets",
    ]);
    expect(JSON.parse(calls[1].body)).toEqual({ media_type: "video/mp4", total_bytes: 10, media_category: "tweet_video" });
    expect(JSON.parse(calls[2].body).segment_index).toBe(0);
    expect(JSON.parse(calls[5].body).media).toEqual({ media_ids: ["v1"] });
  });
});
