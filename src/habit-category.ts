/**
 * 習慣の分類（frontmatter の category）。
 * 習慣タブの見出しを分けるときに使う。空なら「その他」に入れる。
 */

/** frontmatter の category を読む。文字なら整えて返し、リストなら最初の空でない項目、それ以外は空文字。 */
export function readCategory(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && item.trim()) return item.trim();
    }
  }
  return "";
}

export interface HabitCategoryGroup<T> {
  /** 分類の名前。空なら分類なし（「その他」）。 */
  category: string;
  items: T[];
}

/**
 * 習慣を分類ごとにまとめる。分類のある見出しは名前順（日本語）、分類のないものは最後。
 * 同じ分類の中では、渡されたときの順番を保つ。
 */
export function groupHabitsByCategory<T extends { category?: string }>(
  habits: T[]
): HabitCategoryGroup<T>[] {
  const named = new Map<string, T[]>();
  const uncategorized: T[] = [];
  for (const habit of habits) {
    const category = habit.category?.trim() ?? "";
    if (!category) {
      uncategorized.push(habit);
      continue;
    }
    const list = named.get(category);
    if (list) list.push(habit);
    else named.set(category, [habit]);
  }
  const groups = [...named.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "ja"))
    .map(([category, items]) => ({ category, items }));
  if (uncategorized.length) groups.push({ category: "", items: uncategorized });
  return groups;
}
