import {
  App,
  ExtraButtonComponent,
  FuzzySuggestModal,
  Modal,
  Notice,
  Platform,
  Setting,
  TFile,
} from "obsidian";
import {
  DEFAULT_DISPLAY_MODE,
  differenceInCalendarDays,
  normalizeDisplayMode,
  parseDateKey,
} from "./date-utils";
import { readCategory } from "./habit-category";
import { Translator } from "./i18n";
import { DayspannDraft } from "./model";
import { habitNextAction, joinTitle, splitTitle } from "./note-template";
import type { EmptyRequiredField } from "./record-edit";
import { DEFAULT_RECORD_TYPE, normalizeRecordType, readRecordType } from "./record-type";

/**
 * 同じ名前がもうあるときの確認。「新しく作る」なら true、「やめる」や閉じたときは false。
 */
export function confirmDuplicate(
  app: App,
  name: string,
  duplicatePaths: string[],
  t: Translator
): Promise<boolean> {
  return new Promise((resolve) => {
    new DuplicateConfirmModal(app, name, duplicatePaths, t, resolve).open();
  });
}

class DuplicateConfirmModal extends Modal {
  private answered = false;

  constructor(
    app: App,
    private name: string,
    private duplicatePaths: string[],
    private t: Translator,
    private resolve: (create: boolean) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText(this.t("duplicate.title"));
    contentEl.createEl("p", { text: this.t("duplicate.message", { name: this.name }) });
    const list = contentEl.createEl("ul");
    for (const path of this.duplicatePaths) list.createEl("li", { text: path });

    const actions = contentEl.createDiv({ cls: "modal-button-container" });
    const back = actions.createEl("button", { text: this.t("duplicate.back"), cls: "mod-cta" });
    back.addEventListener("click", () => this.answer(false));
    const create = actions.createEl("button", { text: this.t("duplicate.create") });
    create.addEventListener("click", () => this.answer(true));
    window.setTimeout(() => back.focus(), 30);
  }

  onClose(): void {
    this.contentEl.empty();
    // ×ボタンや Esc で閉じたときは「やめる」と同じにする。
    if (!this.answered) this.resolve(false);
  }

  private answer(create: boolean): void {
    this.answered = true;
    this.resolve(create);
    this.close();
  }
}

/**
 * 完了するときの確認。「完了にする」なら true、「まだ」や閉じたときは false。
 */
export function confirmGoalComplete(app: App, goal: string, t: Translator): Promise<boolean> {
  return new Promise((resolve) => {
    new GoalCompleteModal(app, goal, t, resolve).open();
  });
}

class GoalCompleteModal extends Modal {
  private answered = false;

  constructor(
    app: App,
    private goal: string,
    private t: Translator,
    private resolve: (complete: boolean) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText(this.t("completeConfirm.title"));
    contentEl.createEl("p", { text: this.goal });

    const actions = contentEl.createDiv({ cls: "modal-button-container" });
    const notYet = actions.createEl("button", { text: this.t("completeConfirm.notYet") });
    notYet.addEventListener("click", () => this.answer(false));
    const complete = actions.createEl("button", { text: this.t("completeConfirm.confirm"), cls: "mod-cta" });
    complete.addEventListener("click", () => this.answer(true));
    window.setTimeout(() => complete.focus(), 30);
  }

  onClose(): void {
    this.contentEl.empty();
    // ×ボタンや Esc で閉じたときは「まだ」と同じにする。
    if (!this.answered) this.resolve(false);
  }

  private answer(complete: boolean): void {
    this.answered = true;
    this.resolve(complete);
    this.close();
  }
}

/**
 * 新しく登録するとき、完了条件や期日が空なら確かめる。「このまま登録する」なら true、「戻って入力する」や閉じたときは false。
 */
export function confirmEmptyFields(app: App, fields: EmptyRequiredField[], t: Translator): Promise<boolean> {
  return new Promise((resolve) => {
    new EmptyFieldsConfirmModal(app, fields, t, resolve).open();
  });
}

