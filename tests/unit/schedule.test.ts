import { describe, expect, it } from "vitest";
import { buildMonthGrid, shiftMonth } from "@/lib/calendar";
import {
  delayUntil,
  isValidScheduleTime,
  jstDayRange,
  jstMonthRange,
  jstParts,
  jstWeekRange,
  parseYearMonth,
} from "@/lib/datetime";
import { MAX_PUBLISH_ATTEMPTS, retryDelayMs } from "@/lib/queue/retry";
import { jobIdFor } from "@/lib/queue/post-queue";

describe("予約日時の計算", () => {
  const now = new Date("2026-09-26T03:00:00.000Z");

  it("予約までの待ち時間。過去は0", () => {
    expect(delayUntil(new Date("2026-09-26T03:10:00.000Z"), now)).toBe(10 * 60 * 1000);
    expect(delayUntil(new Date("2026-09-26T02:00:00.000Z"), now)).toBe(0);
  });

  it("過去日時は予約不可（1分以内の遅れは許容）", () => {
    expect(isValidScheduleTime(new Date("2026-09-26T03:05:00.000Z"), now)).toBe(true);
    expect(isValidScheduleTime(new Date("2026-09-26T02:59:30.000Z"), now)).toBe(true);
    expect(isValidScheduleTime(new Date("2026-09-26T02:50:00.000Z"), now)).toBe(false);
    expect(isValidScheduleTime(new Date("invalid"), now)).toBe(false);
  });

  it("JST の日付境界で1日を区切る", () => {
    // UTC 15:30 は JST 翌日 0:30
    const d = new Date("2026-09-25T15:30:00.000Z");
    expect(jstParts(d)).toMatchObject({ year: 2026, month: 9, day: 26 });
    const { start, end } = jstDayRange(d);
    expect(start.toISOString()).toBe("2026-09-25T15:00:00.000Z");
    expect(end.toISOString()).toBe("2026-09-26T15:00:00.000Z");
  });

  it("月の範囲（12月→翌年1月）", () => {
    const { start, end } = jstMonthRange(2026, 12);
    expect(start.toISOString()).toBe("2026-11-30T15:00:00.000Z");
    expect(end.toISOString()).toBe("2026-12-31T15:00:00.000Z");
  });

  it("週は月曜始まり", () => {
    // 2026-09-27 は日曜
    const { start } = jstWeekRange(new Date("2026-09-27T05:00:00.000Z"));
    expect(jstParts(start)).toMatchObject({ month: 9, day: 21, weekday: 1 });
  });

  it("YYYY-MM の解釈", () => {
    expect(parseYearMonth("2026-09")).toEqual({ year: 2026, month: 9 });
    expect(parseYearMonth("2026-13")).toBeNull();
    expect(parseYearMonth("abc")).toBeNull();
  });
});

describe("カレンダー", () => {
  it("2026年9月は火曜始まり。月曜始まりの5週で表示", () => {
    const weeks = buildMonthGrid(2026, 9);
    expect(weeks).toHaveLength(5);
    expect(weeks[0][0]).toMatchObject({ month: 8, day: 31, inMonth: false });
    expect(weeks[0][1]).toMatchObject({ month: 9, day: 1, inMonth: true });
    expect(weeks.flat().filter((c) => c.inMonth)).toHaveLength(30);
  });

  it("月の移動", () => {
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
  });
});

describe("リトライ", () => {
  it("30秒 → 2分の順で待つ", () => {
    expect(MAX_PUBLISH_ATTEMPTS).toBe(3);
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(2)).toBe(120_000);
    expect(retryDelayMs(5)).toBe(120_000);
  });

  it("ジョブIDは冪等キーから決まり、':' を含まない", () => {
    expect(jobIdFor("post1:X")).toBe("publish_post1_X");
    expect(jobIdFor("post1:X")).toBe(jobIdFor("post1:X"));
  });
});
