import { differenceInCalendarDays, parseDateKey } from "./date-utils";

export function calculateProgress(
  dateKey: string,
  deadlineKey: string,
  todayKey: string
): number | null {
  if (!parseDateKey(dateKey) || !parseDateKey(deadlineKey)) return null;

  const total = differenceInCalendarDays(deadlineKey, dateKey);
  if (total <= 0) return null;

  const elapsed = differenceInCalendarDays(todayKey, dateKey);
  const percent = Math.round((elapsed / total) * 100);
  return Math.min(100, Math.max(0, percent));
}