class EmptyFieldsConfirmModal extends Modal {
  private answered = false;

  constructor(
    app: App,
    private fields: EmptyRequiredField[],
    private t: Translator,
    private resolve: (register: boolean) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText(this.t("emptyCheck.title"));
    const goalEmpty = this.fields.includes("goal");
    const dateEmpty = this.fields.includes("date");
    const message = goalEmpty && dateEmpty
      ? this.t("emptyCheck.both")
      : goalEmpty
        ? this.t("emptyCheck.goal")
        : this.t("emptyCheck.date");
    contentEl.createEl("p", { text: message });

    const actions = contentEl.createDiv({ cls: "modal-button-container" });
    const back = actions.createEl("button", { text: this.t("emptyCheck.back"), cls: "mod-cta" });
    back.addEventListener("click", () => this.answer(false));
    const register = actions.createEl("button", { text: this.t("emptyCheck.register") });
    register.addEventListener("click", () => this.answer(true));
    window.setTimeout(() => back.focus(), 30);
  }

  onClose(): void {
    this.contentEl.empty();
    // ×ボタンや Esc で閉じたときは「戻って入力する」と同じにする。
    if (!this.answered) this.resolve(false);
  }

  private answer(register: boolean): void {
    this.answered = true;
    this.resolve(register);
    this.close();
  }
}

/**
 * 延期する日付を選ぶ。「決定」なら YYYY-MM-DD、「やめる」や閉じたときは null。
 * 今日より前の日付は受け付けず、案内を出して画面を開いたままにする。
 */
export function choosePostponeDate(
  app: App,
  defaultDateKey: string,
  todayKey: string,
  t: Translator
): Promise<string | null> {
  return new Promise((resolve) => {
    new PostponeDateModal(app, defaultDateKey, todayKey, t, resolve).open();
  });
}

class PostponeDateModal extends Modal {
  private answered = false;
  private inputEl?: HTMLInputElement;

  constructor(
    app: App,
    private defaultDateKey: string,
    private todayKey: string,
    private t: Translator,
    private resolve: (dateKey: string | null) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText(this.t("postponePick.title"));

    const field = contentEl.createDiv("dayspann-modal-field");
    const input = field.createEl("input", {
      type: "date",
      cls: "dayspann-postpone-date",
      attr: { type: "date", min: this.todayKey },
    });
    input.value = this.defaultDateKey;
    this.inputEl = input;
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.submit();
      }
    });

    const actions = contentEl.createDiv({ cls: "modal-button-container" });
    const cancel = actions.createEl("button", { text: this.t("postponePick.cancel") });
    cancel.addEventListener("click", () => this.answer(null));
    const confirm = actions.createEl("button", { text: this.t("postponePick.confirm"), cls: "mod-cta" });
    confirm.addEventListener("click", () => this.submit());
    window.setTimeout(() => input.focus(), 30);
  }

  onClose(): void {
    this.contentEl.empty();
    // ×ボタンや Esc で閉じたときは「やめる」と同じにする。
    if (!this.answered) this.resolve(null);
  }

  private submit(): void {
    const value = this.inputEl?.value.trim() ?? "";
    if (!parseDateKey(value)) {
      new Notice(this.t("error.dateInvalid"));
      return;
    }
    if (differenceInCalendarDays(value, this.todayKey) < 0) {
      new Notice(this.t("error.dateBeforeToday"));
      return;
    }
    this.answer(value);
  }

  private answer(dateKey: string | null): void {
    this.answered = true;
    this.resolve(dateKey);
    this.close();
  }
}

/** 登録画面を、エラーの文字を出さずに開いたままにしたいときに投げる（確認で「戻って入力する」を選んだときなど）。 */
export class KeepEntryOpenError extends Error {}

export class DayspannEntryModal extends Modal {
  private draft: DayspannDraft;
  private errorEl?: HTMLElement;
  private nameInput?: HTMLInputElement;
  private nextActionInput?: HTMLInputElement;

