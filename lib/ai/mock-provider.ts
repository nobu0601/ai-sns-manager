import {
  DRAFT_STYLES,
  DRAFT_STYLE_LABELS,
  type AIProvider,
  type AnalysisRequest,
  type AnalysisResult,
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

const MOCK_FILLERS = [
  {
    x: "仕事の合間にひと息つきたいとき、静かな席で自分のペースを取り戻してみませんか。",
    instagram:
      "忙しい毎日の中で、少しだけ立ち止まれる時間をつくりたい。そんな気持ちに寄り添える場所でありたいと考えています。\n\n静かな席で集中したい日も、ゆっくり考えごとをしたい日も、自分のペースで過ごしてください。ドリンクを片手に、気持ちを切り替えるひとときをどうぞ。",
    threads: "ちょっとした気分転換のコツがあれば、ぜひ教えてください。",
  },
  {
    x: "予定のすき間に、気持ちを整える小さな寄り道はいかがですか。ゆっくりどうぞ。",
    instagram:
      "今日はいつもと少し違う視点でお届けします。予定と予定のあいだにできた、ほんの少しの空き時間。その使い方ひとつで、一日の印象は変わるものです。\n\n落ち着いた空間で、読みかけの本を開いたり、明日の段取りを考えたり。自分だけの小さな寄り道を楽しんでください。",
    threads: "最近うれしかった小さな寄り道、よかったら聞かせてください。",
  },
];

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

    // 作り直しで「過去の投稿と似すぎ」と言われたら、別の言い回しにする
    const variant = request.feedback?.some((f) => f.issues.some((x) => x.includes("似すぎ"))) ? 1 : 0;
    const fill = MOCK_FILLERS[variant];

    // 文字数は各SNSの目安（quality.ts の RECOMMENDED_LENGTH）に収まる長さにしている
    const drafts: PostDraft[] = request.styles.map((style, i) => {
      const label = DRAFT_STYLE_LABELS[style];
      const extra = banned && i === 0 ? `${banned}な` : "";
      return {
        style,
        title: `${topic}（${label}）`,
        summary: `${label}で「${topic}」を伝える案`,
        x: { text: `【${label}】${brand}の${extra}「${topic}」。${fill.x}` },
        instagram: {
          caption: `${brand}より、${topic}のお知らせです。\n\n${label}の案 ${i + 1}。\n${fill.instagram}\n\nくわしくはプロフィールのリンクから。`,
          hashtags: ["#大阪", `#${brand.replace(/[^\p{L}\p{N}_]/gu, "")}`],
        },
        threads: { text: `${topic}、みなさんはどう過ごしていますか？（${label}）${fill.threads}` },
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
    // 分析の次回投稿案があれば、先頭の枠から使う（分析が計画に反映されることの確認用）
    const ideas = request.insights?.nextIdeas ?? [];
    return {
      model: "mock",
      items: request.slots.map((slot, i) => ({
        slotIndex: slot.index,
        pillar: pillars[i % pillars.length],
        topic: ideas[i] ? `${ideas[i].topic}` : `${pillars[i % pillars.length]}：${slot.label}のおすすめ`,
        style: DRAFT_STYLES[i % DRAFT_STYLES.length],
        reason: ideas[i] ? `分析の次回投稿案「${ideas[i].topic}」を使いました` : `${slot.label}の枠に、最近使っていない柱を割り当てました`,
        imageIdea: `${request.brand.name}の店内で過ごす${pillars[i % pillars.length]}の様子`,
      })),
    };
  }

  // 渡された数値だけから、決まった形の分析を返す（反応の多い柱・時間帯を選ぶ）
  analyzeCalls: AnalysisRequest[] = [];
  async analyze(request: AnalysisRequest): Promise<AnalysisResult> {
    this.analyzeCalls.push(request);
    const best = (groups: AnalysisRequest["byPillar"]) =>
      [...groups].filter((g) => g.avgReactions !== null).sort((a, b) => b.avgReactions! - a.avgReactions!)[0];
    const pillar = best(request.byPillar);
    const band = best(request.byTimeBand);
    const refsOf = (pred: (p: AnalysisRequest["posts"][number]) => boolean) => request.posts.filter(pred).map((p) => p.ref).slice(0, 3);
    const top = [...request.posts].filter((p) => p.reactions !== null).sort((a, b) => b.reactions! - a.reactions!)[0];
    const pillars = request.brand.contentPillars.length > 0 ? request.brand.contentPillars : [pillar?.key ?? "ブランド紹介"];
    const mainPillar = pillar && pillars.includes(pillar.key) ? pillar.key : pillars[0];
    return {
      model: "mock",
      summary: `${request.posts.length}件の投稿を分析しました。${pillar ? `「${pillar.key}」の投稿の反応が多い傾向です。` : ""}`,
      goodThemes: pillar ? [{ theme: pillar.key, reason: `平均の反応が${pillar.avgReactions}で最も多い`, evidence: refsOf((p) => (p.pillar ?? "（柱なし）") === pillar.key) }] : [],
      textTrends: top ? [{ finding: `反応が最も多い投稿は「${top.title}」です`, evidence: [top.ref] }] : [],
      timeTrends: band ? [{ finding: `${band.key}の投稿の反応が多い傾向です`, evidence: refsOf((p) => p.timeBand === band.key) }] : [],
      nextIdeas: [0, 1, 2].map((i) => {
        const ideaPillar = i === 0 ? mainPillar : pillars[i % pillars.length];
        return {
          title: `${ideaPillar}の投稿案${i + 1}`,
          topic: `${ideaPillar}：反応が良かった投稿の続き（案${i + 1}）`,
          pillar: ideaPillar,
          reason: i === 0 ? "反応が良かったテーマを続けるため" : "投稿テーマの柱が偏らないようにするため",
        };
      }),
    };
  }
}
