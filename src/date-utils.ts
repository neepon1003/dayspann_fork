export const DAY_MS = 86_400_000;

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

export type DayspannDisplayMode =
  | "days"
  | "months"
  | "years"
  | "months-days"
  | "years-months-days";

export const DEFAULT_DISPLAY_MODE: DayspannDisplayMode = "days";

export interface DayspannDisplayPart {
  value: number;
  unit: "day" | "month" | "year";
}

const DISPLAY_MODES = new Set<DayspannDisplayMode>([
  "days",
  "months",
  "years",
  "months-days",
  "years-months-days",
]);

export function parseDateKey(value: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function differenceInCalendarDays(
  targetDateKey: string,
  todayDateKey: string
): number {
  const target = parseDateKey(targetDateKey);
  const today = parseDateKey(todayDateKey);
  if (!target || !today) throw new Error("日付は YYYY-MM-DD 形式で入力してください");

  const targetTime = Date.UTC(target.year, target.month - 1, target.day);
  const todayTime = Date.UTC(today.year, today.month - 1, today.day);
  return Math.round((targetTime - todayTime) / DAY_MS);
}

/** 週の始まり。0 が日曜、1 が月曜です（JavaScript の getUTCDay と同じ番号です）。 */
export const WEEK_STARTS_ON = 0;

export function daysUntilEndOfWeek(todayDateKey: string): number {
  const today = parseDateKey(todayDateKey);
  if (!today) throw new Error("日付は YYYY-MM-DD 形式で入力してください");

  const weekday = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay();
  return (WEEK_STARTS_ON - weekday + 6) % 7;
}

export function normalizeDisplayMode(value: unknown): DayspannDisplayMode {
  return typeof value === "string" && DISPLAY_MODES.has(value as DayspannDisplayMode)
    ? (value as DayspannDisplayMode)
    : DEFAULT_DISPLAY_MODE;
}

export function formatDateSpan(
  firstDateKey: string,
  secondDateKey: string,
  mode: DayspannDisplayMode
): DayspannDisplayPart[] {
  const first = parseDateKey(firstDateKey);
  const second = parseDateKey(secondDateKey);
  if (!first || !second) throw new Error("日付は YYYY-MM-DD 形式で入力してください");

  const [start, end] = compareCalendarDates(first, second) <= 0
    ? [first, second]
    : [second, first];

  if (mode === "days") {
    return [{ value: calendarDayDifference(start, end), unit: "day" }];
  }

  const { months, days } = completedMonthsAndDays(start, end);
  if (mode === "months") return [{ value: months, unit: "month" }];
  if (mode === "years") return [{ value: Math.floor(months / 12), unit: "year" }];
  if (mode === "months-days") {
    return [
      { value: months, unit: "month" },
      { value: days, unit: "day" },
    ];
  }

  return [
    { value: Math.floor(months / 12), unit: "year" },
    { value: months % 12, unit: "month" },
    { value: days, unit: "day" },
  ];
}

function completedMonthsAndDays(
  start: CalendarDate,
  end: CalendarDate
): { months: number; days: number } {
  let months = (end.year - start.year) * 12 + (end.month - start.month);
  let anchor = addMonthsClamped(start, months);

  if (compareCalendarDates(anchor, end) > 0) {
    months -= 1;
    anchor = addMonthsClamped(start, months);
  }

  return { months, days: calendarDayDifference(anchor, end) };
}

function addMonthsClamped(date: CalendarDate, months: number): CalendarDate {
  const zeroBasedMonth = date.month - 1 + months;
  const year = date.year + Math.floor(zeroBasedMonth / 12);
  const month = ((zeroBasedMonth % 12) + 12) % 12 + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { year, month, day: Math.min(date.day, lastDay) };
}

function calendarDayDifference(start: CalendarDate, end: CalendarDate): number {
  const startTime = Date.UTC(start.year, start.month - 1, start.day);
  const endTime = Date.UTC(end.year, end.month - 1, end.day);
  return Math.round((endTime - startTime) / DAY_MS);
}

function compareCalendarDates(first: CalendarDate, second: CalendarDate): number {
  if (first.year !== second.year) return first.year - second.year;
  if (first.month !== second.month) return first.month - second.month;
  return first.day - second.day;
}

export function formatLocalizedDate(dateKey: string, locale: "ja" | "en"): string {
  const value = parseDateKey(dateKey);
  if (!value) return dateKey;
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day, 12));
  return new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en-US", {
    year: "numeric",
    month: locale === "ja" ? "long" : "short",
    day: "numeric",
    weekday: "short",
    timeZone: "UTC",
  }).format(date);
}
