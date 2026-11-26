import {
  compareArchiveOrder,
  compareByDueDifference,
  countThisMonth,
  daysUntilEndOfWeek,
  differenceInCalendarDays,
  parseDateKey,
} from "./date-utils";

/** プロジェクトの分類フィルター。「*」はすべて、"" は未分類（その他）、それ以外は分類名。 */
export const PROJECT_FILTER_ALL = "*";
export const PROJECT_FILTER_UNCATEGORIZED = "";

/** プロジェクト分類の既定の並び順。ここに無い分類は後ろに名前順で並ぶ。 */
export const DEFAULT_PROJECT_CATEGORY_ORDER = ["個人", "家庭", "仕事"];
export const DEFAULT_PROJECT_CATEGORY_ORDER_TEXT = DEFAULT_PROJECT_CATEGORY_ORDER.join(", ");

/** プロジェクト分類ごとのカード色（左端の帯・うっすら背景・分類ピルに使う）。 */
export const DEFAULT_PROJECT_CATEGORY_COLORS: Record<string, string> = {
  個人: "#ef4444",
  家庭: "#eab308",
  家族: "#eab308",
  仕事: "#3b82f6",
};

/** カンマ・読点区切りの分類並び順テキストを配列にする。 */
export function parseProjectCategoryOrder(raw: string | undefined): string[] {
  if (typeof raw !== "string") return [...DEFAULT_PROJECT_CATEGORY_ORDER];
  const result: string[] = [];
  for (const part of raw.split(/[,、]/)) {
    const trimmed = part.trim();
    if (trimmed && !result.includes(trimmed)) result.push(trimmed);
  }
  return result;
}

/** 分類名に対応するカード色を返す。未定義の分類は null。 */
export function resolveProjectCategoryColor(category: string | undefined): string | null {
  const key = category?.trim() ?? "";
  if (!key) return null;
  return DEFAULT_PROJECT_CATEGORY_COLORS[key] ?? null;
}

/** プロジェクトの見出し分けと件数に使う、記録の一部分。 */
export interface ProjectGroupRecord {
  title: string;
  date: string;
  archived: boolean;
  completed?: string;
  category?: string;
  taskchute?: { targetDate?: string };
}

/**
 * プロジェクトで使われている分類を集める。
 * preferredOrder に含まれる分類をその順で先に並べ、残りは日本語辞書順にする。
 * 未アーカイブのプロジェクトに分類が空のものがあれば hasUncategorized を true にする。
 */
export function collectProjectCategories(
  records: ProjectGroupRecord[],
  preferredOrder: readonly string[] = DEFAULT_PROJECT_CATEGORY_ORDER
): {
  categories: string[];
  hasUncategorized: boolean;
} {
  const names = new Set<string>();
  let hasUncategorized = false;
  for (const record of records) {
    if (record.archived) continue;
    const category = record.category?.trim() ?? "";
    if (category) names.add(category);
    else hasUncategorized = true;
  }
  const rankOf = (name: string): number => {
    const index = preferredOrder.indexOf(name);
    return index >= 0 ? index : preferredOrder.length;
  };
  const categories = [...names].sort(
    (a, b) => rankOf(a) - rankOf(b) || a.localeCompare(b, "ja")
  );
  return { categories, hasUncategorized };
}

/** 保存していた絞り込み値が今の分類一覧に無ければ「すべて」に戻す。 */
export function resolveProjectCategoryFilter(
  savedFilter: string,
  categories: string[],
  hasUncategorized: boolean
): string {
  if (savedFilter === PROJECT_FILTER_ALL) return PROJECT_FILTER_ALL;
  if (savedFilter === PROJECT_FILTER_UNCATEGORIZED) {
    return hasUncategorized ? PROJECT_FILTER_UNCATEGORIZED : PROJECT_FILTER_ALL;
  }
  return categories.includes(savedFilter) ? savedFilter : PROJECT_FILTER_ALL;
}

/** 選んだ分類に合うプロジェクトだけを残す。 */
export function filterProjectsByCategory<T extends ProjectGroupRecord>(
  records: T[],
  filter: string
): T[] {
  if (filter === PROJECT_FILTER_ALL) return records;
  if (filter === PROJECT_FILTER_UNCATEGORIZED) {
    return records.filter((record) => !(record.category?.trim()));
  }
  return records.filter((record) => (record.category?.trim() ?? "") === filter);
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

/** 次回予定日（target_date）順。予定過ぎが上、次に近い未来日、予定なしはいちばん下。同じ日なら名前順。 */
export function compareProjectByTargetDate(
  left: ProjectGroupRecord,
  right: ProjectGroupRecord,
  todayKey: string
): number {
  const leftTarget = left.taskchute?.targetDate ?? "";
  const rightTarget = right.taskchute?.targetDate ?? "";
  const leftHas = Boolean(parseDateKey(leftTarget));
  const rightHas = Boolean(parseDateKey(rightTarget));
  if (!leftHas && !rightHas) return left.title.localeCompare(right.title);
  if (!leftHas) return 1;
  if (!rightHas) return -1;
  return (
    compareByDueDifference(
      differenceInCalendarDays(leftTarget, todayKey),
      leftTarget,
      differenceInCalendarDays(rightTarget, todayKey),
      rightTarget
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
  undated.sort((left, right) => compareProjectByTargetDate(left, right, todayKey));
  archived.sort((left, right) =>
    compareArchiveOrder(left.completed, right.completed, left.date, right.date)
  );
  return { inToday, dated, undated, archived };
}
