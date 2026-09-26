import { jstDate, jstParts } from "./datetime";

export type CalendarCell = { year: number; month: number; day: number; inMonth: boolean; key: string };

// 月曜始まりの月カレンダー（前後月の日付で埋めて週単位にする）
export function buildMonthGrid(year: number, month: number): CalendarCell[][] {
  const first = jstDate(year, month, 1);
  const offset = (jstParts(first).weekday + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const totalCells = Math.ceil((offset + daysInMonth) / 7) * 7;

  const cells: CalendarCell[] = [];
  for (let i = 0; i < totalCells; i++) {
    const d = jstParts(new Date(first.getTime() + (i - offset) * 24 * 60 * 60 * 1000));
    cells.push({ ...d, inMonth: d.month === month, key: `${d.year}-${d.month}-${d.day}` });
  }
  const weeks: CalendarCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function formatYearMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}
