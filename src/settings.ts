export type DayspannSectionKind = "future" | "today" | "past";

export const DEFAULT_SECTION_ORDER: DayspannSectionKind[] = ["today", "future", "past"];

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
