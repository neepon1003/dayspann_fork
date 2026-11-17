import { isTaskChuteTask } from "./taskchute";
import { readRecordType } from "./record-type";

/**
 * 同じ名前のプロジェクト・タスクがもうあるかを調べる（新しく登録するときの二重登録を防ぐため）。
 * 名前は「｜」より前だけを見て、ファイル名の先頭の「YYYY-MM-DD - 」は外して比べる。
 */

/** 調べる対象のノート 1 つ分（frontmatter とファイルの場所）。 */
export interface DuplicateCandidate {
  path: string;
  basename: string;
  frontmatter: Record<string, unknown> | undefined;
}

/** 比べるための名前の形にそろえる。全角・半角、大文字・小文字、前後と連続する空白の違いは同じとみなす。 */
export function normalizeNameForCompare(name: string): string {
  const beforeBar = name.split("｜")[0] ?? "";
  return beforeBar.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

/** ファイル名の先頭の「YYYY-MM-DD - 」を外す（1.0.4 までのファイル名の形）。 */
export function stripDatePrefix(basename: string): string {
  return basename.replace(/^\d{4}-\d{2}-\d{2} - /, "");
}

/** PJ-span の記録（プロジェクト・習慣）か TaskChute のタスクで、アーカイブ（完了）していないものか。 */
export function isActiveProjectOrTask(frontmatter: Record<string, unknown>): boolean {
  if (frontmatter.archived === true) return false;
  const isRecord = readRecordType(frontmatter.type) !== null;
  return isRecord || isTaskChuteTask(frontmatter);
}

/** 新しく登録しようとしている名前と同じ名前の、完了していないノートを返す。 */
export function findDuplicates(name: string, candidates: DuplicateCandidate[]): DuplicateCandidate[] {
  const target = normalizeNameForCompare(name);
  if (!target) return [];
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.path)) return false;
    seen.add(candidate.path);
    const frontmatter = candidate.frontmatter;
    if (!frontmatter || !isActiveProjectOrTask(frontmatter)) return false;
    const names = [stripDatePrefix(candidate.basename)];
    if (typeof frontmatter.title === "string") names.push(frontmatter.title);
    return names.some((value) => normalizeNameForCompare(value) === target);
  });
}
