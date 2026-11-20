import { differenceInCalendarDays, dueSoonDays, parseDateKey } from "./date-utils";
import type { DayspannRecord } from "./model";

/** 残日数ピルの色。soon はオレンジ、ok は緑、overdue は赤、muted は控えめ。 */
export type DuePillAppearance = "soon" | "ok" | "overdue" | "muted";

/** 残日数ピルの種類。 */
export type DuePillKind = "remaining" | "today" | "overdue" | "none" | "done";

export interface DuePillModel {
  kind: DuePillKind;
  appearance: DuePillAppearance;
  /** 残り日数、または超過日数（絶対値）。今日・期日なし・完了では使わない。 */
  days?: number;
  /** ツールチップに出す期日（YYYY-MM-DD）。完了なら完了日、なければ元の期日。 */
  tooltipDateKey?: string;
  /** 完了ピルの「完了 {date}」に使う完了日。 */
  completedDateKey?: string;
}

export type DuePillRecord = Pick<DayspannRecord, "date" | "archived" | "completed">;

/**
 * プロジェクトカードの残日数ピルを決める。
 * 期日が近いオレンジは、設定の soonDays（初期値 7）に合わせる。今日が期日のときは、設定がオフでもオレンジの「今日まで」。
 * 期日なしは、1.0.9 からカードに「期日なし」と出していたので、控えめなピルで同じ言葉を出す。
 */
export function buildDuePill(record: DuePillRecord, todayKey: string, soonDays: number): DuePillModel {
  if (record.archived) {
    return {
      kind: "done",
      appearance: "muted",
      tooltipDateKey: parseDateKey(record.completed ?? "") ? record.completed : parseDateKey(record.date) ? record.date : undefined,
      completedDateKey: parseDateKey(record.completed ?? "") ? record.completed : undefined,
    };
  }
  if (!parseDateKey(record.date)) {
    return { kind: "none", appearance: "muted" };
  }
  const days = differenceInCalendarDays(record.date, todayKey);
  if (days < 0) {
    return {
      kind: "overdue",
      appearance: "overdue",
      days: Math.abs(days),
      tooltipDateKey: record.date,
    };
  }
  if (days === 0) {
    return { kind: "today", appearance: "soon", days: 0, tooltipDateKey: record.date };
  }
  const soon = dueSoonDays(record.date, todayKey, soonDays) !== null;
  return {
    kind: "remaining",
    appearance: soon ? "soon" : "ok",
    days,
    tooltipDateKey: record.date,
  };
}
