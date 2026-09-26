import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "@/lib/encryption/crypto";

describe("トークン暗号化", () => {
  it("暗号化して復号すると元に戻る", () => {
    const token = "secret-access-token-あいう";
    expect(decrypt(encrypt(token))).toBe(token);
  });

  it("同じ値でも毎回異なる暗号文になり、平文を含まない", () => {
    const a = encrypt("same");
    const b = encrypt("same");
    expect(a).not.toBe(b);
    expect(a).not.toContain("same");
  });

  it("改ざんされた暗号文は復号できない", () => {
    const parts = encrypt("value").split(".");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decrypt(parts.join("."))).toThrow();
  });

  it("キーが不正な長さならエラー", () => {
    const original = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = Buffer.alloc(16).toString("base64");
    try {
      expect(() => encrypt("x")).toThrow(/32バイト/);
    } finally {
      process.env.ENCRYPTION_KEY = original;
    }
  });
});
