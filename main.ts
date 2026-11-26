import {
  AbstractInputSuggest,
  App,
  Editor,
  getLanguage,
  MarkdownFileInfo,
  MarkdownView,
  Menu,
  Notice,
  normalizePath,
  parseYaml,
  Platform,
  Plugin,
  PluginSettingTab,
  SettingDefinitionItem,
  TFile,
  TFolder,
} from "obsidian";
import {
  addMonthsClamped,
  differenceInCalendarDays,
  formatLocalizedDate,
  parseDateKey,
  readDateKey,
  shiftDateKey,
  toDateKey,
} from "./src/date-utils";
import {
  createTranslator,
  DayspannLocale,
  resolveLocale,
  TranslationKey,
  TranslationVariables,
} from "./src/i18n";
import { DuplicateCandidate, findDuplicates } from "./src/duplicate-check";
import { appendLogLineToFile, resolveCompletedDate } from "./src/log-entry";
import {
  confirmDuplicate,
  confirmEmptyFields,
  confirmGoalComplete,
  DayspannEntryModal,
  KeepEntryOpenError,
  promptHabitMemo,
} from "./src/modals";
import {
  applyDraftToFrontmatter,
  applyHabitToProjectTransition,
  emptyRequiredFields,
  replaceRecordBody,
} from "./src/record-edit";
import { nextHabitScheduledDate } from "./src/habit-target";
import { DEFAULT_RECORD_TYPE, normalizeRecordType, RecordType } from "./src/record-type";
import {
  collectLogMonthKeys,
  HabitLogDays,
  HabitLogDelta,
  heatmapMonthKeys,
  mergeHabitLogs,
  parseDeltaLines,
  parseMonthlyLog,
} from "./src/habit-log";
import {
  buildHabitDoneDelta,
  buildHabitUndoDelta,
  deltaLineToAppend,
  findPjSpanEntries,
  isHabitDoneOn,
  normalizeTaskChuteDeviceId,
  resolveTaskChuteTitle,
  TASKCHUTE_DEVICE_ID_STORAGE_KEY,
  TaskChuteDeltaRecord,
  taskChuteDeltaPath,
} from "./src/habit-record";
import {
  buildTaskChuteFields,
  canReloadTaskChuteView,
  chooseNewRecordFolder,
  generateTaskChuteTaskId,
  getTaskChuteTaskFolder,
  getTaskChuteLogFolder,
  isTaskChuteEnabled,
  readTargetDate,
  reloadTaskChuteViewIfOpen,
  TASKCHUTE_PLUGIN_ID,
  TASKCHUTE_SHOW_TODAY_COMMAND,
  TaskChuteHost,
  TaskChuteNewTaskFields,
} from "./src/taskchute";
import {
  DayspannDraft,
  DayspannRecord,
  makeTitleFromSelection,
  parseRecord,
  sanitizeFileName,
  serializeRecord,
} from "./src/model";
import {
  DEFAULT_SECTION_ORDER,
  DEFAULT_SOON_DAYS,
  DEFAULT_STALLED_DAYS,
  DayspannSectionKind,
  HabitFilter,
  MAX_SOON_DAYS,
  normalizeCollapsedHabitGroups,
  normalizeCollapsedSections,
  normalizeHabitFilter,
  normalizeSectionOrder,
  parseSoonDays,
  toggleCollapsedKey,
} from "./src/settings";
import {
  formatSourceReference,
  isLinkedSourceReference,
  parseSourceReference,
} from "./src/source-link";
import {
  buildHabitQuickAddVariables,
  filterQuickAddChoiceNames,
  getQuickAddChoices,
  getQuickAddExecuteChoice,
  hasQuickAddChoice,
  listQuickAddChoiceNames,
  normalizeQuickAddChoiceName,
  QuickAddHost,
} from "./src/quickadd";
import {
  appendDailyLogEntry,
  applyHabitMemo,
  buildDailyLogEntry,
  buildNewDailyLog,
  chooseHabitAfterLog,
  currentNextAction,
  dailyLogPath,
  DEFAULT_DAILY_LOG_FOLDER,
  formatMemoTime,
  habitMemoNotice,
  isInDailyLogFolder,
  normalizeDailyLogFolder,
  normalizeHabitMemoEnabled,
  parsePreviousHabitMemo,
  prepareHabitMemoInput,
} from "./src/habit-memo";
import { displayTitle } from "./src/note-template";
import { DEFAULT_PROJECT_CATEGORY_ORDER_TEXT, PROJECT_FILTER_ALL } from "./src/project-groups";
import { RefreshCoalescer } from "./src/refresh-coalesce";
import { DAYSPANN_VIEW_TYPE, DayspannView } from "./src/view";

export interface DayspannSettings {
  storageFolder: string;
  futureColor: string;
  pastColor: string;
  soonDays: number;
  stalledDays: number;
  sectionOrder: DayspannSectionKind[];
  collapsedSections: DayspannSectionKind[];
  undatedCollapsed: boolean;
  archiveCollapsed: boolean;
  /** 折りたたんだ習慣の見出しのキー。分類の名前、その他は空文字、分類が一つもないときの「習慣」見出しは "*"。 */
  collapsedHabitGroups: string[];
  /** 習慣タブの表示。「今日」か「すべて」。再起動しても残る。 */
  habitFilter: HabitFilter;
  /** プロジェクトタブの分類絞り込み。「*」はすべて、"" はその他、それ以外は分類名。 */
  projectCategoryFilter: string;
  /** プロジェクト分類フィルターの並び順（カンマ区切り）。 */
  projectCategoryOrder: string;
  /** 最後に選んだタブ（プロジェクト・習慣）。 */
  activeTab: RecordType;
  /** 習慣カードに「今日やった」ボタンを出すか。TaskChute 側だけで実行を記録するときはオフ。 */
  habitLogButtonEnabled: boolean;
  /** 「今日やった」で記録したあとに動かす QuickAdd の選択肢の名前。空なら動かさない。 */
  habitQuickAddChoice: string;
  /** 「今日やった」で記録したあとに、PJ-span の「メモと次回」の画面を出すか。QuickAdd の名前が入っていれば、そちらが先。 */
  habitMemoEnabled: boolean;
  /** メモを足す日次ログのフォルダ（その日の YYYY-MM-DD.md に足す）。 */
  habitDailyLogFolder: string;
}

const DEFAULT_SETTINGS: DayspannSettings = {
  storageFolder: "pj-span",
  futureColor: "#22c55e",
  pastColor: "#ef4444",
  soonDays: DEFAULT_SOON_DAYS,
  stalledDays: DEFAULT_STALLED_DAYS,
  sectionOrder: [...DEFAULT_SECTION_ORDER],
  collapsedSections: [],
  undatedCollapsed: false,
  archiveCollapsed: true,
  collapsedHabitGroups: [],
  habitFilter: "all",
  projectCategoryFilter: PROJECT_FILTER_ALL,
  projectCategoryOrder: DEFAULT_PROJECT_CATEGORY_ORDER_TEXT,
  activeTab: DEFAULT_RECORD_TYPE,
  habitLogButtonEnabled: false,
  habitQuickAddChoice: "",
  habitMemoEnabled: true,
  habitDailyLogFolder: DEFAULT_DAILY_LOG_FOLDER,
};

export default class DayspannPlugin extends Plugin {
  settings: DayspannSettings = DEFAULT_SETTINGS;
  /** 画面の読み直しをまとめる（自分の書き込みの直後の二重描画を避ける）。 */
  private refreshCoalescer = new RefreshCoalescer(
    () => this.refreshViewsNow(),
    {
      now: () => Date.now(),
      setTimeout: (callback, ms) => window.setTimeout(() => void callback(), ms),
      clearTimeout: (id) => window.clearTimeout(id),
    }
  );
  /** 「今日やった」「取り消す」を書いている途中の習慣（ノートの場所）。続けて押しても 2 回書かないようにする。 */
  private habitLogWrites = new Set<string>();

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.migrateLegacyData();

    this.registerView(DAYSPANN_VIEW_TYPE, (leaf) => new DayspannView(leaf, this));

    this.addRibbonIcon("calendar-range", this.t("ribbon.open"), () => void this.activateView());

    this.addCommand({
      id: "open-list",
      name: this.t("command.openList"),
      callback: () => void this.activateView(),
    });

    this.addCommand({
      id: "register-selection",
      name: this.t("command.registerSelection"),
      callback: () => this.openActiveSelectionEntry(),
    });

