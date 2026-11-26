import { readDateKey } from "./date-utils";
import { readCategory } from "./habit-category";
import type { DayspannDraft } from "./model";
import { buildHabitTitle } from "./note-template";
import { formatSourceReference, parseSourceReference } from "./source-link";

/** 完了条件（goal）を 1 行の文字にする。改行や続いた空白は 1 つの空白にまとめる。文字でなければ空文字。 */
export function readGoal(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/**
 * 編集画面の内容を、いまの frontmatter に上書きする。
 * PJ-span が使うキー（title・type・date・goal・category・display・archived・completed・source・sourceLine）だけを変え、created・TaskChute の taskId / tags / target_date などはそのまま残す。
 * 種類が習慣のときは、date・goal・display は触らない（プロジェクトに戻したとき、元の値が残るように）。分類は、空でなければ書き、空なら消す。
 * 種類がプロジェクトのときは、category は触らない。
 */
export function applyDraftToFrontmatter(
  frontmatter: Record<string, unknown>,
  draft: DayspannDraft
): void {
  frontmatter.title = draft.type === "habit" ? buildHabitTitle(draft.title, draft.nextAction) : draft.title.trim();
  if (draft.type) frontmatter.type = draft.type;
  if (draft.type !== "habit") {
    if (draft.date) frontmatter.date = draft.date;
    else delete frontmatter.date;
    const goal = readGoal(draft.goal);
    if (goal) frontmatter.goal = goal;
    else delete frontmatter.goal;
    if (draft.displayMode) frontmatter.display = draft.displayMode;
  } else {
    const category = readCategory(draft.category);
    if (category) frontmatter.category = category;
    else delete frontmatter.category;
  }

  if (draft.archived) frontmatter.archived = true;
  else delete frontmatter.archived;
  if (draft.completed) frontmatter.completed = draft.completed;
  else delete frontmatter.completed;

  if (draft.sourcePath) {
    if (parseSourceReference(frontmatter.source) !== draft.sourcePath) {
      frontmatter.source = formatSourceReference(draft.sourcePath);
    }
  } else {
    delete frontmatter.source;
  }
  if (typeof draft.sourceLine === "number") frontmatter.sourceLine = draft.sourceLine;
  else delete frontmatter.sourceLine;
}

/** ノートの frontmatter はそのままに、本文だけを入れ替える。 */
export function replaceRecordBody(content: string, body: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(content);
  const frontmatter = match ? match[0].replace(/\r?\n$/, "") : "";
  const trimmed = body.trim();
  const tail = trimmed ? `\n${trimmed}\n` : "";
  return frontmatter ? `${frontmatter}\n${tail}` : tail.replace(/^\n/, "");
}

export type EmptyRequiredField = "goal" | "date";

/**
 * 習慣 → プロジェクトへ種類を変えたときに、TaskChute のルーチン設定を止めて次回予定日を引き継ぐ。
 * 頻度設定（routine_type・routine_interval など）は消さずに残すので、あとから習慣へ戻しやすい。
 */
export function applyHabitToProjectTransition(
  frontmatter: Record<string, unknown>,
  inheritedTargetDate?: string | null
): boolean {
  let changed = false;
  if (frontmatter.isRoutine === true || frontmatter.isRoutine === "true") {
    frontmatter.isRoutine = false;
    changed = true;
  }
  if (
    frontmatter.routine_enabled !== false &&
    ("routine_enabled" in frontmatter || "isRoutine" in frontmatter)
  ) {
    frontmatter.routine_enabled = false;
    changed = true;
  }
  const inherited = readDateKey(inheritedTargetDate);
  if (inherited && !readDateKey(frontmatter.target_date)) {
    frontmatter.target_date = inherited;
    changed = true;
  }
  return changed;
}

/** 新しく登録するときに確かめる項目のうち、空のもの（完了条件・期日の順）。空白だけのときも空とみなす。習慣は確かめない。 */
export function emptyRequiredFields(draft: Pick<DayspannDraft, "goal" | "date" | "type">): EmptyRequiredField[] {
  if (draft.type === "habit") return [];
  const empty: EmptyRequiredField[] = [];
  if (!draft.goal?.trim()) empty.push("goal");
  if (!draft.date.trim()) empty.push("date");
  return empty;
}
