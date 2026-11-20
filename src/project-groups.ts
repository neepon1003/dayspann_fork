import {
  compareArchiveOrder,
  compareByDueDifference,
  countThisMonth,
  daysUntilEndOfWeek,
  differenceInCalendarDays,
  parseDateKey,
} from "./date-utils";

/** プロジェクトの見出し分けと件数に使う、記録の一部分。 */
export interface ProjectGroupRecord {
  title: string;
  date: string;
  archived: boolean;
  completed?: string;
  taskchute?: { targetDate?: string };
}

export interface ProjectSummaryCounts {
  dueThisWeek: number;
  overdue: number;
  doneThisMonth: number;
}

/**
 * TaskChute の今日の一覧に入っているか（完了していない、かつ target_date が今日）。
 * 「✓ 今日」ボタンと同じ判定。
 */
export function isInTodayList(record: ProjectGroupRecord, todayKey: string): boolean {
  return !record.archived && record.taskchute?.targetDate === todayKey;
}

/**
 * 今日完了したプロジェクトの件数。今日の一覧に入っていたかどうかは問わない。
 * 完了日は、読み込み時に resolveCompletedDate で決めた record.completed を使う。
 */
export function countCompletedToday(records: ProjectGroupRecord[], todayKey: string): number {
  let count = 0;
  for (const record of records) {
    if (record.archived && record.completed === todayKey) count += 1;
  }
  return count;
}

export interface InTodayProgress {
  remaining: number;
  doneToday: number;
}

/** 「今日やる」見出し用。残りは今日の一覧、完了は今日完了したプロジェクト全部。 */
export function countInTodayProgress(records: ProjectGroupRecord[], todayKey: string): InTodayProgress {
  return {
    remaining: records.filter((record) => isInTodayList(record, todayKey)).length,
    doneToday: countCompletedToday(records, todayKey),
  };
}

/** 残りも今日の完了も 0 のときだけ、「今日やる」見出しを出さない。 */
export function shouldShowInTodaySection(progress: InTodayProgress): boolean {
  return progress.remaining > 0 || progress.doneToday > 0;
}

/**
 * 一覧の上の件数。どの見出しに出しているかとは別に数える。
 * 今週締切は、完了していない・期日あり・今日から週の終わり（土曜）まで。超過と期日なしは含めない。
 */
export function countProjectSummary(records: ProjectGroupRecord[], todayKey: string): ProjectSummaryCounts {
  const weekRemaining = daysUntilEndOfWeek(todayKey);
  let dueThisWeek = 0;
  let overdue = 0;
  const completed: Array<string | undefined> = [];
  for (const record of records) {
    if (record.archived) {
      completed.push(record.completed);
      continue;
    }
    if (!parseDateKey(record.date)) continue;
    const difference = differenceInCalendarDays(record.date, todayKey);
    if (difference < 0) overdue += 1;
    else if (difference <= weekRemaining) dueThisWeek += 1;
  }
  return {
    dueThisWeek,
    overdue,
    doneThisMonth: countThisMonth(completed, todayKey),
  };
}

/** 期日順と同じ（超過が上、次に今日、次にこれから）。期日なしはいちばん下。同じ日なら名前順。 */
export function compareProjectByDue(left: ProjectGroupRecord, right: ProjectGroupRecord, todayKey: string): number {
  const leftDated = Boolean(parseDateKey(left.date));
  const rightDated = Boolean(parseDateKey(right.date));
  if (!leftDated && !rightDated) return left.title.localeCompare(right.title);
  if (!leftDated) return 1;
  if (!rightDated) return -1;
  return (
    compareByDueDifference(
      differenceInCalendarDays(left.date, todayKey),
      left.date,
      differenceInCalendarDays(right.date, todayKey),
      right.date
    ) || left.title.localeCompare(right.title)
  );
}

export interface ProjectGroups<T extends ProjectGroupRecord> {
  inToday: T[];
  dated: T[];
  undated: T[];
  archived: T[];
}

/**
 * 完了していない、かつ今日の一覧に入っているカードを「今日やる」へ。期日順・期日なしには出さない。
 * 完了したカードはアーカイブへ。今日やる・期日順の並びは compareProjectByDue。
 */
export function partitionProjectGroups<T extends ProjectGroupRecord>(
  records: T[],
  todayKey: string
): ProjectGroups<T> {
  const inToday: T[] = [];
  const dated: T[] = [];
  const undated: T[] = [];
  const archived: T[] = [];
  for (const record of records) {
    if (record.archived) {
      archived.push(record);
      continue;
    }
    if (isInTodayList(record, todayKey)) {
      inToday.push(record);
      continue;
    }
    if (parseDateKey(record.date)) dated.push(record);
    else undated.push(record);
  }
  inToday.sort((left, right) => compareProjectByDue(left, right, todayKey));
  dated.sort((left, right) => compareProjectByDue(left, right, todayKey));
  undated.sort((left, right) => left.title.localeCompare(right.title));
  archived.sort((left, right) =>
    compareArchiveOrder(left.completed, right.completed, left.date, right.date)
  );
  return { inToday, dated, undated, archived };
}
