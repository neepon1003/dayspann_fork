import assert from "node:assert/strict";
import test from "node:test";
import {
  compareArchiveOrder,
  compareByDueDifference,
  countThisMonth,
  daysUntilEndOfWeek,
  differenceInCalendarDays,
  dueSoonDays,
  formatArchiveMonthParts,
  formatCompletedBadgeDate,
  formatCompletedCardDate,
  formatDateSpan,
  formatLocalizedDate,
  groupByMonth,
  monthKey,
  normalizeDisplayMode,
  parseDateKey,
  parseMonthKey,
  readDateKey,
  addMonthsClamped,
  postponeTargets,
  shiftDateKey,
  stalledDays,
  toDateKey,
} from "../src/date-utils";
import { createTranslator, durationUnit, formatCountUnit, formatDueOverdue, formatDueRemaining, resolveLocale } from "../src/i18n";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { runInNewContext } from "node:vm";
import {
  allNextChecked,
  appendDailyLogEntry,
  applyHabitMemo,
  buildDailyLogEntry,
  buildNewDailyLog,
  chooseHabitAfterLog,
  currentLabel,
  currentNextAction,
  dailyLogPath,
  DEFAULT_DAILY_LOG_FOLDER,
  formatMemoTime,
  habitMemoNotice,
  insertAfterLogHeading,
  isInDailyLogFolder,
  normalizeDailyLogFolder,
  normalizeHabitMemo,
  normalizeHabitMemoEnabled,
  prepareHabitMemoInput,
  replaceFirstOpenNext,
  submittedNextText,
  upsertTitle,
  formatPreviousMemoDate,
  parsePreviousHabitMemo,
  previewHabitMemoText,
} from "../src/habit-memo";
import {
  buildHabitQuickAddVariables,
  filterQuickAddChoiceNames,
  getQuickAddExecuteChoice,
  hasQuickAddChoice,
  listQuickAddChoiceNames,
  normalizeQuickAddChoiceName,
} from "../src/quickadd";
import {
  ALL_HABITS_GROUP_KEY,
  DONE_HABITS_GROUP_KEY,
  normalizeCollapsedHabitGroups,
  normalizeCollapsedSections,
  normalizeHabitFilter,
  normalizeSectionOrder,
  parseSoonDays,
  toggleCollapsedKey,
} from "../src/settings";
import {
  formatSourceReference,
  isLinkedSourceReference,
  parseSourceReference,
} from "../src/source-link";
import { applyDraftToFrontmatter, emptyRequiredFields, readGoal, replaceRecordBody } from "../src/record-edit";
import { planCardActions } from "../src/card-actions";
import { buildDuePill } from "../src/due-pill";
import { countCompletedToday, countInTodayProgress, countProjectSummary, isInTodayList, partitionProjectGroups, shouldShowInTodaySection } from "../src/project-groups";
import { findDuplicates, isActiveProjectOrTask, normalizeNameForCompare, stripDatePrefix } from "../src/duplicate-check";
import { appendLogLine, appendLogLineToFile, readLatestCompletionLogDate, resolveCompletedDate } from "../src/log-entry";
import { normalizeRecordType, readRecordType } from "../src/record-type";
import { groupHabitsByCategory, partitionHabitsDoneToday, readCategory } from "../src/habit-category";
import {
  buildHeatmapWeeks,
  collectLogMonthKeys,
  countActiveDays,
  countHabitDays,
  countTotalActiveDays,
  HEATMAP_WEEKS,
  heatmapLevel,
  heatmapMonthKeys,
  isLogEntryCompleted,
  matchesHabit,
  mergeHabitLogs,
  monthKeyFromLogPath,
  parseDeltaLines,
  parseMonthlyLog,
  readStreakUnit,
  streakDays,
  streakWeeks,
  sundayOfDateKey,
  sundayWeekNumber,
} from "../src/habit-log";
import {
  buildHabitDoneDelta,
  buildHabitUndoDelta,
  deltaLineToAppend,
  findPjSpanEntries,
  formatClockTime,
  isHabitDoneOn,
  isPjSpanInstanceId,
  normalizeTaskChuteDeviceId,
  resolveTaskChuteTitle,
  TASKCHUTE_DEVICE_ID_STORAGE_KEY,
  taskChuteDeltaPath,
} from "../src/habit-record";
import {
  habitTargetProgress,
  isHabitScheduled,
  plannedDateKeysInWeek,
  readHabitSchedule,
  readHabitTarget,
  readMonthDays,
  readMonthWeeks,
  readRoutineType,
  readRoutineWeekdays,
  readWeekday,
  sortHabitsByPending,
  habitScheduledTodayStatus,
  filterHabitsScheduledToday,
  summarizeHabitTargets,
  weekStreakTarget,
} from "../src/habit-target";
import {
  buildNewNoteBody,
  buildNewNoteTitle,
  displayTitle,
  excerptForCard,
  splitTitle,
  joinTitle,
  habitNextAction,
  buildHabitTitle,
  DEFAULT_NEXT_ACTION,
  NEW_NOTE_TOOLBAR,
} from "../src/note-template";
import {
  buildTaskChuteFields,
  canReloadTaskChuteView,
  chooseNewRecordFolder,
  generateTaskChuteTaskId,
  getTaskChuteTaskFolder,
  hasTaskTag,
  isTaskChuteEnabled,
  isTaskChuteTask,
  readTargetDate,
  reloadTaskChuteViewIfOpen,
  TASKCHUTE_DEFAULT_TASK_FOLDER,
  TASKCHUTE_SHOW_TODAY_COMMAND,
  TaskChuteHost,
} from "../src/taskchute";

test("基準日と今日が同じなら0日", () => {
  assert.equal(differenceInCalendarDays("2026-09-11", "2026-09-11"), 0);
});

test("未来は正、過去は負の日数になる", () => {
  assert.equal(differenceInCalendarDays("2026-09-12", "2026-09-11"), 1);
  assert.equal(differenceInCalendarDays("2026-09-01", "2026-09-11"), -10);
});

test("うるう年をカレンダー日として数える", () => {
  assert.equal(differenceInCalendarDays("2024-03-01", "2024-02-28"), 2);
});

test("存在しない日付は受け付けない", () => {
  assert.equal(parseDateKey("2026-02-29"), null);
  assert.equal(parseDateKey("2026-9-1"), null);
});

test("文字列やDateからYYYY-MM-DDを読み取る", () => {
  assert.equal(readDateKey("2026-11-13"), "2026-11-13");
  assert.equal(readDateKey(new Date("2026-11-13T00:00:00.000Z")), "2026-11-13");
  assert.equal(readDateKey("2026-02-29"), "");
  assert.equal(readDateKey(""), "");
  assert.equal(readDateKey(undefined), "");
});

test("完了バッジの日付は今年なら月日、別の年なら年月日にする", () => {
  assert.equal(formatCompletedBadgeDate("2026-11-13", "2026-11-13"), "11/13");
  assert.equal(formatCompletedBadgeDate("2025-12-01", "2026-11-13"), "2025/12/1");
  assert.equal(formatCompletedBadgeDate("bad", "2026-11-13"), "");
});

test("アーカイブは完了日が新しい順で、完了日がないものは後ろになる", () => {
  assert.ok(compareArchiveOrder("2026-11-12", "2026-11-10", "2026-10-01", "2026-10-20") < 0);
  assert.ok(compareArchiveOrder(undefined, "2026-11-10", "2026-10-01", "2026-10-20") > 0);
  assert.ok(compareArchiveOrder("2026-11-10", "2026-11-10", "2026-10-20", "2026-10-01") < 0);
  assert.ok(compareArchiveOrder(undefined, undefined, "2026-10-20", "2026-10-01") < 0);
});

test("ローカル日付をYYYY-MM-DDにする", () => {
  assert.equal(toDateKey(new Date(2026, 8, 5, 23, 30)), "2026-09-05");
});

test("期日を+1日・+1週ずらすと月末・年末・うるう年もカレンダーどおりになる", () => {
  assert.equal(shiftDateKey("2026-11-14", 1), "2026-11-15");
  assert.equal(shiftDateKey("2026-11-14", 7), "2026-11-21");
  assert.equal(shiftDateKey("2026-11-30", 1), "2026-12-01");
  assert.equal(shiftDateKey("2026-12-28", 7), "2027-01-04");
  assert.equal(shiftDateKey("2024-02-28", 1), "2024-02-29");
  assert.equal(shiftDateKey("2025-02-28", 1), "2025-03-01");
  assert.equal(shiftDateKey("2026-03-31", -1), "2026-03-30");
  assert.throws(() => shiftDateKey("2026-02-30", 1));
});

test("今週の終わり（土曜）までの残り日数を返す", () => {
  assert.equal(daysUntilEndOfWeek("2026-11-08"), 6);
  assert.equal(daysUntilEndOfWeek("2026-11-11"), 3);
  assert.equal(daysUntilEndOfWeek("2026-11-14"), 0);
});

test("表示形式がない既存データは日数表示になる", () => {
  assert.equal(normalizeDisplayMode(undefined), "days");
  assert.equal(normalizeDisplayMode("unknown"), "days");
  assert.equal(normalizeDisplayMode("years"), "years");
});

test("日数・月数・年数を選んだ形式で返す", () => {
  assert.deepEqual(formatDateSpan("2019-10-23", "2026-09-11", "days"), [
    { value: 2515, unit: "day" },
  ]);
  assert.deepEqual(formatDateSpan("2026-01-03", "2026-09-11", "months"), [
    { value: 8, unit: "month" },
  ]);
  assert.deepEqual(formatDateSpan("2019-10-23", "2026-09-11", "years"), [
    { value: 6, unit: "year" },
  ]);
});

test("月＋日は完了した暦月と残りの日数で返す", () => {
  assert.deepEqual(formatDateSpan("2026-01-03", "2026-09-11", "months-days"), [
    { value: 8, unit: "month" },
    { value: 8, unit: "day" },
  ]);
  assert.deepEqual(formatDateSpan("2024-01-31", "2024-02-29", "months-days"), [
    { value: 1, unit: "month" },
    { value: 0, unit: "day" },
  ]);
});

test("年＋月＋日は完了した暦年・暦月と残りの日数で返す", () => {
  assert.deepEqual(
    formatDateSpan("2019-10-23", "2026-09-11", "years-months-days"),
    [
      { value: 6, unit: "year" },
      { value: 10, unit: "month" },
      { value: 19, unit: "day" },
    ]
  );
  assert.deepEqual(
    formatDateSpan("2024-02-29", "2025-02-28", "years-months-days"),
    [
      { value: 1, unit: "year" },
      { value: 0, unit: "month" },
      { value: 0, unit: "day" },
    ]
  );
});

test("未来と過去で表示期間の値は変わらない", () => {
  assert.deepEqual(
    formatDateSpan("2026-09-11", "2026-01-03", "months-days"),
    formatDateSpan("2026-01-03", "2026-09-11", "months-days")
  );
});

test("期日ありの見出しは「期日順」ひとつにまとまり、古い並び順の保存値は使わない", () => {
  assert.deepEqual(normalizeSectionOrder(["past", "future", "today"]), ["due"]);
  assert.deepEqual(normalizeSectionOrder(undefined), ["due"]);
  assert.deepEqual(normalizeSectionOrder(["past", "past", "unknown"]), ["due"]);
});

test("「期日順」の折りたたみは、新しいキーか、以前の期日までと期日超過の両方から引き継ぐ", () => {
  assert.deepEqual(normalizeCollapsedSections(["due"]), ["due"]);
  // 以前の「期日まで」と「期日超過」の両方が折りたたまれていたときだけ折りたたむ。
  assert.deepEqual(normalizeCollapsedSections(["future", "past"]), ["due"]);
  assert.deepEqual(normalizeCollapsedSections(["future", "past", "today"]), ["due"]);
  // 片方だけ折りたたまれていたときは開く（カードが急に隠れないようにする）。
  assert.deepEqual(normalizeCollapsedSections(["future"]), []);
  assert.deepEqual(normalizeCollapsedSections(["past"]), []);
  assert.deepEqual(normalizeCollapsedSections(["today"]), []);
  assert.deepEqual(normalizeCollapsedSections(["past", "past", "unknown", "today"]), []);
  assert.deepEqual(normalizeCollapsedSections(undefined), []);
  // 「今日やる」は inToday だけ。以前の「当日」の today では折りたたまれない。
  assert.deepEqual(normalizeCollapsedSections(["inToday"]), ["inToday"]);
  assert.deepEqual(normalizeCollapsedSections(["inToday", "due"]), ["inToday", "due"]);
  assert.deepEqual(normalizeCollapsedSections(["inToday", "today"]), ["inToday"]);
  assert.deepEqual(normalizeCollapsedSections(["future", "past", "inToday"]), ["inToday", "due"]);
});

test("期日があるカードは、超過がいちばん上、次に今日、次にこれから（近い日が先）", () => {
  const rows = [
    { date: "2026-11-28", diff: 8 },
    { date: "2026-11-17", diff: -3 },
    { date: "2026-11-20", diff: 0 },
    { date: "2026-11-10", diff: -10 },
    { date: "2026-11-27", diff: 7 },
  ];
  rows.sort((a, b) => compareByDueDifference(a.diff, a.date, b.diff, b.date));
  assert.deepEqual(
    rows.map((row) => row.date),
    ["2026-11-10", "2026-11-17", "2026-11-20", "2026-11-27", "2026-11-28"]
  );
});

test("「もうすぐ」の日数は0〜365の整数だけを受け付ける", () => {
  assert.equal(parseSoonDays("3"), 3);
  assert.equal(parseSoonDays(" 14 "), 14);
  assert.equal(parseSoonDays(0), 0);
  assert.equal(parseSoonDays(365), 365);
  assert.equal(parseSoonDays("366"), null);
  assert.equal(parseSoonDays("-1"), null);
  assert.equal(parseSoonDays("2.5"), null);
  assert.equal(parseSoonDays(""), null);
  assert.equal(parseSoonDays(undefined), null);
});

test("Obsidianの日本語設定だけを日本語として扱い、それ以外は英語へフォールバックする", () => {
  assert.equal(resolveLocale("ja"), "ja");
  assert.equal(resolveLocale("ja-JP"), "ja");
  assert.equal(resolveLocale("en"), "en");
  assert.equal(resolveLocale("fr"), "en");
});

test("日本語と英語の表示文言を切り替える", () => {
  assert.equal(createTranslator("ja")("section.due"), "期日順");
  assert.equal(createTranslator("en")("section.due"), "By due date");
  assert.equal(createTranslator("ja")("section.inToday"), "今日やる");
  assert.equal(createTranslator("en")("section.inToday"), "Do today");
  assert.equal(createTranslator("ja")("section.heading", { title: "今日やる", count: 1 }), "今日やる（1）");
  assert.equal(createTranslator("en")("section.heading", { title: "Do today", count: 1 }), "Do today (1)");
  assert.equal(
    createTranslator("ja")("section.inTodayProgress", { remaining: 1, done: 0 }),
    "残り1／完了0"
  );
  assert.equal(
    createTranslator("en")("section.inTodayProgress", { remaining: 1, done: 0 }),
    "1 left / 0 done"
  );
  assert.equal(createTranslator("ja")("section.inTodayAllDone"), "すべて完了 ✓");
  assert.equal(createTranslator("en")("section.inTodayAllDone"), "All done ✓");
  assert.equal(
    createTranslator("ja")("view.goalTooltip", { goal: "支払漏れがないようにする" }),
    "完了条件：支払漏れがないようにする"
  );
  assert.equal(
    createTranslator("en")("view.goalTooltip", { goal: "Pay without missing a bill" }),
    "Completion condition: Pay without missing a bill"
  );
  assert.equal(createTranslator("ja")("action.viewGoal"), "完了条件を見る");
  assert.equal(createTranslator("en")("action.viewGoal"), "View completion condition");
  assert.equal(createTranslator("ja")("action.close"), "閉じる");
  assert.equal(createTranslator("en")("action.close"), "Close");
  assert.equal(createTranslator("ja")("section.future"), "期日まで");
  assert.equal(createTranslator("en")("section.future"), "Days remaining");
  assert.equal(
    createTranslator("ja")("view.emptyDescription"),
    "文章を選択して、コマンドまたは右クリックから「PJ-spanに登録」を実行してください。"
  );
  assert.equal(
    createTranslator("en")("view.openRecord", { title: "Sample event" }),
    "Open Sample event"
  );
  assert.equal(createTranslator("ja")("action.chooseSource"), "ノートを選ぶ");
  assert.equal(createTranslator("en")("action.chooseSource"), "Choose note");
  assert.equal(createTranslator("ja")("modal.sourceNone"), "設定されていません");
  assert.equal(createTranslator("en")("modal.sourceNone"), "Not set");
});

test("期間単位と日付を日本語・英語で表示する", () => {
  assert.equal(durationUnit("ja", "month", 8), "ヶ月");
  assert.equal(durationUnit("en", "day", 1), "day");
  assert.equal(durationUnit("en", "day", 2), "days");
  assert.equal(formatLocalizedDate("2026-09-14", "ja"), "2026年9月14日(月)");
  assert.equal(formatLocalizedDate("2026-09-14", "en"), "Mon, Sep 14, 2026");
});

