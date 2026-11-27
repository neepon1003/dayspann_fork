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

/** TaskChute のセクション境界（カスタム時間帯設定の1項目）。 */
export interface TaskChuteSectionBoundary {
  hour: number;
  minute: number;
}

const DEFAULT_TASKCHUTE_SECTIONS: TaskChuteSectionBoundary[] = [
  { hour: 0, minute: 0 },
  { hour: 3, minute: 0 },
  { hour: 6, minute: 0 },
  { hour: 9, minute: 0 },
  { hour: 12, minute: 0 },
  { hour: 15, minute: 0 },
  { hour: 18, minute: 0 },
  { hour: 21, minute: 0 },
];

interface TaskChuteDayState {
  slotOverrides?: Record<string, string>;
  slotOverridesMeta?: Record<string, { slotKey: string; updatedAt: number }>;
  [key: string]: unknown;
}

interface TaskChuteDayStateService {
  getDateFromKey?: (dateKey: string) => Date;
  loadDay?: (date: Date) => Promise<TaskChuteDayState>;
  saveDay?: (date: Date, state: TaskChuteDayState) => Promise<void>;
}

/** Obsidian の公開型にない app.plugins / app.commands のうち、使う部分だけ。 */
export interface TaskChuteHost {
  plugins?: {
    enabledPlugins?: Set<string>;
    plugins?: Record<
      string,
      | {
          pathManager?: { getTaskFolderPath?: () => unknown; getLogDataPath?: () => unknown };
          settings?: { deviceId?: unknown; customSections?: unknown };
          dayStateService?: TaskChuteDayStateService;
        }
      | undefined
    >;
  };
  commands?: {
    commands?: Record<string, unknown>;
    executeCommandById?: (id: string) => boolean;
  };
  workspace: { getLeavesOfType(type: string): unknown[] };
}

/** frontmatter の scheduled_time に有効な HH:mm が入っているか。 */
export function hasScheduledTime(frontmatter: Record<string, unknown> | undefined): boolean {
  if (!frontmatter || frontmatter.scheduled_time == null) return false;
  const raw = typeof frontmatter.scheduled_time === "string" ? frontmatter.scheduled_time.trim() : "";
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

/** TaskChute Plus の customSections 設定から、現在時刻が属する時間帯枠（slotKey）を返す。 */
export function resolveCurrentTaskChuteSlotKey(
  customSections: unknown,
  now: Date = new Date()
): string {
  const rawList = Array.isArray(customSections) && customSections.length >= 2
    ? customSections
    : DEFAULT_TASKCHUTE_SECTIONS;
  const parsed: TaskChuteSectionBoundary[] = [];
  for (const item of rawList) {
    if (!item || typeof item !== "object") continue;
    const obj = item as { hour?: unknown; minute?: unknown };
    const hour = Number(obj.hour);
    const minute = Number(obj.minute);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) continue;
    parsed.push({
      hour: Math.max(0, Math.min(23, Math.floor(hour))),
      minute: Math.max(0, Math.min(59, Math.floor(minute))),
    });
  }
  const sorted = (parsed.length >= 2 ? parsed : DEFAULT_TASKCHUTE_SECTIONS)
    .slice()
    .sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  let matchedIndex = sorted.length - 1;
  for (let i = 0; i < sorted.length; i += 1) {
    const boundary = sorted[i];
    if (!boundary) continue;
    const startMinutes = boundary.hour * 60 + boundary.minute;
    if (nowMinutes >= startMinutes) matchedIndex = i;
  }
  const start = sorted[matchedIndex] ?? { hour: 0, minute: 0 };
  const end = sorted[(matchedIndex + 1) % sorted.length] ?? { hour: 3, minute: 0 };
  const fmt = (b: TaskChuteSectionBoundary) => `${b.hour}:${String(b.minute).padStart(2, "0")}`;
  return `${fmt(start)}-${fmt(end)}`;
}

/** TaskChute Plus の dayStateService に指定日の時間帯枠（slotOverrides）を保存する。 */
export async function assignTaskChuteSlotOverride(
  host: TaskChuteHost,
  dateKey: string,
  taskId: string | undefined,
  filePath: string,
  slotKey: string
): Promise<boolean> {
  const plugin = host.plugins?.plugins?.[TASKCHUTE_PLUGIN_ID];
  const service = plugin?.dayStateService;
  if (!service?.getDateFromKey || !service.loadDay || !service.saveDay) return false;
  try {
    const dateObj = service.getDateFromKey(dateKey);
    const dayState = await service.loadDay(dateObj);
    if (!dayState.slotOverrides || typeof dayState.slotOverrides !== "object") {
      dayState.slotOverrides = {};
    }
    if (!dayState.slotOverridesMeta || typeof dayState.slotOverridesMeta !== "object") {
      dayState.slotOverridesMeta = {};
    }
    const key = taskId && taskId.trim() ? taskId.trim() : filePath;
    dayState.slotOverrides[key] = slotKey;
    dayState.slotOverridesMeta[key] = { slotKey, updatedAt: Date.now() };
    await service.saveDay(dateObj, dayState);
    const leaf = host.workspace.getLeavesOfType(TASKCHUTE_VIEW_TYPE)[0] as { view?: unknown } | undefined;
    const view = leaf?.view as { invalidateDayStateCache?: (key: string) => void } | undefined;
    view?.invalidateDayStateCache?.(dateKey);
    return true;
  } catch {
    return false;
  }
}

