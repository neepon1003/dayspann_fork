import { parseDateKey, shiftDateKey } from "./date-utils";

/**
 * TaskChute Plus の実行ログ（読むだけ）から、習慣ごとに「どの日に何回やったか」を数える。
 * ログは TaskChute/Log の YYYY-MM-tasks.json（taskExecutions）と、端末ごとの inbox/<端末>/YYYY-MM.jsonl（差分）。
 * TaskChute Plus 3.x の ExecutionLogService・LogReconciler・executionLogUtils と同じ読み方にそろえる。
 */

/** ログの 1 件（使う項目だけ）。 */
export interface HabitLogEntry {
  taskId?: string;
  taskPath?: string;
  taskTitle?: string;
  taskName?: string;
  instanceId?: string;
  startTime?: string;
  stopTime?: string;
  isCompleted?: boolean;
}

/** 日付（YYYY-MM-DD）ごとのログ。 */
export type HabitLogDays = Record<string, HabitLogEntry[]>;

/** inbox の差分 1 行。 */
export interface HabitLogDelta {
  op: "upsert" | "delete";
  dateKey: string;
  recordedAt: string;
  entry: HabitLogEntry;
}

/** 習慣ノートを見分ける手がかり。 */
export interface HabitIdentity {
  taskId?: string;
  path: string;
  basename: string;
}

/** ヒートマップに出す週の数（日曜はじまり。上が古く、下が今週）。 */
export const HEATMAP_WEEKS = 4;

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readEntry(value: unknown): HabitLogEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const entry: HabitLogEntry = {
    taskId: text(raw.taskId),
    taskPath: text(raw.taskPath),
    taskTitle: text(raw.taskTitle),
    taskName: text(raw.taskName),
    instanceId: text(raw.instanceId),
    startTime: text(raw.startTime),
    stopTime: text(raw.stopTime),
  };
  if (typeof raw.isCompleted === "boolean") entry.isCompleted = raw.isCompleted;
  return entry;
}

/** YYYY-MM-tasks.json を読む。壊れていれば空。 */
export function parseMonthlyLog(raw: string): HabitLogDays {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  const executions = (data as { taskExecutions?: unknown } | null)?.taskExecutions;
  if (!executions || typeof executions !== "object") return {};
  const days: HabitLogDays = {};
  for (const [dateKey, list] of Object.entries(executions as Record<string, unknown>)) {
    if (!parseDateKey(dateKey) || !Array.isArray(list)) continue;
    const entries = list.map(readEntry).filter((entry): entry is HabitLogEntry => entry !== null);
    if (entries.length) days[dateKey] = entries;
  }
  return days;
}

/** inbox の YYYY-MM.jsonl を読む。読めない行、要約（summary）、instanceId のない行は飛ばす（TaskChute と同じ）。 */
export function parseDeltaLines(raw: string): HabitLogDelta[] {
  const deltas: HabitLogDelta[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!record || typeof record !== "object") continue;
    const op = record.op ?? "upsert";
    if (op !== "upsert" && op !== "delete") continue;
    const dateKey = text(record.dateKey);
    const entry = readEntry(record.payload);
    if (!dateKey || !parseDateKey(dateKey) || !entry?.instanceId) continue;
    deltas.push({ op, dateKey, recordedAt: text(record.recordedAt) ?? "", entry });
  }
  return deltas;
}

/**
 * 月ごとのログに、inbox の差分を記録した時刻の順に重ねる。
 * 同じ instanceId があれば上書き（upsert）、なければ足す。delete は同じ instanceId を消す。
 */
export function mergeHabitLogs(snapshots: HabitLogDays[], deltas: HabitLogDelta[]): HabitLogDays {
  const days: HabitLogDays = {};
  for (const snapshot of snapshots) {
    for (const [dateKey, entries] of Object.entries(snapshot)) {
      days[dateKey] = [...(days[dateKey] ?? []), ...entries.map((entry) => ({ ...entry }))];
    }
  }
  const ordered = [...deltas].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  for (const delta of ordered) {
    const entries = days[delta.dateKey] ?? [];
    const index = entries.findIndex((entry) => entry.instanceId === delta.entry.instanceId);
    if (delta.op === "delete") {
      if (index >= 0) entries.splice(index, 1);
    } else if (index >= 0) {
      entries[index] = { ...entries[index], ...withoutUndefined(delta.entry) };
    } else {
      entries.push({ ...delta.entry });
    }
    days[delta.dateKey] = entries;
  }
  return days;
}

