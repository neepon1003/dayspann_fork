import { parseYaml, stringifyYaml, TFile } from "obsidian";
import {
  DEFAULT_DISPLAY_MODE,
  DayspannDisplayMode,
  normalizeDisplayMode,
  parseDateKey,
  readDateKey,
} from "./date-utils";
import { buildNewNoteBody, buildNewNoteTitle, NEW_NOTE_TOOLBAR } from "./note-template";
import { readStreakUnit, StreakUnit } from "./habit-log";
import { HabitSchedule, HabitTarget, readHabitSchedule, readHabitTarget } from "./habit-target";
import { readCategory } from "./habit-category";
import { readGoal } from "./record-edit";
import { DEFAULT_RECORD_TYPE, readRecordType, RecordType } from "./record-type";
import { formatSourceReference, parseSourceReference } from "./source-link";
import { isTaskChuteTask, readTargetDate, TaskChuteNewTaskFields } from "./taskchute";

export interface DayspannRecord {
  file: TFile;
  /** 種類（frontmatter の type）。project（プロジェクト）か habit（習慣）。 */
  type: RecordType;
  title: string;
  date: string;
  /** 完了条件（frontmatter の goal）。書いていなければ空文字。 */
  goal: string;
  /** 分類（frontmatter の category）。習慣を見出しごとにまとめるときの名前。なければ空文字。 */
  category: string;
  /** 連続の数え方。TaskChute の routine_type が daily なら日、それ以外（未設定・毎週など）は週。 */
  streakUnit: StreakUnit;
  /** 今の期間の目標日数。TaskChute の routine_type と曜日の指定から決める。 */
  habitTarget: HabitTarget;
  /** ヒートマップに枠を付ける予定日の決め方。TaskChute のルーチン設定から読む。 */
  habitSchedule: HabitSchedule;
  displayMode: DayspannDisplayMode;
  archived: boolean;
  completed?: string;
  excerpt: string;
  sourcePath?: string;
  sourceLine?: number;
  created: string;
  /** TaskChute のタスクノート（tags に task、または taskId がある）なら入る。 */
  taskchute?: { targetDate?: string; taskId?: string };
}

export interface DayspannDraft {
  /** 種類。なければ project。 */
  type?: RecordType;
  title: string;
  date: string;
  goal?: string;
  /** 分類。習慣のときだけ使う。空なら「その他」。 */
  category?: string;
  displayMode?: DayspannDisplayMode;
  archived?: boolean;
  completed?: string;
  excerpt: string;
  sourcePath?: string;
  sourceLine?: number;
  created?: string;
}

/**
 * 新しい記録のノートの中身を作る（新しく登録するときだけ使う）。
 * タイトルの後ろに「｜プロジェクトノート作成」を付け、notetoolbar: [btn] と「概要」「次の一手」「ログ」の見出しを入れる。
 * taskchute を渡すと、TaskChute のタスク（tags・taskId・target_date）としても作る。
 */
export function serializeRecord(draft: DayspannDraft, taskchute?: TaskChuteNewTaskFields): string {
  const frontmatter: Record<string, string | number | boolean | string[]> = {
    type: draft.type ?? DEFAULT_RECORD_TYPE,
    title: buildNewNoteTitle(draft.title),
    notetoolbar: [...NEW_NOTE_TOOLBAR],
    date: draft.date,
    display: draft.displayMode ?? DEFAULT_DISPLAY_MODE,
    created: draft.created ?? new Date().toISOString(),
  };

  if (frontmatter.type === "habit") {
    // 習慣には、期日・表示形式・完了条件を書かない。分類があれば書く。
    delete frontmatter.date;
    delete frontmatter.display;
    const category = readCategory(draft.category);
    if (category) frontmatter.category = category;
  } else {
    const goal = readGoal(draft.goal);
    if (goal) frontmatter.goal = goal;
  }

  if (draft.archived) frontmatter.archived = true;
  if (draft.completed) frontmatter.completed = draft.completed;
  if (draft.sourcePath) frontmatter.source = formatSourceReference(draft.sourcePath);
  if (typeof draft.sourceLine === "number") frontmatter.sourceLine = draft.sourceLine;

  if (taskchute) {
    frontmatter.target_date = taskchute.target_date;
    frontmatter.taskId = taskchute.taskId;
    frontmatter.tags = [...taskchute.tags];
  }

  const yaml = stringifyYaml(frontmatter).replace(/\s+$/, "");
  return `---\n${yaml}\n---\n\n${buildNewNoteBody(draft.excerpt)}\n`;
}

export function parseRecord(file: TFile, content: string): DayspannRecord | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(content);
  if (!match || match[1] === undefined || match[2] === undefined) return null;

  let data: Record<string, unknown>;
  try {
    data = parseYaml(match[1]) as Record<string, unknown>;
  } catch {
    return null;
  }

  // PJ-span に出すのは、type が project（プロジェクト）か habit（習慣）のノートだけ。
  const type = readRecordType(data.type);
  if (!type) return null;
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const rawDate =
    data.date instanceof Date
      ? data.date.toISOString().slice(0, 10)
      : typeof data.date === "string"
        ? data.date.trim()
        : "";
  const date = parseDateKey(rawDate) ? rawDate : "";
  if (!title || (rawDate && !date)) return null;

  const sourceLine = Number(data.sourceLine);
  return {
    file,
    type,
    title,
    date,
    goal: readGoal(data.goal),
    category: readCategory(data.category),
    streakUnit: readStreakUnit(data.routine_type),
    habitTarget: readHabitTarget(data),
    habitSchedule: readHabitSchedule(data),
    displayMode: normalizeDisplayMode(data.display),
    archived: data.archived === true,
    completed: readDateKey(data.completed) || undefined,
    excerpt: match[2].trim(),
    sourcePath: parseSourceReference(data.source),
    sourceLine: Number.isInteger(sourceLine) && sourceLine > 0 ? sourceLine : undefined,
    created: typeof data.created === "string" ? data.created : "",
    taskchute: isTaskChuteTask(data)
      ? {
          targetDate: readTargetDate(data.target_date),
          taskId: typeof data.taskId === "string" && data.taskId.trim() ? data.taskId.trim() : undefined,
        }
      : undefined,
  };
}

export function makeTitleFromSelection(
  selection: string,
  fallback = "新しい記録"
): string {
  const firstLine = selection
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? fallback;

  const plain = firstLine
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+>]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/!?(\[([^\]]+)\])\([^)]*\)/g, "$2")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, alias?: string) => alias ?? target)
    .replace(/[*_~`=]/g, "")
    .trim();

  return plain.length > 48 ? `${plain.slice(0, 47)}…` : plain || fallback;
}

export function sanitizeFileName(title: string, fallback = "記録"): string {
  const sanitized = title
    .replace(/[\\/:*?"<>|#^]/g, " ")
    .replaceAll("[", " ")
    .replaceAll("]", " ")
    .replace(/\s+/g, " ")
    .replace(/^\.+|\.+$/g, "")
    .trim();
  return (sanitized || fallback).slice(0, 60);
}
