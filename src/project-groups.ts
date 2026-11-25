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

/**
 * 「今日やる」見出し用。
 * 残りは「今日の一覧に入っていて、今日まだ TaskChute で実行していない数」。
 * 完了は「今日アーカイブ完了した、または今日 TaskChute で実行したプロジェクトの数」（重複は数えない）。
 */
export function countInTodayProgress<T extends ProjectGroupRecord>(
  records: T[],
  todayKey: string,
  isWorkedToday: (record: T) => boolean = () => false
): InTodayProgress {
  let remaining = 0;
  let doneToday = 0;
  for (const record of records) {
    const worked = !record.archived && isWorkedToday(record);
    const archivedToday = record.archived && record.completed === todayKey;
    if (archivedToday || worked) {
      doneToday += 1;
      continue;
    }
    if (isInTodayList(record, todayKey)) {
      remaining += 1;
    }
  }
  return { remaining, doneToday };
}

/** 未来の次回予定日（target_date）が予約済みなら true。予約済みのカードには停滞マークを出さない。 */
export function hasFutureTargetDate(record: ProjectGroupRecord, todayKey: string): boolean {
  const target = record.taskchute?.targetDate;
  if (!target || !parseDateKey(target)) return false;
  return differenceInCalendarDays(target, todayKey) > 0;
}

export type NextDateBadgeModel =
  | { kind: "future"; appearance: "scheduled"; dateKey: string; days: number }
  | { kind: "past"; appearance: "overdue"; dateKey: string; days: number }
  | { kind: "none"; appearance: "muted" };

/**
 * カードに出す「次回予定日（target_date）」のバッジ情報。
 * アーカイブ済み、TaskChute 非連携、または「今日やる（target_date === 今日）」のカードには出さない。
 */
export function buildNextDateBadge(
  record: ProjectGroupRecord,
  todayKey: string
): NextDateBadgeModel | null {
  if (record.archived || !record.taskchute) return null;
  const target = record.taskchute.targetDate;
  if (!target || !parseDateKey(target)) {
    return { kind: "none", appearance: "muted" };
  }
  const diff = differenceInCalendarDays(target, todayKey);
  if (diff === 0) return null;
  if (diff > 0) {
    return { kind: "future", appearance: "scheduled", dateKey: target, days: diff };
  }
  return { kind: "past", appearance: "overdue", dateKey: target, days: Math.abs(diff) };
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
 * 完了したカードはアーカイブへ。
 * 今日やるの中は「今日まだ」を上、「今日やった」を下にし、同じ状態なら compareProjectByDue。
 */
export function partitionProjectGroups<T extends ProjectGroupRecord>(
  records: T[],
  todayKey: string,
  isWorkedToday: (record: T) => boolean = () => false
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
  inToday.sort((left, right) => {
    const leftWorked = isWorkedToday(left) ? 1 : 0;
    const rightWorked = isWorkedToday(right) ? 1 : 0;
    if (leftWorked !== rightWorked) return leftWorked - rightWorked;
    return compareProjectByDue(left, right, todayKey);
  });
  dated.sort((left, right) => compareProjectByDue(left, right, todayKey));
  undated.sort((left, right) => left.title.localeCompare(right.title));
  archived.sort((left, right) =>
    compareArchiveOrder(left.completed, right.completed, left.date, right.date)
  );
  return { inToday, dated, undated, archived };
}
