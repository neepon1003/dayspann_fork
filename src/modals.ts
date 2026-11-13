import {
  App,
  ExtraButtonComponent,
  FuzzySuggestModal,
  Modal,
  Setting,
  TFile,
} from "obsidian";
import {
  DEFAULT_DISPLAY_MODE,
  normalizeDisplayMode,
  parseDateKey,
} from "./date-utils";
import { Translator } from "./i18n";
import { DayspannDraft } from "./model";

export class DayspannEntryModal extends Modal {
  private draft: DayspannDraft;
  private errorEl?: HTMLElement;

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
    };
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
        text.setValue(this.draft.title).onChange((value) => {
          this.draft.title = value;
        });
        window.setTimeout(() => text.inputEl.focus(), 30);
      });

    new Setting(contentEl)
      .setName(this.t("modal.date"))
      .setDesc(this.t("modal.dateDesc"))
      .addText((text) => {
        text.inputEl.type = "date";
        text.setValue(this.draft.date).onChange((value) => {
          this.draft.date = value;
        });
      });

    new Setting(contentEl)
      .setName(this.t("modal.display"))
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
    if (date && !parseDateKey(date)) {
      this.showError(this.t("error.dateInvalid"));
      return;
    }

    button.disabled = true;
    try {
      await this.onSubmit({ ...this.draft, title, date });
      this.close();
    } catch (error) {
      button.disabled = false;
      this.showError(error instanceof Error ? error.message : this.t("error.saveFailed"));
    }
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
