import { describe, expect, it } from "vitest";
import { BRAND_TEXT_MAX, brandInputSchema } from "@/lib/validation/schemas";

describe("ブランドの入力の上限", () => {
  it("1欄1万字まで入力できる", () => {
    const long = "あ".repeat(BRAND_TEXT_MAX);
    const parsed = brandInputSchema.parse({ name: "Lounge+", description: long, targetAudience: long, tone: long });
    expect(parsed.description).toHaveLength(10000);
  });

  it("上限を超えたときは、どの欄かが分かる日本語で知らせる", () => {
    const result = brandInputSchema.safeParse({ name: "Lounge+", tone: "あ".repeat(BRAND_TEXT_MAX + 1) });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("文章トーンは10,000字以内にしてください");
  });

  it("キーワード・柱は1つ200字・100個まで", () => {
    expect(brandInputSchema.safeParse({ name: "a", contentPillars: Array.from({ length: 100 }, (_, i) => `柱${i}`) }).success).toBe(true);
    expect(brandInputSchema.safeParse({ name: "a", keywords: ["あ".repeat(201)] }).success).toBe(false);
  });
});
