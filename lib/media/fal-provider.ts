import { createFalClient, type FalClient } from "@fal-ai/client";
import { MediaGenerationError } from "./errors";
import type { AspectRatio, GeneratedMedia, MediaGenerationOptions, MediaGenerationProvider, VideoGenerationOptions } from "./types";

// fal.ai で画像・動画を作る。モデルと入出力は公式クライアント（@fal-ai/client）の型定義で確認：
//   画像 fal-ai/flux-1/schnell：入力 { prompt, image_size, num_images, output_format } → 出力 { images: [{ url }] }
//   動画 fal-ai/kling-video/v2.5-turbo/pro/text-to-video：入力 { prompt, duration: "5"|"10", aspect_ratio } → 出力 { video: { url } }
// 返ってくる URL は fal.ai の公開URLで、そのまま保存・投稿に使う（保存期間は fal.ai の規約を確認すること）
export const DEFAULT_IMAGE_MODEL = "fal-ai/flux-1/schnell";
export const DEFAULT_VIDEO_MODEL = "fal-ai/kling-video/v2.5-turbo/pro/text-to-video";

const IMAGE_SIZES: Record<AspectRatio, string> = {
  "1:1": "square_hd",
  "4:5": "portrait_4_3",
  "9:16": "portrait_16_9",
  "16:9": "landscape_16_9",
};
// Kling が受け付ける比率は 16:9 / 9:16 / 1:1
const VIDEO_RATIOS: Record<AspectRatio, string> = { "1:1": "1:1", "4:5": "9:16", "9:16": "9:16", "16:9": "16:9" };

// 型定義のあるモデル以外も環境変数で指定できるよう、呼び出しは最小限の形に絞る
type SubscribeFn = (endpointId: string, options: { input: Record<string, unknown> }) => Promise<{ data: unknown }>;

export class FalAIProvider implements MediaGenerationProvider {
  readonly name = "FAL_AI" as const;
  private readonly subscribe: SubscribeFn;

  constructor(
    private readonly imageModel: string = process.env.FAL_IMAGE_MODEL || DEFAULT_IMAGE_MODEL,
    private readonly videoModel: string = process.env.FAL_VIDEO_MODEL || DEFAULT_VIDEO_MODEL,
    client?: Pick<FalClient, "subscribe">,
  ) {
    const fal = client ?? createFalClient({ credentials: process.env.FAL_KEY });
    this.subscribe = fal.subscribe.bind(fal) as unknown as SubscribeFn;
  }

  async generateImage(prompt: string, options: MediaGenerationOptions): Promise<GeneratedMedia> {
    const data = (await this.run(this.imageModel, {
      prompt,
      image_size: IMAGE_SIZES[options.aspectRatio],
      num_images: 1,
      output_format: "jpeg",
    })) as { images?: { url?: string }[] };
    const url = data.images?.[0]?.url;
    if (!url) throw new MediaGenerationError("UNAVAILABLE", "no image url in response");
    return { url, model: this.imageModel };
  }

  async generateVideo(prompt: string, options: VideoGenerationOptions): Promise<GeneratedMedia> {
    const data = (await this.run(this.videoModel, {
      prompt,
      duration: options.durationSeconds > 5 ? "10" : "5",
      aspect_ratio: VIDEO_RATIOS[options.aspectRatio],
    })) as { video?: { url?: string } };
    const url = data.video?.url;
    if (!url) throw new MediaGenerationError("UNAVAILABLE", "no video url in response");
    return { url, model: this.videoModel };
  }

  private async run(model: string, input: Record<string, unknown>): Promise<unknown> {
    if (!process.env.FAL_KEY?.trim()) throw new MediaGenerationError("NOT_CONFIGURED");
    try {
      const result = await this.subscribe(model, { input });
      return result.data;
    } catch (err) {
      const status = (err as { status?: number }).status;
      const detail = err instanceof Error ? err.message : String(err);
      if (status === 401 || status === 403) throw new MediaGenerationError("AUTH", detail);
      if (status === 429) throw new MediaGenerationError("RATE_LIMIT", detail);
      if (status === 400 || status === 422) throw new MediaGenerationError("REJECTED", detail);
      throw new MediaGenerationError("UNAVAILABLE", detail);
    }
  }
}
