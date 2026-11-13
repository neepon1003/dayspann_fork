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
import { toDateKey, parseDateKey } from "./src/date-utils";
import {
  createTranslator,
  DayspannLocale,
  resolveLocale,
  TranslationKey,
  TranslationVariables,
} from "./src/i18n";
import { DayspannEntryModal } from "./src/modals";
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
  DayspannSectionKind,
  normalizeCollapsedSections,
  normalizeSectionOrder,
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
  sectionOrder: DayspannSectionKind[];
  collapsedSections: DayspannSectionKind[];
  undatedCollapsed: boolean;
  archiveCollapsed: boolean;
}

const DEFAULT_SETTINGS: DayspannSettings = {
  storageFolder: "pj-span",
  futureColor: "#22c55e",
  pastColor: "#ef4444",
  sectionOrder: [...DEFAULT_SECTION_ORDER],
  collapsedSections: [],
  undatedCollapsed: false,
  archiveCollapsed: true,
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
        await this.createRecord(draft);
        new Notice(this.t("notice.registered"));
        await this.activateView();
      }
    ).open();
  }

  openManualEntry(): void {
    new DayspannEntryModal(
      this.app,
      { title: "", date: this.todayKey(), excerpt: "" },
      this.t("modal.registerManual"),
      this.t("action.register"),
      (key, variables) => this.t(key, variables),
      async (draft) => {
        await this.createRecord(draft);
        new Notice(this.t("notice.registered"));
        await this.refreshViews();
      }
    ).open();
  }

  openEditEntry(record: DayspannRecord): void {
    new DayspannEntryModal(
      this.app,
      {
        title: record.title,
        date: record.date,
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
        await this.app.vault.modify(record.file, serializeRecord(draft));
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
      files.map(async (file) => parseRecord(file, await this.app.vault.cachedRead(file)))
    );
    return parsed.filter((record): record is DayspannRecord => record !== null);
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
      sectionOrder: normalizeSectionOrder(saved?.sectionOrder),
      collapsedSections: normalizeCollapsedSections(saved?.collapsedSections),
      undatedCollapsed: saved?.undatedCollapsed ?? DEFAULT_SETTINGS.undatedCollapsed,
      archiveCollapsed: saved?.archiveCollapsed ?? DEFAULT_SETTINGS.archiveCollapsed,
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

  private async createRecord(draft: DayspannDraft): Promise<TFile> {
    const folder = this.normalizedStorageFolder();
    await this.ensureFolder(folder);
    const name = sanitizeFileName(draft.title, this.t("default.entry"));
    const base = draft.date ? `${draft.date} - ${name}` : name;
    let path = `${folder}/${base}.md`;
    let index = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = `${folder}/${base} ${index}.md`;
      index += 1;
    }
    return this.app.vault.create(path, serializeRecord(draft));
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
    if (!paths.some((path) => this.isStoragePath(path))) return;
    this.scheduleRefresh();
  }

  private isStoragePath(path: string): boolean {
    const folder = this.normalizedStorageFolder();
    return path === folder || path.startsWith(`${folder}/`);
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

  private async resetColor(key: "futureColor" | "pastColor"): Promise<void> {
    this.plugin.settings[key] = DEFAULT_SETTINGS[key];
    await this.plugin.saveSettings();
    await this.plugin.refreshViews();
    this.update();
  }
}
