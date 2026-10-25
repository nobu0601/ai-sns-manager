import { describe, expect, it } from "vitest";
import {
  byPillar,
  byTimeBand,
  engagementRateOf,
  followerChange,
  reactionsOf,
  timeBandOf,
  totalsOf,
  type Metrics,
  type PostRow,
} from "@/lib/analytics/aggregate";
import { checkAnalysis } from "@/lib/analytics/analysis-service";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { analysisUserPrompt, planUserPrompt } from "@/lib/ai/prompts";
import type { AnalysisOutput, AnalysisRequest, BrandContext } from "@/lib/ai/types";
import { metricsMessageFor } from "@/lib/errors/user-messages";
import { SocialPublishError } from "@/lib/social/errors";
import { classifyHttpError } from "@/lib/social/http";
import { InstagramAdapter } from "@/lib/social/instagram/instagram-adapter";
import { MOCK_NO_METRICS_KEY, MockSocialAdapter } from "@/lib/social/mock/mock-adapter";
import { ThreadsAdapter } from "@/lib/social/threads/threads-adapter";
import type { SocialPlatformAdapter } from "@/lib/social/types";
import { XAdapter } from "@/lib/social/x/x-adapter";

type Call = { url: string; method: string; headers: Record<string, string> };

// 実際のSNSには接続せず、送ったリクエストを記録して決まった応答を返す
function fakeFetch(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), method: init.method ?? "GET", headers: (init.headers as Record<string, string>) ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  }) as typeof fetch;
  return { impl, calls };
}

// インターフェース経由で呼ぶ（実装クラスは使わない引数を省略しているため）
const adapter = (a: SocialPlatformAdapter) => a;

const xKeys = { apiKey: "ck", apiSecret: "cs", accessToken: "at", accessTokenSecret: "as" };
const account = { accountName: "@lounge", externalAccountId: "17841" };

const metrics = (over: Partial<Metrics> = {}): Metrics => ({
  views: 1000,
  reach: null,
  likes: 30,
  comments: 5,
  shares: 3,
  saves: null,
  clicks: null,
  ...over,
});

const row = (over: Partial<PostRow> = {}): PostRow => ({
  postPlatformId: "pp1",
  postId: "p1",
  title: "投稿",
  topic: "",
  pillar: "カフェ",
  content: "本文",
  platform: "X",
  accountName: "@lounge",
  // 2026-10-26(月) 12:00 JST
  publishedAt: new Date("2026-10-26T03:00:00.000Z"),
  externalUrl: null,
  metrics: metrics(),
  fetchedAt: null,
  ...over,
});

describe("分析の集計", () => {
  it("反応は取得できた項目だけを足し、1つも無ければ null（0 と区別する）", () => {
    expect(reactionsOf(metrics())).toBe(38);
    expect(reactionsOf(metrics({ likes: null, comments: null, shares: null, saves: null }))).toBeNull();
    expect(reactionsOf(null)).toBeNull();
  });

  it("反応率は表示が取れないときは null", () => {
    expect(engagementRateOf(metrics())).toBe(3.8);
    expect(engagementRateOf(metrics({ views: null }))).toBeNull();
    expect(engagementRateOf(metrics({ views: 0 }))).toBeNull();
  });

  it("合計：どの投稿でも取れない指標は null、取れた投稿の分だけ合計する", () => {
    const totals = totalsOf([row(), row({ metrics: metrics({ saves: 4, views: 500 }) }), row({ metrics: null })]);
    expect(totals.views).toBe(1500);
    expect(totals.saves).toBe(4);
    expect(totals.reach).toBeNull();
  });

  it("時間帯は日本時間で判定する（深夜は22時〜6時）", () => {
    expect(timeBandOf(new Date("2026-10-26T03:00:00.000Z"))).toBe("昼（11〜14時）");
    expect(timeBandOf(new Date("2026-10-26T14:30:00.000Z"))).toBe("深夜（22〜6時）"); // 23:30 JST
    expect(timeBandOf(new Date("2026-10-25T21:00:00.000Z"))).toBe("朝（6〜11時）"); // 6:00 JST
  });

  it("柱ごとの平均は反応が多い順。数値の無い投稿は数えない", () => {
    const groups = byPillar([
      row({ pillar: "カフェ", metrics: metrics({ likes: 10 }) }),
      row({ pillar: "ラウンジ", metrics: metrics({ likes: 100 }) }),
      row({ pillar: "ラウンジ", metrics: null }),
    ]);
    expect(groups.map((g) => [g.key, g.posts])).toEqual([
      ["ラウンジ", 1],
      ["カフェ", 1],
    ]);
    expect(byTimeBand([row()])[0].key).toBe("昼（11〜14時）");
  });

  it("フォロワーの増減は期間の最初と最後の差（記録が1件なら増減は null）", () => {
    const d = (s: string) => new Date(s);
    expect(followerChange([])).toEqual({ latest: null, change: null });
    expect(followerChange([{ date: d("2026-10-01"), followers: 100 }])).toEqual({ latest: 100, change: null });
    expect(
      followerChange([
        { date: d("2026-10-20"), followers: 130 },
        { date: d("2026-10-01"), followers: 100 },
      ]),
    ).toEqual({ latest: 130, change: 30 });
  });
});

