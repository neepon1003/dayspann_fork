import type { DayspannRecord } from "./model";

/** カードの「今日やる」ボタンの状態。none はボタンを出さない。 */
export type TodayButtonState = "none" | "add" | "inToday";

export interface CardActionPlan {
  /** 日数の横に出す「今日やる」（太陽アイコン）の状態 */
  today: TodayButtonState;
  /** 日数の横に ✓（完了）を出すか */
  complete: boolean;
  /** 「…」メニューに「期日を1週間延ばす」を入れるか */
  postponeInMenu: boolean;
}

export type CardActionRecord = Pick<DayspannRecord, "archived" | "completed" | "date" | "taskchute">;

/** カードに出す操作を決める。アーカイブ済みのカードは「…」だけになる。 */
export function planCardActions(record: CardActionRecord, todayKey: string): CardActionPlan {
  const active = !record.archived;
  let today: TodayButtonState = "none";
  if (active && !record.completed && record.taskchute) {
    today = record.taskchute.targetDate === todayKey ? "inToday" : "add";
  }
  return {
    today,
    complete: active,
    postponeInMenu: active && Boolean(record.date),
  };
}
