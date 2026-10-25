import { randomUUID } from "node:crypto";
import type { AspectRatio, GeneratedMedia, MediaGenerationOptions, MediaGenerationProvider, VideoGenerationOptions } from "./types";

// FAL_KEY 未設定時・テスト用。画像は公開のプレースホルダー画像、動画は架空の URL を返す（動画は再生できない）
const SIZES: Record<AspectRatio, string> = { "1:1": "1080x1080", "4:5": "1080x1350", "9:16": "1080x1920", "16:9": "1920x1080" };

export class MockMediaProvider implements MediaGenerationProvider {
  readonly name = "MOCK" as const;
  calls: { type: "IMAGE" | "VIDEO"; prompt: string }[] = [];

  async generateImage(prompt: string, options: MediaGenerationOptions): Promise<GeneratedMedia> {
    this.calls.push({ type: "IMAGE", prompt });
    return { url: `https://placehold.co/${SIZES[options.aspectRatio]}/png?text=Mock+Image`, model: "mock-image" };
  }

  async generateVideo(prompt: string, _options: VideoGenerationOptions): Promise<GeneratedMedia> {
    this.calls.push({ type: "VIDEO", prompt });
    return { url: `https://mock.example.com/videos/${randomUUID()}.mp4`, model: "mock-video" };
  }
}
