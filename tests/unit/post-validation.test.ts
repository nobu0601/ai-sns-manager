import { describe, expect, it } from "vitest";
import { PLATFORM_CAPABILITIES } from "@/lib/social/capabilities";
import { validateAgainstCapabilities } from "@/lib/social/validate";
import { postInputSchema, scheduleInputSchema } from "@/lib/validation/schemas";

const check = (platform: "X" | "INSTAGRAM" | "THREADS", content: string) =>
  validateAgainstCapabilities({ platform, content, idempotencyKey: "k" }, PLATFORM_CAPABILITIES[platform]);

describe("SNS別の投稿チェック", () => {
  it("空の投稿はエラー", () => {
    expect(check("X", "   ").errors).toHaveLength(1);
  });

  it("最大文字数ちょうどはOK、超えるとエラー", () => {
    const max = PLATFORM_CAPABILITIES.X.maxTextLength!;
    expect(check("X", "あ".repeat(max)).valid).toBe(true);
    const over = check("X", "あ".repeat(max + 1));
    expect(over.valid).toBe(false);
    expect(over.errors[0]).toContain(`${max}文字以内`);
  });

  it("絵文字は1文字として数える", () => {
    const max = PLATFORM_CAPABILITIES.THREADS.maxTextLength!;
    expect(check("THREADS", "😀".repeat(max)).valid).toBe(true);
  });

  it("Instagram はメディアなしだと警告（エラーではない）", () => {
    const result = check("INSTAGRAM", "キャプション");
    expect(result.valid).toBe(true);
    expect(result.warnings[0]).toContain("画像または動画");
  });
});

describe("入力スキーマ", () => {
  it("SNS未選択はエラー", () => {
    expect(postInputSchema.safeParse({ title: "t", platforms: [] }).success).toBe(false);
  });

  it("同じSNSの重複はエラー", () => {
    const result = postInputSchema.safeParse({
      title: "t",
      platforms: [
        { platform: "X", content: "a" },
        { platform: "X", content: "b" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("タイトル必須・前後の空白は除去", () => {
    expect(postInputSchema.safeParse({ title: "  ", platforms: [{ platform: "X", content: "" }] }).success).toBe(false);
    const ok = postInputSchema.parse({ title: " 投稿 ", platforms: [{ platform: "X", content: "" }] });
    expect(ok.title).toBe("投稿");
    expect(ok.topic).toBe("");
  });

  it("予約日時は ISO 文字列から Date に変換、不正ならエラー", () => {
    expect(scheduleInputSchema.parse({ scheduledAt: "2030-01-01T00:00:00.000Z" }).scheduledAt).toBeInstanceOf(Date);
    expect(scheduleInputSchema.safeParse({ scheduledAt: "not-a-date" }).success).toBe(false);
  });
});
