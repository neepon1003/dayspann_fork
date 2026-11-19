/**
 * PJ-span で新しく登録するノートのひな形（タイトルの後ろの言葉・notetoolbar・本文の見出し）。
 * 新しく登録するときだけ使い、すでにある記録の編集では使わない。
 */

/** 新しいノートのタイトルの後ろに付ける言葉。区切りは全角の ｜（U+FF5C）。 */
export const NEW_NOTE_TITLE_SUFFIX = "｜プロジェクトノート作成";

/** 新しいノートの notetoolbar（Note Toolbar プラグインのツールバー名）。 */
export const NEW_NOTE_TOOLBAR = ["btn"];

/** 新しいノートの本文の見出し。登録画面の「残しておく文章」は「概要」の下に入る。 */
export const NEW_NOTE_HEADINGS = ["概要", "次の一手", "ログ"] as const;

/** 名前の後ろに「｜プロジェクトノート作成」を付ける。もう付いていれば、そのまま。 */
export function buildNewNoteTitle(name: string): string {
  const trimmed = name.trim();
  return trimmed.endsWith(NEW_NOTE_TITLE_SUFFIX) ? trimmed : `${trimmed}${NEW_NOTE_TITLE_SUFFIX}`;
}

/** カードに出すタイトル。「｜」より前の名前。名前が空になるときは元のタイトルを出す。 */
export function displayTitle(title: string): string {
  return splitTitle(title).name || title;
}

/** 新しいノートの本文。「概要」「次の一手」「ログ」の見出しを作り、残しておく文章は「概要」の下に入れる。 */
export function buildNewNoteBody(excerpt: string): string {
  const text = excerpt.trim();
  const [summary, ...rest] = NEW_NOTE_HEADINGS;
  const sections = [`## ${summary}`];
  if (text) sections.push(text);
  for (const heading of rest) sections.push(`## ${heading}`);
  return sections.join("\n\n");
}

/** カードに出す抜き書き。本文から見出しの行を外して、1 行にまとめる。 */
export function excerptForCard(body: string): string {
  return body
    .split(/\r?\n/)
    .filter((line) => !/^#{1,6}\s/.test(line.trim()))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface SplitTitle {
  name: string;
  nextAction: string;
}

/**
 * タイトルを、最初の全角「｜」（U+FF5C）の前（名前）と後ろ（次の一手）に分ける。
 * 「｜」がなければ次の一手は空。後ろが空なら次の一手は空。2つ目以降の「｜」は次の一手に残す。
 */
export function splitTitle(title: string): SplitTitle {
  const index = title.indexOf("｜");
  if (index < 0) return { name: title.trim(), nextAction: "" };
  return {
    name: title.slice(0, index).trim(),
    nextAction: title.slice(index + "｜".length).trim(),
  };
}

/** 新しく登録したときの次の一手の初期値（NEW_NOTE_TITLE_SUFFIX の「｜」より後ろ）。 */
export const DEFAULT_NEXT_ACTION = NEW_NOTE_TITLE_SUFFIX.slice("｜".length);

/** 名前と次の一手を、全角「｜」でつなげる。次の一手が空なら名前だけ。 */
export function joinTitle(name: string, nextAction: string): string {
  const trimmedName = name.trim();
  const trimmedNext = nextAction.trim();
  return trimmedNext ? `${trimmedName}｜${trimmedNext}` : trimmedName;
}

/**
 * 習慣のカードに出す次の一手。
 * 新しく登録したときの初期値「プロジェクトノート作成」は、習慣には出さない。
 */
export function habitNextAction(title: string): string {
  const nextAction = splitTitle(title).nextAction;
  return nextAction === DEFAULT_NEXT_ACTION ? "" : nextAction;
}

/**
 * 習慣の title を、名前と次の一手から組む。
 * nextAction を渡したときはそれを使い、渡さなければ名前の「｜」より後ろを使う。
 * 初期値「プロジェクトノート作成」は付けない。
 */
export function buildHabitTitle(name: string, nextAction?: string): string {
  const parts = splitTitle(name);
  const next = nextAction !== undefined ? nextAction.trim() : parts.nextAction;
  return joinTitle(parts.name, habitNextAction(joinTitle(parts.name, next)));
}
