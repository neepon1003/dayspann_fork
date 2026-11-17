import {
  App,
  Editor,
  getLanguage,
  MarkdownFileInfo,
  MarkdownView,
  Menu,
  Notice,
  normalizePath,
  parseYaml,
  Plugin,
  PluginSettingTab,
  SettingDefinitionItem,
  TFile,
  TFolder,
} from "obsidian";
import {
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
} from "./src/modals";
import { applyDraftToFrontmatter, emptyRequiredFields, replaceRecordBody } from "./src/record-edit";
import { DEFAULT_RECORD_TYPE, normalizeRecordType, RecordType } from "./src/record-type";
import { HabitLogDays, HabitLogDelta, mergeHabitLogs, parseDeltaLines, parseMonthlyLog } from "./src/habit-log";
import {
  buildTaskChuteFields,
  canReloadTaskChuteView,
  chooseNewRecordFolder,
  generateTaskChuteTaskId,
  getTaskChuteTaskFolder,
  getTaskChuteLogFolder,
  isTaskChuteEnabled,
  readTargetDate,
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
  MAX_SOON_DAYS,
  normalizeCollapsedSections,
  normalizeSectionOrder,
  parseSoonDays,
} from "./src/settings";
import {
  formatSourceReference,
  isLinkedSourceReference,
  parseSourceReference,
} from "./src/source-link";
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
  /** 最後に選んだタブ（プロジェクト・習慣）。 */
  activeTab: RecordType;
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
  activeTab: DEFAULT_RECORD_TYPE,
};

