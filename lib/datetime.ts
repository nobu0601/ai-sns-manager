// 表示・集計の基準タイムゾーン。日本はサマータイムが無いため固定オフセットで計算できる。
export const APP_TIMEZONE = "Asia/Tokyo";
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

// JST のカレンダー上の年月日（month は 1〜12）
export function jstParts(date: Date): { year: number; month: number; day: number; weekday: number } {
  const shifted = new Date(date.getTime() + JST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

// JST の年月日 00:00 を表す Date
export function jstDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day) - JST_OFFSET_MS);
}

export function startOfJstDay(date: Date): Date {
  const { year, month, day } = jstParts(date);
  return jstDate(year, month, day);
}

// [start, end) の範囲
export function jstDayRange(date: Date): { start: Date; end: Date } {
  const start = startOfJstDay(date);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

export function jstMonthRange(year: number, month: number): { start: Date; end: Date } {
  return { start: jstDate(year, month, 1), end: jstDate(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1) };
}

// 週の開始を月曜とした範囲
export function jstWeekRange(date: Date): { start: Date; end: Date } {
  const { weekday } = jstParts(date);
  const diff = (weekday + 6) % 7;
  const start = new Date(startOfJstDay(date).getTime() - diff * 24 * 60 * 60 * 1000);
  return { start, end: new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000) };
}

// "YYYY-MM" を解釈する。不正なら null
export function parseYearMonth(value: string | null | undefined): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? { year, month } : null;
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "-";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

// 予約までの待ち時間（ms）。過去日時は即時（0）
export function delayUntil(runAt: Date, now: Date = new Date()): number {
  return Math.max(0, runAt.getTime() - now.getTime());
}

// 予約日時として受け付けるか。操作中の数秒の遅れを許容する
export const SCHEDULE_GRACE_MS = 60 * 1000;
export function isValidScheduleTime(runAt: Date, now: Date = new Date()): boolean {
  return !Number.isNaN(runAt.getTime()) && runAt.getTime() >= now.getTime() - SCHEDULE_GRACE_MS;
}
