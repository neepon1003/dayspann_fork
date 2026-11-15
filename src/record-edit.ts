import type { DayspannDraft } from "./model";
import { formatSourceReference, parseSourceReference } from "./source-link";

/** 完了条件（goal）を 1 行の文字にする。改行や続いた空白は 1 つの空白にまとめる。文字でなければ空文字。 */
export function readGoal(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/**
 * 編集画面の内容を、いまの frontmatter に上書きする。
 * PJ-span が使うキー（title・date・goal・display・archived・completed・source・sourceLine）だけを変え、type・created・TaskChute の taskId / tags / target_date などはそのまま残す。
 */
export function applyDraftToFrontmatter(
  frontmatter: Record<string, unknown>,
  draft: DayspannDraft
): void {
  frontmatter.title = draft.title.trim();
  if (draft.date) frontmatter.date = draft.date;
  else delete frontmatter.date;
  const goal = readGoal(draft.goal);
  if (goal) frontmatter.goal = goal;
  else delete frontmatter.goal;
  if (draft.displayMode) frontmatter.display = draft.displayMode;

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
