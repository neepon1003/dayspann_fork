import { parseYaml, stringifyYaml, TFile } from "obsidian";
import {
  DEFAULT_DISPLAY_MODE,
  DayspannDisplayMode,
  normalizeDisplayMode,
  parseDateKey,
  readDateKey,
} from "./date-utils";
import { formatSourceReference, parseSourceReference } from "./source-link";

export interface DayspannRecord {
  file: TFile;
  title: string;
  date: string;
  displayMode: DayspannDisplayMode;
  archived: boolean;
  completed?: string;
  excerpt: string;
  sourcePath?: string;
  sourceLine?: number;
  created: string;
}

export interface DayspannDraft {
  title: string;
  date: string;
  displayMode?: DayspannDisplayMode;
  archived?: boolean;
  completed?: string;
  excerpt: string;
  sourcePath?: string;
  sourceLine?: number;
  created?: string;
}

export function serializeRecord(draft: DayspannDraft): string {
  const frontmatter: Record<string, string | number | boolean> = {
    type: "project",
    title: draft.title.trim(),
    date: draft.date,
    display: draft.displayMode ?? DEFAULT_DISPLAY_MODE,
    created: draft.created ?? new Date().toISOString(),
  };

  if (draft.archived) frontmatter.archived = true;
  if (draft.completed) frontmatter.completed = draft.completed;
  if (draft.sourcePath) frontmatter.source = formatSourceReference(draft.sourcePath);
  if (typeof draft.sourceLine === "number") frontmatter.sourceLine = draft.sourceLine;

  const yaml = stringifyYaml(frontmatter).replace(/\s+$/, "");
  const body = draft.excerpt.trim();
  return `---\n${yaml}\n---\n${body ? `\n${body}\n` : ""}`;
}

export function parseRecord(file: TFile, content: string): DayspannRecord | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(content);
  if (!match || match[1] === undefined || match[2] === undefined) return null;

  let data: Record<string, unknown>;
  try {
    data = parseYaml(match[1]) as Record<string, unknown>;
  } catch {
    return null;
  }

  // Also read records made before the rename to PJ-span ("dayspann"), pre-0.1.7 beta records ("dayspan"), and the previous PJ-span type ("pj-span").
  if (
    data.type !== "project" &&
    data.type !== "pj-span" &&
    data.type !== "dayspann" &&
    data.type !== "dayspan"
  ) {
    return null;
  }
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const rawDate =
    data.date instanceof Date
      ? data.date.toISOString().slice(0, 10)
      : typeof data.date === "string"
        ? data.date.trim()
        : "";
  const date = parseDateKey(rawDate) ? rawDate : "";
  if (!title || (rawDate && !date)) return null;

  const sourceLine = Number(data.sourceLine);
  return {
    file,
    title,
    date,
    displayMode: normalizeDisplayMode(data.display),
    archived: data.archived === true,
    completed: readDateKey(data.completed) || undefined,
    excerpt: match[2].trim(),
    sourcePath: parseSourceReference(data.source),
    sourceLine: Number.isInteger(sourceLine) && sourceLine > 0 ? sourceLine : undefined,
    created: typeof data.created === "string" ? data.created : "",
  };
}

export function makeTitleFromSelection(
  selection: string,
  fallback = "新しい記録"
): string {
  const firstLine = selection
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? fallback;

  const plain = firstLine
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+>]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/!?(\[([^\]]+)\])\([^)]*\)/g, "$2")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, alias?: string) => alias ?? target)
    .replace(/[*_~`=]/g, "")
    .trim();

  return plain.length > 48 ? `${plain.slice(0, 47)}…` : plain || fallback;
}

export function sanitizeFileName(title: string, fallback = "記録"): string {
  const sanitized = title
    .replace(/[\\/:*?"<>|#^]/g, " ")
    .replaceAll("[", " ")
    .replaceAll("]", " ")
    .replace(/\s+/g, " ")
    .replace(/^\.+|\.+$/g, "")
    .trim();
  return (sanitized || fallback).slice(0, 60);
}