    this.addCommand({
      id: "register-manually",
      name: this.t("command.registerManually"),
      callback: () => this.openManualEntry(),
    });

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor, view: MarkdownView | MarkdownFileInfo) => {
        if (!editor.getSelection().trim()) return;
        menu.addItem((item) =>
          item
            .setTitle(this.t("context.register"))
            .setIcon("calendar-plus")
            .onClick(() => this.openSelectionEntry(editor, view))
        );
      })
    );

    this.registerEvent(
      this.app.vault.on("create", (file) => this.scheduleRefreshForPaths(file.path))
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => this.scheduleRefreshForPaths(file.path))
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => this.scheduleRefreshForPaths(file.path))
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) =>
        this.scheduleRefreshForPaths(file.path, oldPath)
      )
    );

    this.addSettingTab(new DayspannSettingTab(this.app, this));
  }

  onunload(): void {
    this.refreshCoalescer.dispose();
  }

  todayKey(): string {
    return toDateKey(new Date());
  }

  locale(): DayspannLocale {
    return resolveLocale(getLanguage());
  }

  t(key: TranslationKey, variables?: TranslationVariables): string {
    return createTranslator(getLanguage())(key, variables);
  }

  async activateView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(DAYSPANN_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({ type: DAYSPANN_VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (view instanceof DayspannView) await view.refresh();
  }

  openSelectionEntry(editor: Editor, view: MarkdownView | MarkdownFileInfo): void {
    const selection = editor.getSelection().trim();
    if (!selection) {
      new Notice(this.t("notice.selectText"));
      return;
    }

    const file = view.file;
    const sourceLine = Math.min(editor.getCursor("from").line, editor.getCursor("to").line) + 1;
    this.openSelectionDraft({
      title: makeTitleFromSelection(selection, this.t("default.newEntry")),
      date: this.inferDate(file),
      excerpt: selection,
      sourcePath: file?.path,
      sourceLine,
    });
  }

  openActiveSelectionEntry(): void {
    const activeEditor = this.app.workspace.activeEditor;
    if (activeEditor?.editor) {
      const editor = activeEditor.editor;
      if (editor.getSelection().trim()) {
        this.openSelectionEntry(editor, activeEditor);
        return;
      }
    }

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const previewSelection = this.getMarkdownPreviewSelection(view);
    if (!view?.file || !previewSelection) {
      new Notice(this.t("notice.selectMarkdownText"));
      return;
    }

    this.openSelectionDraft({
      title: makeTitleFromSelection(previewSelection.text, this.t("default.newEntry")),
      date: this.inferDate(view.file),
      excerpt: previewSelection.text,
      sourcePath: view.file.path,
      sourceLine: previewSelection.sourceLine,
    });
  }

  private openSelectionDraft(initial: DayspannDraft): void {
    new DayspannEntryModal(
      this.app,
      initial,
      this.t("modal.registerSelection"),
      this.t("action.register"),
      (key, variables) => this.t(key, variables),
      async (draft) => {
        await this.registerRecord(draft);
        await this.activateView();
      }
    ).open();
  }

  /** 手で登録する画面を開く。種類のはじめの値は type（一覧から開いたときは、いま選んでいるタブ）。 */
  openManualEntry(type: RecordType = DEFAULT_RECORD_TYPE): void {
    new DayspannEntryModal(
      this.app,
      { title: "", date: this.todayKey(), excerpt: "", type },
      this.t("modal.registerManual"),
      this.t("action.register"),
      (key, variables) => this.t(key, variables),
      async (draft) => {
        await this.registerRecord(draft);
        await this.refreshViews();
      }
    ).open();
  }

  openEditEntry(record: DayspannRecord): void {
    new DayspannEntryModal(
      this.app,
      {
        title: record.title,
        type: record.type,
        date: record.date,
        goal: record.goal,
        category: record.category,
        displayMode: record.displayMode,
        archived: record.archived,
        completed: record.completed,
        excerpt: record.excerpt,
        sourcePath: record.sourcePath,
        sourceLine: record.sourceLine,
        created: record.created,
      },
      this.t("modal.edit"),
      this.t("action.save"),
      (key, variables) => this.t(key, variables),
      async (draft) => {
        const previousType = record.type;
        const nextType = draft.type ?? previousType;
        const today = this.todayKey();
        const inheritedTargetDate =
          previousType === "habit" && nextType === "project"
            ? nextHabitScheduledDate(record.habitSchedule, today, false)
            : null;
        const previousTargetDate = record.taskchute?.targetDate;
        const initialRoutineStart =
          previousTargetDate && differenceInCalendarDays(previousTargetDate, today) >= 0
            ? previousTargetDate
            : undefined;
        let routineStopped = false;

        // ファイル全体を書き直さず、PJ-spanのキーと本文だけを変える（TaskChuteの taskId・tags・target_date などを残すため）。
        await this.app.vault.process(record.file, (content) => replaceRecordBody(content, draft.excerpt));
        await this.app.fileManager.processFrontMatter(
          record.file,
          (frontmatter: Record<string, unknown>) => {
            applyDraftToFrontmatter(frontmatter, draft);
            if (previousType === "habit" && nextType === "project") {
              routineStopped = applyHabitToProjectTransition(frontmatter, inheritedTargetDate);
            }
          }
        );
        new Notice(this.t("notice.updated"));
        await this.refreshViewsAfterWrite(record.file.path);
        if (routineStopped) this.reloadTaskChuteViewNow();
        if (previousType === "project" && nextType === "habit" && record.taskchute) {
          void this.openHabitRoutineModal(
            { ...record, type: "habit", title: draft.title },
            { initialStartDate: initialRoutineStart, clearTargetDateOnSave: true, forceEnabled: true }
          );
        }
      }
    ).open();
  }

  async deleteRecord(record: DayspannRecord): Promise<void> {
    const confirmed = await this.app.fileManager.promptForDeletion(record.file);
    if (!confirmed) return;
    await this.app.fileManager.trashFile(record.file);
    new Notice(this.t("notice.trashed"));
    await this.refreshViewsAfterWrite(record.file.path);
  }

  async setRecordArchived(record: DayspannRecord, archived: boolean): Promise<void> {
    // プロジェクトを完了にするとき、完了条件が書いてあれば先に確認する。空なら確認せずに完了にする。
    // 習慣は、完了条件の確認も、ログの「完了」行も出さない。
    const isProject = record.type === "project";
    const isHabit = record.type === "habit";
    if (archived && isProject && record.goal) {
      const confirmed = await confirmGoalComplete(this.app, record.goal, (key, variables) => this.t(key, variables));
      if (!confirmed) return;
    }
    if (archived && isProject) {
      const logLine = `- ${this.todayKey()} 完了`;
      await this.app.vault.process(record.file, (content) => appendLogLineToFile(content, logLine));
    }
    let routineChanged = false;
    await this.app.fileManager.processFrontMatter(
      record.file,
      (frontmatter: Record<string, unknown>) => {
        if (archived) {
          frontmatter.archived = true;
          frontmatter.completed = this.todayKey();
          // 習慣をアーカイブしたときは TaskChute 側のルーチンも自動でオフにする。
          if (isHabit && (frontmatter.isRoutine === true || "routine_enabled" in frontmatter)) {
            frontmatter.routine_enabled = false;
            routineChanged = true;
          }
        } else {
          delete frontmatter.archived;
          delete frontmatter.completed;
          // 習慣をメイン一覧に戻したときは、オフになっていたルーチンをオンに戻す。
          if (isHabit && frontmatter.isRoutine === true && frontmatter.routine_enabled === false) {
            frontmatter.routine_enabled = true;
            routineChanged = true;
          }
        }
      }
    );
    new Notice(this.t(archived ? "notice.archived" : "notice.restored"));
    await this.refreshViewsAfterWrite(record.file.path);
    if (routineChanged) this.reloadTaskChuteViewNow();
  }

  async postponeRecord(record: DayspannRecord, days: number): Promise<void> {
    let nextDate = "";
    await this.app.fileManager.processFrontMatter(
      record.file,
      (frontmatter: Record<string, unknown>) => {
        const currentDate = readDateKey(frontmatter.date);
        if (!currentDate) return;
        nextDate = shiftDateKey(currentDate, days);
        frontmatter.date = nextDate;
      }
    );
    if (!nextDate) return;
    new Notice(this.t("notice.postponed", { date: formatLocalizedDate(nextDate, this.locale()) }));
    await this.refreshViewsAfterWrite(record.file.path);
  }

  /** 期日（frontmatter の date）を暦月で months か月後へ延ばす（月末は翌月末に丸める）。 */
  async postponeRecordMonths(record: DayspannRecord, months: number): Promise<void> {
    let nextDate = "";
    await this.app.fileManager.processFrontMatter(
      record.file,
      (frontmatter: Record<string, unknown>) => {
        const currentDate = readDateKey(frontmatter.date);
        if (!currentDate) return;
        nextDate = addMonthsClamped(currentDate, months);
        frontmatter.date = nextDate;
      }
    );
    if (!nextDate) return;
    new Notice(this.t("notice.postponed", { date: formatLocalizedDate(nextDate, this.locale()) }));
    await this.refreshViewsAfterWrite(record.file.path);
  }

  /** 期日（frontmatter の date）だけを書き換える。今日より前の日付は受け付けない。 */
  async setRecordDate(record: DayspannRecord, dateKey: string): Promise<void> {
    if (!parseDateKey(dateKey)) return;
    if (differenceInCalendarDays(dateKey, this.todayKey()) < 0) {
      new Notice(this.t("error.dateBeforeToday"));
      return;
    }
    await this.app.fileManager.processFrontMatter(
      record.file,
      (frontmatter: Record<string, unknown>) => {
        frontmatter.date = dateKey;
      }
    );
    new Notice(this.t("notice.postponed", { date: formatLocalizedDate(dateKey, this.locale()) }));
    await this.refreshViewsAfterWrite(record.file.path);
  }

  async addRecordToTaskChuteToday(record: DayspannRecord): Promise<void> {
    const today = this.todayKey();
    let changed = false;
    await this.app.fileManager.processFrontMatter(
      record.file,
      (frontmatter: Record<string, unknown>) => {
        if (readTargetDate(frontmatter.target_date) === today) return;
        frontmatter.target_date = today;
        changed = true;
      }
    );
    if (!changed) {
      new Notice(this.t("notice.alreadyToday", { title: record.title }));
      await this.refreshViewsAfterWrite(record.file.path);
      return;
    }

    new Notice(this.t("notice.addedToday", { title: record.title }));
    await this.refreshViewsAfterWrite(record.file.path);
    await this.reloadTaskChuteView(record.file, today);
  }

  /**
   * 習慣カードの「次回予定日」から TaskChute のルーチン設定モーダルを開く。
   * 開始時刻が空のまま保存したときは scheduled_time を空白で残す。
   */
  async openHabitRoutineModal(
    record: DayspannRecord,
    options?: { initialStartDate?: string; clearTargetDateOnSave?: boolean; forceEnabled?: boolean }
  ): Promise<void> {
    const host = this.app as unknown as TaskChuteHost;
    if (!isTaskChuteEnabled(host)) {
      new Notice(this.t("notice.habitLogNoTaskChute"));
      return;
    }
    const view = await this.ensureTaskChuteRoutineView();
    if (!view) {
      new Notice(this.t("notice.routineModalUnavailable"));
      return;
    }

    const file = record.file;
    const rawFm = (this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>;
    const fm: Record<string, unknown> = { ...rawFm };
    const rawTime = typeof fm.scheduled_time === "string" ? fm.scheduled_time.trim() : "";
    const timeMatch = /^(\d{1,2}):(\d{2})/.exec(rawTime);
    const scheduledTime =
      timeMatch && Number(timeMatch[1]) <= 23 && Number(timeMatch[2]) <= 59
        ? `${String(Number(timeMatch[1])).padStart(2, "0")}:${timeMatch[2]}`
        : "";
    const today = this.todayKey();
    const effectiveFm = options?.forceEnabled ? { ...fm, routine_enabled: true } : fm;
    const task: Record<string, unknown> = {
      file,
      path: file.path,
      isRoutine: fm.isRoutine === true || fm.isRoutine === "true",
      frontmatter: effectiveFm,
      displayTitle: typeof fm.title === "string" && fm.title.trim() ? fm.title.trim() : file.basename,
      routine_type: typeof fm.routine_type === "string" && fm.routine_type.trim() ? fm.routine_type.trim() : "daily",
      routine_interval: typeof fm.routine_interval === "number" && fm.routine_interval >= 1 ? fm.routine_interval : 1,
      routine_enabled: options?.forceEnabled
        ? true
        : fm.routine_enabled !== false && fm.routine_enabled !== "false",
      routine_start: readDateKey(fm.routine_start) || options?.initialStartDate || today,
    };
    const endKey = readDateKey(fm.routine_end);
    if (endKey) task.routine_end = endKey;
    if (scheduledTime) task.scheduledTime = scheduledTime;
    for (const key of [
      "routine_weekday",
      "routine_weekdays",
      "weekdays",
      "routine_week",
      "routine_weeks",
      "routine_monthday",
      "routine_monthdays",
    ]) {
      if (fm[key] !== undefined) task[key] = fm[key];
    }

    const doc = this.app.workspace.containerEl.ownerDocument ?? document;
    const placeholder = createEl("button");
    try {
      view.showRoutineEditModal(task, placeholder);
    } catch {
      new Notice(this.t("notice.routineModalUnavailable"));
      return;
    }

    const modals = doc.querySelectorAll<HTMLElement>(".routine-edit-modal");
    const modalEl = modals.length ? modals[modals.length - 1] : null;
    if (!modalEl) return;

    const state = { blankTime: false, saved: false };
    const timeInput = modalEl.querySelector<HTMLInputElement>('input[type="time"]');
    const form = modalEl.querySelector("form");
    if (timeInput && form) {
      if (!scheduledTime) timeInput.value = "";
      form.addEventListener(
        "submit",
        () => {
          if (timeInput.value) {
            state.blankTime = false;
            return;
          }
          timeInput.value = "00:00";
          state.blankTime = true;
        },
        true
      );
    }

    const isBlankTimeNotice = (text: string): boolean =>
      text.includes("00:00開始予定") || text.includes("starts at 00:00");
    const dismissBlankTimeNotices = (): void => {
      for (const node of Array.from(doc.querySelectorAll(".notice"))) {
        if (isBlankTimeNotice(node.textContent ?? "")) node.remove();
      }
    };

    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      this.app.metadataCache.offref(ref);
      window.clearTimeout(giveUp);
    };
    const ref = this.app.metadataCache.on("changed", (changed) => {
      if (settled || changed.path !== file.path) return;
      const dropTime = state.blankTime;
      state.saved = true;
      finish();
      window.setTimeout(() => {
        void (async () => {
          const shouldClearTarget = Boolean(options?.clearTargetDateOnSave);
          if (dropTime || shouldClearTarget) {
            await this.app.fileManager.processFrontMatter(file, (nextFm: Record<string, unknown>) => {
              if (dropTime) nextFm.scheduled_time = "";
              if (
                shouldClearTarget &&
                (nextFm.isRoutine === true || nextFm.isRoutine === "true") &&
                nextFm.routine_enabled !== false &&
                nextFm.routine_enabled !== "false"
              ) {
                delete nextFm.target_date;
                delete nextFm.temporary_move_date;
              }
            });
          }
          if (dropTime) {
            dismissBlankTimeNotices();
            const noticeCleaner = window.setInterval(dismissBlankTimeNotices, 100);
            window.setTimeout(() => window.clearInterval(noticeCleaner), 2000);
            new Notice(this.t("notice.routineSaved", { title: displayTitle(record.title) }));
          }
          await reloadTaskChuteViewIfOpen(this.app.workspace);
          await this.refreshViewsAfterWrite(file.path);
        })();
      }, 0);
    });
    const giveUp = window.setTimeout(finish, 120000);
    const observer = new MutationObserver(() => {
      if (modalEl.isConnected) return;
      observer.disconnect();
      window.setTimeout(() => {
        if (!settled && !state.saved) finish();
      }, 8000);
    });
    observer.observe(doc.body, { childList: true, subtree: true });
  }

  private async ensureTaskChuteRoutineView(): Promise<{
    showRoutineEditModal: (task: Record<string, unknown>, trigger: HTMLElement) => void;
  } | null> {
    type RoutineView = {
      showRoutineEditModal?: (task: Record<string, unknown>, trigger: HTMLElement) => void;
    };
    type DeferredLeaf = {
      view?: RoutineView;
      loadIfDeferred?: () => Promise<void>;
    };
    const toRoutineView = (leaf: DeferredLeaf | undefined) => {
      const view = leaf?.view;
      return view && typeof view.showRoutineEditModal === "function"
        ? (view as { showRoutineEditModal: (task: Record<string, unknown>, trigger: HTMLElement) => void })
        : null;
    };
    const previous = this.app.workspace.getMostRecentLeaf();
    const existing = this.app.workspace.getLeavesOfType("taskchute-view")[0] as DeferredLeaf | undefined;
    let view = toRoutineView(existing);
    if (!view && existing?.loadIfDeferred) {
      try {
        await existing.loadIfDeferred();
      } catch {
        // 読み込み失敗時は下のフォールバックへ
      }
      view = toRoutineView(existing);
    }
    if (!view) {
      const leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: "taskchute-view", active: true });
      const deferred = leaf as unknown as DeferredLeaf;
      if (!toRoutineView(deferred) && deferred.loadIfDeferred) {
        try {
          await deferred.loadIfDeferred();
        } catch {
          // 続行
        }
      }
      view = toRoutineView(deferred);
      if (previous) this.app.workspace.setActiveLeaf(previous, { focus: true });
    }
    return view;
  }

  /** 次回予定日（frontmatter の target_date）を変更または空にする。 */
  async setRecordTargetDate(record: DayspannRecord, dateKey: string): Promise<void> {
    const trimmed = dateKey.trim();
    if (trimmed && !parseDateKey(trimmed)) return;
    if (trimmed && differenceInCalendarDays(trimmed, this.todayKey()) < 0) {
      new Notice(this.t("error.dateBeforeToday"));
      return;
    }
    await this.app.fileManager.processFrontMatter(
      record.file,
      (frontmatter: Record<string, unknown>) => {
        frontmatter.target_date = trimmed;
      }
    );
    if (trimmed) {
      new Notice(
        this.t("notice.targetDateSet", {
          title: displayTitle(record.title),
          date: formatLocalizedDate(trimmed, this.locale()),
        })
      );
    } else {
      new Notice(this.t("notice.targetDateCleared", { title: displayTitle(record.title) }));
    }
    await this.refreshViewsAfterWrite(record.file.path);
    await this.reloadTaskChuteView(record.file, trimmed);
  }

  /** TaskChuteの画面が開いているときだけ「今日のタスクを表示」で読み直す。開いていなければ何もしない（勝手に画面を開かない）。 */
  private async reloadTaskChuteView(file: TFile, targetDate: string): Promise<void> {
    const host = this.app as unknown as TaskChuteHost;
    if (!canReloadTaskChuteView(host)) return;
    // TaskChuteはメタデータキャッシュから target_date を読むので、キャッシュが新しい日付になるまで少し待つ。
    await this.waitForTargetDate(file, targetDate, 1500);
    host.commands?.executeCommandById?.(TASKCHUTE_SHOW_TODAY_COMMAND);
  }

  private waitForTargetDate(file: TFile, targetDate: string, timeoutMs: number): Promise<void> {
    const cached = () =>
      (readTargetDate(this.app.metadataCache.getFileCache(file)?.frontmatter?.target_date) ?? "") === targetDate;
    if (cached()) return Promise.resolve();
    return new Promise((resolve) => {
      const ref = this.app.metadataCache.on("changed", (changedFile) => {
        if (changedFile.path === file.path && cached()) finish();
      });
      const timer = window.setTimeout(() => finish(), timeoutMs);
      const finish = () => {
        window.clearTimeout(timer);
        this.app.metadataCache.offref(ref);
        resolve();
      };
    });
  }

  async openRecordSource(record: DayspannRecord): Promise<void> {
    const source = record.sourcePath ? this.app.vault.getFileByPath(record.sourcePath) : null;
    if (!source) {
      await this.openRecordFile(record);
      if (record.sourcePath) new Notice(this.t("notice.sourceMissing"));
      return;
    }

    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(source, { active: true });
    if (typeof record.sourceLine !== "number") return;

    const view = leaf.view;
    if (view instanceof MarkdownView) {
      const lastLine = Math.max(0, view.editor.lineCount() - 1);
      const line = Math.min(lastLine, Math.max(0, record.sourceLine - 1));
      view.editor.setCursor({ line, ch: 0 });
      view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
    }
  }

  async openRecordFile(record: DayspannRecord): Promise<void> {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(record.file, { active: true });

    const sourcePath = record.sourcePath;
    if (sourcePath) {
      await this.app.fileManager.processFrontMatter(
        record.file,
        (frontmatter: Record<string, unknown>) => {
          const storedPath = parseSourceReference(frontmatter.source);
          if (storedPath === sourcePath && !isLinkedSourceReference(frontmatter.source)) {
            frontmatter.source = formatSourceReference(sourcePath);
          }
        }
      );
    }
  }

  async loadRecords(): Promise<DayspannRecord[]> {
    const folder = this.normalizedStorageFolder();
    const root = this.app.vault.getAbstractFileByPath(folder);
    if (!(root instanceof TFolder)) return [];

    const files: TFile[] = [];
    this.collectMarkdownFiles(root, files);

    const parsed = await Promise.all(
      files.map(async (file) => {
        const content = await this.app.vault.cachedRead(file);
        const record = parseRecord(file, content);
        if (!record) return null;
        // アーカイブ済みで完了日がなければ、ログの完了行、なければファイルの更新日から補う（ファイルには書かない）。
        if (record.archived) {
          record.completed = resolveCompletedDate(record.completed, content, file.stat.mtime);
        }
        return record;
      })
    );
    return parsed.filter((record): record is DayspannRecord => record !== null);
  }

  /**
   * ログフォルダにある月ごとのファイル（YYYY-MM-tasks.json と inbox の YYYY-MM.jsonl）から月を集める。
   * ヒートマップに必要な月（直近 4 週）も必ず含める。最長の連続を出すために、ある月のファイルはすべて読む。
   */
  async listTaskChuteLogMonths(todayKey: string): Promise<string[]> {
    const adapter = this.app.vault.adapter;
    const base = getTaskChuteLogFolder(this.app as unknown as TaskChuteHost);
    const paths: string[] = [];
    const listFiles = async (folder: string): Promise<string[]> => {
      try {
        const normalized = normalizePath(folder);
        return (await adapter.exists(normalized)) ? (await adapter.list(normalized)).files : [];
      } catch {
        return [];
      }
    };

    paths.push(...(await listFiles(base)));
    for (const inbox of [`${base}/inbox`, `${base}/.inbox`]) {
      let devices: string[] = [];
      try {
        const normalized = normalizePath(inbox);
        if (await adapter.exists(normalized)) devices = (await adapter.list(normalized)).folders;
      } catch {
        devices = [];
      }
      for (const device of devices) {
        paths.push(...(await listFiles(device)));
      }
    }

    const months = collectLogMonthKeys(paths);
    for (const month of heatmapMonthKeys(todayKey)) {
      if (!months.includes(month)) months.push(month);
    }
    months.sort();
    return months;
  }

  /**
   * TaskChute Plus の実行ログを、指定した月（YYYY-MM）の分だけ読む（書き込みはしない）。
   * 月ごとの YYYY-MM-tasks.json に、端末ごとの inbox/<端末>/YYYY-MM.jsonl の差分を重ねる。
   */
  async loadTaskChuteLogs(monthKeys: string[]): Promise<HabitLogDays> {
    const adapter = this.app.vault.adapter;
    const base = getTaskChuteLogFolder(this.app as unknown as TaskChuteHost);
    const readText = async (path: string): Promise<string> => {
      try {
        const normalized = normalizePath(path);
        return (await adapter.exists(normalized)) ? await adapter.read(normalized) : "";
      } catch {
        return "";
      }
    };

    const snapshots: HabitLogDays[] = [];
    for (const month of monthKeys) {
      const raw = await readText(`${base}/${month}-tasks.json`);
      if (raw) snapshots.push(parseMonthlyLog(raw));
    }

    const deltas: HabitLogDelta[] = [];
    for (const inbox of [`${base}/inbox`, `${base}/.inbox`]) {
      let devices: string[] = [];
      try {
        const normalized = normalizePath(inbox);
        if (await adapter.exists(normalized)) devices = (await adapter.list(normalized)).folders;
      } catch {
        devices = [];
      }
      for (const device of devices) {
        for (const month of monthKeys) {
          const raw = await readText(`${device}/${month}.jsonl`);
          if (raw) deltas.push(...parseDeltaLines(raw));
        }
      }
    }
    return mergeHabitLogs(snapshots, deltas);
  }

  /**
   * 習慣のカードの「今日やった」。TaskChute の実行ログに、今日の分を 1 件書く。
   * TaskChute と同じく、この端末の inbox/<端末ID>/YYYY-MM.jsonl に差分を 1 行足すだけにし、
   * YYYY-MM-tasks.json へのまとめは TaskChute に任せる。今日の記録がもうあれば書かない。
   */
  async recordHabitToday(record: DayspannRecord): Promise<void> {
    if (!record.taskchute || record.archived) return;
    const key = record.file.path;
    if (this.habitLogWrites.has(key)) return;
    this.habitLogWrites.add(key);
    // 記録できた日。記録できたときだけ、このあと QuickAdd か「メモと次回」の画面を出す。
    let recordedDate = "";
    try {
      const deviceId = this.taskChuteDeviceIdOrNotice();
      if (!deviceId) return;
      const now = new Date();
      const today = toDateKey(now);
      const habit = { taskId: record.taskchute.taskId, path: record.file.path, basename: record.file.basename };
      // 書く直前にログを読み直し、今日の記録がもうあれば（TaskChute で付けた分も含む）書かない。
      const logs = await this.loadTaskChuteLogs([today.slice(0, 7)]);
      if (isHabitDoneOn(logs, habit, today)) {
        new Notice(this.t("notice.habitAlreadyLogged", { title: record.title }));
        await this.refreshViewsAfterWrite(record.file.path);
        return;
      }
      const title = resolveTaskChuteTitle(
        this.app.metadataCache.getFileCache(record.file)?.frontmatter?.title,
        record.file.basename
      );
      await this.appendTaskChuteDelta(
        buildHabitDoneDelta({ title, path: record.file.path, taskId: record.taskchute.taskId, deviceId, now })
      );
      new Notice(this.t("notice.habitLogged", { title: record.title }));
      recordedDate = today;
      await this.refreshViewsAfterWrite(record.file.path);
      this.reloadTaskChuteViewNow();
    } catch (error) {
      console.error("[PJ-span] 今日の分を記録できませんでした", error);
      new Notice(this.t("notice.habitLogFailed"));
    } finally {
      this.habitLogWrites.delete(key);
    }
    if (recordedDate) await this.runAfterHabitLog(record, recordedDate);
  }

  /**
   * 「今日やった」で記録したあとの続き。設定の QuickAdd の名前が入っていれば QuickAdd を動かし、
   * 空なら PJ-span の「メモと次回」の画面を出す（設定でオフにしていれば何もしない）。
   */
  private async runAfterHabitLog(record: DayspannRecord, date: string): Promise<void> {
    const action = chooseHabitAfterLog({
      quickAddChoice: this.settings.habitQuickAddChoice,
      memoEnabled: this.settings.habitMemoEnabled,
    });
    if (action === "quickadd") await this.runHabitQuickAdd(record, date);
    else if (action === "memo") await this.runHabitMemo(record);
  }

  /**
   * 「メモと次回」の画面を出し、入力したものを習慣のノートと日次ログに書く（QuickAdd スクリプト「感想メモ」と同じ書き方）。
   * ノートは開かず、app.vault.process でまとめて書き換えるので、PJ-span の画面はそのまま。
   * 「スキップ」や Esc、メモも次回も空のときは何も書かない（今日の記録はそのまま残る）。
   */
  private async runHabitMemo(record: DayspannRecord): Promise<void> {
    const file = record.file;
    if (isInDailyLogFolder(file.path, this.settings.habitDailyLogFolder)) {
      new Notice(this.t("notice.habitMemoInDailyLog"));
      return;
    }
    let content = "";
    try {
      // 画面を出す直前にノートを読み直す（キャッシュがあれば cachedRead、なければ read）。
      try {
        content = await this.app.vault.cachedRead(file);
      } catch {
        content = await this.app.vault.read(file);
      }
    } catch (error) {
      console.error("[PJ-span] 習慣のノートを読めませんでした", error);
      new Notice(this.t("notice.habitMemoFailed"));
      return;
    }
    const currentNext = currentNextAction(content);
    const previousMemo = parsePreviousHabitMemo(content);
    const answer = await promptHabitMemo(
      this.app,
      displayTitle(record.title),
      currentNext,
      (key, variables) => this.t(key, variables),
      previousMemo
    );
    if (!answer) return;
    const input = prepareHabitMemoInput(answer.memo, answer.next);
    if (!input) {
      new Notice(this.t("notice.habitMemoEmpty"));
      return;
    }
    try {
      const now = new Date();
      const date = toDateKey(now);
      // 画面を開いているあいだにノートが変わっていてもよいよう、書く直前の中身から作り直す。
      await this.app.vault.process(file, (data) => applyHabitMemo(data, { ...input, basename: file.basename, date }));
      if (input.memo) await this.appendHabitDailyLog(file, input.memo, now);
      await reloadTaskChuteViewIfOpen(this.app.workspace);
      const notice = habitMemoNotice(input.memo !== "", Platform.isMobile);
      new Notice(this.t(notice.key), notice.duration);
    } catch (error) {
      console.error("[PJ-span] メモと次回を書けませんでした", error);
      new Notice(this.t("notice.habitMemoFailed"));
    }
    await this.refreshViewsAfterWrite(file.path);
  }

  /** 日次ログ（設定のフォルダの YYYY-MM-DD.md）の末尾に「- 時刻 [[習慣]] メモ」を足す。無ければ作る。 */
  private async appendHabitDailyLog(source: TFile, memo: string, now: Date): Promise<void> {
    const date = toDateKey(now);
    const path = normalizePath(dailyLogPath(this.settings.habitDailyLogFolder, date));
    const link = this.app.fileManager.generateMarkdownLink(source, path);
    const entry = buildDailyLogEntry(formatMemoTime(now), link, memo);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (!existing) {
      const folder = normalizePath(normalizeDailyLogFolder(this.settings.habitDailyLogFolder));
      if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
      await this.app.vault.create(path, buildNewDailyLog(date, entry));
      return;
    }
    if (!(existing instanceof TFile)) return;
    await this.app.vault.process(existing, (data) => appendDailyLogEntry(data, entry));
  }

  /**
   * 「今日やった」で記録したあと、設定の QuickAdd の選択肢を動かす。設定が空なら何もしない。
   * スクリプトが開いているノートを書き換えられるよう、先に習慣のノートを開き、開き終わってから動かす。
   * QuickAdd が無い・選択肢が無い・途中で失敗したときは知らせるだけにし、記録はそのまま残す。
   */
  private async runHabitQuickAdd(record: DayspannRecord, date: string): Promise<void> {
    const choiceName = normalizeQuickAddChoiceName(this.settings.habitQuickAddChoice);
    if (!choiceName) return;
    const host = this.app as unknown as QuickAddHost;
    const executeChoice = getQuickAddExecuteChoice(host);
    if (!executeChoice) {
      new Notice(this.t("notice.quickAddMissing"));
      return;
    }
    if (!hasQuickAddChoice(getQuickAddChoices(host), choiceName)) {
      new Notice(this.t("notice.quickAddChoiceMissing", { name: choiceName }));
      return;
    }
    try {
      if (!(await this.openHabitNoteForQuickAdd(record.file))) {
        new Notice(this.t("notice.quickAddOpenFailed"));
        return;
      }
      await executeChoice(
        choiceName,
        buildHabitQuickAddVariables({ path: record.file.path, title: record.title, date })
      );
    } catch (error) {
      // Esc で閉じたとき（QuickAdd の MacroAbortError）は、知らせずに終える。
      if (!(error instanceof Error && error.name === "MacroAbortError")) {
        console.error("[PJ-span] QuickAdd の途中でエラーになりました", error);
        new Notice(this.t("notice.quickAddFailed"));
      }
    }
    // 次の一手やメモが変わっていれば出し直す（ノートの変更でも読み直すが、念のため）。
    await this.refreshViewsAfterWrite(record.file.path);
  }

  /**
   * 習慣のノートを開いて、そのノートが「いま開いているノート」になるまで待つ。
   * もうどこかのタブで開いていれば、そのタブに移る。なければ、カードを押したときと同じ開き方（getLeaf(false)）で開く。
   * 2 秒たっても切り替わらなければ false（スクリプトが別のノートを書き換えないよう、QuickAdd は動かさない）。
   */
  private async openHabitNoteForQuickAdd(file: TFile): Promise<boolean> {
    const workspace = this.app.workspace;
    const opened = workspace
      .getLeavesOfType("markdown")
      .find((leaf) => leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path);
    const leaf = opened ?? workspace.getLeaf(false);
    if (opened) workspace.setActiveLeaf(opened, { focus: true });
    else await leaf.openFile(file, { active: true });
    await workspace.revealLeaf(leaf);
    if (workspace.getActiveFile()?.path === file.path) return true;
    return new Promise<boolean>((resolve) => {
      const check = () => {
        if (workspace.getActiveFile()?.path !== file.path) return;
        finish(true);
      };
      const fileOpenRef = workspace.on("file-open", check);
      const leafChangeRef = workspace.on("active-leaf-change", check);
      const timer = window.setTimeout(() => finish(workspace.getActiveFile()?.path === file.path), 2000);
      const finish = (result: boolean) => {
        window.clearTimeout(timer);
        workspace.offref(fileOpenRef);
        workspace.offref(leafChangeRef);
        resolve(result);
      };
    });
  }

  /** 「今日の記録を取り消す」。PJ-span が書いた今日の記録だけを、TaskChute と同じ delete の差分で消す。 */
  async undoHabitToday(record: DayspannRecord): Promise<void> {
    if (!record.taskchute || record.archived) return;
    const key = record.file.path;
    if (this.habitLogWrites.has(key)) return;
    this.habitLogWrites.add(key);
    try {
      const deviceId = this.taskChuteDeviceIdOrNotice();
      if (!deviceId) return;
      const now = new Date();
      const today = toDateKey(now);
      const habit = { taskId: record.taskchute.taskId, path: record.file.path, basename: record.file.basename };
      const logs = await this.loadTaskChuteLogs([today.slice(0, 7)]);
      const entries = findPjSpanEntries(logs, habit, today);
      if (!entries.length) {
        new Notice(this.t("notice.habitUndoNothing"));
        await this.refreshViewsAfterWrite(record.file.path);
        return;
      }
      for (const entry of entries) {
        await this.appendTaskChuteDelta(buildHabitUndoDelta(entry, today, deviceId, now));
      }
      new Notice(this.t("notice.habitUndone", { title: record.title }));
      await this.refreshViewsAfterWrite(record.file.path);
      this.reloadTaskChuteViewNow();
    } catch (error) {
      console.error("[PJ-span] 今日の記録を取り消せませんでした", error);
      new Notice(this.t("notice.habitUndoFailed"));
    } finally {
      this.habitLogWrites.delete(key);
    }
  }

  /**
   * この端末の TaskChute の端末ID。TaskChute の DeviceIdentityService と同じく、localStorage を使える端末では
   * localStorage だけを、使えない端末では TaskChute の設定（deviceId）を見る。
   * TaskChute が無効、または端末ID がまだない（この端末で TaskChute を使っていない）ときは、知らせて null。
   */
  private taskChuteDeviceIdOrNotice(): string | null {
    const host = this.app as unknown as TaskChuteHost;
    if (!isTaskChuteEnabled(host)) {
      new Notice(this.t("notice.habitLogNoTaskChute"));
      return null;
    }
    let deviceId: string | null;
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    if (storage) {
      try {
        deviceId = normalizeTaskChuteDeviceId(storage.getItem(TASKCHUTE_DEVICE_ID_STORAGE_KEY));
      } catch {
        deviceId = null;
      }
    } else {
      deviceId = normalizeTaskChuteDeviceId(host.plugins?.plugins?.[TASKCHUTE_PLUGIN_ID]?.settings?.deviceId);
    }
    if (!deviceId) new Notice(this.t("notice.habitLogNoDevice"));
    return deviceId;
  }

  /** TaskChute のログフォルダの inbox/<端末ID>/YYYY-MM.jsonl に、差分を 1 行足す。ファイルやフォルダがなければ作る。 */
  private async appendTaskChuteDelta(record: TaskChuteDeltaRecord): Promise<void> {
    const adapter = this.app.vault.adapter;
    const base = getTaskChuteLogFolder(this.app as unknown as TaskChuteHost);
    const path = normalizePath(taskChuteDeltaPath(base, record.deviceId, record.monthKey));
    const folder = path.slice(0, path.lastIndexOf("/"));
    let current = "";
    for (const part of folder.split("/")) {
      current = current ? `${current}/${part}` : part;
      if (!(await adapter.exists(current))) await adapter.mkdir(current);
    }
    if (await adapter.exists(path)) {
      const existing = await adapter.read(path);
      await adapter.append(path, deltaLineToAppend(existing, record));
    } else {
      await adapter.write(path, deltaLineToAppend("", record));
    }
    this.refreshCoalescer.noteOwnWrites([path]);
  }

  /** TaskChute の画面が開いているときだけ、「今日のタスクを表示」で読み直す（TaskChute がログをまとめ直す）。 */
  private reloadTaskChuteViewNow(): void {
    const host = this.app as unknown as TaskChuteHost;
    if (!canReloadTaskChuteView(host)) return;
    host.commands?.executeCommandById?.(TASKCHUTE_SHOW_TODAY_COMMAND);
  }

  async refreshViews(): Promise<void> {
    await this.refreshCoalescer.requestImmediate();
  }

  /** 書き込んだファイルのパスを覚え、その変更イベントによるすぐあとの読み直しを無視する。 */
  private async refreshViewsAfterWrite(...paths: string[]): Promise<void> {
    this.refreshCoalescer.noteOwnWrites(paths);
    await this.refreshViews();
  }

  private async refreshViewsNow(): Promise<void> {
    for (const leaf of this.app.workspace.getLeavesOfType(DAYSPANN_VIEW_TYPE)) {
      if (leaf.view instanceof DayspannView) await leaf.view.refresh();
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async setSectionCollapsed(kind: DayspannSectionKind, collapsed: boolean): Promise<void> {
    this.settings.collapsedSections = toggleCollapsedKey(
      this.settings.collapsedSections,
      kind,
      collapsed
    ) as DayspannSectionKind[];
    await this.saveSettings();
  }

  async setUndatedCollapsed(collapsed: boolean): Promise<void> {
    this.settings.undatedCollapsed = collapsed;
    await this.saveSettings();
  }

  async setArchiveCollapsed(collapsed: boolean): Promise<void> {
    this.settings.archiveCollapsed = collapsed;
    await this.saveSettings();
  }

  async setHabitGroupCollapsed(key: string, collapsed: boolean): Promise<void> {
    this.settings.collapsedHabitGroups = toggleCollapsedKey(
      this.settings.collapsedHabitGroups,
      key,
      collapsed
    );
    await this.saveSettings();
  }

  async setActiveTab(type: RecordType): Promise<void> {
    this.settings.activeTab = type;
    await this.saveSettings();
  }

  async setHabitFilter(filter: HabitFilter): Promise<void> {
    this.settings.habitFilter = filter;
    await this.saveSettings();
  }

  async setProjectCategoryFilter(filter: string): Promise<void> {
    this.settings.projectCategoryFilter = filter;
    await this.saveSettings();
  }

  private async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Partial<DayspannSettings> | null;
    const savedStorageFolder = saved?.storageFolder?.trim();
    const legacyStorageFolder = ["dayspann", "Dayspan"].find((folder) =>
      this.app.vault.getAbstractFileByPath(folder)
    );
    const storageFolder = savedStorageFolder
      ? savedStorageFolder
      : legacyStorageFolder &&
          !this.app.vault.getAbstractFileByPath(DEFAULT_SETTINGS.storageFolder)
        ? legacyStorageFolder
        : DEFAULT_SETTINGS.storageFolder;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...saved,
      storageFolder,
      soonDays: parseSoonDays(saved?.soonDays) ?? DEFAULT_SOON_DAYS,
      stalledDays: parseSoonDays(saved?.stalledDays) ?? DEFAULT_STALLED_DAYS,
      sectionOrder: normalizeSectionOrder(saved?.sectionOrder),
      collapsedSections: normalizeCollapsedSections(saved?.collapsedSections),
      undatedCollapsed: saved?.undatedCollapsed ?? DEFAULT_SETTINGS.undatedCollapsed,
      archiveCollapsed: saved?.archiveCollapsed ?? DEFAULT_SETTINGS.archiveCollapsed,
      collapsedHabitGroups: normalizeCollapsedHabitGroups(saved?.collapsedHabitGroups),
      habitFilter: normalizeHabitFilter(saved?.habitFilter),
      projectCategoryFilter:
        typeof saved?.projectCategoryFilter === "string"
          ? saved.projectCategoryFilter
          : PROJECT_FILTER_ALL,
      projectCategoryOrder:
        typeof saved?.projectCategoryOrder === "string" && saved.projectCategoryOrder.trim()
          ? saved.projectCategoryOrder.trim()
          : DEFAULT_PROJECT_CATEGORY_ORDER_TEXT,
      activeTab: normalizeRecordType(saved?.activeTab),
      habitLogButtonEnabled:
        typeof saved?.habitLogButtonEnabled === "boolean"
          ? saved.habitLogButtonEnabled
          : DEFAULT_SETTINGS.habitLogButtonEnabled,
      habitQuickAddChoice: normalizeQuickAddChoiceName(saved?.habitQuickAddChoice),
      habitMemoEnabled: normalizeHabitMemoEnabled(saved?.habitMemoEnabled),
      habitDailyLogFolder: normalizeDailyLogFolder(saved?.habitDailyLogFolder),
    };
  }

  private async migrateLegacyData(): Promise<void> {
    try {
      const legacyStorageFolder = "Dayspan";
      if (this.normalizedStorageFolder() === legacyStorageFolder) {
        const legacyFolder = this.app.vault.getAbstractFileByPath(legacyStorageFolder);
        const currentFolder = this.app.vault.getAbstractFileByPath(DEFAULT_SETTINGS.storageFolder);

        if (legacyFolder instanceof TFolder && !currentFolder) {
          await this.app.fileManager.renameFile(legacyFolder, DEFAULT_SETTINGS.storageFolder);
          this.settings.storageFolder = DEFAULT_SETTINGS.storageFolder;
          await this.saveSettings();
        } else if (!legacyFolder && currentFolder instanceof TFolder) {
          this.settings.storageFolder = DEFAULT_SETTINGS.storageFolder;
          await this.saveSettings();
        }
      }

      const root = this.app.vault.getAbstractFileByPath(this.normalizedStorageFolder());
      if (!(root instanceof TFolder)) return;

      const files: TFile[] = [];
      this.collectMarkdownFiles(root, files);
      for (const file of files) {
        const content = await this.app.vault.cachedRead(file);
        const frontmatterMatch = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
        if (!frontmatterMatch?.[1]) continue;

        let frontmatter: Record<string, unknown>;
        try {
          frontmatter = parseYaml(frontmatterMatch[1]) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (frontmatter.type !== "dayspan") continue;

        await this.app.fileManager.processFrontMatter(
          file,
          (recordFrontmatter: Record<string, unknown>) => {
            if (recordFrontmatter.type === "dayspan") recordFrontmatter.type = "dayspann";
          }
        );
      }
    } catch {
      new Notice(this.t("notice.migrationFailed"));
    }
  }

  private inferDate(file: TFile | null): string {
    if (!file) return this.todayKey();
    if (parseDateKey(file.basename)) return file.basename;

    const frontmatter: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const rawDate: unknown =
      typeof frontmatter === "object" && frontmatter !== null && "date" in frontmatter
        ? frontmatter.date
        : undefined;
    const date = rawDate instanceof Date ? rawDate.toISOString().slice(0, 10) : rawDate;
    if (typeof date === "string" && parseDateKey(date)) return date;
    return this.todayKey();
  }

  private getMarkdownPreviewSelection(
    view: MarkdownView | null
  ): { text: string; sourceLine?: number } | null {
    if (!view || view.getMode() !== "preview") return null;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);
    const preview = view.containerEl.querySelector(".markdown-preview-view");
    if (!preview || !preview.contains(range.commonAncestorContainer)) return null;

    const text = selection.toString().trim();
    if (!text) return null;

    const container =
      range.commonAncestorContainer.instanceOf(Element)
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
    const rawLine = container?.closest<HTMLElement>("[data-line]")?.dataset.line;
    const zeroBasedLine = rawLine === undefined ? Number.NaN : Number(rawLine);

    return {
      text,
      sourceLine: Number.isInteger(zeroBasedLine) && zeroBasedLine >= 0 ? zeroBasedLine + 1 : undefined,
    };
  }

  private normalizedStorageFolder(): string {
    const value = normalizePath(this.settings.storageFolder.trim()).replace(/\/$/, "");
    return value || DEFAULT_SETTINGS.storageFolder;
  }

  /**
   * 新しい記録を作ってお知らせを出す。
   * TaskChute が有効なら、TaskChute のタスク（target_date は空）としても作る。
   */
  private async registerRecord(draft: DayspannDraft): Promise<void> {
    const emptyFields = emptyRequiredFields(draft);
    if (
      emptyFields.length > 0 &&
      !(await confirmEmptyFields(this.app, emptyFields, (key, variables) => this.t(key, variables)))
    ) {
      // 登録画面は閉じずに、入力した内容のまま残す（エラーの文字は出さない）。
      throw new KeepEntryOpenError();
    }
    const host = this.app as unknown as TaskChuteHost;
    const duplicates = this.findDuplicateNotes(draft.title, host);
    if (
      duplicates.length > 0 &&
      !(await confirmDuplicate(
        this.app,
        draft.title,
        duplicates.map((note) => note.path),
        (key, variables) => this.t(key, variables)
      ))
    ) {
      // 登録画面は閉じずに残し、名前を直して登録し直せるようにする。
      throw new Error(this.t("error.duplicateCancelled"));
    }
    if (!isTaskChuteEnabled(host)) {
      await this.createRecord(draft, this.normalizedStorageFolder());
      new Notice(this.t("notice.registered"));
      return;
    }

    const taskFolder = getTaskChuteTaskFolder(host);
    const { folder, visibleToTaskChute } = chooseNewRecordFolder(this.normalizedStorageFolder(), taskFolder);
    if (!visibleToTaskChute) {
      // TaskChute から見えない場所にタスクの項目だけ書いても TaskChute には出ないので、今までどおりの記録にする。
      await this.createRecord(draft, folder);
      new Notice(this.t("notice.registeredOutsideTaskChute", { folder: taskFolder }));
      return;
    }

    const taskchute = buildTaskChuteFields(generateTaskChuteTaskId(this.randomUUID()));
    await this.createRecord(draft, folder, taskchute);
    new Notice(this.t("notice.registeredTaskChute"));
  }

  /** PJ-span の記録フォルダと TaskChute のタスクフォルダから、同じ名前の完了していないノートを探す。 */
  private findDuplicateNotes(name: string, host: TaskChuteHost): DuplicateCandidate[] {
    const folders = [this.normalizedStorageFolder()];
    if (isTaskChuteEnabled(host)) folders.push(getTaskChuteTaskFolder(host));

    const candidates: DuplicateCandidate[] = [];
    for (const folderPath of folders) {
      const folder = this.app.vault.getAbstractFileByPath(normalizePath(folderPath));
      if (!(folder instanceof TFolder)) continue;
      const files: TFile[] = [];
      this.collectMarkdownFiles(folder, files);
      for (const file of files) {
        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
        candidates.push({ path: file.path, basename: file.basename, frontmatter });
      }
    }
    return findDuplicates(name, candidates);
  }

  /** UUID を作る関数（使えない環境なら null）。 */
  private randomUUID(): (() => string) | null {
    const cryptoApi = window.crypto;
    return typeof cryptoApi?.randomUUID === "function" ? () => cryptoApi.randomUUID() : null;
  }

  private async createRecord(
    draft: DayspannDraft,
    folder: string,
    taskchute?: TaskChuteNewTaskFields
  ): Promise<TFile> {
    await this.ensureFolder(folder);
    // ファイル名は名前だけにする（日付は入れない）。日付は frontmatter の date に入っている。
    const base = sanitizeFileName(draft.title, this.t("default.entry"));
    let path = `${folder}/${base}.md`;
    let index = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = `${folder}/${base} ${index}.md`;
      index += 1;
    }
    const file = await this.app.vault.create(path, serializeRecord(draft, taskchute));
    this.refreshCoalescer.noteOwnWrites([file.path]);
    return file;
  }

  private async ensureFolder(folder: string): Promise<void> {
    let path = "";
    for (const segment of folder.split("/").filter(Boolean)) {
      path = path ? `${path}/${segment}` : segment;
      if (!this.app.vault.getAbstractFileByPath(path)) {
        await this.app.vault.createFolder(path);
      }
    }
  }

  private collectMarkdownFiles(folder: TFolder, files: TFile[]): void {
    for (const child of folder.children) {
      if (child instanceof TFolder) {
        this.collectMarkdownFiles(child, files);
      } else if (child instanceof TFile && child.extension === "md") {
        files.push(child);
      }
    }
  }

  private scheduleRefreshForPaths(...paths: string[]): void {
    const relevant = paths.filter((path) => this.isStoragePath(path) || this.isTaskChuteLogPath(path));
    if (!relevant.length) return;
    this.scheduleRefresh(relevant);
  }

  private isStoragePath(path: string): boolean {
    const folder = this.normalizedStorageFolder();
    return path === folder || path.startsWith(`${folder}/`);
  }

  /** TaskChute のログの変更で読み直す（習慣のヒートマップと、プロジェクトの「今日やった」進捗の両方で使う）。 */
  private isTaskChuteLogPath(path: string): boolean {
    const folder = getTaskChuteLogFolder(this.app as unknown as TaskChuteHost);
    return path.startsWith(`${folder}/`) && (path.endsWith("-tasks.json") || path.endsWith(".jsonl"));
  }

  private scheduleRefresh(paths: string[]): void {
    if (!this.app.workspace.getLeavesOfType(DAYSPANN_VIEW_TYPE).length) return;
    this.refreshCoalescer.requestScheduled(paths);
  }
}

