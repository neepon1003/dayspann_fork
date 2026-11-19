import { parseDateKey, shiftDateKey } from "./date-utils";
import { sundayOfDateKey } from "./habit-log";

/**
 * 習慣の「今の期間の目標日数」を、TaskChute のルーチン設定（読むだけ）から決める。
 * 毎日は今日、毎週・平日・週末は日曜はじまりの今週、毎月は今月で数える。
 * 週の日数は、決められた曜日以外にやっても、やった日の数に入れる。
 */

/** 目標を数える期間。daily は日、weekly / weekdays / weekends は週、monthly / monthly_date は月。 */
export type HabitTargetPeriod = "day" | "week" | "month";

/** 今の期間の目標。target はやる回数（日数）。 */
export interface HabitTarget {
  period: HabitTargetPeriod;
  target: number;
}

/** 今の期間の進み具合。done はやった日の数、met なら目標に届いている。 */
export interface HabitTargetProgress extends HabitTarget {
  done: number;
  remaining: number;
  met: boolean;
}

const WEEKDAY_NAMES: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
  日曜日: 0,
  日曜: 0,
  日: 0,
  月曜日: 1,
  月曜: 1,
  月: 1,
  火曜日: 2,
  火曜: 2,
  火: 2,
  水曜日: 3,
  水曜: 3,
  水: 3,
  木曜日: 4,
  木曜: 4,
  木: 4,
  金曜日: 5,
  金曜: 5,
  金: 5,
  土曜日: 6,
  土曜: 6,
  土: 6,
};

/** TaskChute の routine_type を整える。大文字小文字は問わない。無い・空なら空文字。 */
export function readRoutineType(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** 曜日 1 つを 0（日）〜 6（土）にする。英語名・日本語名・数字（0-6）に対応。読めなければ undefined。 */
export function readWeekday(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 6) return value;
  if (typeof value !== "string") return undefined;
  const raw = value.trim();
  if (!raw) return undefined;
  const asNumber = Number(raw);
  if (Number.isInteger(asNumber) && asNumber >= 0 && asNumber <= 6) return asNumber;
  return WEEKDAY_NAMES[raw.toLowerCase()] ?? WEEKDAY_NAMES[raw];
}

function collectWeekdayValues(value: unknown, collected: unknown[]): void {
  if (value === undefined || value === null || value === "") return;
  if (Array.isArray(value)) {
    for (const item of value) collectWeekdayValues(item, collected);
    return;
  }
  if (typeof value === "string" && /[,、]/.test(value)) {
    for (const item of value.split(/[,、]/)) collectWeekdayValues(item, collected);
    return;
  }
  collected.push(value);
}

/**
 * frontmatter の曜日指定を、重複のない 0〜6 の配列にする。
 * routine_weekdays・weekdays・routine_weekday・weekday をまとめて読む（TaskChute の新旧の書き方に対応）。
 */
export function readRoutineWeekdays(data: Record<string, unknown> | undefined): number[] {
  if (!data) return [];
  const collected: unknown[] = [];
  collectWeekdayValues(data.routine_weekdays, collected);
  collectWeekdayValues(data.weekdays, collected);
  collectWeekdayValues(data.routine_weekday, collected);
  collectWeekdayValues(data.weekday, collected);
  const seen = new Set<number>();
  const weekdays: number[] = [];
  for (const item of collected) {
    const weekday = readWeekday(item);
    if (weekday === undefined || seen.has(weekday)) continue;
    seen.add(weekday);
    weekdays.push(weekday);
  }
  return weekdays;
}

/**
 * TaskChute のルーチン設定から、今の期間の目標を決める。
 * daily は今日 1 日、weekdays は今週 5 日、weekends は今週 2 日、monthly / monthly_date は今月 1 日。
 * weekly・未設定・不明な type は、選んだ曜日の数（無ければ 1）を今週の目標にする。
 */
export function readHabitTarget(data: Record<string, unknown> | undefined): HabitTarget {
  const type = readRoutineType(data?.routine_type);
  if (type === "daily") return { period: "day", target: 1 };
  if (type === "monthly" || type === "monthly_date") return { period: "month", target: 1 };
  if (type === "weekdays") return { period: "week", target: 5 };
  if (type === "weekends") return { period: "week", target: 2 };
  const weekdays = readRoutineWeekdays(data);
  return { period: "week", target: weekdays.length > 0 ? weekdays.length : 1 };
}

/** 週の連続を数えるときの目標日数。週の習慣はその目標、毎月・毎日などは 1（1 日でもやればその週は続く）。 */
export function weekStreakTarget(target: HabitTarget): number {
  if (target.period === "week" && Number.isInteger(target.target) && target.target >= 1) return target.target;
  return 1;
}

function countDistinctDays(counts: Record<string, number>, startKey: string, endKey: string): number {
  let done = 0;
  for (const key of Object.keys(counts)) {
    if (!parseDateKey(key) || key < startKey || key > endKey) continue;
    if ((counts[key] ?? 0) > 0) done += 1;
  }
  return done;
}

