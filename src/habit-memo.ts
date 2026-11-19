import { parseDateKey, shiftDateKey } from "./date-utils";

/**
 * 「今日やった」のあとに出す「メモと次回」の画面で、習慣のノートに書く中身を作る関数。
 * ユーザーの QuickAdd スクリプト「感想メモ」と同じ書き方をする（同じ見出し・同じ行の形）。
 * ここの関数はノートやファイルに触らない（文字を受け取って、文字を返すだけ）。
 */

/** メモを書く見出し。 */
export const HABIT_MEMO_LOG_HEADING = "ログ";
/** 次の一手を書く見出し。 */
export const HABIT_MEMO_NEXT_HEADING = "次の一手";
/** title の左側（名前）に使う見出し。 */
export const HABIT_MEMO_CURRENT_HEADING = "いまやること";
/** 日次ログのフォルダの既定値。 */
export const DEFAULT_DAILY_LOG_FOLDER = "02_Configs/Log";
/** 既存の title の先頭にあれば残す印。 */
const TITLE_MARKS = ["★", "◆", "◎"] as const;

const LOG_HEADING_RE = new RegExp(`^## ${HABIT_MEMO_LOG_HEADING}[ \\t]*$`, "m");
const NEXT_HEADING_RE = new RegExp(`^## ${HABIT_MEMO_NEXT_HEADING}[ \\t]*$`, "m");
const CURRENT_HEADING_RE = new RegExp(`^## ${HABIT_MEMO_CURRENT_HEADING}[ \\t]*$`, "m");

export type NextItem = { kind: "item"; checked: boolean; text: string } | { kind: "blank" };

/** 「今日やった」のあとに何をするか。QuickAdd の名前が入っていれば QuickAdd、なければ PJ-span の画面。 */
export type HabitAfterLogAction = "quickadd" | "memo" | "none";

export function chooseHabitAfterLog(settings: { quickAddChoice: string; memoEnabled: boolean }): HabitAfterLogAction {
  if (settings.quickAddChoice.trim()) return "quickadd";
  return settings.memoEnabled ? "memo" : "none";
}

/** 設定の「メモと次回を書く」。true/false 以外（まだ保存していないときなど）はオン。 */
export function normalizeHabitMemoEnabled(value: unknown): boolean {
  return typeof value === "boolean" ? value : true;
}

/** 日次ログのフォルダ。前後の空白と / を取る。空なら既定の 02_Configs/Log。 */
export function normalizeDailyLogFolder(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_DAILY_LOG_FOLDER;
  const folder = value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return folder || DEFAULT_DAILY_LOG_FOLDER;
}

/** その日の日次ログの場所（例：02_Configs/Log/2026-11-19.md）。 */
export function dailyLogPath(folder: string, date: string): string {
  return `${normalizeDailyLogFolder(folder)}/${date}.md`;
}

/** ノートが日次ログのフォルダの中か（スクリプトと同じく、日次ログには書かない）。 */
export function isInDailyLogFolder(path: string, folder: string): boolean {
  return path.startsWith(`${normalizeDailyLogFolder(folder)}/`);
}

/**
 * 入力されたメモを整える。前後の空白を取る（スクリプトと同じ）。
 * 何行か書いたときは、空の行を外し、2 行目からは字下げして、同じ箇条書きの 1 項目に収める。
 */
