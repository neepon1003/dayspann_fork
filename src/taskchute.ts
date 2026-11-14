import { readDateKey } from "./date-utils";

/** TaskChute Plus のプラグインID・コマンドID・ビューの種類（TaskChute Plus 3.0.3 のソースで確認）。 */
export const TASKCHUTE_PLUGIN_ID = "taskchute-plus";
export const TASKCHUTE_SHOW_TODAY_COMMAND = "taskchute-plus:show-today-tasks";
export const TASKCHUTE_VIEW_TYPE = "taskchute-view";

/** frontmatter の tags に「task」があるか。配列・文字列（カンマ/空白区切り）どちらも、先頭の # の有無も問わない。 */
export function hasTaskTag(tags: unknown): boolean {
  const values = Array.isArray(tags)
    ? tags
    : typeof tags === "string"
      ? tags.split(/[,\s]+/)
      : [];
  return values.some(
    (tag) => typeof tag === "string" && tag.trim().replace(/^#/, "").toLowerCase() === "task"
  );
}

/** TaskChute のタスクノートか（tags に task がある、または taskId / 旧 taskchuteId がある）。 */
export function isTaskChuteTask(frontmatter: Record<string, unknown>): boolean {
  if (hasTaskTag(frontmatter.tags)) return true;
  return [frontmatter.taskId, frontmatter.taskchuteId].some(
    (id) => typeof id === "string" && id.trim() !== ""
  );
}

/** frontmatter の target_date を YYYY-MM-DD で返す（無い・形式違いなら undefined）。 */
export function readTargetDate(value: unknown): string | undefined {
  return readDateKey(value) || undefined;
}

/** Obsidian の公開型にない app.plugins / app.commands のうち、使う部分だけ。 */
export interface TaskChuteHost {
  plugins?: { enabledPlugins?: Set<string> };
  commands?: {
    commands?: Record<string, unknown>;
    executeCommandById?: (id: string) => boolean;
  };
  workspace: { getLeavesOfType(type: string): unknown[] };
}

/**
 * TaskChute の画面を読み直してよいか。
 * プラグインが有効で、コマンドがあり、TaskChute の画面がすでに開いているときだけ true。
 * 画面が開いていないときにコマンドを呼ぶと、TaskChute が今のタブに画面を開いてしまうため呼ばない。
 */
export function canReloadTaskChuteView(host: TaskChuteHost): boolean {
  if (!host.plugins?.enabledPlugins?.has(TASKCHUTE_PLUGIN_ID)) return false;
  if (!host.commands?.commands?.[TASKCHUTE_SHOW_TODAY_COMMAND]) return false;
  if (typeof host.commands.executeCommandById !== "function") return false;
  return host.workspace.getLeavesOfType(TASKCHUTE_VIEW_TYPE).length > 0;
}
