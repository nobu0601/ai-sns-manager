import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { ClaudeProvider, DEFAULT_MODEL } from "@/lib/ai/claude-provider";
import { AIError } from "@/lib/ai/errors";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { systemPrompt, userPrompt } from "@/lib/ai/prompts";
import { checkDraft, draftTexts, findDuplicates, findProhibitedWords, instagramContent } from "@/lib/ai/quality";
import { DRAFT_STYLES, type BrandContext, type PostDraft } from "@/lib/ai/types";
import { PLATFORM_CAPABILITIES } from "@/lib/social/capabilities";
import { xWeightedLength } from "@/lib/social/text-length";
import { validateAgainstCapabilities } from "@/lib/social/validate";

const brand: BrandContext = {
  name: "Lounge+",
  description: "大阪のカフェ・コワーキング・ラウンジ",
  targetAudience: "20〜40代",
  brandImage: "上質で落ち着く",
  tone: "おしゃれ、親しみやすい",
  objective: "来店のきっかけづくり",
  avoidExpressions: "誇大表現",
  keywords: ["大阪", "カフェ"],
  prohibitedWords: ["激安"],
  contentPillars: ["利用シーン"],
};

const draft = (over: Partial<PostDraft> = {}): PostDraft => ({
  style: "story",
  title: "t",
  summary: "s",
  x: { text: "週末は読書の時間に。静かな席でページをめくると、平日の疲れが少しずつほどけていきます。ゆっくりどうぞ。" },
  instagram: {
    caption:
      "週末は読書の時間に。\n\n静かな席でページをめくると、平日の疲れが少しずつほどけていきます。好きな飲み物を片手に、読みかけの一冊を開いてみませんか。\n\n窓の外の光が変わっていくのを感じながら、自分のペースで過ごす時間。そんなひとときを大切にしてほしいと思っています。\n\nくわしくはプロフィールのリンクから。",
    hashtags: ["#大阪", "#カフェ"],
  },
  threads: { text: "みなさんは週末どう過ごしますか？最近は静かな場所で本を読むのが楽しみになっています。おすすめの一冊があれば、ぜひ教えてください。" },
  ...over,
});

describe("X の文字数の数え方", () => {
  it("英数字は1、日本語は2、URLは23として数える", () => {
    expect(xWeightedLength("abc")).toBe(3);
    expect(xWeightedLength("あいう")).toBe(6);
    expect(xWeightedLength("見て https://example.com/very/long/path")).toBe(4 + 1 + 23);
  });

  it("全角140字までOK、141字はエラー", () => {
    const check = (n: number) =>
      validateAgainstCapabilities({ platform: "X", content: "あ".repeat(n), idempotencyKey: "k" }, PLATFORM_CAPABILITIES.X);
    expect(check(140).valid).toBe(true);
    const over = check(141);
    expect(over.valid).toBe(false);
    expect(over.errors[0]).toContain("日本語は1文字を2文字として数えます");
  });
});

describe("投稿案の品質チェック", () => {
  it("問題のない案はエラーなし", () => {
    expect(checkDraft(draft(), brand)).toEqual({ errors: [], warnings: [] });
  });

  it("禁止キーワードはエラー（全角・半角や大文字小文字の違いも検出）", () => {
    const result = checkDraft(draft({ threads: { text: "今だけ激安です" } }), brand);
    expect(result.errors.join()).toContain("禁止キーワード「激安」");
    expect(findProhibitedWords("ＳＡＬＥ中", ["sale"])).toEqual(["sale"]);
  });

  it("文字数オーバーはエラー（X は日本語を2文字で数える）", () => {
    const result = checkDraft(draft({ x: { text: "あ".repeat(141) } }), brand);
    expect(result.errors.join()).toContain("Xの文章が長すぎます（282/280文字）");
  });

  it("Instagram のハッシュタグは30個を超えるとエラー、X は3個以上で警告", () => {
    const tags = Array.from({ length: 31 }, (_, i) => `#tag${i}`);
    expect(checkDraft(draft({ instagram: { caption: "本文", hashtags: tags } }), brand).errors.join()).toContain("31個");
    expect(checkDraft(draft({ x: { text: "本文 #a #b #c" } }), brand).warnings.join()).toContain("Xのハッシュタグが多め");
  });

  it("URL を含むと警告、空の文章はエラー", () => {
    expect(checkDraft(draft({ x: { text: "https://example.com を見て" } }), brand).warnings.join()).toContain("URL");
    expect(checkDraft(draft({ threads: { text: " " } }), brand).errors.join()).toContain("Threadsの文章が空");
  });

  it("Instagram はキャプションの後にハッシュタグを付ける。# がなければ補う", () => {
    expect(instagramContent(draft({ instagram: { caption: "本文", hashtags: ["大阪", "#カフェ"] } }))).toBe("本文\n\n#大阪 #カフェ");
    expect(draftTexts(draft()).X).toBe(draft().x.text);
  });

  it("X の文章が同じ案を重複として見つける", () => {
    expect([...findDuplicates([draft(), draft({ style: "howto" }), draft({ x: { text: "別の文章" } })])]).toEqual([1]);
  });
});