export function normalizeHabitMemo(raw: string | null | undefined): string {
  return String(raw ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join("\n  ");
}

function parseNextLine(raw: string): NextItem | null {
  const line = String(raw).trim();
  if (!line) return null;
  const match = /^(?:[-*+][ \t]*)?(?:\[([ xX])\][ \t]*)?([\s\S]*)$/.exec(line);
  if (!match) return null;
  const text = String(match[2] || "").trim();
  if (!text) return null;
  const mark = match[1];
  return { kind: "item", checked: mark === "x" || mark === "X", text };
}

function parseNextLines(raw: string): NextItem[] {
  const lines = String(raw).split(/\r?\n/);
  const items: NextItem[] = [];
  let started = false;
  for (const rawLine of lines) {
    const parsed = parseNextLine(rawLine);
    if (!parsed) {
      if (!started) continue;
      if (items.length && items[items.length - 1]?.kind !== "blank") items.push({ kind: "blank" });
      continue;
    }
    started = true;
    items.push(parsed);
  }
  while (items.length && items[items.length - 1]?.kind === "blank") items.pop();
  return items;
}

/** 「次回」に入れた文字。1 行目だけを使い、先頭の「- [ ]」などは外す。 */
export function submittedNextText(raw: string | null | undefined): string {
  const first = String(raw ?? "").split(/\r?\n/)[0] ?? "";
  const parsed = parseNextLine(first);
  return parsed && parsed.kind === "item" ? parsed.text : "";
}

/** 見出しの下（次の「## 」の手前まで）の文字。見出しが無ければ null。 */
function sectionBody(source: string, headingRe: RegExp): string | null {
  const m = headingRe.exec(source);
  if (!m) return null;
  const after = source.slice(m.index + m[0].length);
  const nextH = /^## /m.exec(after);
  return nextH ? after.slice(0, nextH.index) : after;
}

export function sectionNextItems(source: string): NextItem[] {
  const section = sectionBody(source, NEXT_HEADING_RE);
  return section === null ? [] : parseNextLines(section);
}

function formatNextSection(items: NextItem[]): string {
  return items
    .map((item) => {
      if (item.kind === "blank") return "";
      return item.checked ? `- [x] ${item.text}` : `- [ ] ${item.text}`;
    })
    .join("\n");
}

/** 「次の一手」に行が 1 つ以上あり、全部チェック済みか。 */
export function allNextChecked(source: string): boolean {
  const items = sectionNextItems(source).filter((item) => item.kind === "item");
  return items.length > 0 && items.every((item) => item.kind === "item" && item.checked);
}

function firstOpenNext(items: NextItem[]): string {
  for (const item of items) {
    if (item.kind === "item" && !item.checked) return item.text;
  }
  return "";
}

/** 「次の一手」の、チェックしていない一番上の文言（「次回」の欄に最初から入れる）。無ければ空。 */
export function currentNextAction(source: string): string {
  return firstOpenNext(sectionNextItems(source));
}

/** 「いまやること」の最初の中身 1 行（先頭の「-」は外す）。見出しが無いか空なら空。 */
export function currentLabel(source: string): string {
  const section = sectionBody(source, CURRENT_HEADING_RE);
  if (section === null) return "";
  for (const raw of section.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    return line.replace(/^-+\s*/, "").trim();
  }
  return "";
}

function writeNextSection(source: string, items: NextItem[]): string {
  if (!items.some((item) => item.kind === "item")) return source;
  const line = formatNextSection(items);
  const m = NEXT_HEADING_RE.exec(source);
  if (m) {
    const headingEnd = m.index + m[0].length;
    const after = source.slice(headingEnd);
    const nextH = /^## /m.exec(after);
    const sectionEnd = nextH ? headingEnd + nextH.index : source.length;
    const before = source.slice(0, headingEnd);
    const afterSection = source.slice(sectionEnd);
    if (!afterSection) return before + "\n\n" + line + "\n";
    return before + "\n\n" + line + "\n\n" + afterSection;
  }

  const block = `## ${HABIT_MEMO_NEXT_HEADING}\n\n${line}\n`;
  const logM = LOG_HEADING_RE.exec(source);
  if (logM) {
    let prefix = source.slice(0, logM.index);
    if (prefix.length > 0 && !prefix.endsWith("\n")) prefix += "\n";
    return prefix + `## ${HABIT_MEMO_NEXT_HEADING}\n\n${line}\n\n` + source.slice(logM.index);
  }
  if (source.length === 0) return block;
  const pad = source.endsWith("\n") ? "" : "\n";
  return `${source}${pad}\n${block}`;
}

/** チェックしていない一番上の行の文言だけを差し替える。無ければ末尾に「- [ ]」で足す。文言が空なら何もしない。 */
export function replaceFirstOpenNext(source: string, text: string): string {
  const wording = text.trim();
  if (!wording) return source;
  const items = sectionNextItems(source);
  let replaced = false;
  for (const item of items) {
    if (item.kind === "item" && !item.checked) {
      item.text = wording;
      replaced = true;
      break;
    }
  }
  if (!replaced) items.push({ kind: "item", checked: false, text: wording });
  return writeNextSection(source, items);
}

/** 「## ログ」の見出しのすぐ下に 1 行入れる。見出しが無ければ末尾に作る。 */
export function insertAfterLogHeading(source: string, line: string): string {
  const m = LOG_HEADING_RE.exec(source);
  if (!m) {
    const pad = source.endsWith("\n") || source.length === 0 ? "" : "\n";
    return `${source}${pad}\n## ${HABIT_MEMO_LOG_HEADING}\n\n${line}\n`;
  }
  const headingEnd = m.index + m[0].length;
  let j = headingEnd;
  while (j < source.length && (source[j] === "\n" || source[j] === "\r")) j++;
  return source.slice(0, headingEnd) + "\n\n" + line + "\n" + source.slice(j);
}

function yamlQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function titleMark(existingTitle: string): string {
  const existing = existingTitle.trim();
  return TITLE_MARKS.find((mark) => existing.startsWith(mark)) ?? "";
}

function titleText(basename: string, next: string, existingTitle: string, leftOverride: string): string {
  const left = leftOverride.trim() || basename;
  const mark = titleMark(existingTitle);
  const name = mark && !left.startsWith(mark) ? `${mark}${left}` : left;
  if (!next) return name;
  const action = next.replace(/\r?\n/g, " ").trim();
  return `${name}｜${action}`;
}

function frontmatterBounds(source: string): { bodyStart: number; bodyEnd: number } | null {
  if (!source.startsWith("---")) return null;
  const nl = source.indexOf("\n");
  if (nl === -1) return null;
  if (source.slice(0, nl).replace(/\r$/, "") !== "---") return null;
  const rest = source.slice(nl + 1);
  const close = rest.search(/^---[ \t]*\r?$/m);
  if (close === -1) return null;
  const bodyStart = nl + 1;
  return { bodyStart, bodyEnd: bodyStart + close };
}

interface TitleLineInfo {
  bounds: { bodyStart: number; bodyEnd: number } | null;
  hasValue: boolean;
  value: string;
  lineStart?: number;
  lineEnd?: number;
}

function titleLineInfo(source: string): TitleLineInfo {
  const bounds = frontmatterBounds(source);
  if (!bounds) return { bounds: null, hasValue: false, value: "" };
  const body = source.slice(bounds.bodyStart, bounds.bodyEnd);
  const match = /^title:[ \t]*([^\r\n]*)$/m.exec(body);
  if (!match) return { bounds, hasValue: false, value: "" };
  const raw = (match[1] ?? "").trim();
  let value = raw;
  if (
    (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) ||
    (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2)
  ) {
    value = raw.slice(1, -1);
  }
  return {
    bounds,
    hasValue: value.trim() !== "",
    value,
    lineStart: bounds.bodyStart + match.index,
    lineEnd: bounds.bodyStart + match.index + match[0].length,
  };
}

/**
 * frontmatter の title を書く。右側は next（空なら左側だけ）。左側は leftOverride、空ならファイル名。
 * 既存の title の先頭の ★ ◆ ◎ は残す。next が空で title がもうあるときは、forceLeftOnly のときだけ書き換える。
 */
export function upsertTitle(
  source: string,
  basename: string,
  next: string,
  leftOverride: string,
  forceLeftOnly: boolean
): string {
  const info = titleLineInfo(source);
  if (!next && info.hasValue && !forceLeftOnly) return source;
  const line = `title: ${yamlQuote(titleText(basename, next, info.value, leftOverride))}`;
  if (!info.bounds) {
    const body = source.length === 0 || source.startsWith("\n") ? source : `\n${source}`;
    return `---\n${line}\n---\n${body}`;
  }
  if (info.lineStart !== undefined && info.lineEnd !== undefined) {
    return source.slice(0, info.lineStart) + line + source.slice(info.lineEnd);
  }
  const before = source.slice(0, info.bounds.bodyEnd);
  const pad = before.endsWith("\n") ? "" : "\n";
  return before + pad + line + "\n" + source.slice(info.bounds.bodyEnd);
}

/** 画面で入力された中身。memo は normalizeHabitMemo、next は submittedNextText を通したもの。 */
export interface HabitMemoInput {
  memo: string;
  next: string;
}

/** 入力を整える。メモも次回も空なら null（何も書かない）。 */
export function prepareHabitMemoInput(memoRaw: string, nextRaw: string): HabitMemoInput | null {
  const memo = normalizeHabitMemo(memoRaw);
  const next = submittedNextText(nextRaw);
  if (!memo && !next) return null;
  return { memo, next };
}

/**
 * 習慣のノートの新しい中身。スクリプト「感想メモ」と同じ順で書く。
 * 1. 次回があれば、チェックしていない一番上の行を差し替える（無ければ足す）
 * 2. title を書き直す
 * 3. メモがあれば「## ログ」のすぐ下に「- 日付 メモ」と「--- 」を入れる
 */
export function applyHabitMemo(
  source: string,
  input: HabitMemoInput & { basename: string; date: string }
): string {
  const { memo, next, basename, date } = input;
  const withNext = next ? replaceFirstOpenNext(source, next) : source;
  const checkedDone = !next && allNextChecked(withNext);
  const titleAction = next ? currentNextAction(withNext) : "";
  const left = next || checkedDone ? currentLabel(withNext) : "";
  let content = upsertTitle(withNext, basename, titleAction, left, checkedDone);
  if (memo) content = insertAfterLogHeading(content, `- ${date} ${memo}\n--- `);
  return content;
}

/** 時刻を HH:mm にする。 */
export function formatMemoTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 日次ログに足す 1 件（例：「- 07:30 [[腕立て]] メモ」と「--- 」）。 */
export function buildDailyLogEntry(time: string, link: string, memo: string): string {
  return `- ${time} ${link} ${memo}\n--- \n`;
}

/** 日次ログがまだ無いときに作る中身（frontmatter・前の日と次の日へのリンク・1 件目）。 */
export function buildNewDailyLog(date: string, entry: string): string {
  const nextDate = shiftDateKey(date, 1);
  const prevDate = shiftDateKey(date, -1);
  return `---\nStart: ${date}\nEnd: ${nextDate}\n---\n` + `[[${prevDate}]] ｜ [[${nextDate}]]\n\n\n${entry}`;
}

/** もうある日次ログの末尾に 1 件足す。最後に改行が無ければ足してから書く。 */
export function appendDailyLogEntry(data: string, entry: string): string {
  const base = data.endsWith("\n") ? data : data + "\n";
  return base + entry;
}

/** 書いたあとに出すお知らせ。スマホでは Synctrain で同期するよう伝え、長めに出す。 */
export function habitMemoNotice(
  hasMemo: boolean,
  isMobile: boolean
): {
  key: "notice.habitMemoMobile" | "notice.habitMemoSaved" | "notice.habitNextMobile" | "notice.habitNextSaved";
  duration?: number;
} {
  if (hasMemo && isMobile) return { key: "notice.habitMemoMobile", duration: 8000 };
  if (hasMemo) return { key: "notice.habitMemoSaved" };
  if (isMobile) return { key: "notice.habitNextMobile", duration: 8000 };
  return { key: "notice.habitNextSaved" };
}

/** 「## ログ」の 1 件の区切り（「--- 」または「---」）。 */
const LOG_SEPARATOR_RE = /^---[ \t]*$/;
/** 「- YYYY-MM-DD メモ」の先頭行。 */
const LOG_MEMO_ENTRY_RE = /^- (\d{4}-\d{2}-\d{2})(?:[ \t]+(.*))?$/;

/** 習慣ノートの「## ログ」から読み取った、いちばん新しいメモ。 */
export interface PreviousHabitMemo {
  date: string;
  text: string;
}

/**
 * 「## ログ」のいちばん上（いちばん新しい）の「- YYYY-MM-DD メモ」を取り出す。
 * 2 行目から字下げした続きも、同じ 1 件として入れる。区切りの「--- 」の手前まで。
 * 見出しが無い・中が空・日付のある行が無いときは null。
 */
export function parsePreviousHabitMemo(source: string): PreviousHabitMemo | null {
  const section = sectionBody(source, LOG_HEADING_RE);
  if (section === null) return null;
  const lines = section.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (LOG_SEPARATOR_RE.test(line)) {
      i += 1;
      continue;
    }
    const match = LOG_MEMO_ENTRY_RE.exec(line);
    if (!match) {
      i += 1;
      continue;
    }
    const date = match[1] ?? "";
    const parts: string[] = [];
    const first = (match[2] ?? "").trim();
    if (first) parts.push(first);
    i += 1;
    while (i < lines.length) {
      const raw = lines[i] ?? "";
      if (LOG_SEPARATOR_RE.test(raw)) break;
      if (/^[ \t]+/.test(raw) && raw.trim() !== "") {
        parts.push(raw.trim());
        i += 1;
        continue;
      }
      break;
    }
    const text = parts.join("\n");
    if (text) return { date, text };
  }
  return null;
}

/** 前回のメモの日付を「M月D日」にする（例：11月18日）。形式が違えばそのまま返す。 */
export function formatPreviousMemoDate(date: string): string {
  const parsed = parseDateKey(date);
  if (!parsed) return date;
  return `${parsed.month}月${parsed.day}日`;
}

/** 前回のメモを、画面用に最大 3 行までに整える。超えたら末尾に「…」を付け、全文は呼び出し側のツールチップに出す。 */
export const PREVIOUS_MEMO_PREVIEW_LINES = 3;

export function previewHabitMemoText(
  text: string,
  maxLines = PREVIOUS_MEMO_PREVIEW_LINES
): { preview: string; truncated: boolean } {
  const lines = String(text).split(/\r?\n/);
  if (lines.length <= maxLines) return { preview: text, truncated: false };
  return { preview: `${lines.slice(0, maxLines).join("\n")}…`, truncated: true };
}