test("登録元をクリックできる内部リンクとして保存し、従来のパスも読み込める", () => {
  const path = "Journal/2026-09-14.md";
  const link = formatSourceReference(path);

  assert.equal(link, "[[Journal/2026-09-14.md]]");
  assert.equal(parseSourceReference(link), path);
  assert.equal(parseSourceReference(path), path);
  assert.equal(parseSourceReference("[[Journal/2026-09-14.md|元メモ]]"), path);
  assert.equal(isLinkedSourceReference(link), true);
  assert.equal(isLinkedSourceReference(path), false);
});

test("tagsのtaskを配列・文字列・#つきのどれでも見つける", () => {
  assert.equal(hasTaskTag(["task"]), true);
  assert.equal(hasTaskTag(["work", "#task"]), true);
  assert.equal(hasTaskTag("task"), true);
  assert.equal(hasTaskTag("#task"), true);
  assert.equal(hasTaskTag("work, task"), true);
  assert.equal(hasTaskTag(["tasks", "taskchute"]), false);
  assert.equal(hasTaskTag(undefined), false);
  assert.equal(hasTaskTag(3), false);
});

test("TaskChuteのタスクノートを tags か taskId で見分け、target_date を読む", () => {
  assert.equal(isTaskChuteTask({ tags: ["task"] }), true);
  assert.equal(isTaskChuteTask({ taskId: "tc-task-1" }), true);
  assert.equal(isTaskChuteTask({ taskchuteId: "tc-task-1" }), true);
  assert.equal(isTaskChuteTask({ type: "dayspann", taskId: " " }), false);
  assert.equal(isTaskChuteTask({ type: "project" }), false);
  assert.equal(readTargetDate("2026-12-22"), "2026-12-22");
  assert.equal(readTargetDate(new Date("2026-12-22T00:00:00Z")), "2026-12-22");
  assert.equal(readTargetDate("12/22"), undefined);
  assert.equal(readTargetDate(undefined), undefined);
});

test("TaskChuteの画面は、有効・コマンドあり・画面が開いているときだけ読み直す", () => {
  const host = (enabled: boolean, command: boolean, leaves: number): TaskChuteHost => ({
    plugins: { enabledPlugins: new Set(enabled ? ["taskchute-plus"] : []) },
    commands: {
      commands: command ? { [TASKCHUTE_SHOW_TODAY_COMMAND]: {} } : {},
      executeCommandById: () => true,
    },
    workspace: {
      getLeavesOfType: (type: string) => (type === "taskchute-view" ? new Array<unknown>(leaves).fill({}) : []),
    },
  });
  assert.equal(canReloadTaskChuteView(host(true, true, 1)), true);
  assert.equal(canReloadTaskChuteView(host(false, true, 1)), false);
  assert.equal(canReloadTaskChuteView(host(true, false, 1)), false);
  assert.equal(canReloadTaskChuteView(host(true, true, 0)), false);
  assert.equal(canReloadTaskChuteView({ workspace: { getLeavesOfType: () => [{}] } }), false);
});

test("編集で保存してもTaskChuteのキーとtypeを消さない", () => {
  const frontmatter: Record<string, unknown> = {
    target_date: "2026-12-22",
    taskId: "tc-task-1",
    tags: ["task"],
    title: "旧タイトル",
    type: "dayspann",
    date: "2026-12-22",
    archived: true,
    completed: "2026-11-01",
    source: "[[元ノート]]",
  };
  applyDraftToFrontmatter(frontmatter, {
    title: " 新タイトル ",
    date: "2026-12-25",
    displayMode: "days",
    excerpt: "",
    sourcePath: "元ノート",
  });
  assert.deepEqual(frontmatter, {
    target_date: "2026-12-22",
    taskId: "tc-task-1",
    tags: ["task"],
    title: "新タイトル",
    type: "dayspann",
    date: "2026-12-25",
    display: "days",
    source: "[[元ノート]]",
  });
});

test("本文だけを入れ替え、frontmatterはそのまま残す", () => {
  const content = "---\ntaskId: tc-task-1\ntags:\n  - task\n---\n\n# 古い本文\n";
  assert.equal(
    replaceRecordBody(content, "  # 新しい本文  "),
    "---\ntaskId: tc-task-1\ntags:\n  - task\n---\n\n# 新しい本文\n"
  );
  assert.equal(replaceRecordBody(content, ""), "---\ntaskId: tc-task-1\ntags:\n  - task\n---\n");
  assert.equal(replaceRecordBody("本文だけ", "新しい"), "新しい\n");
});

test("実際のTaskChuteタスクノート（type: dayspann・tags: [task]・taskId）をTaskChuteのタスクとして読む", () => {
  const frontmatter = {
    target_date: "2026-12-22",
    taskId: "tc-task-4aacd653-f7d9-477d-a3d4-7ba1b7bc6379",
    tags: ["task"],
    title: "はばタンPAY+第6弾｜当選結果を確認する",
    notetoolbar: ["btn"],
    type: "dayspann",
    date: "2026-12-22",
  };
  assert.equal(isTaskChuteTask(frontmatter), true);
  assert.equal(readTargetDate(frontmatter.target_date), "2026-12-22");
});

test("「期日を1週間延ばす」は「…」メニューの項目にする", () => {
  assert.equal(createTranslator("ja")("action.postponeWeek"), "期日を1週間延ばす");
  assert.equal(createTranslator("en")("action.postponeWeek"), "Postpone 1 week");
  assert.equal(shiftDateKey("2026-11-30", 7), "2026-12-07");
});

test("TaskChuteのカードは「今日やる」を出し、今日の一覧に入っていれば「入っています」の形にする", () => {
  const record = { archived: false, date: "2026-12-22", taskchute: { targetDate: "2026-12-22" } };
  assert.deepEqual(planCardActions(record, "2026-11-14"), {
    today: "add",
    complete: true,
    postponeInMenu: true,
    overdueActions: false,
  });
  assert.equal(planCardActions({ ...record, taskchute: {} }, "2026-11-14").today, "add");
  assert.equal(
    planCardActions({ ...record, taskchute: { targetDate: "2026-11-14" } }, "2026-11-14").today,
    "inToday"
  );
  assert.equal(createTranslator("ja")("action.inTodayLabel"), "今日の一覧に入っています");
  assert.equal(createTranslator("ja")("action.todayLabel"), "TaskChuteの今日の一覧に入れる");
  assert.equal(createTranslator("ja")("action.todayShort"), "今日やる");
  assert.equal(createTranslator("ja")("action.inTodayShort"), "今日");
  assert.equal(createTranslator("en")("action.todayShort"), "Do today");
  assert.equal(createTranslator("en")("action.inTodayShort"), "Today");
  assert.equal(createTranslator("ja")("action.completeShort"), "完了");
  assert.equal(createTranslator("en")("action.completeShort"), "Done");
});

test("TaskChuteでないカードは✓と「…」だけ、期日がなければ先送りはメニューに出さない", () => {
  assert.deepEqual(planCardActions({ archived: false, date: "2026-12-22" }, "2026-11-14"), {
    today: "none",
    complete: true,
    postponeInMenu: true,
    overdueActions: false,
  });
  assert.equal(planCardActions({ archived: false, date: "" }, "2026-11-14").postponeInMenu, false);
});

test("アーカイブ済みのカードは「…」だけにする", () => {
  assert.deepEqual(
    planCardActions(
      { archived: true, completed: "2026-11-13", date: "2026-11-30", taskchute: { targetDate: "2026-11-14" } },
      "2026-11-14"
    ),
    { today: "none", complete: false, postponeInMenu: false, overdueActions: false }
  );
});

test("完了条件（goal）は 1 行の文字として読み、文字でなければ空にする", () => {
  assert.equal(readGoal("  当選結果を確認して\n家族に共有する  "), "当選結果を確認して 家族に共有する");
  assert.equal(readGoal(""), "");
  assert.equal(readGoal(undefined), "");
  assert.equal(readGoal(123), "");
  assert.equal(createTranslator("ja")("modal.goal"), "完了条件");
  assert.equal(createTranslator("en")("modal.goal"), "Completion condition");
});

test("編集の保存で goal を書き、空なら goal の項目を消す（TaskChuteの項目は残す）", () => {
  const frontmatter: Record<string, unknown> = {
    target_date: "2026-11-15",
    taskId: "tc-task-abc",
    tags: ["task"],
    type: "dayspann",
    title: "はばタンPAY+",
    date: "2026-12-22",
  };
  applyDraftToFrontmatter(frontmatter, {
    title: "はばタンPAY+",
    date: "2026-12-22",
    goal: "  当選結果を確認して家族に共有する ",
    excerpt: "",
  });
  assert.equal(frontmatter.goal, "当選結果を確認して家族に共有する");

  applyDraftToFrontmatter(frontmatter, { title: "はばタンPAY+", date: "2026-12-22", goal: "   ", excerpt: "" });
  assert.equal("goal" in frontmatter, false);
  assert.equal(frontmatter.target_date, "2026-11-15");
  assert.equal(frontmatter.taskId, "tc-task-abc");
  assert.deepEqual(frontmatter.tags, ["task"]);
  assert.equal(frontmatter.type, "dayspann");
});

test("新しく登録した記録のTaskChuteの項目は、空の target_date・taskId・tags: [task]", () => {
  const fields = buildTaskChuteFields("tc-task-1234");
  assert.deepEqual(fields, { target_date: "", taskId: "tc-task-1234", tags: ["task"] });
  // PJ-span の読み方でも TaskChute のタスクで、日付は無い（今日の一覧に入っていない）形になる
  assert.equal(isTaskChuteTask(fields as unknown as Record<string, unknown>), true);
  assert.equal(readTargetDate(fields.target_date), undefined);
  assert.equal(
    planCardActions(
      { archived: false, date: "2026-12-22", taskchute: { targetDate: readTargetDate(fields.target_date) } },
      "2026-11-15"
    ).today,
    "add"
  );
});

test("taskId は TaskChute と同じ tc-task- ＋ UUID の形で作る", () => {
  assert.equal(
    generateTaskChuteTaskId(() => "123e4567-e89b-12d3-a456-426614174000"),
    "tc-task-123e4567-e89b-12d3-a456-426614174000"
  );
  // UUID を作れないときは TaskChute と同じく時刻＋乱数
  assert.match(generateTaskChuteTaskId(null), /^tc-task-[0-9a-z]+-[0-9a-z]+$/);
  assert.notEqual(generateTaskChuteTaskId(null), generateTaskChuteTaskId(null));
});

test("TaskChuteが有効かどうかと、TaskChuteのタスクフォルダを読む", () => {
  assert.equal(isTaskChuteEnabled({ plugins: { enabledPlugins: new Set(["taskchute-plus"]) } }), true);
  assert.equal(isTaskChuteEnabled({ plugins: { enabledPlugins: new Set(["pj-span"]) } }), false);
  assert.equal(isTaskChuteEnabled({}), false);

  assert.equal(
    getTaskChuteTaskFolder({
      plugins: { plugins: { "taskchute-plus": { pathManager: { getTaskFolderPath: () => "Work/TaskChute/Task/" } } } },
    }),
    "Work/TaskChute/Task"
  );
  assert.equal(getTaskChuteTaskFolder({ plugins: { plugins: {} } }), TASKCHUTE_DEFAULT_TASK_FOLDER);
  assert.equal(
    getTaskChuteTaskFolder({
      plugins: {
        plugins: {
          "taskchute-plus": {
            pathManager: {
              getTaskFolderPath: () => {
                throw new Error("x");
              },
            },
          },
        },
      },
    }),
    "TaskChute/Task"
  );
});

test("新しい記録は、PJ-spanとTaskChuteの両方から見えるフォルダに置く", () => {
  // 記録フォルダが TaskChute フォルダ全体 → タスクフォルダに置く
  assert.deepEqual(chooseNewRecordFolder("TaskChute", "TaskChute/Task"), {
    folder: "TaskChute/Task",
    visibleToTaskChute: true,
  });
  // 記録フォルダがタスクフォルダそのもの、またはその下 → 記録フォルダのまま
  assert.deepEqual(chooseNewRecordFolder("TaskChute/Task", "TaskChute/Task"), {
    folder: "TaskChute/Task",
    visibleToTaskChute: true,
  });
  assert.deepEqual(chooseNewRecordFolder("TaskChute/Task/PJ", "TaskChute/Task"), {
    folder: "TaskChute/Task/PJ",
    visibleToTaskChute: true,
  });
  // 名前が似ているだけの別フォルダや、まったく別の場所 → TaskChute からは見えない
  assert.deepEqual(chooseNewRecordFolder("TaskChute/Tasks", "TaskChute/Task"), {
    folder: "TaskChute/Tasks",
    visibleToTaskChute: false,
  });
  assert.deepEqual(chooseNewRecordFolder("pj-span", "TaskChute/Task"), {
    folder: "pj-span",
    visibleToTaskChute: false,
  });
});

test("新しいノートのタイトルは「名前｜プロジェクトノート作成」にし、二重には付けない", () => {
  assert.equal(buildNewNoteTitle("はばタンPAY+"), "はばタンPAY+｜プロジェクトノート作成");
  assert.equal(buildNewNoteTitle("  テスト  "), "テスト｜プロジェクトノート作成");
  assert.equal(buildNewNoteTitle("テスト｜プロジェクトノート作成"), "テスト｜プロジェクトノート作成");
  // 区切りは全角の ｜（U+FF5C）
  assert.equal(buildNewNoteTitle("A").charCodeAt(1), 0xff5c);
  assert.deepEqual(NEW_NOTE_TOOLBAR, ["btn"]);
});

test("カードには「｜」より前の名前を出す", () => {
  assert.equal(displayTitle("はばタンPAY+｜プロジェクトノート作成"), "はばタンPAY+");
  assert.equal(displayTitle("はばタンPAY+第6弾｜当選結果を確認する"), "はばタンPAY+第6弾");
  assert.equal(displayTitle("｜プロジェクトノート作成"), "｜プロジェクトノート作成");
  assert.equal(displayTitle("テスト"), "テスト");
});

test("新しいノートの本文は「概要」「次の一手」「ログ」で、残しておく文章は「概要」の下に入る", () => {
  assert.equal(buildNewNoteBody(""), "## 概要\n\n## 次の一手\n\n## ログ");
  assert.equal(buildNewNoteBody("  選んだ文章\n2行目  "), "## 概要\n\n選んだ文章\n2行目\n\n## 次の一手\n\n## ログ");
});

test("カードの抜き書きは見出しの行を外して1行にまとめる", () => {
  assert.equal(excerptForCard(buildNewNoteBody("")), "");
  assert.equal(excerptForCard(buildNewNoteBody("選んだ文章\n2行目")), "選んだ文章 2行目");
  assert.equal(excerptForCard("前からある文章\n\n続き"), "前からある文章 続き");
  assert.equal(excerptForCard("#task のメモ"), "#task のメモ");
});

test("編集の保存では、タイトルの後ろの言葉・notetoolbar・本文の見出しを変えない", () => {
  const frontmatter: Record<string, unknown> = {
    title: "テスト｜プロジェクトノート作成",
    notetoolbar: ["btn"],
    date: "2026-12-22",
  };
  applyDraftToFrontmatter(frontmatter, {
    title: "テスト｜プロジェクトノート作成",
    date: "2026-12-22",
    excerpt: "",
  });
  assert.equal(frontmatter.title, "テスト｜プロジェクトノート作成");
  assert.deepEqual(frontmatter.notetoolbar, ["btn"]);

  const body = buildNewNoteBody("選んだ文章");
  const note = `---\ntitle: テスト\n---\n\n${body}\n`;
  assert.equal(replaceRecordBody(note, body), note);
});

test("二重登録の確認では、「｜」より前の名前を、全角半角・大文字小文字・空白の違いなしで比べる", () => {
  assert.equal(normalizeNameForCompare("テスト２｜プロジェクトノート作成"), "テスト2");
  assert.equal(normalizeNameForCompare("  ＡＢＣ　 計画 "), "abc 計画");
  assert.equal(stripDatePrefix("2026-11-15 - テスト２"), "テスト２");
  assert.equal(stripDatePrefix("テスト２"), "テスト２");
});

test("同じ名前の、完了していないPJ-spanの記録・TaskChuteのタスクだけを見つける", () => {
  const found = findDuplicates("テスト２", [
    { path: "TaskChute/Task/2026-11-15 - テスト２.md", basename: "2026-11-15 - テスト２", frontmatter: { type: "project", title: "2026-11-15 - テスト２｜次のステージへ２" } },
    { path: "TaskChute/Task/テスト２.md", basename: "テスト２", frontmatter: { tags: ["task"], title: "テスト２｜プロジェクトノート作成" } },
    { path: "TaskChute/Task/別の名前.md", basename: "別の名前", frontmatter: { taskId: "tc-task-1", title: "テスト２" } },
    { path: "TaskChute/Task/テスト２ 2.md", basename: "テスト２ 2", frontmatter: { type: "project", title: "テスト２", archived: true } },
    { path: "メモ/テスト２.md", basename: "テスト２", frontmatter: { title: "テスト２" } },
    { path: "TaskChute/Task/フロントマターなし.md", basename: "テスト２", frontmatter: undefined },
    { path: "TaskChute/Task/テスト２.md", basename: "テスト２", frontmatter: { tags: ["task"] } },
  ]);
  assert.deepEqual(
    found.map((note) => note.path),
    ["TaskChute/Task/2026-11-15 - テスト２.md", "TaskChute/Task/テスト２.md", "TaskChute/Task/別の名前.md"]
  );
  assert.deepEqual(findDuplicates("  ", [{ path: "a.md", basename: "", frontmatter: { type: "project" } }]), []);
});

