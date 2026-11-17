/**
 * PJ-span に出す記録の種類（frontmatter の type）。
 * project（プロジェクト）と habit（習慣）だけを出し、それ以外（routine・life や、昔の dayspann・pj-span・dayspan）は出さない。
 */
export type RecordType = "project" | "habit";

/** タブや選択肢に並べる順番。 */
export const RECORD_TYPES: RecordType[] = ["project", "habit"];

export const DEFAULT_RECORD_TYPE: RecordType = "project";

/** frontmatter の type を読む。project か habit なら返し、それ以外は null。 */
export function readRecordType(value: unknown): RecordType | null {
  return value === "project" || value === "habit" ? value : null;
}

/** 保存した設定や選択肢の値を読む。project か habit でなければ project にする。 */
export function normalizeRecordType(value: unknown): RecordType {
  return readRecordType(value) ?? DEFAULT_RECORD_TYPE;
}
