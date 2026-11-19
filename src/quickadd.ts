import { splitTitle } from "./note-template";

/** QuickAdd のプラグインID（QuickAdd 2.33.3 の manifest.json で確認）。 */
export const QUICKADD_PLUGIN_ID = "quickadd";

/** QuickAdd の「Multi」（フォルダのように、ほかの選択肢をまとめるもの）の種類の名前。 */
const QUICKADD_MULTI_TYPE = "Multi";

/** Obsidian の公開型にない app.plugins のうち、QuickAdd で使う部分だけ。 */
export interface QuickAddHost {
  plugins?: {
    enabledPlugins?: Set<string>;
    plugins?: Record<
      string,
      | {
          settings?: { choices?: unknown };
          api?: {
            executeChoice?: (choice: string, variables?: Record<string, unknown>) => Promise<unknown>;
          };
        }
      | undefined
    >;
  };
}

/** 設定に保存した QuickAdd の選択肢の名前を整える。文字列でなければ空（＝使わない）。前後の空白は取る。 */
export function normalizeQuickAddChoiceName(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * QuickAdd の設定の choices から、実行できる選択肢（Template・Capture・Macro など）の名前を集める。
 * Multi の中に入っているものも、深さを問わず集める。Multi そのものは入れない。
 * 並びは QuickAdd の設定の一覧と同じ順。同じ名前は 1 つにまとめ、空の名前は入れない。
 * 形が崩れたもの（null や配列でないもの）は飛ばす。
 */
export function listQuickAddChoiceNames(choices: unknown): string[] {
  const names: string[] = [];
  const walk = (list: unknown, depth: number) => {
    if (!Array.isArray(list) || depth > 20) return;
    for (const item of list as unknown[]) {
      if (!item || typeof item !== "object") continue;
      const choice = item as { name?: unknown; type?: unknown; choices?: unknown };
      if (choice.type === QUICKADD_MULTI_TYPE) {
        walk(choice.choices, depth + 1);
        continue;
      }
      if (typeof choice.name !== "string") continue;
      const name = choice.name.trim();
      if (name && !names.includes(name)) names.push(name);
    }
  };
  walk(choices, 0);
  return names;
}

/** 名前の選択肢が、QuickAdd の設定にあるか（Multi の中も探す）。QuickAdd と同じく、名前はそのまま比べる。 */
export function hasQuickAddChoice(choices: unknown, name: string): boolean {
  const target = name.trim();
  return target !== "" && listQuickAddChoiceNames(choices).includes(target);
}

/** 入力中の文字で、選択肢の名前をしぼる。大文字・小文字は区別しない。空なら全部。 */
export function filterQuickAddChoiceNames(names: string[], query: string): string[] {
  const text = query.trim().toLowerCase();
  if (!text) return [...names];
  return names.filter((name) => name.toLowerCase().includes(text));
}

/**
 * QuickAdd に渡す変数。ユーザーのスクリプトでは params.variables.habitPath などで読める。
 * habitTitle は「｜」より前の名前、habitNextAction は「｜」より後ろ（今の次の一手。なければ空）。
 * habitDate は記録した日（YYYY-MM-DD）。
 */
export function buildHabitQuickAddVariables(habit: {
  path: string;
  title: string;
  date: string;
}): Record<string, string> {
  const { name, nextAction } = splitTitle(habit.title);
  return {
    habitPath: habit.path,
    habitTitle: name || habit.title.trim(),
    habitNextAction: nextAction,
    habitDate: habit.date,
  };
}

/** 有効になっている QuickAdd の executeChoice。QuickAdd が無い・無効・API が無いときは null。 */
export function getQuickAddExecuteChoice(
  host: QuickAddHost
): ((choice: string, variables?: Record<string, unknown>) => Promise<unknown>) | null {
  if (!host.plugins?.enabledPlugins?.has(QUICKADD_PLUGIN_ID)) return null;
  const plugin = host.plugins.plugins?.[QUICKADD_PLUGIN_ID];
  let api: NonNullable<NonNullable<typeof plugin>["api"]> | undefined;
  try {
    api = plugin?.api;
  } catch {
    return null;
  }
  const execute = api?.executeChoice;
  return typeof execute === "function" ? execute.bind(api) : null;
}

/** QuickAdd の設定にある選択肢（choices）。QuickAdd が無ければ undefined。 */
export function getQuickAddChoices(host: QuickAddHost): unknown {
  return host.plugins?.plugins?.[QUICKADD_PLUGIN_ID]?.settings?.choices;
}
