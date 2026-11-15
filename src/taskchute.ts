import { readDateKey } from "./date-utils";

/** TaskChute Plus のプラグインID・コマンドID・ビューの種類（TaskChute Plus 3.0.3 のソースで確認）。 */
export const TASKCHUTE_PLUGIN_ID = "taskchute-plus";
export const TASKCHUTE_SHOW_TODAY_COMMAND = "taskchute-plus:show-today-tasks";
export const TASKCHUTE_VIEW_TYPE = "taskchute-view";
/** TaskChute のタスクフォルダの既定値（設定で場所を変えていないとき。PathService.getTaskFolderPath）。 */
export const TASKCHUTE_DEFAULT_TASK_FOLDER = "TaskChute/Task";

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
  plugins?: {
    enabledPlugins?: Set<string>;
    plugins?: Record<string, { pathManager?: { getTaskFolderPath?: () => unknown } } | undefined>;
  };
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

/** TaskChute Plus が有効か。 */
export function isTaskChuteEnabled(host: Pick<TaskChuteHost, "plugins">): boolean {
  return host.plugins?.enabledPlugins?.has(TASKCHUTE_PLUGIN_ID) === true;
}

/** TaskChute がタスクを読むフォルダ。TaskChute から聞けなければ既定の TaskChute/Task。 */
export function getTaskChuteTaskFolder(host: Pick<TaskChuteHost, "plugins">): string {
  try {
    const path = host.plugins?.plugins?.[TASKCHUTE_PLUGIN_ID]?.pathManager?.getTaskFolderPath?.();
    if (typeof path === "string" && path.trim()) return trimFolder(path);
  } catch {
    // TaskChute の中の作りが変わっていても、既定のフォルダで続ける。
  }
  return TASKCHUTE_DEFAULT_TASK_FOLDER;
}

/**
 * TaskChute と同じ形の taskId（tc-task- ＋ UUID）を作る。TaskChute の TaskIdManager.generateTaskId と同じ作り方。
 * UUID を作れない環境（randomUUID が null）では、TaskChute と同じく時刻＋乱数で作る。
 */
export function generateTaskChuteTaskId(randomUUID: (() => string) | null): string {
  if (randomUUID) return `tc-task-${randomUUID()}`;
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `tc-task-${timestamp}-${random}`;
}

/** 新しく登録した記録を TaskChute のタスクにして、今日の一覧に入れるための frontmatter の項目。 */
export interface TaskChuteNewTaskFields {
  target_date: string;
  taskId: string;
  tags: string[];
}

/** target_date は TaskChute と同じ YYYY-MM-DD（TaskChute は今日の日付と文字のまま比べる）。 */
export function buildTaskChuteFields(todayKey: string, taskId: string): TaskChuteNewTaskFields {
  return { target_date: todayKey, taskId, tags: ["task"] };
}

/**
 * 新しい記録を置くフォルダを決める。
 * PJ-span は記録フォルダ（とその下）だけを、TaskChute はタスクフォルダ（とその下）だけを読むので、
 * 両方から見える場所を選ぶ。どちらからも見える場所がなければ、PJ-span の記録フォルダに置き、
 * visibleToTaskChute を false にする。
 */
export function chooseNewRecordFolder(
  storageFolder: string,
  taskFolder: string
): { folder: string; visibleToTaskChute: boolean } {
  const storage = trimFolder(storageFolder);
  const task = trimFolder(taskFolder);
  if (isSameOrInside(storage, task)) return { folder: storage, visibleToTaskChute: true };
  if (isSameOrInside(task, storage)) return { folder: task, visibleToTaskChute: true };
  return { folder: storage, visibleToTaskChute: false };
}

function trimFolder(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

/** child が parent と同じか、parent の下のフォルダか（parent が空ならボールト全体）。 */
function isSameOrInside(child: string, parent: string): boolean {
  if (!parent) return true;
  return child === parent || child.startsWith(`${parent}/`);
}
