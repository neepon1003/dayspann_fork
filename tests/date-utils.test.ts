import assert from "node:assert/strict";
import test from "node:test";
import {
  daysUntilEndOfWeek,
  differenceInCalendarDays,
  formatDateSpan,
  formatLocalizedDate,
  normalizeDisplayMode,
  parseDateKey,
  toDateKey,
} from "../src/date-utils";
import { createTranslator, durationUnit, resolveLocale } from "../src/i18n";
import { normalizeCollapsedSections, normalizeSectionOrder } from "../src/settings";
import {
  formatSourceReference,
  isLinkedSourceReference,
  parseSourceReference,
} from "../src/source-link";

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

test("ローカル日付をYYYY-MM-DDにする", () => {
  assert.equal(toDateKey(new Date(2026, 8, 5, 23, 30)), "2026-09-05");
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
