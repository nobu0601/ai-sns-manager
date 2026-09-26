import { describe, expect, it } from "vitest";
import { computePostStatus, initialApprovalStatus, isApproved, isEditable } from "@/lib/posts/status";
import { redact } from "@/lib/logging/logger";
import { userMessageFor } from "@/lib/errors/user-messages";

describe("投稿全体の状態", () => {
  it.each([
    [[], true, "DRAFT"],
    [["DRAFT", "DRAFT"], true, "READY"],
    [["DRAFT"], false, "DRAFT"],
    [["SCHEDULED", "SCHEDULED"], true, "SCHEDULED"],
    [["POSTING", "SCHEDULED"], true, "POSTING"],
    [["PUBLISHED", "PUBLISHED"], true, "PUBLISHED"],
    [["PUBLISHED", "FAILED"], true, "FAILED"],
    [["PUBLISHED", "SCHEDULED"], true, "SCHEDULED"],
    [["PUBLISHED", "CANCELLED"], true, "PUBLISHED"],
    [["CANCELLED"], true, "CANCELLED"],
  ] as const)("%j → %s", (statuses, hasAll, expected) => {
    expect(computePostStatus([...statuses], hasAll)).toBe(expected);
  });
});

describe("承認", () => {
  it("初期値：常に承認モードでは承認待ち", () => {
    expect(initialApprovalStatus("ALWAYS", "manual")).toBe("PENDING");
    expect(initialApprovalStatus("AI_ONLY", "manual")).toBe("NOT_REQUIRED");
    expect(initialApprovalStatus("AI_ONLY", "ai")).toBe("PENDING");
    expect(initialApprovalStatus("AUTO", "ai")).toBe("NOT_REQUIRED");
  });

  it("承認済み・承認不要のみ投稿可", () => {
    expect(isApproved("APPROVED")).toBe(true);
    expect(isApproved("NOT_REQUIRED")).toBe(true);
    expect(isApproved("PENDING")).toBe(false);
    expect(isApproved("REJECTED")).toBe(false);
  });

  it("投稿中・投稿済みは編集不可", () => {
    expect(isEditable("POSTING")).toBe(false);
    expect(isEditable("PUBLISHED")).toBe(false);
    expect(isEditable("FAILED")).toBe(true);
  });
});

describe("ログのマスク", () => {
  it("トークン・パスワード等のキーはマスクされる", () => {
    const masked = redact({ accessToken: "a", nested: { client_secret: "b", ok: 1 }, list: [{ password: "c" }] });
    expect(masked).toEqual({ accessToken: "[REDACTED]", nested: { client_secret: "[REDACTED]", ok: 1 }, list: [{ password: "[REDACTED]" }] });
  });
});

describe("ユーザー向けエラー文", () => {
  it("技術的なエラーコードを含めず、次の行動を示す", () => {
    const message = userMessageFor("AUTH", "INSTAGRAM");
    expect(message).toBe("Instagramとの接続が切れています。アカウント画面から再接続してください。");
    expect(message).not.toMatch(/OAuthException|190/);
  });
});
