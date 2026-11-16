import assert from "node:assert/strict";
import test from "node:test";
import {
  compareArchiveOrder,
  daysUntilEndOfWeek,
  differenceInCalendarDays,
  formatCompletedBadgeDate,
  formatDateSpan,
  formatLocalizedDate,
  normalizeDisplayMode,
  parseDateKey,
  readDateKey,
  addMonthsClamped,
  postponeTargets,
  shiftDateKey,
  stalledDays,
  toDateKey,
} from "../src/date-utils";
import { createTranslator, durationUnit, resolveLocale } from "../src/i18n";
import {
  normalizeCollapsedSections,
  normalizeSectionOrder,
  parseSoonDays,
} from "../src/settings";
import {
  formatSourceReference,
  isLinkedSourceReference,
  parseSourceReference,
} from "../src/source-link";
import { applyDraftToFrontmatter, readGoal, replaceRecordBody } from "../src/record-edit";
import { planCardActions } from "../src/card-actions";
import { findDuplicates, normalizeNameForCompare, stripDatePrefix } from "../src/duplicate-check";
import { appendLogLine, appendLogLineToFile } from "../src/log-entry";
import {
  buildNewNoteBody,
  buildNewNoteTitle,
  displayTitle,
  excerptForCard,
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

test("新しく登録した記録のTaskChuteの項目は、今日の target_date・taskId・tags: [task]", () => {
  const fields = buildTaskChuteFields("2026-11-15", "tc-task-1234");
  assert.deepEqual(fields, { target_date: "2026-11-15", taskId: "tc-task-1234", tags: ["task"] });
  // PJ-span の読み方でも TaskChute のタスクで、今日の一覧に入っている形になる
  assert.equal(isTaskChuteTask(fields as unknown as Record<string, unknown>), true);
  assert.equal(readTargetDate(fields.target_date), "2026-11-15");
  assert.equal(
    planCardActions({ archived: false, date: "2026-12-22", taskchute: { targetDate: fields.target_date } }, "2026-11-15").today,
    "inToday"
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

test("カードには「｜プロジェクトノート作成」を外した名前を出す", () => {
  assert.equal(displayTitle("はばタンPAY+｜プロジェクトノート作成"), "はばタンPAY+");
  assert.equal(displayTitle("はばタンPAY+第6弾｜当選結果を確認する"), "はばタンPAY+第6弾｜当選結果を確認する");
  assert.equal(displayTitle("｜プロジェクトノート作成"), "｜プロジェクトノート作成");
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