function withoutUndefined(entry: HabitLogEntry): HabitLogEntry {
  return Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined));
}

/** やり終えた記録か。isCompleted があればそれ、なければ記録があるだけで完了（TaskChute の isExecutionLogEntryCompleted と同じ）。 */
export function isLogEntryCompleted(entry: HabitLogEntry): boolean {
  return typeof entry.isCompleted === "boolean" ? entry.isCompleted : true;
}

/** ログの 1 件が、この習慣のものか。taskId、なければファイルの場所、なければ名前で見る。 */
export function matchesHabit(entry: HabitLogEntry, habit: HabitIdentity): boolean {
  if (habit.taskId && entry.taskId) return entry.taskId === habit.taskId;
  if (entry.taskPath) return entry.taskPath === habit.path;
  const title = entry.taskTitle ?? entry.taskName;
  return title !== undefined && title === habit.basename;
}

/** 同じ実行を 2 回数えないための目印（TaskChute の computeExecutionInstanceKey と同じ考え方）。 */
function executionKey(entry: HabitLogEntry): string {
  if (entry.instanceId) return entry.instanceId;
  const base = entry.taskId ?? entry.taskPath ?? entry.taskName ?? entry.taskTitle ?? "";
  return `${base}::${entry.startTime ?? ""}-${entry.stopTime ?? ""}`;
}

/** この習慣を、日付ごとに何回やり終えたか。 */
export function countHabitDays(days: HabitLogDays, habit: HabitIdentity): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [dateKey, entries] of Object.entries(days)) {
    const seen = new Set<string>();
    for (const entry of entries) {
      if (!isLogEntryCompleted(entry) || !matchesHabit(entry, habit)) continue;
      const key = executionKey(entry);
      if (seen.has(key)) continue;
      seen.add(key);
    }
    if (seen.size) counts[dateKey] = seen.size;
  }
  return counts;
}

