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

/** カードに出すタイトル。後ろの「｜プロジェクトノート作成」を外す（外すと空になるときは外さない）。 */
export function displayTitle(title: string): string {
  if (!title.endsWith(NEW_NOTE_TITLE_SUFFIX)) return title;
  return title.slice(0, -NEW_NOTE_TITLE_SUFFIX.length).trim() || title;
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
