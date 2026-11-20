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

export function readDateKey(value: unknown): string {
  const raw =
    value instanceof Date
      ? value.toISOString().slice(0, 10)
      : typeof value === "string"
        ? value.trim()
        : "";
  return parseDateKey(raw) ? raw : "";
}

/** 完了バッジ用の日付。今年なら 11/13、別の年なら 2025/12/1。 */
export function formatCompletedBadgeDate(completedDateKey: string, todayDateKey: string): string {
  const completed = parseDateKey(completedDateKey);
  const today = parseDateKey(todayDateKey);
  if (!completed || !today) return "";
  if (completed.year === today.year) return `${completed.month}/${completed.day}`;
  return `${completed.year}/${completed.month}/${completed.day}`;
}

/** アーカイブの並び：完了日が新しい順。完了日がないものは後ろ、同じなら締め切りが新しい順。 */
export function compareArchiveOrder(
  aCompleted: string | undefined,
  bCompleted: string | undefined,
  aDeadline: string,
  bDeadline: string
): number {
  const a = aCompleted ?? "";
  const b = bCompleted ?? "";
  if (a && b) return b.localeCompare(a) || bDeadline.localeCompare(aDeadline);
  if (a) return -1;
  if (b) return 1;
  return bDeadline.localeCompare(aDeadline);
}

export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** YYYY-MM-DD の日付を days 日ずらす（マイナスなら前へ）。月末・年末・うるう年もカレンダーどおり。 */
export function shiftDateKey(dateKey: string, days: number): string {
  const date = parseDateKey(dateKey);
  if (!date) throw new Error("日付は YYYY-MM-DD 形式で入力してください");

  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  const year = String(shifted.getUTCFullYear()).padStart(4, "0");
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * 期日があるプロジェクトを、期日の早い順に並べる。
 * 超過がいちばん上（遅れが大きいほど上）、そのあと今日、そのあとこれから（近い日が先）。
 */
export function compareByDueDifference(
  leftDiff: number,
  leftDate: string,
  rightDiff: number,
  rightDate: string
): number {
  return leftDiff - rightDiff || leftDate.localeCompare(rightDate);
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
  let anchor = shiftCalendarDateByMonths(start, months);

  if (compareCalendarDates(anchor, end) > 0) {
    months -= 1;
    anchor = shiftCalendarDateByMonths(start, months);
  }

  return { months, days: calendarDayDifference(anchor, end) };
}

function shiftCalendarDateByMonths(date: CalendarDate, months: number): CalendarDate {
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

/**
 * ノートの最終更新から、いままで何カレンダー日たっているか。
 * 設定の日数（thresholdDays）以上ならその日数を返す。
 * 未満、または設定が 0（オフ）のときは null。
 * 日付の境目は、ローカルの日付で見る。
 */
export function stalledDays(mtimeMs: number, now: Date, thresholdDays: number): number | null {
  if (thresholdDays <= 0) return null;
  const days = differenceInCalendarDays(toDateKey(now), toDateKey(new Date(mtimeMs)));
  return days >= thresholdDays ? days : null;
}

/** YYYY-MM-DD から「年-月」（YYYY-MM）を取り出す。形式が違えば null。 */
export function monthKey(dateKey: string): string | null {
  const date = parseDateKey(dateKey);
  if (!date) return null;
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}`;
}

/** 今月（todayKey の月）に完了した件数。 */
export function countThisMonth(completedDates: Array<string | undefined>, todayKey: string): number {
  const current = monthKey(todayKey);
  if (!current) return 0;
  let count = 0;
  for (const value of completedDates) {
    if (value && monthKey(value) === current) count += 1;
  }
  return count;
}

export interface MonthGroup<T> {
  monthKey: string;
  items: T[];
}

/**
 * 完了月ごとにまとめる。新しい月が先。完了日がないものは最後の空キーのグループへ。
 * 同じ月の中の順番は、渡された並びのまま。
 */
export function groupByMonth<T>(items: T[], completedOf: (item: T) => string | undefined): MonthGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = monthKey(completedOf(item) ?? "") ?? "";
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    if (!a) return 1;
    if (!b) return -1;
    return b.localeCompare(a);
  });
  return keys.map((key) => ({ monthKey: key, items: groups.get(key) ?? [] }));
}

/** アーカイブのカードに出す完了日。今年なら「11月16日」、別の年なら「2025年12月1日」（英語は November 16）。 */
export function formatCompletedCardDate(dateKey: string, todayKey: string, locale: "ja" | "en"): string {
  const completed = parseDateKey(dateKey);
  const today = parseDateKey(todayKey);
  if (!completed || !today) return "";
  const date = new Date(Date.UTC(completed.year, completed.month - 1, completed.day, 12));
  if (locale === "ja") {
    return completed.year === today.year
      ? `${completed.month}月${completed.day}日`
      : `${completed.year}年${completed.month}月${completed.day}日`;
  }
  return new Intl.DateTimeFormat("en-US", {
    year: completed.year === today.year ? undefined : "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** YYYY-MM を年と月に分ける。 */
export function parseMonthKey(value: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

/** アーカイブの月見出し用。英語の月名（November）も返す。 */
export function formatArchiveMonthParts(
  value: string,
  locale: "ja" | "en"
): { year: number; month: number; monthName: string } | null {
  const parsed = parseMonthKey(value);
  if (!parsed) return null;
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, 1, 12));
  const monthName = new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en-US", {
    month: "long",
    timeZone: "UTC",
  }).format(date);
  return { ...parsed, monthName };
}

/** YYYY-MM-DD の日付を months か月進める（マイナスなら前へ）。同じ日がなければ、その月の末日にする。 */
export function addMonthsClamped(dateKey: string, months: number): string {
  const date = parseDateKey(dateKey);
  if (!date) throw new Error("日付は YYYY-MM-DD 形式で入力してください");
  const shifted = shiftCalendarDateByMonths(date, months);
  const year = String(shifted.year).padStart(4, "0");
  const month = String(shifted.month).padStart(2, "0");
  const day = String(shifted.day).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export interface PostponeTargets {
  tomorrow: string;
  inOneWeek: string;
  inOneMonth: string;
  pickDefault: string;
}

/** 延期の候補日。どれも「今日」から数える（いまの期日からは数えない）。日付を選ぶ欄の初期値は 1 週間後。 */
export function postponeTargets(todayKey: string): PostponeTargets {
  const inOneWeek = shiftDateKey(todayKey, 7);
  return {
    tomorrow: shiftDateKey(todayKey, 1),
    inOneWeek,
    inOneMonth: addMonthsClamped(todayKey, 1),
    pickDefault: inOneWeek,
  };
}

/**
 * 期日（dateKey）まで、今日（todayKey）からあと何日か。
 * 今日から設定の日数（thresholdDays）後まで（両端を含む）ならその日数を返す（今日が期日なら 0）。
 * 期日を過ぎている、期日がない、まだ先、または設定が 0（オフ）のときは null。
 */
export function dueSoonDays(dateKey: string, todayKey: string, thresholdDays: number): number | null {
  if (thresholdDays <= 0 || !parseDateKey(dateKey) || !parseDateKey(todayKey)) return null;
  const days = differenceInCalendarDays(dateKey, todayKey);
  return days >= 0 && days <= thresholdDays ? days : null;
}