describe("AI 分析の確認", () => {
  const output = (over: Partial<AnalysisOutput> = {}): AnalysisOutput => ({
    summary: "傾向です",
    goodThemes: [{ theme: "カフェ", reason: "反応が多い", evidence: ["P1", "P9"] }],
    textTrends: [{ finding: "根拠なし", evidence: ["P99"] }],
    timeTrends: [{ finding: "昼が良い", evidence: ["P2", "P2"] }],
    nextIdeas: [{ title: "案", topic: "昼の過ごし方", pillar: "カフェ", reason: "続けるため" }],
    ...over,
  });

  it("一覧に無い ref は外し、根拠の無い結論は残さない", () => {
    const { result, feedback } = checkAnalysis(output(), ["P1", "P2"], ["カフェ"]);
    expect(feedback).toEqual([]);
    expect(result.goodThemes[0].evidence).toEqual(["P1"]);
    expect(result.textTrends).toEqual([]);
    expect(result.timeTrends[0].evidence).toEqual(["P2"]);
  });

  it("次回の投稿案が無い・柱がブランドに無い・根拠付きの分析が無いときは作り直す", () => {
    expect(checkAnalysis(output({ nextIdeas: [] }), ["P1"], []).feedback[0]).toContain("nextIdeas");
    expect(checkAnalysis(output({ nextIdeas: [{ title: "a", topic: "b", pillar: "ニュース", reason: "" }] }), ["P1"], ["カフェ"]).feedback[0]).toContain("ニュース");
    expect(checkAnalysis(output(), ["P50"], []).feedback[0]).toContain("根拠");
  });
});

describe("分析のプロンプトと Mock", () => {
  const brand: BrandContext = {
    name: "Lounge+",
    description: "",
    targetAudience: "",
    brandImage: "",
    tone: "",
    objective: "",
    avoidExpressions: "",
    keywords: [],
    prohibitedWords: [],
    contentPillars: ["カフェ", "ラウンジ"],
  };
  const request: AnalysisRequest = {
    brand,
    posts: [
      { ref: "P1", date: "10/26(月) 12:00", timeBand: "昼（11〜14時）", platform: "X", pillar: "カフェ", title: "A", excerpt: "本文A", views: 1000, likes: 50, comments: 5, shares: 2, saves: null, reactions: 57, engagementRate: 5.7 },
      { ref: "P2", date: "10/27(火) 20:00", timeBand: "夜（18〜22時）", platform: "Threads", pillar: "ラウンジ", title: "B", excerpt: "本文B", views: 300, likes: 3, comments: 0, shares: 0, saves: null, reactions: 3, engagementRate: 1 },
    ],
    byPillar: [
      { key: "カフェ", posts: 1, avgViews: 1000, avgReactions: 57, avgEngagementRate: 5.7 },
      { key: "ラウンジ", posts: 1, avgViews: 300, avgReactions: 3, avgEngagementRate: 1 },
    ],
    byTimeBand: [{ key: "昼（11〜14時）", posts: 1, avgViews: 1000, avgReactions: 57, avgEngagementRate: 5.7 }],
    byWeekday: [],
  };

  it("実績データを ref 付きで渡し、取得できない項目は「-」にする", () => {
    const text = analysisUserPrompt(request);
    expect(text).toContain("P1｜10/26(月) 12:00");
    expect(text).toContain("保存 -");
    expect(text).toContain("投稿テーマの柱ごと");
    expect(text).toContain("ref（P1 など）だけ");
  });

  it("AI Agent の計画に、最新の分析の要点を渡す", () => {
    const text = planUserPrompt({
      brand,
      slots: [{ index: 0, label: "10/26(月) 12:00" }],
      history: [],
      insights: { analyzedAt: "2026/10/25 09:00", summary: "カフェが好調", goodThemes: ["カフェ"], timeTrends: ["昼が良い"], nextIdeas: [{ topic: "昼の過ごし方", pillar: "カフェ" }] },
    });
    expect(text).toContain("最近の分析（2026/10/25 09:00");
    expect(text).toContain("昼の過ごし方（カフェ）");
  });

  it("Mock の分析は渡した数値から反応の多い柱を選び、根拠の ref を付ける", async () => {
    const result = await new MockAIProvider().analyze(request);
    expect(result.goodThemes[0]).toMatchObject({ theme: "カフェ", evidence: ["P1"] });
    expect(result.nextIdeas).toHaveLength(3);
    expect(checkAnalysis(result, ["P1", "P2"], brand.contentPillars).feedback).toEqual([]);
  });
});