  constructor(
    app: App,
    initial: DayspannDraft,
    private heading: string,
    private submitLabel: string,
    private t: Translator,
    private onSubmit: (draft: DayspannDraft) => Promise<void>
  ) {
    super(app);
    this.draft = {
      ...initial,
      displayMode: initial.displayMode ?? DEFAULT_DISPLAY_MODE,
      type: initial.type ?? DEFAULT_RECORD_TYPE,
    };
    if (this.draft.type === "habit") this.splitHabitTitle();
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText(this.heading);
    this.modalEl.addClass("dayspann-entry-modal");

    new Setting(contentEl)
      .setName(this.t("modal.name"))
      .setDesc(this.t("modal.nameDesc"))
      .addText((text) => {
        this.nameInput = text.inputEl;
        text.setValue(this.draft.title).onChange((value) => {
          this.draft.title = value;
        });
        window.setTimeout(() => text.inputEl.focus(), 30);
      });

    new Setting(contentEl)
      .setName(this.t("modal.type"))
      .setDesc(this.t("modal.typeDesc"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("project", this.t("type.project"))
          .addOption("habit", this.t("type.habit"))
          .setValue(this.draft.type ?? DEFAULT_RECORD_TYPE)
          .onChange((value) => {
            this.draft.type = normalizeRecordType(value);
            this.updateTypeFields();
          });
      });
    this.updateTypeFields();

    new Setting(contentEl)
      .setName(this.t("modal.category"))
      .setClass("dayspann-habit-field")
      .setDesc(this.t("modal.categoryDesc"))
      .addText((text) => {
        text.setValue(this.draft.category ?? "").onChange((value) => {
          this.draft.category = value;
        });
        const suggestions = this.habitCategorySuggestions();
        if (suggestions.length) {
          const listId = "dayspann-category-suggestions";
          const datalist = contentEl.createEl("datalist", { attr: { id: listId } });
          for (const name of suggestions) {
            datalist.createEl("option", { attr: { value: name } });
          }
          text.inputEl.setAttribute("list", listId);
        }
      });

    new Setting(contentEl)
      .setName(this.t("modal.nextAction"))
      .setClass("dayspann-habit-field")
      .setDesc(this.t("modal.nextActionDesc"))
      .addText((text) => {
        this.nextActionInput = text.inputEl;
        text
          .setPlaceholder(this.t("modal.nextActionPlaceholder"))
          .setValue(this.draft.nextAction ?? "")
          .onChange((value) => {
            this.draft.nextAction = value;
          });
      });

    new Setting(contentEl)
      .setName(this.t("modal.date"))
      .setClass("dayspann-project-field")
      .setDesc(this.t("modal.dateDesc"))
      .addText((text) => {
        text.inputEl.type = "date";
        text.setValue(this.draft.date).onChange((value) => {
          this.draft.date = value;
        });
      });

    new Setting(contentEl)
      .setName(this.t("modal.goal"))
      .setClass("dayspann-project-field")
      .setDesc(this.t("modal.goalDesc"))
      .addText((text) => {
        text
          .setPlaceholder(this.t("modal.goalPlaceholder"))
          .setValue(this.draft.goal ?? "")
          .onChange((value) => {
            this.draft.goal = value;
          });
      });

    new Setting(contentEl)
      .setName(this.t("modal.display"))
      .setClass("dayspann-project-field")
      .setDesc(this.t("modal.displayDesc"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("days", this.t("modal.displayDays"))
          .addOption("months", this.t("modal.displayMonths"))
          .addOption("years", this.t("modal.displayYears"))
          .addOption("months-days", this.t("modal.displayMonthsDays"))
          .addOption("years-months-days", this.t("modal.displayYearsMonthsDays"))
          .setValue(this.draft.displayMode ?? DEFAULT_DISPLAY_MODE)
          .onChange((value) => {
            this.draft.displayMode = normalizeDisplayMode(value);
          });
      });

    const excerptWrap = contentEl.createDiv("dayspann-modal-field");
    excerptWrap.createEl("label", { text: this.t("modal.excerpt") });
    excerptWrap.createDiv({
      text: this.t("modal.excerptDesc"),
      cls: "setting-item-description",
    });
    const excerpt = excerptWrap.createEl("textarea", {
      cls: "dayspann-modal-textarea",
    });
    excerpt.value = this.draft.excerpt;
    excerpt.addEventListener("input", () => {
      this.draft.excerpt = excerpt.value;
    });

    const sourceSetting = new Setting(contentEl)
      .setName(this.t("modal.source"))
      .setDesc(this.sourceDescription());
    let clearSourceButton: ExtraButtonComponent | null = null;
    const updateSourceSetting = (): void => {
      sourceSetting.setDesc(this.sourceDescription());
      clearSourceButton?.setDisabled(!this.draft.sourcePath);
    };
    sourceSetting.addButton((button) =>
      button
        .setButtonText(this.t("action.chooseSource"))
        .setIcon("file-search")
        .onClick(() =>
          new SourceNoteSuggestModal(this.app, this.t, (file) => {
            this.draft.sourcePath = file.path;
            this.draft.sourceLine = undefined;
            updateSourceSetting();
          }).open()
        )
    );
    sourceSetting.addExtraButton((button) => {
      clearSourceButton = button;
      button
        .setIcon("x")
        .setTooltip(this.t("action.clearSource"))
        .setDisabled(!this.draft.sourcePath)
        .onClick(() => {
          this.draft.sourcePath = undefined;
          this.draft.sourceLine = undefined;
          updateSourceSetting();
        });
    });

    this.errorEl = contentEl.createDiv("dayspann-modal-error");

    const actions = contentEl.createDiv("dayspann-modal-actions");
    const cancel = actions.createEl("button", { text: this.t("action.cancel") });
    cancel.addEventListener("click", () => this.close());
    const submit = actions.createEl("button", {
      text: this.submitLabel,
      cls: "mod-cta",
    });
    submit.addEventListener("click", () => void this.submit(submit));
  }