export default class DayspannPlugin extends Plugin {
  settings: DayspannSettings = DEFAULT_SETTINGS;
  private refreshTimer?: number;

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
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
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
        // ファイル全体を書き直さず、PJ-spanのキーと本文だけを変える（TaskChuteの taskId・tags・target_date などを残すため）。
        await this.app.vault.process(record.file, (content) => replaceRecordBody(content, draft.excerpt));
        await this.app.fileManager.processFrontMatter(
          record.file,
          (frontmatter: Record<string, unknown>) => applyDraftToFrontmatter(frontmatter, draft)
        );
        new Notice(this.t("notice.updated"));
        await this.refreshViews();
      }
    ).open();
  }

  async deleteRecord(record: DayspannRecord): Promise<void> {
    const confirmed = await this.app.fileManager.promptForDeletion(record.file);
    if (!confirmed) return;
    await this.app.fileManager.trashFile(record.file);
    new Notice(this.t("notice.trashed"));
    await this.refreshViews();
  }

  async setRecordArchived(record: DayspannRecord, archived: boolean): Promise<void> {
    // プロジェクトを完了にするとき、完了条件が書いてあれば先に確認する。空なら確認せずに完了にする。
    // 習慣は、完了条件の確認も、ログの「完了」行も出さない。
    const isProject = record.type === "project";
    if (archived && isProject && record.goal) {
      const confirmed = await confirmGoalComplete(this.app, record.goal, (key, variables) => this.t(key, variables));
      if (!confirmed) return;
    }
    if (archived && isProject) {
      const logLine = `- ${this.todayKey()} 完了`;
      await this.app.vault.process(record.file, (content) => appendLogLineToFile(content, logLine));
    }
    await this.app.fileManager.processFrontMatter(
      record.file,
      (frontmatter: Record<string, unknown>) => {
        if (archived) {
          frontmatter.archived = true;
          frontmatter.completed = this.todayKey();
        } else {
          delete frontmatter.archived;
          delete frontmatter.completed;
        }
      }
    );
    new Notice(this.t(archived ? "notice.archived" : "notice.restored"));
    await this.refreshViews();
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
    await this.refreshViews();
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
    await this.refreshViews();
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
      await this.refreshViews();
      return;
    }

    new Notice(this.t("notice.addedToday", { title: record.title }));
    await this.refreshViews();
    await this.reloadTaskChuteView(record.file, today);
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
      readTargetDate(this.app.metadataCache.getFileCache(file)?.frontmatter?.target_date) === targetDate;
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

  async refreshViews(): Promise<void> {
    for (const leaf of this.app.workspace.getLeavesOfType(DAYSPANN_VIEW_TYPE)) {
      if (leaf.view instanceof DayspannView) await leaf.view.refresh();
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async setSectionCollapsed(kind: DayspannSectionKind, collapsed: boolean): Promise<void> {
    const collapsedSections = this.settings.collapsedSections.filter((item) => item !== kind);
    if (collapsed) collapsedSections.push(kind);
    this.settings.collapsedSections = collapsedSections;
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

  async setActiveTab(type: RecordType): Promise<void> {
    this.settings.activeTab = type;
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
      activeTab: normalizeRecordType(saved?.activeTab),
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
   * TaskChute が有効なら、TaskChute のタスク（今日の一覧に入る）としても作り、TaskChute の画面が開いていれば読み直す。
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
      // TaskChute から見えない場所にタスクの項目だけ書いても今日の一覧には出ないので、今までどおりの記録にする。
      await this.createRecord(draft, folder);
      new Notice(this.t("notice.registeredOutsideTaskChute", { folder: taskFolder }));
      return;
    }

    const today = this.todayKey();
    const taskchute = buildTaskChuteFields(today, generateTaskChuteTaskId(this.randomUUID()));
    const file = await this.createRecord(draft, folder, taskchute);
    new Notice(this.t("notice.registeredToday"));
    await this.reloadTaskChuteView(file, today);
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
    return this.app.vault.create(path, serializeRecord(draft, taskchute));
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
    if (!paths.some((path) => this.isStoragePath(path) || this.isTaskChuteLogPath(path))) return;
    this.scheduleRefresh();
  }

  private isStoragePath(path: string): boolean {
    const folder = this.normalizedStorageFolder();
    return path === folder || path.startsWith(`${folder}/`);
  }

  /** 習慣のタブを出しているときだけ、TaskChute のログの変更で読み直す。 */
  private isTaskChuteLogPath(path: string): boolean {
    if (this.settings.activeTab !== "habit") return false;
    const folder = getTaskChuteLogFolder(this.app as unknown as TaskChuteHost);
    return path.startsWith(`${folder}/`) && (path.endsWith("-tasks.json") || path.endsWith(".jsonl"));
  }

  private scheduleRefresh(): void {
    if (!this.app.workspace.getLeavesOfType(DAYSPANN_VIEW_TYPE).length) return;
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => void this.refreshViews(), 150);
  }
}

type DayspannSettingKey = "storageFolder";

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
        type: "list",
        heading: this.plugin.t("setting.sectionOrder"),
        items: this.plugin.settings.sectionOrder.map((kind, index) => ({
          name: this.sectionTitle(kind),
          desc: this.plugin.t("setting.position", { position: index + 1 }),
        })),
        onReorder: (from, to) => void this.moveSection(from, to),
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
    if (key !== "storageFolder" || typeof value !== "string") return;
    this.plugin.settings.storageFolder = value.trim() || DEFAULT_SETTINGS.storageFolder;
    await this.plugin.saveSettings();
    await this.plugin.refreshViews();
  }

  private sectionTitle(kind: DayspannSectionKind): string {
    if (kind === "future") return this.plugin.t("section.future");
    if (kind === "today") return this.plugin.t("section.today");
    return this.plugin.t("section.past");
  }

  private async moveSection(from: number, to: number): Promise<void> {
    if (to < 0 || to >= this.plugin.settings.sectionOrder.length) return;

    const order = [...this.plugin.settings.sectionOrder];
    const [section] = order.splice(from, 1);
    if (!section) return;
    order.splice(to, 0, section);
    this.plugin.settings.sectionOrder = order;

    await this.plugin.saveSettings();
    await this.plugin.refreshViews();
    this.update();
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