describe("プロンプト", () => {
  it("システムプロンプトは prompts/ の各ファイルを読み込む", () => {
    const system = systemPrompt();
    expect(system).toContain("ブランド紹介型");
    expect(system).toContain("## X（旧Twitter）");
    expect(system).toContain("## Instagram");
    expect(system).toContain("## Threads");
  });

  it("ブランド情報・テーマ・依頼する型・作り直しの指摘を含める", () => {
    const prompt = userPrompt({
      topic: "週末の過ごし方",
      objective: "平日昼の利用を増やしたい",
      brand,
      styles: ["story", "question"],
      feedback: [{ style: "story", issues: ["禁止キーワード「激安」が含まれています"] }],
    });
    expect(prompt).toContain("ブランド名：Lounge+");
    expect(prompt).toContain("禁止キーワード（絶対に使わない）：激安");
    expect(prompt).toContain("テーマ：週末の過ごし方");
    expect(prompt).toContain("今回の目的：平日昼の利用を増やしたい");
    expect(prompt).toContain("2 案");
    expect(prompt).toContain("story（ストーリー型）、question（質問型）");
    expect(prompt).toContain("必ず直してください");
  });
});

// Anthropic SDK の代わりに、送ったリクエストを記録して決まった応答を返す
function fakeClient(response: unknown | (() => never)) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        parse: async (params: Record<string, unknown>) => {
          calls.push(params);
          if (typeof response === "function") return (response as () => never)();
          return response;
        },
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

const okResponse = {
  model: DEFAULT_MODEL,
  stop_reason: "end_turn",
  stop_details: null,
  usage: { input_tokens: 1000, output_tokens: 800 },
  parsed_output: { drafts: [draft()] },
};

describe("ClaudeProvider", () => {
  it("Sonnet・構造化出力・effort・フォールバックを指定して呼ぶ", async () => {
    const { client, calls } = fakeClient(okResponse);
    const result = await new ClaudeProvider(DEFAULT_MODEL, "medium", client).generate({ topic: "x", brand, styles: ["story"] });
    expect(result.drafts).toHaveLength(1);
    expect(result.usage).toEqual({ inputTokens: 1000, outputTokens: 800 });
    const params = calls[0] as {
      model: string;
      betas: string[];
      fallbacks: unknown;
      output_config: { effort: string; format: unknown };
      system: string;
      messages: { content: string }[];
    };
    expect(params.model).toBe("claude-sonnet-5-5");
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(params.fallbacks).toBe("default");
    expect(params.output_config.effort).toBe("medium");
    expect(params.output_config.format).toBeDefined();
    expect(params.system).toContain("SNS運用担当者");
    expect(params.messages[0].content).toContain("ブランド名：Lounge+");
    expect(params).not.toHaveProperty("temperature");
  });

  it("モデルが断った場合は REFUSAL", async () => {
    const { client } = fakeClient({ ...okResponse, stop_reason: "refusal", stop_details: { category: "cyber" }, parsed_output: null });
    await expect(new ClaudeProvider(DEFAULT_MODEL, "medium", client).generate({ topic: "x", brand, styles: ["story"] })).rejects.toMatchObject({
      kind: "REFUSAL",
    });
  });

  it("出力を読み取れない・途中で切れた場合は INVALID_OUTPUT", async () => {
    const { client } = fakeClient({ ...okResponse, stop_reason: "max_tokens", parsed_output: null });
    await expect(new ClaudeProvider(DEFAULT_MODEL, "medium", client).generate({ topic: "x", brand, styles: ["story"] })).rejects.toMatchObject({
      kind: "INVALID_OUTPUT",
    });
  });

  it("APIキーが無効なら AUTH、混雑なら RATE_LIMIT（ユーザー向けの文になる）", async () => {
    const auth = fakeClient(() => {
      throw new Anthropic.AuthenticationError(401, {}, "invalid x-api-key", new Headers());
    });
    const err = await new ClaudeProvider(DEFAULT_MODEL, "medium", auth.client).generate({ topic: "x", brand, styles: ["story"] }).catch((e) => e);
    expect(err).toBeInstanceOf(AIError);
    expect(err.kind).toBe("AUTH");
    expect(err.message).toContain("ANTHROPIC_API_KEY");

    const rate = fakeClient(() => {
      throw new Anthropic.RateLimitError(429, {}, "rate limited", new Headers());
    });
    await expect(new ClaudeProvider(DEFAULT_MODEL, "medium", rate.client).generate({ topic: "x", brand, styles: ["story"] })).rejects.toMatchObject({
      kind: "RATE_LIMIT",
    });
  });
});