  private async submit(button: HTMLButtonElement): Promise<void> {
    const title = this.draft.title.trim();
    if (!title) {
      this.showError(this.t("error.nameRequired"));
      return;
    }
    const date = this.draft.date.trim();
    if (this.draft.type !== "habit" && date && !parseDateKey(date)) {
      this.showError(this.t("error.dateInvalid"));
      return;
    }

    button.disabled = true;
    try {
      await this.onSubmit({ ...this.draft, title, date });
      this.close();
    } catch (error) {
      button.disabled = false;
      if (error instanceof KeepEntryOpenError) return;
      this.showError(error instanceof Error ? error.message : this.t("error.saveFailed"));
    }
  }

  /** 種類が習慣のときは、期日・完了条件・表示形式の欄を隠し、分類と次の一手の欄を出す（CSS の dayspann-entry-modal--habit）。 */
  private updateTypeFields(): void {
    const isHabit = this.draft.type === "habit";
    if (isHabit && this.draft.nextAction === undefined) {
      this.splitHabitTitle();
      if (this.nameInput) this.nameInput.value = this.draft.title;
      if (this.nextActionInput) this.nextActionInput.value = this.draft.nextAction ?? "";
    } else if (!isHabit && this.draft.nextAction !== undefined) {
      this.joinHabitTitle();
      if (this.nameInput) this.nameInput.value = this.draft.title;
    }
    this.modalEl.toggleClass("dayspann-entry-modal--habit", isHabit);
  }

  /** 習慣の編集では、名前と次の一手を分けて欄に出す。初期値「プロジェクトノート作成」は空にする。 */
  private splitHabitTitle(): void {
    const parts = splitTitle(this.draft.title);
    this.draft.nextAction = habitNextAction(this.draft.title);
    this.draft.title = parts.name || this.draft.title;
  }

  /** 種類をプロジェクトに戻すとき、次の一手をタイトルの「｜」の後ろに戻す。 */
  private joinHabitTitle(): void {
    this.draft.title = joinTitle(this.draft.title, this.draft.nextAction ?? "");
    this.draft.nextAction = undefined;
  }