describe("分析のエラー分類と文言", () => {
  it("Meta の権限エラー（code 10 / 200番台）と X の 402 は権限不足として扱う", () => {
    expect(classifyHttpError(400, { error: { code: 10 } })).toBe("PERMISSION");
    expect(classifyHttpError(400, { error: { code: 200 } })).toBe("PERMISSION");
    expect(classifyHttpError(400, { error: { code: 100 } })).toBe("CONTENT");
    expect(classifyHttpError(402, {})).toBe("PERMISSION");
  });

  it("権限不足のときは SNS ごとに必要な権限・プランを案内する", () => {
    expect(metricsMessageFor("PERMISSION", "X")).toContain("API プラン");
    expect(metricsMessageFor("PERMISSION", "INSTAGRAM")).toContain("instagram_business_manage_insights");
    expect(metricsMessageFor("PERMISSION", "THREADS")).toContain("threads_manage_insights");
    expect(metricsMessageFor("AUTH", "X")).toContain("再接続");
  });
});

describe("X の分析（公式SDK・ドキュメントの仕様）", () => {
  it("GET /2/tweets?ids=…&post.fields=public_metrics を OAuth 1.0a で呼び、数値を変換する", async () => {
    const { impl, calls } = fakeFetch([
      {
        body: {
          data: [{ id: "1", public_metrics: { impression_count: 900, like_count: 20, reply_count: 3, repost_count: 4, quote_count: 1, bookmark_count: 2 } }],
          errors: [{ resource_id: "2", title: "Not Found Error", detail: "Could not find tweet with ids: [2]." }],
        },
      },
    ]);
    const result = await adapter(new XAdapter(impl)).fetchPostMetrics([{ externalPostId: "1" }, { externalPostId: "2" }], xKeys, account);
    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe("https://api.x.com/2/tweets");
    expect(url.searchParams.get("ids")).toBe("1,2");
    expect(url.searchParams.get("post.fields")).toBe("public_metrics");
    expect(calls[0].headers.Authorization).toMatch(/^OAuth /);
    expect(result.get("1")).toMatchObject({ views: 900, likes: 20, comments: 3, shares: 5, saves: 2, reach: null, clicks: null });
    expect(result.get("2")).toEqual({ error: "Could not find tweet with ids: [2]." });
  });

  it("101件以上は100件ずつに分けて問い合わせる", async () => {
    const { impl, calls } = fakeFetch([{ body: { data: [] } }, { body: { data: [] } }]);
    const targets = Array.from({ length: 150 }, (_, i) => ({ externalPostId: String(i) }));
    await adapter(new XAdapter(impl)).fetchPostMetrics(targets, xKeys, account);
    expect(calls).toHaveLength(2);
    expect(new URL(calls[1].url).searchParams.get("ids")!.split(",")).toHaveLength(50);
  });

  it("プランで使えない（403）ときは PERMISSION として投げる", async () => {
    const { impl } = fakeFetch([{ status: 403, body: { title: "Client Forbidden" } }]);
    await expect(adapter(new XAdapter(impl)).fetchPostMetrics([{ externalPostId: "1" }], xKeys, account)).rejects.toMatchObject({ kind: "PERMISSION" });
  });

  it("フォロワー数は GET /2/users/me?user.fields=public_metrics", async () => {
    const { impl, calls } = fakeFetch([{ body: { data: { id: "9", public_metrics: { followers_count: 321 } } } }]);
    expect(await adapter(new XAdapter(impl)).fetchFollowerCount(xKeys, account)).toBe(321);
    expect(new URL(calls[0].url).searchParams.get("user.fields")).toBe("public_metrics");
  });
});

