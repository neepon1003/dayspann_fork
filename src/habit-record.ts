import { toDateKey } from "./date-utils";
import { countHabitDays, HabitIdentity, HabitLogDays, HabitLogEntry, isLogEntryCompleted, matchesHabit } from "./habit-log";

/**
 * 習慣のカードの「今日やった」で、TaskChute Plus の実行ログに今日の分を 1 件書く・取り消すための部品。
 * TaskChute Plus 3.x は、実行ログを YYYY-MM-tasks.json に直接書かず、
 * 端末ごとの inbox/<端末ID>/YYYY-MM.jsonl に「差分」を 1 行ずつ足し、あとで TaskChute 自身が tasks.json にまとめる
 * （ExecutionLogService.saveTaskLog・removeTaskLogForInstanceOnDate、ExecutionLogDeltaWriter、LogReconciler）。
 * ここでは、その差分の 1 行を TaskChute と同じ形で作る。tasks.json や dailySummary は TaskChute に任せ、触らない。
 */

/** TaskChute Plus が端末ID を覚えている localStorage のキー（DeviceIdentityService）。 */
export const TASKCHUTE_DEVICE_ID_STORAGE_KEY = "taskchute-plus.device-id";

/** PJ-span が書いた記録の instanceId に入れる目印。取り消すときに、PJ-span が書いた分だけを見分ける。 */
export const PJSPAN_INSTANCE_MARK = "pjspan";

/** TaskChute の差分の形式の番号（ExecutionLogDeltaWriter の DEFAULT_SCHEMA_VERSION）。 */
const DELTA_SCHEMA_VERSION = 1;

/** 差分の中身（TaskChute の TaskLogEntry のうち、PJ-span が書く項目だけ）。 */
export interface TaskChuteLogPayload {
  taskTitle?: string;
  taskPath?: string;
  taskId?: string;
  instanceId: string;
  startTime?: string;
  stopTime?: string;
  durationSec?: number;
  deviceId?: string;
}

/** inbox の YYYY-MM.jsonl の 1 行（TaskChute の ExecutionLogDeltaRecord と同じ項目・同じ順番）。 */
export interface TaskChuteDeltaRecord {
  schemaVersion: number;
  op: "upsert" | "delete";
  entryId: string;
  deviceId: string;
  monthKey: string;
  dateKey: string;
  recordedAt: string;
  payload: TaskChuteLogPayload;
}

/** 端末ID を TaskChute と同じように整える（前後の空白を取り、64 文字まで）。フォルダ名に使えないものは null。 */
export function normalizeTaskChuteDeviceId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, 64);
  if (!trimmed || trimmed === "." || trimmed === ".." || /[\\/]/.test(trimmed)) return null;
  return trimmed;
}

/** TaskChute と同じ HH:MM:SS（その端末の時刻）。 */
export function formatClockTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** TaskChute で出す名前。frontmatter の title があればそれ、なければファイル名（TaskChute の resolveTaskDisplayTitle と同じ）。 */
export function resolveTaskChuteTitle(frontmatterTitle: unknown, basename: string): string {
  if (typeof frontmatterTitle === "string" && frontmatterTitle.trim()) return frontmatterTitle.trim();
  return basename.trim() || "Untitled task";
}

/** 0〜9・a〜z の乱数（TaskChute と同じ Math.random().toString(36) の作り方）。 */
export function randomBase36(length: number): string {
  let text = "";
  while (text.length < length) text += Math.random().toString(36).slice(2);
  return text.slice(0, length);
}

/**
 * PJ-span が書く記録の instanceId。TaskChute の generateInstanceId（パス_日付_時刻_乱数）と同じ形にし、
 * 乱数の前に pjspan- を付けて、PJ-span が書いたものだと分かるようにする。
 */
export function buildPjSpanInstanceId(path: string, dateKey: string, nowMs: number, random: string): string {
  return `${path}_${dateKey}_${nowMs}_${PJSPAN_INSTANCE_MARK}-${random}`;
}

/** PJ-span が書いた記録の instanceId か。 */
export function isPjSpanInstanceId(instanceId: string | undefined): boolean {
  return typeof instanceId === "string" && /_\d{4}-\d{2}-\d{2}_\d+_pjspan-[0-9a-z]+$/.test(instanceId);
}

/** 差分の entryId（TaskChute の generateEntryId と同じ「端末ID:時刻36進:乱数」）。 */
export function buildTaskChuteEntryId(deviceId: string, nowMs: number, random: string): string {
  return `${deviceId}:${nowMs.toString(36)}:${random}`;
}