  /** すでにある習慣の分類を、入力の候補として集める。 */
  private habitCategorySuggestions(): string[] {
    const names = new Set<string>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const data = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!data || readRecordType(data.type) !== "habit") continue;
      const category = readCategory(data.category);
      if (category) names.add(category);
    }
    return [...names].sort((a, b) => a.localeCompare(b, "ja"));
  }

  private showError(message: string): void {
    if (this.errorEl) this.errorEl.setText(message);
  }

  private sourceDescription(): string {
    if (!this.draft.sourcePath) {
      return `${this.t("modal.sourceDesc")} ${this.t("modal.sourceNone")}`;
    }
    const line = this.draft.sourceLine
      ? this.t("modal.sourceLine", { line: this.draft.sourceLine })
      : "";
    return this.t("modal.sourceValue", { path: this.draft.sourcePath, line });
  }
}

class SourceNoteSuggestModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    t: Translator,
    private onChoose: (file: TFile) => void
  ) {
    super(app);
    this.setPlaceholder(t("modal.sourceSearch"));
  }

  getItems(): TFile[] {
    return this.app.vault
      .getMarkdownFiles()
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}

/** 「メモと次回」の画面で入力したもの。 */
export interface HabitMemoAnswer {
  memo: string;
  next: string;
}

/**
 * 「今日やった」のあとに出す「メモと次回」の画面。「保存」なら入力したもの、「スキップ」や閉じたときは null。
 * 次回の欄には、いまの次の一手（チェックしていない一番上）を最初から入れておく。
 */
export function promptHabitMemo(
  app: App,
  title: string,
  currentNext: string,
  t: Translator
): Promise<HabitMemoAnswer | null> {
  return new Promise((resolve) => {
    new HabitMemoModal(app, title, currentNext, t, resolve).open();
  });
}

class HabitMemoModal extends Modal {
  private answered = false;

  constructor(
    app: App,
    private title: string,
    private currentNext: string,
    private t: Translator,
    private resolve: (answer: HabitMemoAnswer | null) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass("dayspann-habit-memo-modal");
    this.titleEl.setText(this.t("habitMemo.title", { title: this.title }));

    const memoWrap = contentEl.createDiv("dayspann-modal-field");
    const memoLabel = memoWrap.createEl("label", { text: this.t("habitMemo.memo") });
    const memo = memoWrap.createEl("textarea", { cls: "dayspann-habit-memo-textarea" });
    memo.id = "dayspann-habit-memo-memo";
    memoLabel.htmlFor = memo.id;
    memo.rows = 3;
    if (!Platform.isMobile) {
      memoWrap.createDiv({ text: this.t("habitMemo.memoHint"), cls: "setting-item-description" });
    }

    const nextWrap = contentEl.createDiv("dayspann-modal-field");
    const nextLabel = nextWrap.createEl("label", { text: this.t("habitMemo.next") });
    const next = nextWrap.createEl("input", { type: "text", cls: "dayspann-habit-memo-input" });
    next.id = "dayspann-habit-memo-next";
    nextLabel.htmlFor = next.id;
    next.value = this.currentNext;

    const actions = contentEl.createDiv({ cls: "modal-button-container" });
    const skip = actions.createEl("button", { text: this.t("habitMemo.skip") });
    skip.addEventListener("click", () => this.answer(null));
    const save = actions.createEl("button", { text: this.t("habitMemo.save"), cls: "mod-cta" });
    const submit = () => this.answer({ memo: memo.value, next: next.value });
    save.addEventListener("click", submit);

    // 日本語を変換している途中の Enter では保存しない。
    memo.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing || !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      submit();
    });
    next.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      submit();
    });
    window.setTimeout(() => memo.focus(), 30);
  }

  onClose(): void {
    this.contentEl.empty();
    // ×ボタンや Esc で閉じたときは「スキップ」と同じにする（何も書かない）。
    if (!this.answered) this.resolve(null);
  }

  private answer(value: HabitMemoAnswer | null): void {
    if (this.answered) return;
    this.answered = true;
    this.resolve(value);
    this.close();
  }
}