test("ログが見出しの途中にあるとき、その見出しのいちばん下に行を足す", () => {
  const body = "## 概要\n\n概要の文\n\n## ログ\n- 2026-10-01 開始\n\n## 振り返り\n\nあとで書く\n";
  assert.equal(
    appendLogLine(body, "- 2026-11-15 完了"),
    "## 概要\n\n概要の文\n\n## ログ\n- 2026-10-01 開始\n- 2026-11-15 完了\n\n## 振り返り\n\nあとで書く\n"
  );
  assert.equal(createTranslator("ja")("completeConfirm.title"), "完了条件を達成しましたか？");
  assert.equal(createTranslator("en")("completeConfirm.notYet"), "Not yet");
});

test("ログが見出しの末尾にあるとき、そのいちばん下に行を足す", () => {
  const body = buildNewNoteBody("選んだ文章");
  assert.equal(
    appendLogLine(body, "- 2026-11-15 完了"),
    "## 概要\n\n選んだ文章\n\n## 次の一手\n\n## ログ\n- 2026-11-15 完了"
  );
});

test("ログの見出しがなければ、末尾に「## ログ」を作って行を足す", () => {
  assert.equal(appendLogLine("前からある文章", "- 2026-11-15 完了"), "前からある文章\n## ログ\n- 2026-11-15 完了\n");
  assert.equal(appendLogLine("", "- 2026-11-15 完了"), "## ログ\n- 2026-11-15 完了\n");
  const note = "---\ntitle: テスト\ngoal: 当選結果を確認する\n---\n\n## 概要\n\n## 次の一手\n";
  assert.equal(
    appendLogLineToFile(note, "- 2026-11-15 完了"),
    "---\ntitle: テスト\ngoal: 当選結果を確認する\n---\n\n## 概要\n\n## 次の一手\n## ログ\n- 2026-11-15 完了\n"
  );
});

test("更新から設定の日数以上たっているときだけ、止まっている日数を返す", () => {
  const now = new Date(2026, 10, 15, 12, 0, 0);
  const at = (monthDay: number, hours: number, minutes = 0) =>
    new Date(2026, 10, monthDay, hours, minutes, 0).getTime();

  // 設定より少ない日数（2日前、設定は3日）
  assert.equal(stalledDays(at(13, 12), now, 3), null);
  // ちょうど設定の日数（3日前）
  assert.equal(stalledDays(at(12, 12), now, 3), 3);
  // 設定より多い日数
  assert.equal(stalledDays(at(10, 12), now, 3), 5);
  // 設定が 0 ならオフ（何日たっていても印をつけない）
  assert.equal(stalledDays(at(1, 12), now, 0), null);
  // 同じ日なら印をつけない
  assert.equal(stalledDays(at(15, 9), now, 3), null);

  // 日付をまたぐとき：11/12 23:30 から 11/15 00:30 はカレンダー日で 3 日
  const justAfterMidnight = new Date(2026, 10, 15, 0, 30, 0);
  assert.equal(stalledDays(at(12, 23, 30), justAfterMidnight, 3), 3);
  // 11/13 23:30 から 11/15 00:30 はカレンダー日で 2 日なので、設定が 3 なら印をつけない
  assert.equal(stalledDays(at(13, 23, 30), justAfterMidnight, 3), null);

  assert.equal(createTranslator("ja")("stalled.tooltip", { days: 3 }), "3日より前から更新されていません");
  assert.equal(createTranslator("en")("stalled.tooltip", { days: 3 }), "Not updated for more than 3 days");
});

