import { differenceInCalendarDays } from "./date-utils";
import type { DayspannRecord } from "./model";

/** カードの「今日やる」ボタンの状態。none はボタンを出さない。 */
export type TodayButtonState = "none" | "add" | "inToday";

export interface CardActionPlan {
  /** 「今日やる」（太陽アイコン）の状態 */
  today: TodayButtonState;
  /** ✓（完了）を出すか。期日超過でもアイコンの ✓ を出す。 */
  complete: boolean;
  /** 「…」メニューに「期日を1週間延ばす」を入れるか */
  postponeInMenu: boolean;
  /** 期日超過のとき、「延期する」（日付を選ぶ）を「…」メニューに入れるか */
  overdueActions: boolean;
}

export type CardActionRecord = Pick<DayspannRecord, "archived" | "completed" | "date" | "taskchute">;

/** カードに出す操作を決める。アーカイブ済みのカードは「…」だけになる。 */
export function planCardActions(record: CardActionRecord, todayKey: string): CardActionPlan {
  const active = !record.archived;
  const overdue = active && Boolean(record.date) && differenceInCalendarDays(record.date, todayKey) < 0;
  let today: TodayButtonState = "none";
  if (active && !record.completed && record.taskchute) {
    today = record.taskchute.targetDate === todayKey ? "inToday" : "add";
  }
  return {
    today,
    complete: active,
    postponeInMenu: active && Boolean(record.date),
    overdueActions: overdue,
  };
}