describe("MockAIProvider", () => {
  it("依頼した型の数だけ案を返す", async () => {
    const result = await new MockAIProvider().generate({ topic: "週末", brand, styles: [...DRAFT_STYLES] });
    expect(result.drafts.map((d) => d.style)).toEqual([...DRAFT_STYLES]);
    for (const d of result.drafts) expect(checkDraft(d, brand).errors).toEqual([]);
  });
});

describe("投稿の長さと、過去の投稿との重複", async () => {
  const { lengthIssue, similarity, findSimilarPast, RECOMMENDED_LENGTH } = await import("@/lib/ai/quality");

  it("SNSごとの目安より短い・長い文章は作り直しの対象", () => {
    expect(lengthIssue(draft(), "X")).toBeNull();
    expect(lengthIssue(draft({ x: { text: "短い" } }), "X")).toContain("短すぎ");
    expect(lengthIssue(draft({ threads: { text: "あ".repeat(RECOMMENDED_LENGTH.THREADS.max + 1) } }), "THREADS")).toContain("長すぎ");
    // Instagram はハッシュタグを除いた本文で数える
    expect(lengthIssue(draft({ instagram: { caption: "短い本文", hashtags: Array(20).fill("#長いハッシュタグです") } }), "INSTAGRAM")).toContain("短すぎ");
    expect(checkDraft(draft({ x: { text: "短い" } }), brand).errors.join()).toContain("Xの文章が短すぎます");
  });

  it("文章の似ている度合い：同じ文章は1、違う話題は低い（記号・空白・ハッシュタグは無視）", () => {
    expect(similarity("週末は読書の時間に。", "週末は 読書の時間に！ #大阪")).toBe(1);
    expect(similarity("週末は読書の時間に。静かな席で過ごしましょう", "新メニューのホットチョコレートが始まりました")).toBeLessThan(0.3);
  });

  it("過去の投稿と似すぎている案を見つける（短い文章どうしは比べない）", () => {
    const past = [{ label: "10/20(火) Threads", text: draft().threads.text }];
    const issues = findSimilarPast(draft(), past);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("Threadsの文章が、過去の投稿（10/20(火) Threads）と似すぎています");
    expect(findSimilarPast(draft(), [{ label: "x", text: "ありがとう" }])).toEqual([]);
    expect(findSimilarPast(draft(), [{ label: "x", text: "新メニューのホットチョコレートが始まりました。寒い日にぴったりの一杯です" }])).toEqual([]);
  });
});

describe("これまでの投稿をAIに渡す", async () => {
  const { userPrompt, planUserPrompt } = await import("@/lib/ai/prompts");
  it("投稿案の依頼に、これまでの投稿（新しい順）を入れる", () => {
    const text = userPrompt({ topic: "週末", brand, styles: ["story"], history: [{ label: "10/20(火) Threads", text: "雨の日の過ごし方" }] });
    expect(text).toContain("# これまでの投稿");
    expect(text).toContain("- 10/20(火) Threads：雨の日の過ごし方");
    expect(userPrompt({ topic: "週末", brand, styles: ["story"] })).not.toContain("これまでの投稿");
  });
  it("AI エージェントの計画にも、SNS にある過去の投稿の本文を入れる", () => {
    const text = planUserPrompt({ brand, slots: [{ index: 0, label: "10/26(月) 12:00" }], history: [], pastPosts: [{ label: "10/20(火) Instagram", text: "新しい席のご紹介" }] });
    expect(text).toContain("SNS にある過去の投稿を含む");
    expect(text).toContain("新しい席のご紹介");
  });
});