type DayspannSettingKey = "storageFolder" | "habitDailyLogFolder";

class DayspannSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: DayspannPlugin) {
    super(app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem<DayspannSettingKey>[] {
    return [
      {
        name: this.plugin.t("setting.storage"),
        desc: this.plugin.t("setting.storageDesc"),
        control: {
          type: "folder",
          key: "storageFolder",
          defaultValue: DEFAULT_SETTINGS.storageFolder,
          placeholder: DEFAULT_SETTINGS.storageFolder,
        },
      },
      {
        type: "group",
        heading: this.plugin.t("setting.colors"),
        items: [
          {
            name: this.plugin.t("setting.futureColor"),
            desc: this.plugin.t("setting.futureColorDesc"),
            render: (setting) => {
              setting
                .addColorPicker((color) =>
                  color
                    .setValue(this.plugin.settings.futureColor)
                    .onChange((value) => void this.setColor("futureColor", value))
                )
                .addExtraButton((button) =>
                  button
                    .setIcon("rotate-ccw")
                    .setTooltip(this.plugin.t("setting.resetColor"))
                    .onClick(() => void this.resetColor("futureColor"))
                );
            },
          },
          {
            name: this.plugin.t("setting.pastColor"),
            desc: this.plugin.t("setting.pastColorDesc"),
            render: (setting) => {
              setting
                .addColorPicker((color) =>
                  color
                    .setValue(this.plugin.settings.pastColor)
                    .onChange((value) => void this.setColor("pastColor", value))
                )
                .addExtraButton((button) =>
                  button
                    .setIcon("rotate-ccw")
                    .setTooltip(this.plugin.t("setting.resetColor"))
                    .onClick(() => void this.resetColor("pastColor"))
                );
            },
          },
          {
            name: this.plugin.t("setting.soonDays"),
            desc: this.plugin.t("setting.soonDaysDesc"),
            render: (setting) => {
              setting.addText((text) => {
                text.inputEl.type = "number";
                text.inputEl.min = "0";
                text.inputEl.max = String(MAX_SOON_DAYS);
                text
                  .setPlaceholder(String(DEFAULT_SOON_DAYS))
                  .setValue(String(this.plugin.settings.soonDays))
                  .onChange((value) => void this.setSoonDays(value));
              });
            },
          },
          {
            name: this.plugin.t("setting.stalledDays"),
            desc: this.plugin.t("setting.stalledDaysDesc"),
            render: (setting) => {
              setting.addText((text) => {
                text.inputEl.type = "number";
                text.inputEl.min = "0";
                text.inputEl.max = String(MAX_SOON_DAYS);
                text
                  .setPlaceholder(String(DEFAULT_STALLED_DAYS))
                  .setValue(String(this.plugin.settings.stalledDays))
                  .onChange((value) => void this.setStalledDays(value));
              });
            },
          },
        ],
      },
      {
        name: this.plugin.t("setting.projectCategoryOrder"),
        desc: this.plugin.t("setting.projectCategoryOrderDesc"),
        render: (setting) => {
          setting.addText((text) => {
            text
              .setPlaceholder(DEFAULT_PROJECT_CATEGORY_ORDER_TEXT)
              .setValue(this.plugin.settings.projectCategoryOrder)
              .onChange((value) => void this.setProjectCategoryOrder(value));
          });
        },
      },
      {
        name: this.plugin.t("setting.habitLogButton"),
        desc: this.plugin.t("setting.habitLogButtonDesc"),
        render: (setting) => {
          setting.addToggle((toggle) =>
            toggle
              .setValue(this.plugin.settings.habitLogButtonEnabled)
              .onChange((value) => void this.setHabitLogButtonEnabled(value))
          );
        },
      },
      {
        name: this.plugin.t("setting.habitMemo"),
        desc: this.plugin.t("setting.habitMemoDesc"),
        render: (setting) => {
          setting.addToggle((toggle) =>
            toggle
              .setValue(this.plugin.settings.habitMemoEnabled)
              .onChange((value) => void this.setHabitMemoEnabled(value))
          );
        },
      },
      {
        name: this.plugin.t("setting.habitDailyLogFolder"),
        desc: this.plugin.t("setting.habitDailyLogFolderDesc"),
        control: {
          type: "folder",
          key: "habitDailyLogFolder",
          defaultValue: DEFAULT_DAILY_LOG_FOLDER,
          placeholder: DEFAULT_DAILY_LOG_FOLDER,
        },
      },
      {
        name: this.plugin.t("setting.habitQuickAdd"),
        desc: this.plugin.t("setting.habitQuickAddDesc"),
        render: (setting) => {
          setting.addText((text) => {
            text
              .setPlaceholder(this.plugin.t("setting.habitQuickAddPlaceholder"))
              .setValue(this.plugin.settings.habitQuickAddChoice)
              .onChange((value) => void this.setHabitQuickAddChoice(value));
            const suggest = new QuickAddChoiceSuggest(this.app, text.inputEl);
            suggest.onSelect((value) => {
              suggest.setValue(value);
              void this.setHabitQuickAddChoice(value);
              suggest.close();
            });
          });
        },
      },
      {
        name: this.plugin.t("setting.calculation"),
        desc: this.plugin.t("setting.calculationDesc"),
        searchable: false,
      },
    ];
  }

  getControlValue(key: DayspannSettingKey): unknown {
    return this.plugin.settings[key];
  }

  async setControlValue(key: DayspannSettingKey, value: unknown): Promise<void> {
    if (typeof value !== "string") return;
    if (key === "habitDailyLogFolder") {
      this.plugin.settings.habitDailyLogFolder = normalizeDailyLogFolder(value);
      await this.plugin.saveSettings();
      return;
    }
    if (key !== "storageFolder") return;
    this.plugin.settings.storageFolder = value.trim() || DEFAULT_SETTINGS.storageFolder;
    await this.plugin.saveSettings();
    await this.plugin.refreshViews();
  }

  private async setColor(
    key: "futureColor" | "pastColor",
    value: string
  ): Promise<void> {
    this.plugin.settings[key] = value;
    await this.plugin.saveSettings();
    await this.plugin.refreshViews();
  }

  private async setSoonDays(value: string): Promise<void> {
    const days = parseSoonDays(value);
    if (days === null) return;
    this.plugin.settings.soonDays = days;
    await this.plugin.saveSettings();
    await this.plugin.refreshViews();
  }

  private async setHabitQuickAddChoice(value: string): Promise<void> {
    this.plugin.settings.habitQuickAddChoice = normalizeQuickAddChoiceName(value);
    await this.plugin.saveSettings();
  }

  private async setProjectCategoryOrder(value: string): Promise<void> {
    this.plugin.settings.projectCategoryOrder = value.trim() || DEFAULT_PROJECT_CATEGORY_ORDER_TEXT;
    await this.plugin.saveSettings();
    await this.plugin.refreshViews();
  }

  private async setHabitLogButtonEnabled(value: boolean): Promise<void> {
    this.plugin.settings.habitLogButtonEnabled = value;
    await this.plugin.saveSettings();
    await this.plugin.refreshViews();
  }

  private async setHabitMemoEnabled(value: boolean): Promise<void> {
    this.plugin.settings.habitMemoEnabled = value;
    await this.plugin.saveSettings();
  }

  private async setStalledDays(value: string): Promise<void> {
    const days = parseSoonDays(value);
    if (days === null) return;
    this.plugin.settings.stalledDays = days;
    await this.plugin.saveSettings();
    await this.plugin.refreshViews();
  }

  private async resetColor(key: "futureColor" | "pastColor"): Promise<void> {
    this.plugin.settings[key] = DEFAULT_SETTINGS[key];
    await this.plugin.saveSettings();
    await this.plugin.refreshViews();
    this.update();
  }
}

/** 設定の QuickAdd の選択肢の欄で、QuickAdd の設定にある選択肢の名前を候補に出す。QuickAdd が無ければ候補なし。 */
class QuickAddChoiceSuggest extends AbstractInputSuggest<string> {
  protected getSuggestions(query: string): string[] {
    const names = listQuickAddChoiceNames(getQuickAddChoices(this.app as unknown as QuickAddHost));
    return filterQuickAddChoiceNames(names, query);
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(value);
  }
}
