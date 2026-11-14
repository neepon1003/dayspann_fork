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
  shiftDateKey,
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
import { applyDraftToFrontmatter, replaceRecordBody } from "../src/record-edit";
import {
  canReloadTaskChuteView,
  hasTaskTag,
  isTaskChuteTask,
  readTargetDate,
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

test("先送りボタンは+1週だけを出す", () => {
  assert.equal(createTranslator("ja")("action.postponeWeek"), "+1週");
  assert.equal(createTranslator("en")("action.postponeWeek"), "+1 week");
  assert.equal(shiftDateKey("2026-11-30", 7), "2026-12-07");
});
