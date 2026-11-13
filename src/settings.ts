export type DayspannSectionKind = "future" | "today" | "past";

export const DEFAULT_SECTION_ORDER: DayspannSectionKind[] = ["today", "future", "past"];

export const DEFAULT_SOON_DAYS = 7;
export const MAX_SOON_DAYS = 365;

/** 「もうすぐ」の日数を読み取る。0〜365 の整数だけを受け付け、それ以外は null。 */
export function parseSoonDays(value: unknown): number | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(text)) return null;
  const days = Number(text);
  return days <= MAX_SOON_DAYS ? days : null;
}

const SECTION_KINDS = new Set<DayspannSectionKind>(DEFAULT_SECTION_ORDER);

export function normalizeCollapsedSections(value: unknown): DayspannSectionKind[] {
  if (!Array.isArray(value)) return [];

  const normalized: DayspannSectionKind[] = [];
  for (const item of value) {
    if (typeof item === "string" && SECTION_KINDS.has(item as DayspannSectionKind)) {
      const kind = item as DayspannSectionKind;
      if (!normalized.includes(kind)) normalized.push(kind);
    }
  }
  return normalized;
}

export function normalizeSectionOrder(value: unknown): DayspannSectionKind[] {
  const normalized: DayspannSectionKind[] = [];

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && SECTION_KINDS.has(item as DayspannSectionKind)) {
        const kind = item as DayspannSectionKind;
        if (!normalized.includes(kind)) normalized.push(kind);
      }
    }
  }

  for (const kind of DEFAULT_SECTION_ORDER) {
    if (!normalized.includes(kind)) normalized.push(kind);
  }

  return normalized;
}
