import {
  DRAFT_STYLES,
  DRAFT_STYLE_LABELS,
  type AIProvider,
  type GenerateRequest,
  type GenerateResult,
  type MediaPromptRequest,
  type MediaPromptResult,
  type PlanRequest,
  type PlanResult,
  type PostDraft,
} from "./types";

// APIキー未設定時・テスト用の Mock。AI を呼ばずに、テーマとブランド名から決まった投稿案を返す。
// テーマに「#mock-prohibited」を含めると、禁止ワード入りの案を返す（品質チェックと作り直しの確認用）
export const MOCK_AI_PROHIBITED_TRIGGER = "#mock-prohibited";

export class MockAIProvider implements AIProvider {
  readonly name = "mock";
  calls: GenerateRequest[] = [];

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    this.calls.push(request);
    const brand = request.brand?.name ?? "私たち";
    const topic = request.topic.replace(MOCK_AI_PROHIBITED_TRIGGER, "").trim() || "日々のこと";
    // 作り直し（feedback あり）のときは禁止ワードを入れない
    const banned =
      request.topic.includes(MOCK_AI_PROHIBITED_TRIGGER) && !request.feedback?.length ? request.brand?.prohibitedWords[0] : undefined;

    const drafts: PostDraft[] = request.styles.map((style, i) => {
      const label = DRAFT_STYLE_LABELS[style];
      const extra = banned && i === 0 ? `${banned}な` : "";
      return {
        style,
        title: `${topic}（${label}）`,
        summary: `${label}で「${topic}」を伝える案`,
        x: { text: `【${label}】${brand}の${extra}「${topic}」。ふらっと立ち寄ってみませんか。` },
        instagram: {
          caption: `${brand}より、${topic}のお知らせです。\n\n${label}の案 ${i + 1}。\nくわしくはプロフィールのリンクから。`,
          hashtags: ["#大阪", `#${brand.replace(/[^\p{L}\p{N}_]/gu, "")}`],
        },
        threads: { text: `${topic}、みなさんはどう過ごしていますか？（${label}）` },
      };
    });
    return { drafts, model: "mock", usage: { inputTokens: 0, outputTokens: 0 } };
  }

  async mediaPrompt(request: MediaPromptRequest): Promise<MediaPromptResult> {
    return {
      prompt: `${request.type === "VIDEO" ? "Short video" : "Photo"} of ${request.idea}, natural light, no text, no logo`,
      script: request.type === "VIDEO" ? `0〜3秒：${request.idea}の全景／3〜7秒：近づく／7〜10秒：余韻` : "",
      model: "mock",
    };
  }

  // 投稿テーマの柱と型を順番に割り当てる
  planCalls: PlanRequest[] = [];
  async planWeek(request: PlanRequest): Promise<PlanResult> {
    this.planCalls.push(request);
    const pillars = request.brand.contentPillars.length > 0 ? request.brand.contentPillars : ["ブランド紹介"];
    return {
      model: "mock",
      items: request.slots.map((slot, i) => ({
        slotIndex: slot.index,
        pillar: pillars[i % pillars.length],
        topic: `${pillars[i % pillars.length]}：${slot.label}のおすすめ`,
        style: DRAFT_STYLES[i % DRAFT_STYLES.length],
        reason: `${slot.label}の枠に、最近使っていない柱を割り当てました`,
        imageIdea: `${request.brand.name}の店内で過ごす${pillars[i % pillars.length]}の様子`,
      })),
    };
  }
}