/** 「今日やった」で書く 1 件の材料。 */
export interface HabitDoneInput {
  /** TaskChute で出す名前（resolveTaskChuteTitle）。 */
  title: string;
  /** 習慣のノートの場所。 */
  path: string;
  /** 習慣のノートの taskId（あれば）。 */
  taskId?: string;
  /** この端末の TaskChute の端末ID。 */
  deviceId: string;
  /** 押した時刻。 */
  now: Date;
  /** 乱数を作る関数（テストで固定するため）。 */
  random?: (length: number) => string;
}

/**
 * 「今日やった」で inbox に足す 1 行（upsert）。TaskChute の saveTaskLog と同じ項目にする。
 * 開始と終了は押した時刻、かかった時間（durationSec）は 0 秒。slotKey は書かない（TaskChute が開始時刻から決める）。
 */
export function buildHabitDoneDelta(input: HabitDoneInput): TaskChuteDeltaRecord {
  const random = input.random ?? randomBase36;
  const nowMs = input.now.getTime();
  const dateKey = toDateKey(input.now);
  const clock = formatClockTime(input.now);
  const payload: TaskChuteLogPayload = {
    taskTitle: input.title,
    taskPath: input.path,
    taskId: input.taskId,
    instanceId: buildPjSpanInstanceId(input.path, dateKey, nowMs, random(9)),
    startTime: clock,
    stopTime: clock,
    durationSec: 0,
    deviceId: input.deviceId,
  };
  if (!payload.taskId) delete payload.taskId;
  return {
    schemaVersion: DELTA_SCHEMA_VERSION,
    op: "upsert",
    entryId: buildTaskChuteEntryId(input.deviceId, nowMs, random(8)),
    deviceId: input.deviceId,
    monthKey: dateKey.slice(0, 7),
    dateKey,
    recordedAt: input.now.toISOString(),
    payload,
  };
}

/**
 * 「今日の記録を取り消す」で inbox に足す 1 行（delete）。TaskChute の removeTaskLogForInstanceOnDate と同じく、
 * instanceId（と taskId・taskPath）だけを書く。TaskChute は instanceId が同じ記録だけを消す。
 */
export function buildHabitUndoDelta(
  entry: HabitLogEntry,
  dateKey: string,
  deviceId: string,
  now: Date,
  random: (length: number) => string = randomBase36
): TaskChuteDeltaRecord {
  if (!entry.instanceId) throw new Error("instanceId がない記録は取り消せません");
  const payload: TaskChuteLogPayload = { instanceId: entry.instanceId };
  if (entry.taskId) payload.taskId = entry.taskId;
  if (entry.taskPath) payload.taskPath = entry.taskPath;
  return {
    schemaVersion: DELTA_SCHEMA_VERSION,
    op: "delete",
    entryId: buildTaskChuteEntryId(deviceId, now.getTime(), random(8)),
    deviceId,
    monthKey: dateKey.slice(0, 7),
    dateKey,
    recordedAt: now.toISOString(),
    payload,
  };
}

/** その日に、この習慣の記録が 1 件でもあるか（TaskChute で付けた記録も含む）。2 回目の記録を防ぐのに使う。 */
export function isHabitDoneOn(days: HabitLogDays, habit: HabitIdentity, dateKey: string): boolean {
  return (countHabitDays(days, habit)[dateKey] ?? 0) > 0;
}

/** その日の、この習慣の記録のうち、PJ-span が書いたものだけ。 */
export function findPjSpanEntries(days: HabitLogDays, habit: HabitIdentity, dateKey: string): HabitLogEntry[] {
  return (days[dateKey] ?? []).filter(
    (entry) => isLogEntryCompleted(entry) && matchesHabit(entry, habit) && isPjSpanInstanceId(entry.instanceId)
  );
}

/** inbox のファイルの場所（TaskChute のログフォルダ/inbox/端末ID/YYYY-MM.jsonl）。 */
export function taskChuteDeltaPath(logFolder: string, deviceId: string, monthKey: string): string {
  return `${logFolder}/inbox/${deviceId}/${monthKey}.jsonl`;
}

/**
 * 今のファイルの中身のあとに足す文字。1 行の JSON と改行（TaskChute と同じ）。
 * 今の中身が改行で終わっていなければ（途中で切れているなど）、前の行とくっつかないように先に改行を入れる。
 */
export function deltaLineToAppend(existing: string, record: TaskChuteDeltaRecord): string {
  const line = `${JSON.stringify(record)}\n`;
  return existing && !existing.endsWith("\n") ? `\n${line}` : line;
}
