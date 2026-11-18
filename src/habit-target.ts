import { parseDateKey } from "./date-utils";
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
