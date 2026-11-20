/** プロジェクト一覧の、期日があるカードの見出し。以前の当日・期日まで・期日超過をひとつにまとめたもの。 */
export type DayspannSectionKind = "due";

export const DEFAULT_SECTION_ORDER: DayspannSectionKind[] = ["due"];

export const DEFAULT_SOON_DAYS = 7;
export const DEFAULT_STALLED_DAYS = 3;
export const MAX_SOON_DAYS = 365;

/** 「もうすぐ」の日数を読み取る。0〜365 の整数だけを受け付け、それ以外は null。 */
export function parseSoonDays(value: unknown): number | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(text)) return null;
  const days = Number(text);
  return days <= MAX_SOON_DAYS ? days : null;
}

export function normalizeCollapsedSections(value: unknown): DayspannSectionKind[] {
  if (!Array.isArray(value)) return [];
  const keys = value.filter((item): item is string => typeof item === "string");
  // 新しい「期日順」を折りたたんでいれば、それを使う。
  if (keys.includes("due")) return ["due"];
  // 以前の「期日まで」と「期日超過」の両方が折りたたまれていたときだけ、新しい見出しも折りたたむ。
  // どちらか一方だけなら開く（片方のカードが急に隠れないようにする。「当日」は空で出ていないことも多いので、判定には使わない）。
  if (keys.includes("future") && keys.includes("past")) return ["due"];
  return [];
}

/** 並び順の保存値を整える。期日ありの見出しは「期日順」ひとつになったので、いつも ["due"] にする。 */
export function normalizeSectionOrder(_value: unknown): DayspannSectionKind[] {
  return ["due"];
}

/** 分類が一つもないときの「習慣」見出しのキー。その他（空文字）とは別に覚える。 */
export const ALL_HABITS_GROUP_KEY = "*";

/** 「今日」表示の「完了」見出しのキー。分類の名前とぶつからないよう、予約の id にする。 */
export const DONE_HABITS_GROUP_KEY = "*done";

/** 折りたたんだ習慣の見出しのキーを整える。文字列だけを、重複なく残す。 */
export function normalizeCollapsedHabitGroups(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && !normalized.includes(item)) {
      normalized.push(item);
    }
  }
  return normalized;
}

/** 折りたたみのキーをリストに入れる、または外す。同じキーは重複させない。 */
export function toggleCollapsedKey(keys: string[], key: string, collapsed: boolean): string[] {
  const next = keys.filter((item) => item !== key);
  if (collapsed) next.push(key);
  return next;
}

/** 習慣タブの表示。today は今日が予定日の習慣だけ、all はすべての習慣。 */
export type HabitFilter = "today" | "all";

/** 覚えておいた表示の指定を整える。today 以外はすべて all にする。 */
export function normalizeHabitFilter(value: unknown): HabitFilter {
  return value === "today" ? "today" : "all";
}