describe("Threads の分析（Meta 公式サンプルの仕様）", () => {
  it("GET {id}/insights?metric=views,likes,replies,reposts,quotes,shares の values[0].value を読む", async () => {
    const insight = (name: string, value: number) => ({ name, period: "lifetime", values: [{ value }] });
    const { impl, calls } = fakeFetch([
      { body: { data: [insight("views", 500), insight("likes", 12), insight("replies", 2), insight("reposts", 1), insight("quotes", 1), insight("shares", 3)] } },
    ]);
    const result = await adapter(new ThreadsAdapter(impl)).fetchPostMetrics([{ externalPostId: "t1" }], { accessToken: "tok" }, account);
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/t1/insights");
    expect(url.searchParams.get("metric")).toBe("views,likes,replies,reposts,quotes,shares");
    expect(result.get("t1")).toMatchObject({ views: 500, likes: 12, comments: 2, shares: 5, saves: null, reach: null });
  });

  it("フォロワー数は me/threads_insights?metric=followers_count の total_value", async () => {
    const { impl, calls } = fakeFetch([{ body: { data: [{ name: "followers_count", total_value: { value: 88 } }] } }]);
    expect(await adapter(new ThreadsAdapter(impl)).fetchFollowerCount({ accessToken: "tok" }, account)).toBe(88);
    expect(new URL(calls[0].url).pathname).toBe("/me/threads_insights");
  });

  it("権限が無い（code 10）ときはアカウント全体の問題として投げる", async () => {
    const { impl } = fakeFetch([{ status: 400, body: { error: { code: 10, message: "Application does not have permission" } } }]);
    await expect(adapter(new ThreadsAdapter(impl)).fetchPostMetrics([{ externalPostId: "t1" }], { accessToken: "tok" }, account)).rejects.toMatchObject({
      kind: "PERMISSION",
    });
  });
});

describe("Instagram の分析（公式ドキュメントの仕様）", () => {
  it("GET {media-id}/insights?metric=views,reach,likes,comments,shares,saved を読み、投稿ごとの失敗は続ける", async () => {
    const insight = (name: string, value: number) => ({ name, period: "lifetime", values: [{ value }] });
    const { impl, calls } = fakeFetch([
      { status: 400, body: { error: { code: 100, message: "media not found" } } },
      { body: { data: [insight("views", 800), insight("reach", 600), insight("likes", 40), insight("comments", 4), insight("shares", 2), insight("saved", 9)] } },
    ]);
    const result = await adapter(new InstagramAdapter(impl)).fetchPostMetrics(
      [{ externalPostId: "gone" }, { externalPostId: "m2" }],
      { accessToken: "tok" },
      account,
    );
    expect(new URL(calls[1].url).searchParams.get("metric")).toBe("views,reach,likes,comments,shares,saved");
    expect(result.get("gone")).toHaveProperty("error");
    expect(result.get("m2")).toMatchObject({ views: 800, reach: 600, likes: 40, comments: 4, shares: 2, saves: 9 });
  });

  it("接続切れ（code 190）は投稿ごとに続けず、すぐに投げる", async () => {
    const { impl, calls } = fakeFetch([{ status: 400, body: { error: { code: 190 } } }]);
    await expect(
      adapter(new InstagramAdapter(impl)).fetchPostMetrics([{ externalPostId: "a" }, { externalPostId: "b" }], { accessToken: "tok" }, account),
    ).rejects.toBeInstanceOf(SocialPublishError);
    expect(calls).toHaveLength(1);
  });

  it("フォロワー数は me?fields=followers_count", async () => {
    const { impl, calls } = fakeFetch([{ body: { followers_count: 1200, id: "1" } }]);
    expect(await adapter(new InstagramAdapter(impl)).fetchFollowerCount({ accessToken: "tok" }, account)).toBe(1200);
    expect(new URL(calls[0].url).searchParams.get("fields")).toBe("followers_count");
  });
});

describe("Mock の分析", () => {
  it("同じ投稿なら同じ数値。SNS が返さない指標は null", async () => {
    const threads = adapter(new MockSocialAdapter("THREADS"));
    const a = await threads.fetchPostMetrics([{ externalPostId: "p1" }], { accessToken: "x" }, account);
    const b = await threads.fetchPostMetrics([{ externalPostId: "p1" }], { accessToken: "x" }, account);
    expect(a.get("p1")).toEqual(b.get("p1"));
    expect(a.get("p1")).toMatchObject({ saves: null, reach: null, clicks: null });
    const ig = await adapter(new MockSocialAdapter("INSTAGRAM")).fetchPostMetrics([{ externalPostId: "p1" }], { accessToken: "x" }, account);
    expect((ig.get("p1") as Metrics).reach).not.toBeNull();
  });

  it(`キーに「${MOCK_NO_METRICS_KEY}」を含めると、権限不足を再現する`, async () => {
    const x = adapter(new MockSocialAdapter("X"));
    const keys = { ...xKeys, accessToken: `at-${MOCK_NO_METRICS_KEY}` };
    await expect(x.fetchPostMetrics([{ externalPostId: "1" }], keys, account)).rejects.toMatchObject({ kind: "PERMISSION" });
    await expect(x.fetchFollowerCount(keys, account)).rejects.toMatchObject({ kind: "PERMISSION" });
  });
});
