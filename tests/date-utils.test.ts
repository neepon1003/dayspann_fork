import assert from "node:assert/strict";
import test from "node:test";
import {
  compareArchiveOrder,
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
import { createTranslator, durationUnit, formatCountUnit, resolveLocale } from "../src/i18n";
import {
  ALL_HABITS_GROUP_KEY,
  normalizeCollapsedHabitGroups,
  normalizeCollapsedSections,
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
import { findDuplicates, isActiveProjectOrTask, normalizeNameForCompare, stripDatePrefix } from "../src/duplicate-check";
import { appendLogLine, appendLogLineToFile, readLatestCompletionLogDate, resolveCompletedDate } from "../src/log-entry";
import { normalizeRecordType, readRecordType } from "../src/record-type";
import { groupHabitsByCategory, readCategory } from "../src/habit-category";
import {
  buildHeatmapWeeks,
  collectLogMonthKeys,
  countActiveDays,
  countHabitDays,
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
} from "../src/habit-log";
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
  weekStreakTarget,
} from "../src/habit-target";
import {
  buildNewNoteBody,
  buildNewNoteTitle,
  displayTitle,
  excerptForCard,
  splitTitle,
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

test("セクションの並び順を保存値から復元する", () => {
  assert.deepEqual(normalizeSectionOrder(["past", "future", "today"]), [
    "past",
    "future",
    "today",
  ]);
});

test("古い設定や不正な並び順には不足項目を補う", () => {
  assert.deepEqual(normalizeSectionOrder(undefined), ["today", "future", "past"]);
  assert.deepEqual(normalizeSectionOrder(["past", "past", "unknown"]), [
    "past",
    "today",
    "future",
  ]);
});

test("折りたたみ状態は有効なセクションだけ重複なく復元する", () => {
  assert.deepEqual(normalizeCollapsedSections(["past", "past", "unknown", "today"]), [
    "past",
    "today",
  ]);
  assert.deepEqual(normalizeCollapsedSections(undefined), []);
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
    complete: false,
    postponeInMenu: true,
    overdueActions: true,
  });
  assert.deepEqual(
    planCardActions(
      { archived: false, date: "2026-11-10", taskchute: { targetDate: "2026-11-16" } },
      "2026-11-16"
    ),
    { today: "inToday", complete: false, postponeInMenu: true, overdueActions: true }
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
  assert.equal(createTranslator("ja")("view.doneThisMonth", { count: 3 }), "今月完了：3件");
  assert.equal(createTranslator("en")("view.doneThisMonth", { count: 3 }), "Done this month: 3");
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

  const t = createTranslator("ja");
  assert.equal(t("heatmap.recentLabel", { days: 30 }), "直近30日");
  assert.equal(t("heatmap.streakLabel"), "連続");
  assert.equal(t("heatmap.bestLabel"), "最長");
  const en = createTranslator("en");
  assert.equal(en("heatmap.recentLabel", { days: 30 }), "Last 30 days");
  assert.equal(en("heatmap.streakLabel"), "Streak");
  assert.equal(en("heatmap.bestLabel"), "Best");
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

