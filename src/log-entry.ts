/**
 * ノート本文の「ログ」見出しの下に、完了などの行を足す。
 * frontmatter は触らず、本文だけを対象にする。
 */

/** 「ログ」見出し（# の数は問わない）に合うか。合うときは見出しのレベルを返す。 */
function logHeadingLevel(line: string): number | null {
  const match = /^(#{1,6})\s+ログ(?:\s+#*)?\s*$/.exec(line);
  return match?.[1] ? match[1].length : null;
}

/** 見出しのレベル。見出しでなければ null。 */
function headingLevel(line: string): number | null {
  const match = /^(#{1,6})\s+\S/.exec(line);
  return match?.[1] ? match[1].length : null;
}

/**
 * 本文の「ログ」見出しのいちばん下に 1 行を足す。
 * 見出しがなければ、末尾に「## ログ」を作ってから足す。
 * 次の「同じかそれより上のレベルの見出し」の手前が、その見出しの終わり。
 */
export function appendLogLine(body: string, line: string): string {
  const newline = body.includes("\r\n") ? "\r\n" : "\n";
  const normalized = body.replace(/\r\n/g, "\n");
  const trailingNewline = normalized.endsWith("\n");
  const lines = normalized === "" ? [] : normalized.replace(/\n$/, "").split("\n");

  let headingIndex = -1;
  let level = 2;
  for (let index = 0; index < lines.length; index++) {
    const found = logHeadingLevel(lines[index] ?? "");
    if (found !== null) {
      headingIndex = index;
      level = found;
      break;
    }
  }

  if (headingIndex < 0) {
    const prefix = body === "" ? "" : `${body.replace(/\r?\n$/, "")}${newline}`;
    return `${prefix}## ログ${newline}${line}${newline}`;
  }

  let sectionEnd = lines.length;
  for (let index = headingIndex + 1; index < lines.length; index++) {
    const nextLevel = headingLevel(lines[index] ?? "");
    if (nextLevel !== null && nextLevel <= level) {
      sectionEnd = index;
      break;
    }
  }

  let insertAt = sectionEnd;
  while (insertAt > headingIndex + 1 && (lines[insertAt - 1] ?? "") === "") insertAt--;
  lines.splice(insertAt, 0, line);

  let result = lines.join(newline);
  if (trailingNewline) result += newline;
  return result;
}

/** ファイル全体のうち、frontmatter の後ろの本文に 1 行を足す。frontmatter はそのまま。 */
export function appendLogLineToFile(content: string, line: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) return appendLogLine(content, line);
  return `${match[0]}${appendLogLine(content.slice(match[0].length), line)}`;
}
