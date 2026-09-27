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

  it("Instagram は画像URLが必須。https の公開URLのみ受け付ける", () => {
    const check2 = (mediaUrls?: string[]) =>
      validateAgainstCapabilities({ platform: "INSTAGRAM", content: "キャプション", mediaUrls, idempotencyKey: "k" }, PLATFORM_CAPABILITIES.INSTAGRAM);
    expect(check2().errors[0]).toContain("画像のURLを入力してください");
    expect(check2(["http://example.com/a.jpg"]).valid).toBe(false);
    expect(check2(["https://example.com/a.jpg"]).valid).toBe(true);
  });
});

describe("入力スキーマ", () => {
  it("投稿先アカウント未選択はエラー", () => {
    expect(postInputSchema.safeParse({ title: "t", targets: [] }).success).toBe(false);
  });

  it("同じアカウントの重複はエラー。同じSNSの別アカウントはOK", () => {
    const dup = postInputSchema.safeParse({
      title: "t",
      targets: [
        { socialAccountId: "a1", content: "a" },
        { socialAccountId: "a1", content: "b" },
      ],
    });
    expect(dup.success).toBe(false);
    const two = postInputSchema.safeParse({
      title: "t",
      targets: [
        { socialAccountId: "a1", content: "a" },
        { socialAccountId: "a2", content: "b" },
      ],
    });
    expect(two.success).toBe(true);
  });

  it("タイトル必須・前後の空白は除去", () => {
    expect(postInputSchema.safeParse({ title: "  ", targets: [{ socialAccountId: "a1", content: "" }] }).success).toBe(false);
    const ok = postInputSchema.parse({ title: " 投稿 ", targets: [{ socialAccountId: "a1", content: "" }] });
    expect(ok.title).toBe("投稿");
    expect(ok.topic).toBe("");
  });

  it("予約日時は ISO 文字列から Date に変換、不正ならエラー", () => {
    expect(scheduleInputSchema.parse({ scheduledAt: "2030-01-01T00:00:00.000Z" }).scheduledAt).toBeInstanceOf(Date);
    expect(scheduleInputSchema.safeParse({ scheduledAt: "not-a-date" }).success).toBe(false);
  });
});