function findTaskChuteSlotHeader(taskList: HTMLElement, slotKey: string): HTMLElement | null {
  if (!slotKey || slotKey === "none") {
    return taskList.querySelector<HTMLElement>(".time-slot-header.other");
  }
  const headers = taskList.querySelectorAll<HTMLElement>(".time-slot-header");
  for (const header of Array.from(headers)) {
    if (header.classList.contains("other")) continue;
    const labelEl = header.querySelector<HTMLElement>(".tc-slot-label");
    const text = (labelEl?.textContent ?? header.textContent ?? "").trim();
    if (text === slotKey) return header;
  }
  return null;
}

/**
 * 開いている TaskChute 画面の日付を指定日に合わせ、一覧を読み直したうえで対象枠へスクロール（折りたたみ展開つき）する。
 */
export async function reloadTaskChuteViewAndScrollToSlot(
  workspace: { getLeavesOfType(type: string): unknown[] },
  dateKey: string,
  slotKey?: string
): Promise<boolean> {
  const leaf = workspace.getLeavesOfType(TASKCHUTE_VIEW_TYPE)[0] as { view?: unknown } | undefined;
  const view = leaf?.view as
    | {
        currentDate?: Date;
        currentDayStateKey?: string | null;
        currentDayState?: unknown;
        taskList?: HTMLElement;
        getCurrentDateString?: () => string;
        taskHeaderController?: { refreshDateLabel?: () => void };
        reloadTasksAndRestore?: (options: { runBoundaryCheck: boolean }) => Promise<void> | void;
      }
    | undefined;
  if (!view || typeof view.reloadTasksAndRestore !== "function") return false;
  const current = typeof view.getCurrentDateString === "function" ? view.getCurrentDateString() : "";
  if (current !== dateKey && /^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    const parts = dateKey.split("-").map(Number);
    const year = parts[0];
    const month = parts[1];
    const day = parts[2];
    if (year !== undefined && month !== undefined && day !== undefined) {
      view.currentDate = new Date(year, month - 1, day);
      view.currentDayStateKey = null;
      view.currentDayState = null;
      view.taskHeaderController?.refreshDateLabel?.();
    }
  }
  await view.reloadTasksAndRestore({ runBoundaryCheck: true });
  if (slotKey && view.taskList) {
    const taskList = view.taskList;
    const focus = () => {
      let header = findTaskChuteSlotHeader(taskList, slotKey);
      if (!header) return;
      if (header.classList.contains("collapsed")) {
        header.click();
        header = findTaskChuteSlotHeader(taskList, slotKey) ?? header;
      }
      header.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    window.requestAnimationFrame(() => {
      window.setTimeout(focus, 50);
    });
  }
  return true;
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

/**
 * TaskChute の画面が開いていれば、一覧を読み直す（QuickAdd スクリプト「感想メモ」の reloadTaskChuteIfOpen と同じ）。
 * 画面が開いていない、または読み直す関数が無いときは何もしない。
 */
export async function reloadTaskChuteViewIfOpen(workspace: { getLeavesOfType(type: string): unknown[] }): Promise<void> {
  const leaf = workspace.getLeavesOfType(TASKCHUTE_VIEW_TYPE)[0] as { view?: unknown } | undefined;
  const view = leaf?.view as { reloadTasksAndRestore?: (options: { runBoundaryCheck: boolean }) => unknown } | undefined;
  if (view && typeof view.reloadTasksAndRestore === "function") {
    await view.reloadTasksAndRestore({ runBoundaryCheck: true });
  }
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

/** 新しく登録した記録を TaskChute のタスクにするための frontmatter の項目（target_date は空）。 */
export interface TaskChuteNewTaskFields {
  target_date: string;
  taskId: string;
  tags: string[];
}

/** target_date は空にする（日付を決めずに TaskChute のタスクにする。日付は TaskChute 側で決める）。 */
export function buildTaskChuteFields(taskId: string): TaskChuteNewTaskFields {
  return { target_date: "", taskId, tags: ["task"] };
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

/** TaskChute の実行ログのフォルダの既定値（PathService.getLogDataPath）。 */
export const TASKCHUTE_DEFAULT_LOG_FOLDER = "TaskChute/Log";

/** TaskChute が実行ログを置くフォルダ。TaskChute から聞けなければ既定の TaskChute/Log。 */
export function getTaskChuteLogFolder(host: Pick<TaskChuteHost, "plugins">): string {
  try {
    const path = host.plugins?.plugins?.[TASKCHUTE_PLUGIN_ID]?.pathManager?.getLogDataPath?.();
    if (typeof path === "string" && path.trim()) return trimFolder(path);
  } catch {
    // TaskChute の中の作りが変わっていても、既定のフォルダで続ける。
  }
  return TASKCHUTE_DEFAULT_LOG_FOLDER;
}