/**
 * 今日までの、今の期間の進み具合を数える。
 * 週は日曜はじまり。同じ日に何回やっても 1 日。決められた曜日以外にやっても日数に入れる。
 */
export function habitTargetProgress(
  target: HabitTarget,
  counts: Record<string, number>,
  todayKey: string
): HabitTargetProgress {
  let startKey = todayKey;
  if (target.period === "week") startKey = sundayOfDateKey(todayKey);
  else if (target.period === "month") startKey = `${todayKey.slice(0, 7)}-01`;
  const done = countDistinctDays(counts, startKey, todayKey);
  const remaining = Math.max(0, target.target - done);
  return { ...target, done, remaining, met: done >= target.target };
}

/** その日がルーチンの予定日かどうか。設定が無い・わからないときは none。 */
export type HabitSchedule =
  | { kind: "none" }
  | { kind: "daily" }
  | { kind: "weekly"; weekdays: number[] }
  | { kind: "monthDate"; days: Array<number | "last"> }
  | { kind: "monthNth"; weeks: Array<number | "last">; weekdays: number[] };

function weekdayOfDateKey(dateKey: string): number | undefined {
  const date = parseDateKey(dateKey);
  if (!date) return undefined;
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function uniqueWeekdaysFromKeys(data: Record<string, unknown>, keys: string[]): number[] {
  const collected: unknown[] = [];
  for (const key of keys) collectWeekdayValues(data[key], collected);
  const seen = new Set<number>();
  const weekdays: number[] = [];
  for (const item of collected) {
    const weekday = readWeekday(item);
    if (weekday === undefined || seen.has(weekday)) continue;
    seen.add(weekday);
    weekdays.push(weekday);
  }
  return weekdays;
}

function readMonthDayValue(value: unknown): number | "last" | undefined {
  if (typeof value === "string") {
    const raw = value.trim().toLowerCase();
    if (raw === "last") return "last";
    value = raw;
  }
  const asNumber = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= 31) return asNumber;
  return undefined;
}

function collectMonthDays(value: unknown, collected: Array<number | "last">, seen: Set<string>): void {
  if (value === undefined || value === null || value === "") return;
  if (Array.isArray(value)) {
    for (const item of value) collectMonthDays(item, collected, seen);
    return;
  }
  if (typeof value === "string" && /[,、]/.test(value)) {
    for (const item of value.split(/[,、]/)) collectMonthDays(item, collected, seen);
    return;
  }
  const day = readMonthDayValue(value);
  if (day === undefined) return;
  const key = String(day);
  if (seen.has(key)) return;
  seen.add(key);
  collected.push(day);
}

/** 毎月（日付）の指定。routine_monthday / routine_monthdays。1〜31 または last。 */
export function readMonthDays(data: Record<string, unknown> | undefined): Array<number | "last"> {
  if (!data) return [];
  const days: Array<number | "last"> = [];
  const seen = new Set<string>();
  collectMonthDays(data.routine_monthdays, days, seen);
  collectMonthDays(data.routine_monthday, days, seen);
  return days;
}

function readMonthWeekValue(value: unknown, zeroBased = false): number | "last" | undefined {
  if (typeof value === "string") {
    const raw = value.trim().toLowerCase();
    if (raw === "last") return "last";
    value = raw;
  }
  const asNumber = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(asNumber)) return undefined;
  if (zeroBased) return asNumber >= 0 && asNumber <= 4 ? asNumber + 1 : undefined;
  return asNumber >= 1 && asNumber <= 5 ? asNumber : undefined;
}

function collectMonthWeeks(
  value: unknown,
  collected: Array<number | "last">,
  seen: Set<string>,
  zeroBased = false
): void {
  if (value === undefined || value === null || value === "") return;
  if (Array.isArray(value)) {
    for (const item of value) collectMonthWeeks(item, collected, seen, zeroBased);
    return;
  }
  const week = readMonthWeekValue(value, zeroBased);
  if (week === undefined) return;
  const key = String(week);
  if (seen.has(key)) return;
  seen.add(key);
  collected.push(week);
}

/** 毎月（第n曜日）の週。routine_week / routine_weeks は 1〜5 または last。古い monthly_week だけ 0〜4。 */
export function readMonthWeeks(data: Record<string, unknown> | undefined): Array<number | "last"> {
  if (!data) return [];
  const weeks: Array<number | "last"> = [];
  const seen = new Set<string>();
  collectMonthWeeks(data.routine_weeks, weeks, seen);
  collectMonthWeeks(data.routine_week, weeks, seen);
  collectMonthWeeks(data.monthly_weeks, weeks, seen);
  collectMonthWeeks(data.monthly_week, weeks, seen, true);
  return weeks;
}

