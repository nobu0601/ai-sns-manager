import type { MediaType } from "@prisma/client";

export type AspectRatio = "1:1" | "4:5" | "9:16" | "16:9";

export interface GeneratedMedia {
  url: string;
  model: string;
}

export interface MediaGenerationOptions {
  aspectRatio: AspectRatio;
}

export interface VideoGenerationOptions extends MediaGenerationOptions {
  durationSeconds: number;
}

// 画像生成の呼び出し先
export interface ImageGenerationProvider {
  generateImage(prompt: string, options: MediaGenerationOptions): Promise<GeneratedMedia>;
}

// 動画生成の呼び出し先
export interface VideoGenerationProvider {
  generateVideo(prompt: string, options: VideoGenerationOptions): Promise<GeneratedMedia>;
}

export interface MediaGenerationProvider extends ImageGenerationProvider, VideoGenerationProvider {
  readonly name: "FAL_AI" | "MOCK";
}

export const MEDIA_TYPE_LABELS: Record<MediaType, string> = { IMAGE: "画像", VIDEO: "動画" };
