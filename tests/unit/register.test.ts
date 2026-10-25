import { describe, expect, it } from "vitest";
import { isRegistrationAllowed } from "@/lib/auth/register";

describe("新規登録の制限（ALLOWED_EMAILS）", () => {
  it("未設定なら誰でも登録できる", () => {
    expect(isRegistrationAllowed("a@example.com", "")).toBe(true);
    expect(isRegistrationAllowed("a@example.com", undefined)).toBe(true);
  });
  it("設定すると、そのメールアドレスだけ登録できる（大文字小文字・空白は無視）", () => {
    expect(isRegistrationAllowed(" A@Example.com ", "a@example.com, b@example.com")).toBe(true);
    expect(isRegistrationAllowed("c@example.com", "a@example.com,b@example.com")).toBe(false);
  });
});