/**
 * TaskChute のルーチン設定から、予定日の決め方を読む。
 * 設定が無いとき、種類がわからないとき、曜日や日付が無い weekly / monthly は none（枠を付けない）。
 * routine_interval や開始・終了日は見ない。
 */
export function readHabitSchedule(data: Record<string, unknown> | undefined): HabitSchedule {
  const type = readRoutineType(data?.routine_type);
  if (type === "daily") return { kind: "daily" };
  if (type === "weekdays") return { kind: "weekly", weekdays: [1, 2, 3, 4, 5] };
  if (type === "weekends") return { kind: "weekly", weekdays: [0, 6] };
  if (type === "weekly") {
    const weekdays = readRoutineWeekdays(data);
    return weekdays.length > 0 ? { kind: "weekly", weekdays } : { kind: "none" };
  }
  if (type === "monthly_date") {
    const days = readMonthDays(data);
    return days.length > 0 ? { kind: "monthDate", days } : { kind: "none" };
  }
  if (type === "monthly") {
    const weeks = readMonthWeeks(data);
    const weekdays = uniqueWeekdaysFromKeys(data ?? {}, [
      "routine_weekdays",
      "monthly_weekdays",
      "routine_weekday",
      "monthly_weekday",
      "weekday",
    ]);
    return weeks.length > 0 && weekdays.length > 0 ? { kind: "monthNth", weeks, weekdays } : { kind: "none" };
  }
  return { kind: "none" };
}

/** その日がルーチンの予定日なら true。日付が不正なときや kind が none のときは false。 */
export function isHabitScheduled(schedule: HabitSchedule, dateKey: string): boolean {
  const date = parseDateKey(dateKey);
  if (!date || schedule.kind === "none") return false;
  const weekday = weekdayOfDateKey(dateKey);
  if (weekday === undefined) return false;
  if (schedule.kind === "daily") return true;
  if (schedule.kind === "weekly") return schedule.weekdays.includes(weekday);
  if (schedule.kind === "monthDate") {
    const last = lastDayOfMonth(date.year, date.month);
    return schedule.days.some((day) => (day === "last" ? date.day === last : date.day === day));
  }
  const last = date.day + 7 > lastDayOfMonth(date.year, date.month);
  const occurrence = Math.floor((date.day - 1) / 7) + 1;
  const weekMatches = schedule.weeks.some((week) => (week === "last" ? last : week === occurrence));
  return weekMatches && schedule.weekdays.includes(weekday);
}

/**
 * 日曜はじまりの今週（今日より先の日も含む）のうち、予定日の YYYY-MM-DD を返す。
 * ヒートマップの一番下の行に枠を付ける対象。
 */
export function plannedDateKeysInWeek(schedule: HabitSchedule, todayKey: string): string[] {
  if (schedule.kind === "none") return [];
  const sunday = sundayOfDateKey(todayKey);
  const keys: string[] = [];
  for (let day = 0; day < 7; day += 1) {
    const dateKey = shiftDateKey(sunday, day);
    if (isHabitScheduled(schedule, dateKey)) keys.push(dateKey);
  }
  return keys;
}

/**
 * 習慣を、まだ目標に届いていないものから並べる。
 * isMet が false（まだ）→ null（日数を出していない）→ true（届いた）の順にする。
 * 同じ中では、渡されたときの順番（名前の順）を保つ。
 */
export function sortHabitsByPending<T>(items: T[], isMet: (item: T) => boolean | null): T[] {
  const rank = (met: boolean | null): number => (met === false ? 0 : met === null ? 1 : 2);
  return items
    .map((item, index) => ({ item, index, rank: rank(isMet(item)) }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ item }) => item);
}

/**
 * 習慣タブの上に出す「目標達成：◯/◯」の数を数える。
 * true（届いた）を met に数え、日数を出していない null は total にも入れない。
 */
export function summarizeHabitTargets(statuses: Array<boolean | null>): { met: number; total: number } {
  const shown = statuses.filter((status): status is boolean => status !== null);
  return { met: shown.filter((status) => status).length, total: shown.length };
}

/**
 * 今日が予定日なら、今日やったかどうかを返す。予定日でなければ null。
 * 予定日の決め方は、ヒートマップの枠（isHabitScheduled）と同じ。
 */
export function habitScheduledTodayStatus(
  schedule: HabitSchedule,
  todayKey: string,
  doneToday: boolean
): boolean | null {
  if (!isHabitScheduled(schedule, todayKey)) return null;
  return doneToday;
}

/**
 * 「今日」表示用。今日が予定日の習慣だけを残す（今日やったものも含む）。
 * scheduledToday は habitScheduledTodayStatus と同じく、予定日なら true/false、違えば null。
 */
export function filterHabitsScheduledToday<T>(
  items: T[],
  scheduledToday: (item: T) => boolean | null
): T[] {
  return items.filter((item) => scheduledToday(item) !== null);
}