/** YYYY-MM-DD の曜日（0 が日曜）。 */
function weekdayOf(dateKey: string): number {
  const date = parseDateKey(dateKey);
  if (!date) return 0;
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

/**
 * ヒートマップの並び。週ごとの行（上が古く、下が今週）で、各行は日曜から土曜の 7 マス。
 * 今日より先の日は null。
 */
export function buildHeatmapWeeks(todayKey: string, weeks = HEATMAP_WEEKS): Array<Array<string | null>> {
  const fromSunday = weekdayOf(todayKey);
  const firstSunday = shiftDateKey(todayKey, -fromSunday - (weeks - 1) * 7);
  const rows: Array<Array<string | null>> = [];
  for (let week = 0; week < weeks; week += 1) {
    const row: Array<string | null> = [];
    for (let day = 0; day < 7; day += 1) {
      const offset = week * 7 + day;
      const dateKey = shiftDateKey(firstSunday, offset);
      row.push(offset > fromSunday + (weeks - 1) * 7 ? null : dateKey);
    }
    rows.push(row);
  }
  return rows;
}

/** ヒートマップに出す日が入っている月（YYYY-MM）。読むログのファイルを決めるのに使う。 */
export function heatmapMonthKeys(todayKey: string, weeks = HEATMAP_WEEKS): string[] {
  const months: string[] = [];
  for (const week of buildHeatmapWeeks(todayKey, weeks)) {
    for (const dateKey of week) {
      const month = dateKey?.slice(0, 7);
      if (month && !months.includes(month)) months.push(month);
    }
  }
  return months;
}

/** マスの濃さ。0 回は 0（灰色）、1 回以上は 1（濃い緑）。 */
export function heatmapLevel(count: number): 0 | 1 {
  return count <= 0 ? 0 : 1;
}

/** 今日までの days 日のうち、1 回以上やった日の数。 */
export function countActiveDays(counts: Record<string, number>, todayKey: string, days: number): number {
  let active = 0;
  for (let offset = 0; offset < days; offset += 1) {
    if ((counts[shiftDateKey(todayKey, -offset)] ?? 0) > 0) active += 1;
  }
  return active;
}

/** 連続の数え方。daily は日、それ以外（未設定・毎週・毎月など）は週。 */
export type StreakUnit = "day" | "week";

/** いまの連続と、これまでの最長。 */
export interface StreakResult {
  current: number;
  longest: number;
}

/**
 * TaskChute の routine_type を見て、連続を日で数えるか週で数えるかを決める。
 * daily（大文字小文字は問わない）のときだけ日。weekly / monthly / monthly_date / weekdays / weekends / 未設定などは週。
 */
export function readStreakUnit(value: unknown): StreakUnit {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return raw === "daily" ? "day" : "week";
}

function hasCount(counts: Record<string, number>, dateKey: string): boolean {
  return (counts[dateKey] ?? 0) > 0;
}

/** YYYY-MM-DD が属する、日曜はじまりの週の日曜。 */
export function sundayOfDateKey(dateKey: string): string {
  const date = parseDateKey(dateKey);
  if (!date) throw new Error("日付は YYYY-MM-DD 形式で入力してください");
  const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return shiftDateKey(dateKey, -weekday);
}

function longestRun(keys: string[], stepDays: number): number {
  const ordered = [...keys].sort();
  let longest = 0;
  let run = 0;
  let previous: string | null = null;
  for (const key of ordered) {
    run = previous && shiftDateKey(previous, stepDays) === key ? run + 1 : 1;
    if (run > longest) longest = run;
    previous = key;
  }
  return longest;
}

function currentRun(startKey: string, hasKey: (key: string) => boolean, stepDays: number): number {
  let current = 0;
  let cursor = startKey;
  while (hasKey(cursor)) {
    current += 1;
    cursor = shiftDateKey(cursor, -stepDays);
  }
  return current;
}

/**
 * 日ごとの連続。1 回以上やった日を数える。
 * 今日がまだ空なら、昨日までの連続を出す（今日も昨日も空なら 0）。
 * 最長は、読み込んだログにある日のうち、いちばん長く続いた日数。
 */
export function streakDays(counts: Record<string, number>, todayKey: string): StreakResult {
  const start = hasCount(counts, todayKey) ? todayKey : shiftDateKey(todayKey, -1);
  const current = currentRun(start, (key) => hasCount(counts, key), 1);
  const dates = Object.keys(counts).filter((key) => parseDateKey(key) && hasCount(counts, key) && key <= todayKey);
  return { current, longest: Math.max(current, longestRun(dates, 1)) };
}

/**
 * 週ごとの連続（日曜はじまり。ヒートマップと同じ）。その週に 1 日でもやっていれば、その週は続いている。
 * 今週がまだ空なら、先週までの連続を出す（今週も先週も空なら 0）。
 * 最長は、読み込んだログにある週のうち、いちばん長く続いた週数。
 */
export function streakWeeks(counts: Record<string, number>, todayKey: string): StreakResult {
  const thisSunday = sundayOfDateKey(todayKey);
  const weeks = new Set<string>();
  for (const key of Object.keys(counts)) {
    if (parseDateKey(key) && hasCount(counts, key) && key <= todayKey) weeks.add(sundayOfDateKey(key));
  }
  const hasWeek = (sunday: string) => weeks.has(sunday);
  const start = hasWeek(thisSunday) ? thisSunday : shiftDateKey(thisSunday, -7);
  const current = currentRun(start, hasWeek, 7);
  return { current, longest: Math.max(current, longestRun([...weeks], 7)) };
}

/** ログのファイル名やパスから、月（YYYY-MM）を取り出す。YYYY-MM-tasks.json と YYYY-MM.jsonl に対応。 */
export function monthKeyFromLogPath(path: string): string | null {
  const name = path.replace(/\\/g, "/").split("/").pop() ?? "";
  const match = /^(\d{4}-\d{2})(?:-tasks\.json|\.jsonl)$/.exec(name);
  return match?.[1] ?? null;
}

/** ログのパスから、重複のない月（YYYY-MM）を古い順に集める。 */
export function collectLogMonthKeys(paths: string[]): string[] {
  const months: string[] = [];
  for (const path of paths) {
    const month = monthKeyFromLogPath(path);
    if (month && !months.includes(month)) months.push(month);
  }
  months.sort();
  return months;
}