test("1か月後は同じ日の翌月で、その日がなければ月末にする", () => {
  assert.equal(addMonthsClamped("2026-11-16", 1), "2026-12-16");
  assert.equal(addMonthsClamped("2026-12-16", 1), "2027-01-16");
  assert.equal(addMonthsClamped("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonthsClamped("2024-01-31", 1), "2024-02-29");
  assert.equal(addMonthsClamped("2026-03-31", 1), "2026-04-30");
  assert.equal(addMonthsClamped("2026-05-31", -1), "2026-04-30");
  assert.throws(() => addMonthsClamped("2026-02-30", 1));
});

test("延期の候補日は今日から数え、期日超過のカードには「延期する」と「完了する」を出す", () => {
  assert.deepEqual(postponeTargets("2026-11-16"), {
    tomorrow: "2026-11-17",
    inOneWeek: "2026-11-23",
    inOneMonth: "2026-12-16",
    pickDefault: "2026-11-23",
  });
  assert.equal(postponeTargets("2026-01-31").inOneMonth, "2026-02-28");
  assert.equal(postponeTargets("2024-01-31").inOneMonth, "2024-02-29");

  assert.deepEqual(planCardActions({ archived: false, date: "2026-11-10" }, "2026-11-16"), {
    today: "none",
    complete: true,
    postponeInMenu: true,
    overdueActions: true,
  });
  assert.deepEqual(
    planCardActions(
      { archived: false, date: "2026-11-10", taskchute: { targetDate: "2026-11-16" } },
      "2026-11-16"
    ),
    { today: "inToday", complete: true, postponeInMenu: true, overdueActions: true }
  );
  assert.equal(planCardActions({ archived: false, date: "2026-11-16" }, "2026-11-16").overdueActions, false);
  assert.equal(planCardActions({ archived: false, date: "" }, "2026-11-16").overdueActions, false);

  assert.equal(createTranslator("ja")("action.postpone"), "延期する");
  assert.equal(createTranslator("ja")("action.completeOverdue"), "完了する");
  assert.equal(createTranslator("ja")("action.postponeTomorrow"), "明日");
  assert.equal(createTranslator("en")("action.postponeInWeek"), "In 1 week");
  assert.equal(createTranslator("ja")("postponePick.confirm"), "決定");
  assert.equal(createTranslator("en")("error.dateBeforeToday"), "Dates before today cannot be chosen.");
});

test("完了日を月ごとにまとめ、今月の件数を数える", () => {
  assert.equal(monthKey("2026-11-16"), "2026-11");
  assert.equal(monthKey("2026-01-01"), "2026-01");
  assert.equal(monthKey("bad"), null);
  assert.deepEqual(parseMonthKey("2026-11"), { year: 2026, month: 11 });
  assert.equal(parseMonthKey("2026-13"), null);

  assert.equal(
    countThisMonth(["2026-11-01", "2026-11-30", "2026-10-31", undefined, "bad"], "2026-11-16"),
    2
  );
  assert.equal(countThisMonth([], "2026-11-16"), 0);

  const grouped = groupByMonth(
    [
      { name: "a", completed: "2026-11-16" },
      { name: "b", completed: "2026-10-02" },
      { name: "c", completed: "2026-11-01" },
      { name: "d", completed: undefined },
    ],
    (item) => item.completed
  );
  assert.deepEqual(
    grouped.map((group) => [group.monthKey, group.items.map((item) => item.name)]),
    [
      ["2026-11", ["a", "c"]],
      ["2026-10", ["b"]],
      ["", ["d"]],
    ]
  );

  assert.equal(formatArchiveMonthParts("2026-11", "en")?.monthName, "November");
  assert.equal(createTranslator("ja")("view.doneThisMonth", { count: 3 }), "今月完了 3");
  assert.equal(createTranslator("en")("view.doneThisMonth", { count: 3 }), "Done this month 3");
  assert.equal(createTranslator("ja")("view.dueThisWeek", { count: 0 }), "今週締切 0");
  assert.equal(createTranslator("en")("view.dueThisWeek", { count: 0 }), "This week 0");
  assert.equal(createTranslator("ja")("view.overdueCount", { count: 2 }), "超過 2");
  assert.equal(createTranslator("en")("view.overdueCount", { count: 2 }), "Overdue 2");
  assert.equal(createTranslator("ja")("section.archiveMonth", { year: 2026, month: 11, count: 2 }), "2026年11月（2）");
  assert.equal(createTranslator("en")("section.archiveMonth", { year: 2026, monthName: "November", count: 2 }), "November 2026 (2)");
});

test("アーカイブのカードの完了日は「完了 11月16日」の形にする", () => {
  assert.equal(formatCompletedCardDate("2026-11-16", "2026-11-16", "ja"), "11月16日");
  assert.equal(formatCompletedCardDate("2025-12-01", "2026-11-16", "ja"), "2025年12月1日");
  assert.equal(formatCompletedCardDate("2026-11-16", "2026-11-16", "en"), "November 16");
  assert.equal(formatCompletedCardDate("2025-12-01", "2026-11-16", "en"), "December 1, 2025");
  assert.equal(formatCompletedCardDate("bad", "2026-11-16", "ja"), "");
  assert.equal(createTranslator("ja")("view.doneOn", { date: "11月16日" }), "完了 11月16日");
  assert.equal(createTranslator("en")("view.doneOn", { date: "November 16" }), "Done November 16");
});

test("完了日は frontmatter、なければログの完了行、それもなければ更新日から決める", () => {
  const note = "---\ntitle: テスト\narchived: true\n---\n\n## 概要\n\n## ログ\n- 2026-10-01 開始\n- 2026-10-20 完了\n\n## 振り返り\n- 2026-12-01 完了\n";
  assert.equal(readLatestCompletionLogDate(note), "2026-10-20");
  assert.equal(resolveCompletedDate("2026-11-16", note, Date.UTC(2026, 0, 1)), "2026-11-16");
  assert.equal(resolveCompletedDate(undefined, note, Date.UTC(2026, 0, 1)), "2026-10-20");

  const noLog = "---\ntitle: テスト\narchived: true\n---\n\n本文だけ\n";
  assert.equal(readLatestCompletionLogDate(noLog), undefined);
  const mtime = new Date(2026, 8, 5, 23, 30).getTime();
  assert.equal(resolveCompletedDate(undefined, noLog, mtime), "2026-09-05");
  assert.equal(resolveCompletedDate("bad", noLog, mtime), "2026-09-05");
});

test("タイトルの「｜」より後ろを次の一手として分ける", () => {
  assert.deepEqual(splitTitle("テスト２｜次のステージへ２"), { name: "テスト２", nextAction: "次のステージへ２" });
  assert.deepEqual(splitTitle("テスト２"), { name: "テスト２", nextAction: "" });
  assert.deepEqual(splitTitle("テスト２｜"), { name: "テスト２", nextAction: "" });
  assert.deepEqual(splitTitle("  テスト２ ｜ 次の一手 ｜ 続き  "), { name: "テスト２", nextAction: "次の一手 ｜ 続き" });
  assert.deepEqual(splitTitle("｜プロジェクトノート作成"), { name: "", nextAction: "プロジェクトノート作成" });
  assert.equal(createTranslator("ja")("view.nextAction"), "次の一手");
  assert.equal(createTranslator("en")("view.nextAction"), "Next action");
});

test("習慣の次の一手はタイトルの「｜」より後ろで、初期値は出さない", () => {
  assert.equal(DEFAULT_NEXT_ACTION, "プロジェクトノート作成");
  assert.equal(joinTitle("スクワット", "10回やる"), "スクワット｜10回やる");
  assert.equal(joinTitle("  スクワット  ", "  "), "スクワット");
  assert.equal(joinTitle("スクワット", ""), "スクワット");
  assert.equal(habitNextAction("スクワット｜10回やる"), "10回やる");
  assert.equal(habitNextAction("スクワット"), "");
  assert.equal(habitNextAction("スクワット｜"), "");
  assert.equal(habitNextAction("スクワット｜プロジェクトノート作成"), "");
  assert.equal(buildHabitTitle("スクワット"), "スクワット");
  assert.equal(buildHabitTitle("スクワット｜プロジェクトノート作成"), "スクワット");
  assert.equal(buildHabitTitle("スクワット", "10回やる"), "スクワット｜10回やる");
  assert.equal(buildHabitTitle("スクワット｜古い一手", "10回やる"), "スクワット｜10回やる");
  assert.equal(buildHabitTitle("スクワット｜10回やる"), "スクワット｜10回やる");
  assert.equal(buildHabitTitle("スクワット", "プロジェクトノート作成"), "スクワット");
  assert.equal(buildHabitTitle("スクワット", "  "), "スクワット");

  const frontmatter: Record<string, unknown> = { type: "habit", title: "スクワット｜プロジェクトノート作成" };
  applyDraftToFrontmatter(frontmatter, {
    title: "スクワット",
    type: "habit",
    nextAction: "10回やる",
    date: "",
    excerpt: "",
  });
  assert.equal(frontmatter.title, "スクワット｜10回やる");
  applyDraftToFrontmatter(frontmatter, {
    title: "スクワット｜10回やる",
    type: "habit",
    date: "",
    excerpt: "",
  });
  assert.equal(frontmatter.title, "スクワット｜10回やる");
  applyDraftToFrontmatter(frontmatter, {
    title: "スクワット",
    type: "habit",
    nextAction: "",
    date: "",
    excerpt: "",
  });
  assert.equal(frontmatter.title, "スクワット");

  assert.equal(createTranslator("ja")("modal.nextAction"), "次の一手");
  assert.equal(createTranslator("ja")("modal.nextActionDesc"), "次にやることを書きます（空でもかまいません）");
  assert.equal(createTranslator("ja")("modal.nextActionPlaceholder"), "例：10回やる");
  assert.equal(createTranslator("en")("modal.nextAction"), "Next action");
  assert.equal(createTranslator("en")("modal.nextActionDesc"), "What to do next (optional)");
  assert.equal(createTranslator("en")("modal.nextActionPlaceholder"), "e.g. Do 10 reps");
});

test("期日が今日から設定の日数後までなら、期日が近いとして残りの日数を返す", () => {
  assert.equal(dueSoonDays("2026-11-16", "2026-11-16", 7), 0);
  assert.equal(dueSoonDays("2026-11-17", "2026-11-16", 7), 1);
  assert.equal(dueSoonDays("2026-11-23", "2026-11-16", 7), 7);
  assert.equal(dueSoonDays("2026-11-24", "2026-11-16", 7), null);
  assert.equal(dueSoonDays("2026-11-15", "2026-11-16", 7), null);
  assert.equal(dueSoonDays("", "2026-11-16", 7), null);
  assert.equal(dueSoonDays("2026-11-16", "2026-11-16", 0), null);
  assert.equal(dueSoonDays("2026-12-01", "2026-11-28", 7), 3);
  assert.equal(createTranslator("ja")("dueSoon.tooltip", { days: 3 }), "期日まであと3日");
  assert.equal(createTranslator("ja")("dueSoon.tomorrow"), "明日が期日");
  assert.equal(createTranslator("ja")("dueSoon.today"), "今日が期日");
  assert.equal(createTranslator("en")("dueSoon.tooltip", { days: 3 }), "Due in 3 days");
  assert.equal(createTranslator("en")("dueSoon.tomorrow"), "Due tomorrow");
  assert.equal(createTranslator("en")("dueSoon.today"), "Due today");
});

test("新しく登録するとき、完了条件と期日のうち空のものを、完了条件・期日の順に返す", () => {
  assert.deepEqual(emptyRequiredFields({ goal: "結果を共有する", date: "2026-11-17" }), []);
  assert.deepEqual(emptyRequiredFields({ goal: "", date: "2026-11-17" }), ["goal"]);
  assert.deepEqual(emptyRequiredFields({ date: "2026-11-17" }), ["goal"]);
  assert.deepEqual(emptyRequiredFields({ goal: "結果を共有する", date: "" }), ["date"]);
  assert.deepEqual(emptyRequiredFields({ goal: "  ", date: " " }), ["goal", "date"]);
  assert.equal(createTranslator("ja")("emptyCheck.title"), "空の項目があります");
  assert.equal(createTranslator("ja")("emptyCheck.both"), "完了条件と期日が空です。このまま登録しますか？");
  assert.equal(createTranslator("ja")("emptyCheck.register"), "このまま登録する");
  assert.equal(createTranslator("ja")("emptyCheck.back"), "戻って入力する");
  assert.equal(createTranslator("en")("emptyCheck.title"), "Some fields are empty");
  assert.equal(createTranslator("en")("emptyCheck.date"), "The due date is empty. Add it anyway?");
});

test("種類は project と habit だけを読み、習慣は空の項目を確かめず、編集で期日・完了条件を触らない", () => {
  assert.equal(readRecordType("project"), "project");
  assert.equal(readRecordType("habit"), "habit");
  assert.equal(readRecordType("routine"), null);
  assert.equal(readRecordType("life"), null);
  assert.equal(readRecordType("dayspann"), null);
  assert.equal(readRecordType("pj-span"), null);
  assert.equal(normalizeRecordType("habit"), "habit");
  assert.equal(normalizeRecordType(undefined), "project");
  assert.equal(normalizeRecordType("life"), "project");

  assert.deepEqual(emptyRequiredFields({ type: "habit", goal: "", date: "" }), []);
  assert.deepEqual(emptyRequiredFields({ type: "project", goal: "", date: "" }), ["goal", "date"]);

  const frontmatter: Record<string, unknown> = { type: "project", title: "読書", date: "2026-12-01", goal: "1冊読む", display: "days" };
  applyDraftToFrontmatter(frontmatter, { title: "読書｜10分読む", type: "habit", date: "", goal: "", excerpt: "" });
  assert.equal(frontmatter.type, "habit");
  assert.equal(frontmatter.title, "読書｜10分読む");
  assert.equal(frontmatter.date, "2026-12-01");
  assert.equal(frontmatter.goal, "1冊読む");

  assert.equal(isActiveProjectOrTask({ type: "habit" }), true);
  assert.equal(isActiveProjectOrTask({ type: "project" }), true);
  assert.equal(isActiveProjectOrTask({ type: "dayspann" }), false);
  assert.equal(isActiveProjectOrTask({ type: "routine" }), false);
  assert.equal(isActiveProjectOrTask({ type: "habit", archived: true }), false);

  assert.equal(createTranslator("ja")("tab.habit"), "習慣");
  assert.equal(createTranslator("ja")("view.lastUpdated", { date: "11月16日" }), "最終更新 11月16日");
  assert.equal(createTranslator("en")("tab.project"), "Projects");
  assert.equal(createTranslator("en")("view.lastUpdated", { date: "November 16" }), "Last updated November 16");
});

test("TaskChute のログを読み、差分を重ねて、習慣ごとに日付ごとの回数を数える", () => {
  const monthly = JSON.stringify({
    taskExecutions: {
      "2026-11-16": [
        { taskId: "tc-task-a", taskTitle: "古い名前", taskPath: "TaskChute/Task/ストレッチ.md", instanceId: "i1", startTime: "07:00:00", stopTime: "07:10:00" },
        { taskId: "tc-task-b", taskTitle: "ストレッチ", instanceId: "i2" },
        { taskTitle: "ストレッチ", taskPath: "TaskChute/Task/ストレッチ.md", startTime: "21:00:00", stopTime: "21:05:00" },
        { taskTitle: "ストレッチ", taskPath: "TaskChute/Task/ストレッチ.md", startTime: "21:00:00", stopTime: "21:05:00" },
      ],
      "2026-11-15": [{ taskName: "ストレッチ", instanceId: "i3", isCompleted: false }],
      bad: [{ taskId: "tc-task-a" }],
    },
  });
  const days = parseMonthlyLog(monthly);
  assert.deepEqual(Object.keys(days).sort(), ["2026-11-15", "2026-11-16"]);
  assert.deepEqual(parseMonthlyLog("{壊れている"), {});

  const deltas = parseDeltaLines([
    JSON.stringify({ op: "upsert", dateKey: "2026-11-17", recordedAt: "2026-11-17T00:00:00Z", payload: { taskId: "tc-task-a", instanceId: "i4" } }),
    JSON.stringify({ op: "upsert", dateKey: "2026-11-15", recordedAt: "2026-11-17T00:00:01Z", payload: { instanceId: "i3", isCompleted: true } }),
    JSON.stringify({ op: "delete", dateKey: "2026-11-16", recordedAt: "2026-11-17T00:00:02Z", payload: { instanceId: "i2" } }),
    JSON.stringify({ op: "summary", dateKey: "2026-11-16", payload: { summary: { totalTasks: 3 } } }),
    JSON.stringify({ op: "upsert", dateKey: "2026-11-16", payload: { taskId: "tc-task-a" } }),
    "読めない行",
  ].join("\n"));
  assert.equal(deltas.length, 3);

  const merged = mergeHabitLogs([days], deltas);
  assert.equal(merged["2026-11-16"]?.length, 3);
  assert.equal(merged["2026-11-15"]?.[0]?.isCompleted, true);
  assert.equal(merged["2026-11-15"]?.[0]?.taskName, "ストレッチ");

  const habit = { taskId: "tc-task-a", path: "TaskChute/Task/ストレッチ.md", basename: "ストレッチ" };
  assert.equal(matchesHabit({ taskId: "tc-task-a", taskPath: "別の場所.md" }, habit), true);
  assert.equal(matchesHabit({ taskId: "tc-task-b", taskTitle: "ストレッチ" }, habit), false);
  assert.equal(matchesHabit({ taskPath: "TaskChute/Task/ストレッチ.md" }, habit), true);
  assert.equal(matchesHabit({ taskTitle: "ストレッチ" }, habit), true);
  assert.equal(isLogEntryCompleted({ isCompleted: false }), false);
  assert.equal(isLogEntryCompleted({}), true);
  assert.deepEqual(countHabitDays(merged, habit), { "2026-11-15": 1, "2026-11-16": 2, "2026-11-17": 1 });
  assert.deepEqual(countHabitDays(days, habit), { "2026-11-16": 2 });

  assert.equal(heatmapLevel(0), 0);
  assert.equal(heatmapLevel(1), 1);
  assert.equal(heatmapLevel(3), 1);
  assert.equal(countActiveDays({ "2026-11-17": 1, "2026-10-19": 2, "2026-10-18": 1 }, "2026-11-17", 30), 2);
  assert.equal(createTranslator("ja")("heatmap.done", { date: "11月16日", count: 2 }), "11月16日：2回");
  assert.equal(createTranslator("ja")("heatmap.recent", { days: 30, count: 12 }), "直近30日：12日");
});

test("ヒートマップは日曜はじまりの 4 週で、左から日月火…、下の行が今週、今日より先は空ける", () => {
  const weeks = buildHeatmapWeeks("2026-11-18");
  assert.equal(HEATMAP_WEEKS, 4);
  assert.equal(weeks.length, 4);
  assert.ok(weeks.every((week) => week.length === 7));
  assert.deepEqual(weeks[3], ["2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", null, null, null]);
  assert.deepEqual(weeks[0], ["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]);
  assert.deepEqual(buildHeatmapWeeks("2026-11-21")[3], ["2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"]);
  assert.deepEqual(buildHeatmapWeeks("2026-11-22")[3], ["2026-11-22", null, null, null, null, null, null]);
  assert.deepEqual(heatmapMonthKeys("2026-11-18"), ["2026-10", "2026-11"]);
  assert.equal(createTranslator("ja")("heatmap.weekdays"), "日月火水木金土");
  assert.equal(createTranslator("en")("heatmap.weekdays"), "SMTWTFS");
});

test("習慣の分類を読み、名前順の見出しにまとめ、編集では習慣のときだけ書き込む", () => {
  assert.equal(readCategory(" 読書 "), "読書");
  assert.equal(readCategory(""), "");
  assert.equal(readCategory("   "), "");
  assert.equal(readCategory(undefined), "");
  assert.equal(readCategory(123), "");
  assert.equal(readCategory(["", "  ", "読書", "運動"]), "読書");
  assert.equal(readCategory(["運動"]), "運動");
  assert.equal(readCategory([]), "");

  const grouped = groupHabitsByCategory([
    { title: "スクワット", category: "運動" },
    { title: "技術書", category: "読書" },
    { title: "水を飲む" },
    { title: "走る", category: "運動" },
    { title: "小説", category: " 読書 " },
    { title: "英語の単語", category: "英語" },
    { title: "ストレッチ", category: "" },
  ]);
  assert.deepEqual(
    grouped.map((group) => [group.category, group.items.map((item) => item.title)]),
    [
      ["運動", ["スクワット", "走る"]],
      ["英語", ["英語の単語"]],
      ["読書", ["技術書", "小説"]],
      ["", ["水を飲む", "ストレッチ"]],
    ]
  );
  assert.deepEqual(
    groupHabitsByCategory([{ title: "水を飲む" }, { title: "ストレッチ", category: "  " }]).map(
      (group) => group.category
    ),
    [""]
  );

  const habitFrontmatter: Record<string, unknown> = { type: "habit", title: "読書" };
  applyDraftToFrontmatter(habitFrontmatter, {
    title: "読書",
    type: "habit",
    date: "",
    category: " 読書 ",
    excerpt: "",
  });
  assert.equal(habitFrontmatter.category, "読書");
  applyDraftToFrontmatter(habitFrontmatter, { title: "読書", type: "habit", date: "", category: "  ", excerpt: "" });
  assert.equal("category" in habitFrontmatter, false);

  const projectFrontmatter: Record<string, unknown> = { type: "project", title: "企画", category: "仕事" };
  applyDraftToFrontmatter(projectFrontmatter, {
    title: "企画",
    type: "project",
    date: "2026-12-01",
    category: "別の分類",
    excerpt: "",
  });
  assert.equal(projectFrontmatter.category, "仕事");

  assert.equal(createTranslator("ja")("section.other"), "その他");
  assert.equal(createTranslator("ja")("modal.category"), "分類");
  assert.equal(createTranslator("en")("section.other"), "Other");
  assert.equal(createTranslator("en")("modal.category"), "Category");
});

test("習慣の見出しの折りたたみ状態はキーのリストで重複なく入れ外しできる", () => {
  assert.deepEqual(normalizeCollapsedHabitGroups(["読書", "読書", 1, "", ALL_HABITS_GROUP_KEY, null]), [
    "読書",
    "",
    ALL_HABITS_GROUP_KEY,
  ]);
  assert.deepEqual(normalizeCollapsedHabitGroups(undefined), []);
  assert.deepEqual(normalizeCollapsedHabitGroups("読書"), []);

  assert.deepEqual(toggleCollapsedKey([], "読書", true), ["読書"]);
  assert.deepEqual(toggleCollapsedKey(["読書"], "読書", true), ["読書"]);
  assert.deepEqual(toggleCollapsedKey(["読書"], "読書", false), []);
  assert.deepEqual(toggleCollapsedKey(["読書", ""], "運動", true), ["読書", "", "運動"]);
  assert.deepEqual(toggleCollapsedKey(["読書", ""], "", false), ["読書"]);
  assert.deepEqual(toggleCollapsedKey([], ALL_HABITS_GROUP_KEY, true), [ALL_HABITS_GROUP_KEY]);
  assert.deepEqual(toggleCollapsedKey([ALL_HABITS_GROUP_KEY], ALL_HABITS_GROUP_KEY, false), []);
});

test("連続の単位は routine_type が daily のときだけ日で、ログの月はファイル名から集める", () => {
  assert.equal(readStreakUnit("daily"), "day");
  assert.equal(readStreakUnit(" Daily "), "day");
  assert.equal(readStreakUnit("DAILY"), "day");
  assert.equal(readStreakUnit("weekly"), "week");
  assert.equal(readStreakUnit("monthly"), "week");
  assert.equal(readStreakUnit("monthly_date"), "week");
  assert.equal(readStreakUnit("weekdays"), "week");
  assert.equal(readStreakUnit("weekends"), "week");
  assert.equal(readStreakUnit(""), "week");
  assert.equal(readStreakUnit(undefined), "week");
  assert.equal(readStreakUnit(true), "week");

  assert.equal(monthKeyFromLogPath("TaskChute/Log/2026-11-tasks.json"), "2026-11");
  assert.equal(monthKeyFromLogPath("TaskChute/Log/inbox/iphone/2026-10.jsonl"), "2026-10");
  assert.equal(monthKeyFromLogPath("readme.md"), null);
  assert.deepEqual(
    collectLogMonthKeys([
      "TaskChute/Log/2026-11-tasks.json",
      "TaskChute/Log/inbox/iphone/2026-10.jsonl",
      "TaskChute/Log/2026-11-tasks.json",
      "TaskChute/Log/notes.md",
    ]),
    ["2026-10", "2026-11"]
  );
});

test("日の連続は今日が空なら昨日まで、週の連続は今週が空なら先週まで数え、最長も出す", () => {
  const today = "2026-11-17";
  assert.deepEqual(
    streakDays({ "2026-11-15": 1, "2026-11-16": 2, "2026-11-17": 1 }, today),
    { current: 3, longest: 3 }
  );
  assert.deepEqual(
    streakDays({ "2026-11-15": 1, "2026-11-16": 1 }, today),
    { current: 2, longest: 2 }
  );
  assert.deepEqual(
    streakDays({ "2026-11-14": 1, "2026-11-15": 1 }, today),
    { current: 0, longest: 2 }
  );
  assert.deepEqual(
    streakDays({ "2026-11-01": 1, "2026-11-02": 1, "2026-11-03": 1, "2026-11-16": 1, "2026-11-17": 1 }, today),
    { current: 2, longest: 3 }
  );
  assert.deepEqual(streakDays({}, today), { current: 0, longest: 0 });
  assert.deepEqual(streakDays({ "2026-11-17": 1, bad: 2 }, today), { current: 1, longest: 1 });

  assert.equal(sundayOfDateKey("2026-11-17"), "2026-11-15");
  assert.equal(sundayOfDateKey("2026-11-15"), "2026-11-15");
  assert.deepEqual(
    streakWeeks({ "2026-11-17": 1 }, today),
    { current: 1, longest: 1 }
  );
  assert.deepEqual(
    streakWeeks({ "2026-11-10": 1 }, today),
    { current: 1, longest: 1 }
  );
  assert.deepEqual(
    streakWeeks({ "2026-11-07": 1 }, today),
    { current: 0, longest: 1 }
  );
  assert.deepEqual(
    streakWeeks(
      { "2026-10-25": 1, "2026-11-03": 1, "2026-11-10": 1, "2026-11-17": 1 },
      today
    ),
    { current: 4, longest: 4 }
  );
  assert.deepEqual(
    streakWeeks({ "2026-10-18": 1, "2026-11-03": 1, "2026-11-10": 1 }, today),
    { current: 2, longest: 2 }
  );
  assert.deepEqual(streakWeeks({}, today), { current: 0, longest: 0 });

  const t = createTranslator("ja");
  assert.equal(t("heatmap.streakDays", { current: 5, longest: 21 }), "🔥 5日連続・最長 21日");
  assert.equal(t("heatmap.streakDaysZero", { current: 0, longest: 21 }), "連続 0日・最長 21日");
  assert.equal(t("heatmap.streakWeeks", { current: 3, longest: 8 }), "🔥 3週連続・最長 8週");
  assert.equal(t("heatmap.streakWeeksZero", { current: 0, longest: 8 }), "連続 0週・最長 8週");
  const en = createTranslator("en");
  assert.equal(en("heatmap.streakDays", { current: 5, longest: 21 }), "🔥 5-day streak · best 21 days");
  assert.equal(en("heatmap.streakWeeksZero", { current: 0, longest: 8 }), "0-week streak · best 8 weeks");
});

test("習慣の数字は単位つきで出し、見出しの言葉を日英で用意する", () => {
  assert.equal(durationUnit("ja", "week", 5), "週");
  assert.equal(durationUnit("en", "week", 1), "week");
  assert.equal(durationUnit("en", "week", 5), "weeks");
  assert.equal(formatCountUnit("ja", 8, "day"), "8日");
  assert.equal(formatCountUnit("ja", 5, "week"), "5週");
  assert.equal(formatCountUnit("en", 1, "day"), "1 day");
  assert.equal(formatCountUnit("en", 8, "day"), "8 days");
  assert.equal(formatCountUnit("en", 1, "week"), "1 week");
  assert.equal(formatCountUnit("en", 5, "week"), "5 weeks");
  assert.equal(formatCountUnit("ja", 120, "day"), "120日");
  assert.equal(formatCountUnit("en", 120, "day"), "120 days");

  const t = createTranslator("ja");
  assert.equal(t("heatmap.recentLabel", { days: 30 }), "直近30日");
  assert.equal(t("heatmap.totalLabel"), "通算");
  assert.equal(t("heatmap.streakLabel"), "連続");
  assert.equal(t("heatmap.bestLabel"), "最長");
  const en = createTranslator("en");
  assert.equal(en("heatmap.recentLabel", { days: 30 }), "Last 30 days");
  assert.equal(en("heatmap.totalLabel"), "Total");
  assert.equal(en("heatmap.streakLabel"), "Streak");
  assert.equal(en("heatmap.bestLabel"), "Best");
});

test("countTotalActiveDays counts distinct done days in the loaded log, not extra runs on the same day", () => {
  assert.equal(countTotalActiveDays({ "2026-01-01": 1, "2026-06-15": 3, "2026-11-19": 1 }), 3);
  assert.equal(countTotalActiveDays({ "2026-11-19": 2 }), 1);
  assert.equal(countTotalActiveDays({ "2026-11-19": 0, "2026-11-18": 1 }), 1);
  assert.equal(countTotalActiveDays({}), 0);
  assert.equal(countTotalActiveDays({ "2026-11-19": 1, bad: 4, "2026-13-01": 1 }), 1);
});

test("習慣の目標日数は TaskChute のルーチン設定から数え、決めた曜日以外にやっても週の日数に入れる", () => {
  assert.equal(readRoutineType(" Daily "), "daily");
  assert.equal(readRoutineType("WEEKLY"), "weekly");
  assert.equal(readRoutineType(""), "");
  assert.equal(readRoutineType(undefined), "");

  assert.equal(readWeekday("tuesday"), 2);
  assert.equal(readWeekday("Tue"), 2);
  assert.equal(readWeekday("火"), 2);
  assert.equal(readWeekday("火曜"), 2);
  assert.equal(readWeekday(2), 2);
  assert.equal(readWeekday("5"), 5);
  assert.equal(readWeekday("金曜日"), 5);
  assert.equal(readWeekday("日"), 0);
  assert.equal(readWeekday("土"), 6);
  assert.equal(readWeekday("maybe"), undefined);

  assert.deepEqual(readRoutineWeekdays({ routine_weekdays: ["tuesday", "friday"] }), [2, 5]);
  assert.deepEqual(readRoutineWeekdays({ routine_weekdays: ["火", "金"] }), [2, 5]);
  assert.deepEqual(readRoutineWeekdays({ weekdays: [2, 5], routine_weekday: 2 }), [2, 5]);
  assert.deepEqual(readRoutineWeekdays({ routine_weekday: 2 }), [2]);
  assert.deepEqual(readRoutineWeekdays({ weekday: "monday" }), [1]);
  assert.deepEqual(readRoutineWeekdays({ routine_weekdays: "tuesday, friday" }), [2, 5]);
  assert.deepEqual(readRoutineWeekdays({ routine_weekdays: [2, 2, 5] }), [2, 5]);
  assert.deepEqual(readRoutineWeekdays({}), []);

  assert.deepEqual(readHabitTarget({ routine_type: "daily" }), { period: "day", target: 1 });
  assert.deepEqual(
    readHabitTarget({ routine_type: "weekly", routine_weekdays: ["tuesday", "friday"] }),
    { period: "week", target: 2 }
  );
  assert.deepEqual(readHabitTarget({ routine_type: "weekly" }), { period: "week", target: 1 });
  assert.deepEqual(readHabitTarget({ routine_type: "weekly", weekdays: [2, 5] }), { period: "week", target: 2 });
  assert.deepEqual(readHabitTarget({}), { period: "week", target: 1 });
  assert.deepEqual(readHabitTarget({ routine_type: "custom" }), { period: "week", target: 1 });
  assert.deepEqual(readHabitTarget({ routine_type: "weekdays" }), { period: "week", target: 5 });
  assert.deepEqual(readHabitTarget({ routine_type: "weekends" }), { period: "week", target: 2 });
  assert.deepEqual(readHabitTarget({ routine_type: "monthly" }), { period: "month", target: 1 });
  assert.deepEqual(readHabitTarget({ routine_type: "monthly_date" }), { period: "month", target: 1 });

  const today = "2026-11-18";
  const weekly = { period: "week" as const, target: 2 };
  // 火曜と金曜の習慣でも、水曜にやれば今週の日数に入る。
  assert.deepEqual(habitTargetProgress(weekly, { "2026-11-18": 1 }, today), {
    period: "week",
    target: 2,
    done: 1,
    remaining: 1,
    met: false,
  });
  // 同じ日に何回やっても 1 日。
  assert.deepEqual(
    habitTargetProgress(weekly, { "2026-11-16": 3, "2026-11-18": 2 }, today),
    { period: "week", target: 2, done: 2, remaining: 0, met: true }
  );
  // 先週の土曜は、日曜はじまりの今週には入らない。
  assert.deepEqual(
    habitTargetProgress(weekly, { "2026-11-14": 1, "2026-11-15": 1 }, today),
    { period: "week", target: 2, done: 1, remaining: 1, met: false }
  );

  const weekdays = { period: "week" as const, target: 5 };
  assert.deepEqual(
    habitTargetProgress(weekdays, { "2026-11-16": 1, "2026-11-17": 1, "2026-11-18": 1 }, today),
    { period: "week", target: 5, done: 3, remaining: 2, met: false }
  );
  const weekends = { period: "week" as const, target: 2 };
  assert.deepEqual(
    habitTargetProgress(weekends, { "2026-11-15": 1 }, today),
    { period: "week", target: 2, done: 1, remaining: 1, met: false }
  );
  assert.equal(habitTargetProgress(weekends, { "2026-11-15": 1, "2026-11-16": 1 }, today).met, true);

  const daily = { period: "day" as const, target: 1 };
  assert.deepEqual(habitTargetProgress(daily, {}, today), {
    period: "day",
    target: 1,
    done: 0,
    remaining: 1,
    met: false,
  });
  assert.equal(habitTargetProgress(daily, { "2026-11-18": 1 }, today).met, true);
  assert.equal(habitTargetProgress(daily, { "2026-11-17": 1 }, today).met, false);

  const monthly = { period: "month" as const, target: 1 };
  assert.deepEqual(habitTargetProgress(monthly, {}, today), {
    period: "month",
    target: 1,
    done: 0,
    remaining: 1,
    met: false,
  });
  assert.equal(habitTargetProgress(monthly, { "2026-11-01": 1 }, today).met, true);
  assert.equal(habitTargetProgress(monthly, { "2026-10-31": 1 }, today).met, false);

  const t = createTranslator("ja");
  assert.equal(t("habit.pendingToday"), "今日まだ");
  assert.equal(t("habit.pendingWeek", { done: 1, target: 2 }), "今週 1/2");
  assert.equal(t("habit.pendingMonth", { done: 0, target: 1 }), "今月 0/1");
  assert.equal(t("habit.pendingTodayTooltip"), "今日はまだです");
  assert.equal(t("habit.pendingWeekTooltip", { remaining: 1 }), "今週あと1日");
  assert.equal(t("habit.pendingMonthTooltip"), "今月はまだです");
  const en = createTranslator("en");
  assert.equal(en("habit.pendingToday"), "Not yet today");
  assert.equal(en("habit.pendingWeek", { done: 1, target: 2 }), "This week 1/2");
  assert.equal(en("habit.pendingMonth", { done: 0, target: 1 }), "This month 0/1");
  assert.equal(en("habit.pendingTodayTooltip"), "Not done today yet");
  assert.equal(en("habit.pendingWeekTooltip", { remaining: 1 }), "1 more this week");
  assert.equal(en("habit.pendingMonthTooltip"), "Not done this month yet");
  assert.equal(t("habit.doneToday"), "今日 ✓");
  assert.equal(t("habit.doneWeek", { done: 2, target: 2 }), "今週 2/2 ✓");
  assert.equal(t("habit.doneWeek", { done: 3, target: 2 }), "今週 3/2 ✓");
  assert.equal(t("habit.doneMonth", { done: 1, target: 1 }), "今月 1/1 ✓");
  assert.equal(t("habit.doneTodayTooltip"), "今日やりました");
  assert.equal(t("habit.doneWeekTooltip"), "今週の目標を達成しました");
  assert.equal(t("habit.doneMonthTooltip"), "今月の目標を達成しました");
  assert.equal(en("habit.doneToday"), "Today ✓");
  assert.equal(en("habit.doneWeek", { done: 2, target: 2 }), "This week 2/2 ✓");
  assert.equal(en("habit.doneWeek", { done: 3, target: 2 }), "This week 3/2 ✓");
  assert.equal(en("habit.doneMonth", { done: 1, target: 1 }), "This month 1/1 ✓");
  assert.equal(en("habit.doneTodayTooltip"), "Done today");
  assert.equal(en("habit.doneWeekTooltip"), "This week's goal is met");
  assert.equal(en("habit.doneMonthTooltip"), "This month's goal is met");

  const over = habitTargetProgress(weekly, { "2026-11-16": 1, "2026-11-17": 1, "2026-11-18": 1 }, today);
  assert.deepEqual(over, { period: "week", target: 2, done: 3, remaining: 0, met: true });
});

test("ヒートマップの今週は、ルーチンの予定日だけ枠を付ける対象になる", () => {
  const today = "2026-11-18";
  assert.deepEqual(readHabitSchedule({}), { kind: "none" });
  assert.deepEqual(readHabitSchedule({ routine_type: "custom" }), { kind: "none" });
  assert.deepEqual(readHabitSchedule({ routine_type: "weekly" }), { kind: "none" });
  assert.deepEqual(readHabitSchedule({ routine_type: "daily" }), { kind: "daily" });
  assert.deepEqual(readHabitSchedule({ routine_type: "weekdays" }), {
    kind: "weekly",
    weekdays: [1, 2, 3, 4, 5],
  });
  assert.deepEqual(readHabitSchedule({ routine_type: "weekends" }), { kind: "weekly", weekdays: [0, 6] });
  assert.deepEqual(
    readHabitSchedule({ routine_type: "weekly", routine_weekdays: ["tuesday", "friday"] }),
    { kind: "weekly", weekdays: [2, 5] }
  );
  assert.deepEqual(
    readHabitSchedule({ routine_type: "weekly", weekdays: [2, 5], routine_weekday: 2 }),
    { kind: "weekly", weekdays: [2, 5] }
  );

  const daily = readHabitSchedule({ routine_type: "daily" });
  assert.deepEqual(plannedDateKeysInWeek(daily, today), [
    "2026-11-15",
    "2026-11-16",
    "2026-11-17",
    "2026-11-18",
    "2026-11-19",
    "2026-11-20",
    "2026-11-21",
  ]);

  const weekly = readHabitSchedule({ routine_type: "weekly", routine_weekdays: ["火", "金"] });
  assert.deepEqual(plannedDateKeysInWeek(weekly, today), ["2026-11-17", "2026-11-20"]);
  assert.equal(isHabitScheduled(weekly, "2026-11-17"), true);
  assert.equal(isHabitScheduled(weekly, "2026-11-18"), false);
  assert.equal(isHabitScheduled(weekly, "2026-11-20"), true);
  // 今日より先の予定日も、今週の対象に入る。
  assert.equal(plannedDateKeysInWeek(weekly, today).includes("2026-11-20"), true);
  // 先週の同じ曜日は入らない。
  assert.equal(plannedDateKeysInWeek(weekly, today).includes("2026-11-13"), false);

  const weekdays = readHabitSchedule({ routine_type: "weekdays" });
  assert.deepEqual(plannedDateKeysInWeek(weekdays, today), [
    "2026-11-16",
    "2026-11-17",
    "2026-11-18",
    "2026-11-19",
    "2026-11-20",
  ]);
  const weekends = readHabitSchedule({ routine_type: "weekends" });
  assert.deepEqual(plannedDateKeysInWeek(weekends, today), ["2026-11-15", "2026-11-21"]);

  assert.deepEqual(readMonthDays({ routine_monthday: 18 }), [18]);
  assert.deepEqual(readMonthDays({ routine_monthdays: [18, "last"] }), [18, "last"]);
  const monthDate = readHabitSchedule({ routine_type: "monthly_date", routine_monthday: 18 });
  assert.deepEqual(plannedDateKeysInWeek(monthDate, today), ["2026-11-18"]);
  const monthDateNext = readHabitSchedule({ routine_type: "monthly_date", routine_monthday: 22 });
  assert.deepEqual(plannedDateKeysInWeek(monthDateNext, today), []);
  const monthLast = readHabitSchedule({ routine_type: "monthly_date", routine_monthday: "last" });
  assert.deepEqual(plannedDateKeysInWeek(monthLast, today), []);
  assert.deepEqual(plannedDateKeysInWeek(monthLast, "2026-11-29"), ["2026-11-30"]);

  assert.deepEqual(readMonthWeeks({ routine_week: 3 }), [3]);
  assert.deepEqual(readMonthWeeks({ routine_weeks: [3, "last"] }), [3, "last"]);
  assert.deepEqual(readMonthWeeks({ monthly_week: 2 }), [3]);
  const monthNth = readHabitSchedule({
    routine_type: "monthly",
    routine_week: 3,
    routine_weekday: "tuesday",
  });
  // 2026年11月の第3火曜日は 17 日。
  assert.deepEqual(plannedDateKeysInWeek(monthNth, today), ["2026-11-17"]);
  const monthLastFriday = readHabitSchedule({
    routine_type: "monthly",
    routine_week: "last",
    routine_weekday: 5,
  });
  assert.deepEqual(plannedDateKeysInWeek(monthLastFriday, today), []);
  assert.deepEqual(plannedDateKeysInWeek(monthLastFriday, "2026-11-25"), ["2026-11-27"]);
  const monthLegacy = readHabitSchedule({
    routine_type: "monthly",
    monthly_week: 2,
    monthly_weekday: 2,
  });
  assert.deepEqual(plannedDateKeysInWeek(monthLegacy, today), ["2026-11-17"]);

  const none = readHabitSchedule({});
  assert.deepEqual(plannedDateKeysInWeek(none, today), []);
  assert.equal(isHabitScheduled(none, "2026-11-18"), false);

  const t = createTranslator("ja");
  assert.equal(t("heatmap.planned", { label: "11月19日：やっていません" }), "11月19日：やっていません・予定");
  const en = createTranslator("en");
  assert.equal(en("heatmap.planned", { label: "Nov 19: not done" }), "Nov 19: not done · Planned");
});

test("週の連続と最長は、目標日数に届いた週だけを数え、今週が未達でも先週までの連続は残す", () => {
  assert.equal(weekStreakTarget({ period: "week", target: 2 }), 2);
  assert.equal(weekStreakTarget({ period: "week", target: 5 }), 5);
  assert.equal(weekStreakTarget({ period: "week", target: 1 }), 1);
  assert.equal(weekStreakTarget({ period: "month", target: 1 }), 1);
  assert.equal(weekStreakTarget({ period: "day", target: 1 }), 1);
  assert.equal(weekStreakTarget({ period: "week", target: 0 }), 1);

  const today = "2026-11-18";
  // 目標 2 日。1 日だけの週は連続を切る。今週はまだ 1 日なので、先週までの連続を出す。
  assert.deepEqual(
    streakWeeks(
      {
        "2026-10-20": 1,
        "2026-10-22": 1,
        "2026-10-27": 1,
        "2026-10-29": 1,
        "2026-11-03": 1,
        "2026-11-10": 1,
        "2026-11-12": 1,
        "2026-11-17": 1,
      },
      today,
      2
    ),
    { current: 1, longest: 2 }
  );
  // 今週も 2 日に届いていれば、今週を含める。
  assert.deepEqual(
    streakWeeks(
      {
        "2026-10-20": 1,
        "2026-10-22": 1,
        "2026-10-27": 1,
        "2026-10-29": 1,
        "2026-11-03": 1,
        "2026-11-10": 1,
        "2026-11-12": 1,
        "2026-11-16": 1,
        "2026-11-18": 1,
      },
      today,
      2
    ),
    { current: 2, longest: 2 }
  );
  // 同じ日に何回やっても 1 日。
  assert.deepEqual(
    streakWeeks({ "2026-11-10": 3, "2026-11-17": 2 }, today, 2),
    { current: 0, longest: 0 }
  );

  // 平日（目標 5 日）。4 日の週は届かず、今週はまだ 3 日なので先週までの連続を出す。
  assert.deepEqual(
    streakWeeks(
      {
        "2026-10-19": 1,
        "2026-10-20": 1,
        "2026-10-21": 1,
        "2026-10-22": 1,
        "2026-10-23": 1,
        "2026-10-26": 1,
        "2026-10-27": 1,
        "2026-10-28": 1,
        "2026-10-29": 1,
        "2026-10-30": 1,
        "2026-11-02": 1,
        "2026-11-03": 1,
        "2026-11-04": 1,
        "2026-11-05": 1,
        "2026-11-09": 1,
        "2026-11-10": 1,
        "2026-11-11": 1,
        "2026-11-12": 1,
        "2026-11-13": 1,
        "2026-11-16": 1,
        "2026-11-17": 1,
        "2026-11-18": 1,
      },
      today,
      5
    ),
    { current: 1, longest: 2 }
  );

  // 目標を省略したときは、これまでどおり 1 日でもその週は続く。
  assert.deepEqual(streakWeeks({ "2026-11-17": 1 }, today), { current: 1, longest: 1 });
});

test("＋で登録したときのお知らせは、TaskChuteのタスクにしたことと、日付が空なことを伝える", () => {
  assert.equal(
    createTranslator("ja")("notice.registeredTaskChute"),
    "PJ-spanに登録して、TaskChuteのタスクにしました（日付は空のままです）"
  );
  assert.equal(
    createTranslator("en")("notice.registeredTaskChute"),
    "Added to PJ-span as a TaskChute task (no target date)."
  );
});

test("sortHabitsByPending puts habits not yet at their target first and keeps name order", () => {
  const habits = [
    { title: "A腹筋", met: true },
    { title: "B読書", met: false },
    { title: "C水を飲む", met: null },
    { title: "Dスクワット", met: false },
    { title: "E腕立て", met: true },
    { title: "F日記", met: null },
  ];
  assert.deepEqual(
    sortHabitsByPending(habits, (habit) => habit.met).map((habit) => habit.title),
    ["B読書", "Dスクワット", "C水を飲む", "F日記", "A腹筋", "E腕立て"]
  );
  assert.deepEqual(
    habits.map((habit) => habit.title),
    ["A腹筋", "B読書", "C水を飲む", "Dスクワット", "E腕立て", "F日記"]
  );
  assert.deepEqual(sortHabitsByPending([], () => false), []);
});

test("summarizeHabitTargets counts met habits out of those that show progress", () => {
  assert.deepEqual(summarizeHabitTargets([true, false, null, true, false]), { met: 2, total: 4 });
  assert.deepEqual(summarizeHabitTargets([true, true]), { met: 2, total: 2 });
  assert.deepEqual(summarizeHabitTargets([null, null]), { met: 0, total: 0 });
  assert.deepEqual(summarizeHabitTargets([]), { met: 0, total: 0 });
});

test("週番号は日曜はじまりで、1 月 1 日が入っている週を第 1 週にする", () => {
  assert.deepEqual(sundayWeekNumber("2026-11-18"), { year: 2026, week: 47 });
  assert.deepEqual(sundayWeekNumber("2026-11-15"), { year: 2026, week: 47 });
  assert.deepEqual(sundayWeekNumber("2026-11-14"), { year: 2026, week: 46 });
  assert.deepEqual(sundayWeekNumber("2026-10-25"), { year: 2026, week: 44 });
  assert.deepEqual(sundayWeekNumber("2025-12-28"), { year: 2026, week: 1 });
  assert.deepEqual(sundayWeekNumber("2026-01-03"), { year: 2026, week: 1 });
  assert.deepEqual(sundayWeekNumber("2026-01-04"), { year: 2026, week: 2 });
  assert.deepEqual(sundayWeekNumber("2026-12-26"), { year: 2026, week: 52 });
  assert.deepEqual(sundayWeekNumber("2026-12-27"), { year: 2027, week: 1 });
  assert.deepEqual(sundayWeekNumber("2027-01-02"), { year: 2027, week: 1 });
  assert.deepEqual(sundayWeekNumber("2028-12-30"), { year: 2028, week: 53 });
  assert.deepEqual(sundayWeekNumber("2028-12-31"), { year: 2029, week: 1 });
  assert.equal(createTranslator("ja")("heatmap.weekNumber", { year: 2026, week: 47 }), "2026年 第47週");
  assert.equal(createTranslator("en")("heatmap.weekNumber", { year: 2026, week: 47 }), "Week 47, 2026");
});

test("habitScheduledTodayStatus counts only habits scheduled for today, and met only if done today", () => {
  const today = "2026-11-19"; // 木曜日

  const daily = readHabitSchedule({ routine_type: "daily" });
  assert.equal(habitScheduledTodayStatus(daily, today, false), false);
  assert.equal(habitScheduledTodayStatus(daily, today, true), true);

  const weeklyThuFri = readHabitSchedule({
    routine_type: "weekly",
    routine_weekdays: ["thursday", "friday"],
  });
  assert.equal(habitScheduledTodayStatus(weeklyThuFri, today, false), false);
  assert.equal(habitScheduledTodayStatus(weeklyThuFri, today, true), true);
  const weeklyTueFri = readHabitSchedule({ routine_type: "weekly", routine_weekdays: ["火", "金"] });
  assert.equal(habitScheduledTodayStatus(weeklyTueFri, today, true), null);

  const weekdays = readHabitSchedule({ routine_type: "weekdays" });
  assert.equal(habitScheduledTodayStatus(weekdays, today, false), false);
  assert.equal(habitScheduledTodayStatus(weekdays, "2026-11-21", true), null);
  const weekends = readHabitSchedule({ routine_type: "weekends" });
  assert.equal(habitScheduledTodayStatus(weekends, today, true), null);
  assert.equal(habitScheduledTodayStatus(weekends, "2026-11-21", true), true);

  const monthDate19 = readHabitSchedule({ routine_type: "monthly_date", routine_monthday: 19 });
  assert.equal(habitScheduledTodayStatus(monthDate19, today, true), true);
  const monthDate18 = readHabitSchedule({ routine_type: "monthly_date", routine_monthday: 18 });
  assert.equal(habitScheduledTodayStatus(monthDate18, today, true), null);
  const monthLast = readHabitSchedule({ routine_type: "monthly_date", routine_monthday: "last" });
  assert.equal(habitScheduledTodayStatus(monthLast, today, true), null);
  assert.equal(habitScheduledTodayStatus(monthLast, "2026-11-30", true), true);

  // 2026年11月19日は第3木曜日。最後の木曜日は 26 日。
  const thirdThu = readHabitSchedule({
    routine_type: "monthly",
    routine_week: 3,
    routine_weekday: "thursday",
  });
  assert.equal(habitScheduledTodayStatus(thirdThu, today, false), false);
  assert.equal(habitScheduledTodayStatus(thirdThu, today, true), true);
  const lastThu = readHabitSchedule({
    routine_type: "monthly",
    routine_week: "last",
    routine_weekday: "thursday",
  });
  assert.equal(habitScheduledTodayStatus(lastThu, today, true), null);
  assert.equal(habitScheduledTodayStatus(lastThu, "2026-11-26", true), true);
  const thirdTue = readHabitSchedule({
    routine_type: "monthly",
    routine_week: 3,
    routine_weekday: "tuesday",
  });
  assert.equal(habitScheduledTodayStatus(thirdTue, today, true), null);

  const none = readHabitSchedule({});
  assert.equal(habitScheduledTodayStatus(none, today, true), null);
  assert.equal(habitScheduledTodayStatus(daily, "not-a-date", true), null);

  const statuses = [
    habitScheduledTodayStatus(daily, today, true),
    habitScheduledTodayStatus(weeklyTueFri, today, true),
    habitScheduledTodayStatus(weekdays, today, false),
    habitScheduledTodayStatus(weekends, today, true),
    habitScheduledTodayStatus(monthDate19, today, true),
    habitScheduledTodayStatus(none, today, true),
  ];
  assert.deepEqual(summarizeHabitTargets(statuses), { met: 2, total: 3 });
  assert.deepEqual(summarizeHabitTargets([null, null]), { met: 0, total: 0 });

  const t = createTranslator("ja");
  assert.equal(t("view.habitTargetsNone"), "目標達成：今日の予定なし");
  assert.equal(t("view.habitTargetsTooltip"), "今日が予定日の習慣のうち、今日やった数");
  const en = createTranslator("en");
  assert.equal(en("view.habitTargetsNone"), "Targets met: none scheduled today");
  assert.equal(en("view.habitTargetsTooltip"), "Number of habits scheduled for today that were done today");
});

test("normalizeHabitFilter keeps today and treats anything else as all", () => {
  assert.equal(normalizeHabitFilter("today"), "today");
  assert.equal(normalizeHabitFilter("all"), "all");
  assert.equal(normalizeHabitFilter(undefined), "all");
  assert.equal(normalizeHabitFilter(""), "all");
  assert.equal(normalizeHabitFilter("other"), "all");
});

test("filterHabitsScheduledToday keeps only habits scheduled for today, including those already done", () => {
  const today = "2026-11-19"; // 木曜日
  const habits = [
    {
      title: "daily-done",
      status: habitScheduledTodayStatus(readHabitSchedule({ routine_type: "daily" }), today, true),
    },
    {
      title: "weekly-tue",
      status: habitScheduledTodayStatus(
        readHabitSchedule({ routine_type: "weekly", routine_weekdays: ["火", "金"] }),
        today,
        true
      ),
    },
    {
      title: "weekdays-pending",
      status: habitScheduledTodayStatus(readHabitSchedule({ routine_type: "weekdays" }), today, false),
    },
    {
      title: "weekend",
      status: habitScheduledTodayStatus(readHabitSchedule({ routine_type: "weekends" }), today, true),
    },
    { title: "unlinked", status: null },
  ];
  assert.deepEqual(
    filterHabitsScheduledToday(habits, (habit) => habit.status).map((habit) => habit.title),
    ["daily-done", "weekdays-pending"]
  );
  assert.deepEqual(filterHabitsScheduledToday([], () => true), []);

  const t = createTranslator("ja");
  assert.equal(t("view.habitFilterToday"), "今日");
  assert.equal(t("view.habitFilterAll"), "すべて");
  assert.equal(t("view.habitFilterEmpty"), "今日が予定日の習慣はありません");
  const en = createTranslator("en");
  assert.equal(en("view.habitFilterToday"), "Today");
  assert.equal(en("view.habitFilterAll"), "All");
  assert.equal(en("view.habitFilterEmpty"), "No habits are scheduled for today");
});

test("buildHabitDoneDelta writes one TaskChute-style upsert line for today", () => {
  const now = new Date(2026, 10, 19, 7, 5, 9); // 2026-11-19 07:05:09（その端末の時刻）
  const fixed = (length: number) => "abcdefghijk".slice(0, length);
  const delta = buildHabitDoneDelta({
    title: "腕立て",
    path: "pj-span/腕立て.md",
    taskId: "tc-task-1",
    deviceId: "tc-dev-1",
    now,
    random: fixed,
  });
  assert.deepEqual(Object.keys(delta), [
    "schemaVersion",
    "op",
    "entryId",
    "deviceId",
    "monthKey",
    "dateKey",
    "recordedAt",
    "payload",
  ]);
  assert.equal(delta.schemaVersion, 1);
  assert.equal(delta.op, "upsert");
  assert.equal(delta.entryId, `tc-dev-1:${now.getTime().toString(36)}:abcdefgh`);
  assert.equal(delta.monthKey, "2026-11");
  assert.equal(delta.dateKey, "2026-11-19");
  assert.equal(delta.recordedAt, now.toISOString());
  assert.deepEqual(delta.payload, {
    taskTitle: "腕立て",
    taskPath: "pj-span/腕立て.md",
    taskId: "tc-task-1",
    instanceId: `pj-span/腕立て.md_2026-11-19_${now.getTime()}_pjspan-abcdefghi`,
    startTime: "07:05:09",
    stopTime: "07:05:09",
    durationSec: 0,
    deviceId: "tc-dev-1",
  });
  assert.equal(formatClockTime(now), "07:05:09");
  assert.equal(TASKCHUTE_DEVICE_ID_STORAGE_KEY, "taskchute-plus.device-id");
  assert.equal(taskChuteDeltaPath("TaskChute/Log", "tc-dev-1", "2026-11"), "TaskChute/Log/inbox/tc-dev-1/2026-11.jsonl");

  // taskId のない習慣は taskId を書かない。
  const noId = buildHabitDoneDelta({ title: "散歩", path: "pj-span/散歩.md", deviceId: "tc-dev-1", now, random: fixed });
  assert.equal("taskId" in noId.payload, false);

  // 1 行の JSON と改行。前の行が改行で終わっていなければ、先に改行を入れる。
  const line = deltaLineToAppend("", delta);
  assert.equal(line, `${JSON.stringify(delta)}\n`);
  assert.equal(deltaLineToAppend('{"op":"upsert"}\n', delta), line);
  assert.equal(deltaLineToAppend('{"op":"upsert"}', delta), `\n${line}`);

  // PJ-span の読み方でも、TaskChute の差分として読めて、今日やったことになる。
  const habit = { taskId: "tc-task-1", path: "pj-span/腕立て.md", basename: "腕立て" };
  const before = mergeHabitLogs([], []);
  assert.equal(isHabitDoneOn(before, habit, "2026-11-19"), false);
  const after = mergeHabitLogs([], parseDeltaLines(line));
  assert.equal(isHabitDoneOn(after, habit, "2026-11-19"), true);
  assert.deepEqual(countHabitDays(after, habit), { "2026-11-19": 1 });
  assert.equal(findPjSpanEntries(after, habit, "2026-11-19").length, 1);
});

test("buildHabitUndoDelta removes only the record PJ-span wrote", () => {
  const now = new Date(2026, 10, 19, 21, 0, 0);
  const fixed = (length: number) => "zyxwvutsrqp".slice(0, length);
  const habit = { taskId: "tc-task-1", path: "pj-span/腕立て.md", basename: "腕立て" };
  const days = parseMonthlyLog(
    JSON.stringify({
      taskExecutions: {
        "2026-11-19": [
          {
            taskTitle: "腕立て",
            taskPath: "pj-span/腕立て.md",
            taskId: "tc-task-1",
            instanceId: "pj-span/腕立て.md_2026-11-19_1763500000000_k2j3h4g5f",
            startTime: "06:00:00",
            stopTime: "06:10:00",
          },
        ],
      },
    })
  );
  const done = buildHabitDoneDelta({ title: "腕立て", path: habit.path, taskId: habit.taskId, deviceId: "tc-dev-1", now, random: fixed });
  const merged = mergeHabitLogs([days], parseDeltaLines(deltaLineToAppend("", done)));
  assert.deepEqual(countHabitDays(merged, habit), { "2026-11-19": 2 });

  // TaskChute で付けた記録は PJ-span の記録とは見なさない。
  const mine = findPjSpanEntries(merged, habit, "2026-11-19");
  assert.equal(mine.length, 1);
  const entry = mine[0];
  assert.ok(entry);
  assert.equal(entry.instanceId, done.payload.instanceId);
  assert.equal(isPjSpanInstanceId("pj-span/腕立て.md_2026-11-19_1763500000000_k2j3h4g5f"), false);
  assert.equal(isPjSpanInstanceId(undefined), false);
  assert.equal(isPjSpanInstanceId(done.payload.instanceId), true);

  const undo = buildHabitUndoDelta(entry, "2026-11-19", "tc-dev-1", now, fixed);
  assert.equal(undo.op, "delete");
  assert.equal(undo.dateKey, "2026-11-19");
  assert.equal(undo.monthKey, "2026-11");
  assert.deepEqual(undo.payload, {
    instanceId: done.payload.instanceId,
    taskId: "tc-task-1",
    taskPath: "pj-span/腕立て.md",
  });
  const undone = mergeHabitLogs(
    [days],
    parseDeltaLines(deltaLineToAppend("", done) + deltaLineToAppend("", undo))
  );
  assert.deepEqual(countHabitDays(undone, habit), { "2026-11-19": 1 });
  assert.equal(findPjSpanEntries(undone, habit, "2026-11-19").length, 0);
  assert.throws(() => buildHabitUndoDelta({ taskId: "tc-task-1" }, "2026-11-19", "tc-dev-1", now, fixed));
});

test("normalizeTaskChuteDeviceId and resolveTaskChuteTitle follow TaskChute, and the button texts exist", () => {
  assert.equal(normalizeTaskChuteDeviceId(" tc-dev-1 "), "tc-dev-1");
  assert.equal(normalizeTaskChuteDeviceId("x".repeat(80)), "x".repeat(64));
  assert.equal(normalizeTaskChuteDeviceId(""), null);
  assert.equal(normalizeTaskChuteDeviceId(null), null);
  assert.equal(normalizeTaskChuteDeviceId("a/b"), null);
  assert.equal(normalizeTaskChuteDeviceId(".."), null);
  assert.equal(resolveTaskChuteTitle(" 朝の腕立て ", "腕立て"), "朝の腕立て");
  assert.equal(resolveTaskChuteTitle(undefined, "腕立て"), "腕立て");
  assert.equal(resolveTaskChuteTitle("", "腕立て"), "腕立て");

  const t = createTranslator("ja");
  assert.equal(t("habit.logToday"), "今日やった");
  assert.equal(t("habit.logTodayTooltip"), "今日やった");
  assert.equal(t("habit.doneToday"), "今日 ✓");
  assert.equal(t("habit.loggedTodayTooltip"), "今日 ✓（記録済み）");
  assert.equal(t("action.undoHabitToday"), "今日の記録を取り消す");
  assert.equal(t("notice.habitLogged", { title: "腕立て" }), "『腕立て』の今日の分を記録しました");
  const en = createTranslator("en");
  assert.equal(en("habit.logToday"), "Done today");
  assert.equal(en("habit.logTodayTooltip"), "Done today");
  assert.equal(en("habit.loggedTodayTooltip"), "Today ✓ (recorded)");
  assert.equal(en("action.undoHabitToday"), "Undo today's record");
});

test("partitionHabitsDoneToday moves habits done today into one group, keeping category then name order", () => {
  const habits = [
    { title: "スクワット", category: "運動", done: true },
    { title: "ストレッチ", category: "", done: false },
    { title: "走る", category: "運動", done: false },
    { title: "技術書", category: "読書", done: true },
    { title: "水を飲む", done: true },
    { title: "小説", category: " 読書 ", done: false },
    { title: "英語の単語", category: "英語", done: false },
  ];
  const { pending, done } = partitionHabitsDoneToday(habits, (habit) => habit.done);

  assert.deepEqual(
    groupHabitsByCategory(pending).map((group) => [group.category, group.items.map((item) => item.title)]),
    [
      ["運動", ["走る"]],
      ["英語", ["英語の単語"]],
      ["読書", ["小説"]],
      ["", ["ストレッチ"]],
    ]
  );
  assert.deepEqual(
    done.map((item) => item.title),
    ["スクワット", "技術書", "水を飲む"]
  );

  const noneDone = partitionHabitsDoneToday(habits, () => false);
  assert.deepEqual(
    noneDone.pending.map((item) => item.title),
    habits.map((item) => item.title)
  );
  assert.deepEqual(noneDone.done, []);

  const allDone = partitionHabitsDoneToday(habits, () => true);
  assert.deepEqual(allDone.pending, []);
  assert.deepEqual(
    allDone.done.map((item) => item.title),
    ["スクワット", "走る", "英語の単語", "技術書", "小説", "ストレッチ", "水を飲む"]
  );
  assert.deepEqual(partitionHabitsDoneToday([], () => true), { pending: [], done: [] });

  const original = habits.map((item) => item.title);
  partitionHabitsDoneToday(habits, (habit) => habit.done);
  assert.deepEqual(
    habits.map((item) => item.title),
    original
  );

  assert.equal(DONE_HABITS_GROUP_KEY, "*done");
  assert.notEqual(DONE_HABITS_GROUP_KEY, ALL_HABITS_GROUP_KEY);
  assert.notEqual(DONE_HABITS_GROUP_KEY, "完了");
  assert.deepEqual(normalizeCollapsedHabitGroups([DONE_HABITS_GROUP_KEY, DONE_HABITS_GROUP_KEY, "運動"]), [
    DONE_HABITS_GROUP_KEY,
    "運動",
  ]);
  assert.deepEqual(toggleCollapsedKey([], DONE_HABITS_GROUP_KEY, true), [DONE_HABITS_GROUP_KEY]);
  assert.deepEqual(toggleCollapsedKey([DONE_HABITS_GROUP_KEY], DONE_HABITS_GROUP_KEY, false), []);

  const t = createTranslator("ja");
  assert.equal(t("section.habitDone"), "完了");
  assert.equal(t("section.heading", { title: t("section.habitDone"), count: 3 }), "完了（3）");
  const en = createTranslator("en");
  assert.equal(en("section.habitDone"), "Done");
  assert.equal(en("section.heading", { title: en("section.habitDone"), count: 3 }), "Done (3)");
});

test("QuickAdd helpers find choice names in nested settings and build the habit variables", async () => {
  const choices = [
    { name: "習慣のメモ", type: "Macro", id: "a" },
    {
      name: "フォルダ",
      type: "Multi",
      id: "b",
      choices: [
        { name: "日記に追記", type: "Capture", id: "c" },
        { name: "中のフォルダ", type: "Multi", id: "d", choices: [{ name: " 次の一手を更新 ", type: "Macro", id: "e" }] },
        { name: "習慣のメモ", type: "Template", id: "f" },
      ],
    },
    null,
    "壊れた行",
    { name: "", type: "Macro", id: "g" },
    { type: "Macro", id: "h" },
    { name: "空のフォルダ", type: "Multi", id: "i" },
    { name: "壊れたフォルダ", type: "Multi", id: "j", choices: {} },
  ];

  assert.deepEqual(listQuickAddChoiceNames(choices), ["習慣のメモ", "日記に追記", "次の一手を更新"]);
  assert.deepEqual(listQuickAddChoiceNames(undefined), []);
  assert.deepEqual(listQuickAddChoiceNames({}), []);

  assert.equal(hasQuickAddChoice(choices, "次の一手を更新"), true);
  assert.equal(hasQuickAddChoice(choices, " 日記に追記 "), true);
  assert.equal(hasQuickAddChoice(choices, "フォルダ"), false);
  assert.equal(hasQuickAddChoice(choices, "ない名前"), false);
  assert.equal(hasQuickAddChoice(choices, ""), false);
  assert.equal(hasQuickAddChoice(undefined, "習慣のメモ"), false);

  assert.deepEqual(filterQuickAddChoiceNames(["Habit memo", "日記に追記"], "habit"), ["Habit memo"]);
  assert.deepEqual(filterQuickAddChoiceNames(["Habit memo", "日記に追記"], " "), ["Habit memo", "日記に追記"]);

  assert.equal(normalizeQuickAddChoiceName("  習慣のメモ  "), "習慣のメモ");
  assert.equal(normalizeQuickAddChoiceName(undefined), "");
  assert.equal(normalizeQuickAddChoiceName(3), "");

  assert.deepEqual(
    buildHabitQuickAddVariables({ path: "pj-span/腕立て.md", title: "腕立て｜15回3セット", date: "2026-11-19" }),
    { habitPath: "pj-span/腕立て.md", habitTitle: "腕立て", habitNextAction: "15回3セット", habitDate: "2026-11-19" }
  );
  assert.deepEqual(
    buildHabitQuickAddVariables({ path: "pj-span/将棋.md", title: "将棋", date: "2026-11-19" }),
    { habitPath: "pj-span/将棋.md", habitTitle: "将棋", habitNextAction: "", habitDate: "2026-11-19" }
  );

  assert.equal(getQuickAddExecuteChoice({}), null);
  assert.equal(
    getQuickAddExecuteChoice({ plugins: { enabledPlugins: new Set(), plugins: { quickadd: { api: {} } } } }),
    null
  );
  assert.equal(
    getQuickAddExecuteChoice({ plugins: { enabledPlugins: new Set(["quickadd"]), plugins: { quickadd: { api: {} } } } }),
    null
  );
  const calls: unknown[][] = [];
  const api = {
    executeChoice(this: unknown, choice: string, variables?: Record<string, unknown>) {
      calls.push([this === api, choice, variables]);
      return Promise.resolve();
    },
  };
  const execute = getQuickAddExecuteChoice({
    plugins: { enabledPlugins: new Set(["quickadd"]), plugins: { quickadd: { api } } },
  });
  assert.ok(execute);
  await execute("習慣のメモ", { habitPath: "a.md" });
  assert.deepEqual(calls, [[true, "習慣のメモ", { habitPath: "a.md" }]]);

  const t = createTranslator("ja");
  assert.equal(t("setting.habitQuickAdd"), "「今日やった」のあとに動かす QuickAdd");
  assert.equal(
    t("notice.quickAddChoiceMissing", { name: "習慣のメモ" }),
    "QuickAdd に『習慣のメモ』が見つかりません。PJ-span の設定の名前を確かめてください（今日の記録は残っています）"
  );
  const en = createTranslator("en");
  assert.equal(en("setting.habitQuickAdd"), "QuickAdd choice after logging a habit");
  assert.equal(en("notice.quickAddMissing"), "QuickAdd is not enabled, so it was not run. Today's record is kept.");
});

/** QuickAdd スクリプト「感想メモ」を、そのまま（tests/fixtures の写し）動かして、書いた結果を返す。 */
interface KansouRun {
  note: string;
  dailyLog: string | undefined;
  notices: string[];
  prompts: { header: string; value: string | undefined }[];
  reloads: number;
}

interface KansouCase {
  path?: string;
  content: string;
  memo: string | null;
  next?: string | null;
  dailyLog?: string;
  isMobile?: boolean;
}

const KANSOU_DATE = "2026-11-19";
const KANSOU_TIME = "07:05";

function runKansouScript(input: KansouCase): Promise<KansouRun> {
  const source = readFileSync(join(cwd(), "tests/fixtures/kansou-memo.quickadd.js.txt"), "utf8");
  const notePath = input.path ?? "pj-span/腕立て.md";
  const logPath = `02_Configs/Log/${KANSOU_DATE}.md`;
  const files = new Map<string, string>([[notePath, input.content]]);
  if (input.dailyLog !== undefined) files.set(logPath, input.dailyLog);
  const notices: string[] = [];
  const prompts: { header: string; value: string | undefined }[] = [];
  const answers = [input.memo, input.next ?? null];
  let reloads = 0;

  class FakeTFile {
    basename: string;
    constructor(public path: string) {
      this.basename = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
    }
  }
  class FakeNotice {
    constructor(message: string) {
      notices.push(message);
    }
  }
  class FakeMarkdownView {}
  class AbortError extends Error {}

  // 2026-11-19 07:05 で止めた moment（スクリプトが使う format・add・subtract だけ）。
  const fakeMoment = (offsetDays = 0) => ({
    format: (pattern: string) => {
      if (pattern === "HH:mm") return KANSOU_TIME;
      return shiftDateKey(KANSOU_DATE, offsetDays);
    },
    add: (days: number) => fakeMoment(offsetDays + days),
    subtract: (days: number) => fakeMoment(offsetDays - days),
  });

  const app = {
    isMobile: input.isMobile === true,
    workspace: {
      getActiveFile: () => new FakeTFile(notePath),
      getActiveViewOfType: () => null,
      getLeavesOfType: (type: string) =>
        type === "taskchute-view"
          ? [{ view: { reloadTasksAndRestore: () => { reloads += 1; return Promise.resolve(); } } }]
          : [],
    },
    vault: {
      read: (file: FakeTFile) => Promise.resolve(files.get(file.path) ?? ""),
      process: (file: FakeTFile, fn: (data: string) => string) => {
        const next = fn(files.get(file.path) ?? "");
        files.set(file.path, next);
        return Promise.resolve(next);
      },
      modify: (file: FakeTFile, data: string) => {
        files.set(file.path, data);
        return Promise.resolve();
      },
      create: (path: string, data: string) => {
        files.set(path, data);
        return Promise.resolve(new FakeTFile(path));
      },
      getAbstractFileByPath: (path: string) => (files.has(path) ? new FakeTFile(path) : null),
    },
    fileManager: {
      generateMarkdownLink: (file: FakeTFile) => `[[${file.basename}]]`,
    },
  };
  const params = {
    app,
    obsidian: { Notice: FakeNotice, MarkdownView: FakeMarkdownView, TFile: FakeTFile },
    quickAddApi: {
      inputPrompt: (header: string, _placeholder?: string, value?: string) => {
        prompts.push({ header, value });
        return Promise.resolve(answers.shift() ?? null);
      },
    },
    abort: (message: string) => {
      throw new AbortError(message);
    },
  };
  const sandbox: { module: { exports: unknown }; window: { moment: typeof fakeMoment } } = {
    module: { exports: undefined },
    window: { moment: () => fakeMoment(0) },
  };
  runInNewContext(source, sandbox);
  const script = sandbox.module.exports as (params: unknown) => Promise<void>;
  return script(params)
    .catch((error: unknown) => {
      if (!(error instanceof AbortError)) throw error;
    })
    .then(() => ({ note: files.get(notePath) ?? "", dailyLog: files.get(logPath), notices, prompts, reloads }));
}

/** 同じ入力で、PJ-span（「メモと次回」の画面）が書く結果。main.ts の runHabitMemo と同じ順に関数を使う。 */
function runPjSpanMemo(input: KansouCase): KansouRun {
  const t = createTranslator("ja");
  const path = input.path ?? "pj-span/腕立て.md";
  const basename = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
  const result: KansouRun = { note: input.content, dailyLog: input.dailyLog, notices: [], prompts: [], reloads: 0 };
  if (isInDailyLogFolder(path, DEFAULT_DAILY_LOG_FOLDER)) return result;
  // 画面には「メモ」と、次の一手を入れた「次回」の 2 つの欄を出す。
  result.prompts.push({ header: "メモ", value: undefined }, { header: "次回", value: currentNextAction(input.content) });
  if (input.memo === null || input.next === null || input.next === undefined) return result;
  const prepared = prepareHabitMemoInput(input.memo, input.next);
  if (!prepared) {
    result.notices.push(t("notice.habitMemoEmpty"));
    return result;
  }
  result.note = applyHabitMemo(input.content, { ...prepared, basename, date: KANSOU_DATE });
  if (prepared.memo) {
    const entry = buildDailyLogEntry(KANSOU_TIME, `[[${basename}]]`, prepared.memo);
    result.dailyLog =
      input.dailyLog === undefined ? buildNewDailyLog(KANSOU_DATE, entry) : appendDailyLogEntry(input.dailyLog, entry);
  }
  result.reloads = 1;
  result.notices.push(t(habitMemoNotice(prepared.memo !== "", input.isMobile === true).key));
  return result;
}

const KANSOU_NOTES: Record<string, string> = {
  typical: [
    "---",
    'title: "腕立て｜15回3セット"',
    "taskId: tc-task-1",
    "tags:",
    "  - task",
    "---",
    "## いまやること",
    "",
    "- 腕立て伏せ",
    "",
    "## 次の一手",
    "",
    "- [x] 10回3セット",
    "- [ ] 15回3セット",
    "- [ ] 20回3セット",
    "",
    "## ログ",
    "",
    "- 2026-11-18 きつかった",
    "--- ",
    "",
  ].join("\n"),
  noTitle: "---\ntaskId: tc-task-2\n---\n## 次の一手\n\n- [ ] 45から\n\n## ログ\n",
  noFrontmatter: "## 次の一手\n\n- [ ] 45から\n\n## ログ\n\n- 2026-11-01 はじめた\n--- \n",
  marked: '---\ntitle: "★将棋｜詰将棋5問"\n---\n## いまやること\n詰将棋\n\n## 次の一手\n- [ ] 詰将棋5問\n## ログ\n',
  markedNoLabel: "---\ntitle: ◆読書｜10ページ\n---\n## 次の一手\n\n- [ ] 10ページ\n",
  allChecked: '---\ntitle: "散歩｜1km"\n---\n## いまやること\n\n- 夜の散歩\n\n## 次の一手\n\n- [x] 1km\n- [X] 2km\n\n## ログ\n',
  noNextHeading: '---\ntitle: "瞑想"\n---\n## いまやること\n\n5分\n## ログ\n\n- 2026-11-10 集中できた\n--- \n',
  noHeadings: "なにもない本文",
  empty: "",
  nextLast: "---\ntitle: 'ストレッチ'\n---\n## ログ\n\n## 次の一手\n\n\n- [ ] 前屈\n\n\n- 開脚\n* [ ] 肩\n",
  quotedTitle: '---\ntitle: "引用\\"テスト\\\\｜a"\n---\n## いまやること\n\n- 「言葉」\\と"記号"\n## 次の一手\n- [ ] a\n',
  emptyTitle: "---\ntitle: ''\n---\n## 次の一手\n\n- [x] 終わった\n",
  crlf: '---\r\ntitle: "腹筋｜30回"\r\n---\r\n## 次の一手\r\n\r\n- [ ] 30回\r\n\r\n## ログ\r\n\r\n- 2026-11-18 よし\r\n--- \r\n',
  headingSpaces: '---\ntitle: "縄跳び"\n---\n## 次の一手  \n- [ ] 100回\n## ログ\t\n- 2026-11-02 はじめた\n',
  unclosedFrontmatter: "---\ntitle: 途中\n## 次の一手\n- [ ] x\n",
  frontmatterNoNewline: "---\ntitle: \"a\"\n---",
};

test("the habit memo port writes the same note, daily log, and notice as the 感想メモ QuickAdd script", async () => {
  const combos: { label: string; memo: string | null; next: string | null; dailyLog?: string; isMobile?: boolean }[] = [
    { label: "memo + same next", memo: "よくできた", next: "@prefill" },
    { label: "memo + new next", memo: "  フォームを意識  ", next: "20回3セット", dailyLog: "---\nStart: x\n---\n既存" },
    { label: "memo only", memo: "メモだけ", next: "", dailyLog: "既存の行\n", isMobile: true },
    { label: "next only", memo: "", next: "- [ ] 50から", isMobile: true },
    { label: "next only (desktop)", memo: "   ", next: "[x] 次はこれ\n2 行目は使わない" },
    { label: "both empty", memo: "", next: "  " },
    { label: "cancel memo", memo: null, next: null },
    { label: "cancel next", memo: "書いたけど", next: null },
  ];
  let compared = 0;
  let written = 0;
  for (const [name, content] of Object.entries(KANSOU_NOTES)) {
    for (const combo of combos) {
      const next = combo.next === "@prefill" ? currentNextAction(content) : combo.next;
      const input: KansouCase = { content, memo: combo.memo, next, dailyLog: combo.dailyLog, isMobile: combo.isMobile };
      const expected = await runKansouScript(input);
      const actual = runPjSpanMemo(input);
      const label = `${name} / ${combo.label}`;
      assert.equal(actual.note, expected.note, `note: ${label}`);
      assert.equal(actual.dailyLog, expected.dailyLog, `daily log: ${label}`);
      assert.equal(actual.reloads, expected.reloads, `TaskChute reload: ${label}`);
      assert.equal(actual.prompts[1]?.value, expected.prompts[1]?.value ?? currentNextAction(content), `prefill: ${label}`);
      if (combo.memo !== null && combo.next !== null) {
        assert.deepEqual(actual.notices, expected.notices, `notice: ${label}`);
      }
      compared += 1;
      if (expected.note !== content) written += 1;
    }
  }
  assert.equal(compared, Object.keys(KANSOU_NOTES).length * combos.length);
  // 比べたうち、スクリプトがノートを書き換えたのは「書く」5 通り × ノートの数。
  assert.equal(written, Object.keys(KANSOU_NOTES).length * 5);

  // 日次ログのフォルダの中のノートでは、スクリプトもPJ-spanも書かない。
  const inLog = await runKansouScript({ path: "02_Configs/Log/2026-11-19.md", content: "x", memo: "m", next: "n" });
  assert.equal(inLog.note, "x");
  assert.equal(inLog.prompts.length, 0);
  assert.equal(isInDailyLogFolder("02_Configs/Log/2026-11-19.md", DEFAULT_DAILY_LOG_FOLDER), true);
  assert.equal(isInDailyLogFolder("02_Configs/Logs/a.md", DEFAULT_DAILY_LOG_FOLDER), false);
});

test("applyHabitMemo writes the memo under ログ, replaces the first open 次の一手, and rewrites the title", () => {
  const base = { basename: "腕立て", date: "2026-11-19" };
  assert.equal(
    applyHabitMemo(KANSOU_NOTES.typical ?? "", { ...base, memo: "よくできた", next: "20回3セット" }),
    [
      "---",
      'title: "腕立て伏せ｜20回3セット"',
      "taskId: tc-task-1",
      "tags:",
      "  - task",
      "---",
      "## いまやること",
      "",
      "- 腕立て伏せ",
      "",
      "## 次の一手",
      "",
      "- [x] 10回3セット",
      "- [ ] 20回3セット",
      "- [ ] 20回3セット",
      "",
      "## ログ",
      "",
      "- 2026-11-19 よくできた",
      "--- ",
      "- 2026-11-18 きつかった",
      "--- ",
      "",
    ].join("\n")
  );
  // メモだけのとき、title と次の一手はそのまま。
  assert.equal(
    applyHabitMemo(KANSOU_NOTES.noTitle ?? "", { ...base, memo: "m", next: "" }),
    '---\ntaskId: tc-task-2\ntitle: "腕立て"\n---\n## 次の一手\n\n- [ ] 45から\n\n## ログ\n\n- 2026-11-19 m\n--- \n'
  );
  // 全部チェック済みで次回が空なら、title は左側だけ（いまやることの 1 行目）。
  assert.equal(
    applyHabitMemo(KANSOU_NOTES.allChecked ?? "", { ...base, memo: "歩いた", next: "" }),
    '---\ntitle: "夜の散歩"\n---\n## いまやること\n\n- 夜の散歩\n\n## 次の一手\n\n- [x] 1km\n- [X] 2km\n\n## ログ\n\n- 2026-11-19 歩いた\n--- \n'
  );
  // 印（★）は残し、次の一手が無ければ ## ログ の前に作る。
  assert.equal(
    applyHabitMemo('---\ntitle: "★瞑想"\n---\n## ログ\n', { ...base, basename: "瞑想", memo: "", next: "10分" }),
    '---\ntitle: "★瞑想｜10分"\n---\n## 次の一手\n\n- [ ] 10分\n\n## ログ\n'
  );
  // 何もないノートには、frontmatter と見出しを作る。
  assert.equal(
    applyHabitMemo("", { ...base, memo: "初回", next: "続ける" }),
    '---\ntitle: "腕立て｜続ける"\n---\n\n## 次の一手\n\n- [ ] 続ける\n\n## ログ\n\n- 2026-11-19 初回\n--- \n'
  );
});

test("habit memo input, settings, daily log, and notice helpers follow the 感想メモ rules", async () => {
  assert.equal(submittedNextText("- [ ] 50から"), "50から");
  assert.equal(submittedNextText("[x] 済み\n2 行目"), "済み");
  assert.equal(submittedNextText("  "), "");
  assert.equal(submittedNextText(null), "");
  assert.equal(normalizeHabitMemo("  よし  "), "よし");
  assert.equal(normalizeHabitMemo("1 行目\n\n  2 行目  \r\n"), "1 行目\n  2 行目");
  assert.equal(normalizeHabitMemo(undefined), "");
  assert.deepEqual(prepareHabitMemoInput(" ", "\n"), null);
  assert.deepEqual(prepareHabitMemoInput("a\nb", "- [ ] c"), { memo: "a\n  b", next: "c" });
  assert.equal(
    applyHabitMemo("## ログ\n", { basename: "x", date: "2026-11-19", memo: "a\n  b", next: "" }),
    '---\ntitle: "x"\n---\n\n## ログ\n\n- 2026-11-19 a\n  b\n--- \n'
  );

  assert.equal(currentNextAction(KANSOU_NOTES.typical ?? ""), "15回3セット");
  assert.equal(currentNextAction(KANSOU_NOTES.allChecked ?? ""), "");
  assert.equal(currentNextAction("## 次の一手\n\n- [x] a\n\n- b\n"), "b");
  assert.equal(currentLabel("## いまやること\n\n--- 区切り\n## 次"), "区切り");
  assert.equal(currentLabel("## いまやること\n\n## 次"), "");
  assert.equal(allNextChecked("## 次の一手\n"), false);
  assert.equal(replaceFirstOpenNext("## 次の一手\n- [x] a\n", " "), "## 次の一手\n- [x] a\n");
  assert.equal(insertAfterLogHeading("本文", "- 行"), "本文\n\n## ログ\n\n- 行\n");
  assert.equal(insertAfterLogHeading("## ログ\r\n\r\n- 古い", "- 新"), "## ログ\n\n- 新\n- 古い");
  assert.equal(upsertTitle('---\ntitle: "a｜b"\n---\n', "f", "", "", false), '---\ntitle: "a｜b"\n---\n');

  assert.equal(dailyLogPath("02_Configs/Log", "2026-11-19"), "02_Configs/Log/2026-11-19.md");
  assert.equal(dailyLogPath(" /日記/ログ/ ", "2026-01-01"), "日記/ログ/2026-01-01.md");
  assert.equal(normalizeDailyLogFolder(""), DEFAULT_DAILY_LOG_FOLDER);
  assert.equal(normalizeDailyLogFolder(3), DEFAULT_DAILY_LOG_FOLDER);
  assert.equal(normalizeDailyLogFolder("a\\b/"), "a/b");
  assert.equal(
    buildNewDailyLog("2026-03-01", buildDailyLogEntry("23:59", "[[腕立て]]", "m")),
    "---\nStart: 2026-03-01\nEnd: 2026-03-02\n---\n[[2026-02-28]] ｜ [[2026-03-02]]\n\n\n- 23:59 [[腕立て]] m\n--- \n"
  );
  assert.equal(appendDailyLogEntry("a", "- b\n"), "a\n- b\n");
  assert.equal(appendDailyLogEntry("a\n", "- b\n"), "a\n- b\n");
  assert.equal(formatMemoTime(new Date(2026, 10, 19, 7, 5)), "07:05");

  assert.equal(normalizeHabitMemoEnabled(undefined), true);
  assert.equal(normalizeHabitMemoEnabled(false), false);
  assert.equal(normalizeHabitMemoEnabled("false"), true);
  assert.equal(chooseHabitAfterLog({ quickAddChoice: "感想メモ", memoEnabled: true }), "quickadd");
  assert.equal(chooseHabitAfterLog({ quickAddChoice: "感想メモ", memoEnabled: false }), "quickadd");
  assert.equal(chooseHabitAfterLog({ quickAddChoice: " ", memoEnabled: true }), "memo");
  assert.equal(chooseHabitAfterLog({ quickAddChoice: "", memoEnabled: false }), "none");

  assert.deepEqual(habitMemoNotice(true, true), { key: "notice.habitMemoMobile", duration: 8000 });
  assert.deepEqual(habitMemoNotice(true, false), { key: "notice.habitMemoSaved" });
  assert.deepEqual(habitMemoNotice(false, true), { key: "notice.habitNextMobile", duration: 8000 });
  assert.deepEqual(habitMemoNotice(false, false), { key: "notice.habitNextSaved" });

  const calls: unknown[] = [];
  await reloadTaskChuteViewIfOpen({ getLeavesOfType: () => [] });
  await reloadTaskChuteViewIfOpen({ getLeavesOfType: () => [{ view: {} }] });
  await reloadTaskChuteViewIfOpen({
    getLeavesOfType: (type) =>
      type === "taskchute-view" ? [{ view: { reloadTasksAndRestore: (options: unknown) => calls.push(options) } }] : [],
  });
  assert.deepEqual(calls, [{ runBoundaryCheck: true }]);

  const t = createTranslator("ja");
  assert.equal(t("setting.habitMemo"), "「今日やった」のあとにメモと次回を書く");
  assert.equal(t("habitMemo.title", { title: "腕立て" }), "『腕立て』のメモと次回");
  assert.equal(t("notice.habitMemoMobile"), "日次ログに書きました。Synctrainで同期してください");
  const en = createTranslator("en");
  assert.equal(en("habitMemo.save"), "Save");
  assert.equal(en("setting.habitDailyLogFolder"), "Daily log folder");
});

test("parsePreviousHabitMemo reads the newest ログ memo, including multi-line and CRLF entries", () => {
  assert.deepEqual(
    parsePreviousHabitMemo("## ログ\n\n- 2026-11-18 45から解いた\n--- \n- 2026-11-17 前のメモ\n--- \n"),
    { date: "2026-11-18", text: "45から解いた" }
  );
  assert.deepEqual(
    parsePreviousHabitMemo("## ログ\r\n\r\n- 2026-11-18 1行目\r\n  2行目\r\n  3行目\r\n--- \r\n- 2026-11-17 古い\r\n--- \r\n"),
    { date: "2026-11-18", text: "1行目\n2行目\n3行目" }
  );
  assert.equal(parsePreviousHabitMemo("本文だけ\n- 2026-11-18 メモ\n--- \n"), null);
  assert.equal(parsePreviousHabitMemo("## ログ\n\n"), null);
  assert.equal(parsePreviousHabitMemo("## ログ\n\n--- \n"), null);
  assert.deepEqual(
    parsePreviousHabitMemo("## ログ\n\n- 日付のないメモ\n--- \n- ただの行\n- 2026-11-01 本体\n--- \n"),
    { date: "2026-11-01", text: "本体" }
  );
  assert.deepEqual(
    parsePreviousHabitMemo("## ログ\n\n- 2026-11-18\n--- \n- 2026-11-10 次の有効なメモ\n--- \n"),
    { date: "2026-11-10", text: "次の有効なメモ" }
  );
  assert.equal(formatPreviousMemoDate("2026-11-18"), "11月18日");
  assert.equal(formatPreviousMemoDate("2026-01-05"), "1月5日");
  assert.equal(formatPreviousMemoDate("メモ"), "メモ");
  assert.deepEqual(previewHabitMemoText("1\n2\n3"), { preview: "1\n2\n3", truncated: false });
  assert.deepEqual(previewHabitMemoText("1\n2\n3\n4"), { preview: "1\n2\n3…", truncated: true });

  const t = createTranslator("ja");
  assert.equal(t("habitMemo.previous", { date: "11月18日", text: "45から解いた" }), "前回（11月18日）：45から解いた");
  const en = createTranslator("en");
  assert.equal(en("habitMemo.previous", { date: "11月18日", text: "45から解いた" }), "Previous (11月18日): 45から解いた");
});

test("プロジェクトの残日数ピルは、あと◯日・今日まで・超過・期日なしを出し分ける", () => {
  const today = "2026-11-20";
  assert.deepEqual(buildDuePill({ archived: false, date: "2026-11-27" }, today, 7), {
    kind: "remaining",
    appearance: "soon",
    days: 7,
    tooltipDateKey: "2026-11-27",
  });
  assert.deepEqual(buildDuePill({ archived: false, date: "2026-11-28" }, today, 7), {
    kind: "remaining",
    appearance: "ok",
    days: 8,
    tooltipDateKey: "2026-11-28",
  });
  assert.deepEqual(buildDuePill({ archived: false, date: "2026-11-20" }, today, 7), {
    kind: "today",
    appearance: "soon",
    days: 0,
    tooltipDateKey: "2026-11-20",
  });
  // 設定の「期日が近い」がオフでも、今日が期日ならオレンジの「今日まで」。
  assert.equal(buildDuePill({ archived: false, date: "2026-11-20" }, today, 0).appearance, "soon");
  // 7日以内のオレンジは、設定の soonDays に合わせる（0 ならオレンジにしない）。
  assert.equal(buildDuePill({ archived: false, date: "2026-11-27" }, today, 0).appearance, "ok");
  assert.deepEqual(buildDuePill({ archived: false, date: "2026-11-17" }, today, 7), {
    kind: "overdue",
    appearance: "overdue",
    days: 3,
    tooltipDateKey: "2026-11-17",
  });
  assert.deepEqual(buildDuePill({ archived: false, date: "" }, today, 7), {
    kind: "none",
    appearance: "muted",
  });
  assert.deepEqual(
    buildDuePill({ archived: true, completed: "2026-11-16", date: "2026-11-30" }, today, 7),
    {
      kind: "done",
      appearance: "muted",
      tooltipDateKey: "2026-11-16",
      completedDateKey: "2026-11-16",
    }
  );

  assert.equal(formatDueRemaining("ja", 7), "あと7日");
  assert.equal(formatDueRemaining("en", 7), "7 days left");
  assert.equal(formatDueRemaining("en", 1), "1 day left");
  assert.equal(formatDueOverdue("ja", 3), "3日超過");
  assert.equal(formatDueOverdue("en", 3), "3 days overdue");
  assert.equal(formatDueOverdue("en", 1), "1 day overdue");
  assert.equal(createTranslator("ja")("view.dueByToday"), "今日まで");
  assert.equal(createTranslator("en")("view.dueByToday"), "Due today");
  assert.equal(createTranslator("ja")("view.noDate"), "期日なし");
  assert.equal(formatLocalizedDate("2026-11-27", "ja"), "2026年11月27日(金)");
});

test("ヘッダーの件数は、今週締切・超過・今月完了を、見出しの分け方とは別に数える", () => {
  // 2026-11-20 は金曜。週の終わりは土曜なので、今日と明日だけが今週締切。
  const today = "2026-11-20";
  const records = [
    { title: "今日まで", date: "2026-11-20", archived: false },
    { title: "明日", date: "2026-11-21", archived: false },
    { title: "来週", date: "2026-11-22", archived: false },
    { title: "超過", date: "2026-11-19", archived: false },
    { title: "期日なし", date: "", archived: false },
    { title: "今月完了", date: "2026-11-10", archived: true, completed: "2026-11-18" },
    { title: "先月完了", date: "2026-10-01", archived: true, completed: "2026-10-30" },
    {
      title: "今日やる（来週が期日）",
      date: "2026-11-27",
      archived: false,
      taskchute: { targetDate: today },
    },
    {
      title: "今日やる（今週が期日）",
      date: "2026-11-21",
      archived: false,
      taskchute: { targetDate: today },
    },
  ];
  assert.deepEqual(countProjectSummary(records, today), {
    dueThisWeek: 3,
    overdue: 1,
    doneThisMonth: 1,
  });
});

test("今日の一覧に入っているカードは「今日やる」にまとめ、期日順と期日なしには出さない", () => {
  const today = "2026-11-20";
  const dated = { title: "期日あり", date: "2026-11-27", archived: false };
  const inTodayDated = {
    title: "今日やる・期日あり",
    date: "2026-11-27",
    archived: false,
    taskchute: { targetDate: today },
  };
  const undated = { title: "期日なし", date: "", archived: false };
  const inTodayUndated = {
    title: "今日やる・期日なし",
    date: "",
    archived: false,
    taskchute: { targetDate: today },
  };
  const archivedToday = {
    title: "完了（今日の日付が残っていても）",
    date: "2026-11-10",
    archived: true,
    completed: "2026-11-18",
    taskchute: { targetDate: today },
  };
  const otherDay = {
    title: "別の日の一覧",
    date: "2026-11-27",
    archived: false,
    taskchute: { targetDate: "2026-11-19" },
  };
  const notTaskChute = { title: "TaskChuteでない", date: "2026-11-15", archived: false };
  const records = [dated, inTodayDated, undated, inTodayUndated, archivedToday, otherDay, notTaskChute];
  assert.equal(isInTodayList(inTodayDated, today), true);
  assert.equal(isInTodayList(inTodayUndated, today), true);
  assert.equal(isInTodayList(archivedToday, today), false);
  assert.equal(isInTodayList(otherDay, today), false);
  const groups = partitionProjectGroups(records, today);
  assert.deepEqual(
    groups.inToday.map((row) => row.title),
    ["今日やる・期日あり", "今日やる・期日なし"]
  );
  assert.deepEqual(
    groups.dated.map((row) => row.title),
    ["TaskChuteでない", "別の日の一覧", "期日あり"]
  );
  assert.deepEqual(
    groups.undated.map((row) => row.title),
    ["期日なし"]
  );
  assert.deepEqual(
    groups.archived.map((row) => row.title),
    ["完了（今日の日付が残っていても）"]
  );
});

test("「今日やる」の並びは、超過、今日、これから、期日なしの順", () => {
  const today = "2026-11-20";
  const inToday = { taskchute: { targetDate: today } };
  const records = [
    { title: "これから", date: "2026-11-27", archived: false, ...inToday },
    { title: "期日なし", date: "", archived: false, ...inToday },
    { title: "超過", date: "2026-11-10", archived: false, ...inToday },
    { title: "今日", date: "2026-11-20", archived: false, ...inToday },
  ];
  assert.deepEqual(
    partitionProjectGroups(records, today).inToday.map((row) => row.title),
    ["超過", "今日", "これから", "期日なし"]
  );
  assert.deepEqual(partitionProjectGroups([], today), {
    inToday: [],
    dated: [],
    undated: [],
    archived: [],
  });
});

test("今日やるの完了件数は、今日完了したプロジェクト全部を数える", () => {
  const today = "2026-11-20";
  const remaining = {
    title: "今日やる残り",
    date: "2026-11-27",
    archived: false,
    taskchute: { targetDate: today },
  };
  const doneFromTodayList = {
    title: "今日の一覧から完了",
    date: "2026-11-27",
    archived: true,
    completed: today,
    taskchute: { targetDate: today },
  };
  const doneFromDueList = {
    title: "期日順から完了",
    date: "2026-11-21",
    archived: true,
    completed: today,
  };
  const doneYesterday = {
    title: "昨日完了",
    date: "2026-11-10",
    archived: true,
    completed: "2026-11-19",
  };
  const stillOpen = { title: "未完了", date: "2026-11-21", archived: false };
  const records = [remaining, doneFromTodayList, doneFromDueList, doneYesterday, stillOpen];

  assert.equal(countCompletedToday(records, today), 2);
  assert.deepEqual(countInTodayProgress(records, today), { remaining: 1, doneToday: 2 });
  assert.equal(shouldShowInTodaySection({ remaining: 1, doneToday: 2 }), true);
  assert.equal(shouldShowInTodaySection({ remaining: 0, doneToday: 2 }), true);
  assert.equal(shouldShowInTodaySection({ remaining: 1, doneToday: 0 }), true);
  assert.equal(shouldShowInTodaySection({ remaining: 0, doneToday: 0 }), false);
  assert.deepEqual(countInTodayProgress([], today), { remaining: 0, doneToday: 0 });
  assert.equal(shouldShowInTodaySection(countInTodayProgress([], today)), false);
});
