import { ItemView, Menu, setIcon, WorkspaceLeaf } from "obsidian";
import type DayspannPlugin from "../main";
import {
  compareArchiveOrder,
  daysUntilEndOfWeek,
  differenceInCalendarDays,
  formatCompletedBadgeDate,
  formatDateSpan,
  formatLocalizedDate,
} from "./date-utils";
import { durationUnit } from "./i18n";
import { DayspannRecord } from "./model";
import { DayspannSectionKind } from "./settings";

export const DAYSPANN_VIEW_TYPE = "pj-span-view";

const SOON_DAYS = 7;

interface CountedRecord {
  record: DayspannRecord;
  difference: number | null;
}

type ViewSectionKind = DayspannSectionKind | "undated" | "archive";

export class DayspannView extends ItemView {
  private refreshVersion = 0;
  private resizeObserver: ResizeObserver | null = null;
  private readonly viewId = Math.random().toString(36).slice(2);

  constructor(leaf: WorkspaceLeaf, private plugin: DayspannPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return DAYSPANN_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "PJ-span";
  }

  getIcon(): string {
    return "calendar-range";
  }

  async onOpen(): Promise<void> {
    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(([entry]) => {
      this.updateResponsiveState(entry?.contentRect.width ?? this.contentEl.clientWidth);
    });
    this.resizeObserver.observe(this.contentEl);
    this.updateResponsiveState(this.contentEl.clientWidth);
    await this.refresh();
  }

  async onClose(): Promise<void> {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  async refresh(): Promise<void> {
    const refreshVersion = ++this.refreshVersion;
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("dayspann-view");
    root.setCssProps({
      "--dayspann-future-color": this.plugin.settings.futureColor,
      "--dayspann-past-color": this.plugin.settings.pastColor,
    });

    const header = root.createDiv("dayspann-header");
    const heading = header.createDiv("dayspann-heading");
    heading.createEl("h2", { text: "PJ-span" });
    heading.createEl("p", {
      cls: "dayspann-tagline",
      text: this.plugin.t("view.tagline"),
    });

    const actions = header.createDiv("dayspann-header-actions");
    this.iconButton(actions, "refresh-cw", this.plugin.t("view.refresh"), () => void this.refresh());
    this.iconButton(actions, "plus", this.plugin.t("command.registerManually"), () => this.plugin.openManualEntry());

    const records = await this.plugin.loadRecords();
    if (refreshVersion !== this.refreshVersion) return;

    const today = this.plugin.todayKey();
    const counted = records.map((record) => ({
      record,
      difference: record.date ? differenceInCalendarDays(record.date, today) : null,
    }));

    const weekRemaining = daysUntilEndOfWeek(today);
    const dueThisWeek = counted.filter(
      (item) =>
        !item.record.archived &&
        item.difference !== null &&
        item.difference >= 0 &&
        item.difference <= weekRemaining
    ).length;
    const overdueCount = counted.filter(
      (item) => !item.record.archived && item.difference !== null && item.difference < 0
    ).length;
    const summary = heading.createDiv("dayspann-summary");
    summary.createSpan({
      text: this.plugin.t("view.dueThisWeek", { count: dueThisWeek }),
    });
    const overdue = summary.createSpan({
      cls: "dayspann-summary-overdue",
      text: this.plugin.t("view.overdueCount", { count: overdueCount }),
    });
    if (overdueCount > 0) overdue.addClass("dayspann-summary-overdue--alert");

    if (!counted.length) {
      const empty = root.createDiv("dayspann-empty");
      setIcon(empty.createDiv("dayspann-empty-icon"), "calendar-range");
      empty.createEl("h3", { text: this.plugin.t("view.emptyTitle") });
      empty.createEl("p", {
        text: this.plugin.t("view.emptyDescription"),
      });
      const button = empty.createEl("button", {
        text: this.plugin.t("command.registerManually"),
        cls: "mod-cta",
      });
      button.addEventListener("click", () => this.plugin.openManualEntry());
      return;
    }

    const active = counted.filter(
      (item): item is CountedRecord & { difference: number } =>
        !item.record.archived && item.difference !== null
    );
    const undated = counted
      .filter((item) => !item.record.archived && item.difference === null)
      .sort((a, b) => a.record.title.localeCompare(b.record.title));
    const archived = counted
      .filter((item) => item.record.archived)
      .sort((a, b) =>
        compareArchiveOrder(
          a.record.completed,
          b.record.completed,
          a.record.date,
          b.record.date
        )
      );
    const future = active
      .filter((item) => item.difference > 0)
      .sort((a, b) => a.difference - b.difference || a.record.date.localeCompare(b.record.date));
    const todayRecords = active.filter((item) => item.difference === 0);
    const past = active
      .filter((item) => item.difference < 0)
      .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

    const sections: Record<
      DayspannSectionKind,
      { icon: string; title: string; items: CountedRecord[] }
    > = {
      future: { icon: "calendar-clock", title: this.plugin.t("section.future"), items: future },
      today: { icon: "circle-check", title: this.plugin.t("section.today"), items: todayRecords },
      past: { icon: "triangle-alert", title: this.plugin.t("section.past"), items: past },
    };

    for (const kind of this.plugin.settings.sectionOrder) {
      const section = sections[kind];
      this.renderSection(root, section.icon, section.title, kind, section.items);
    }

    this.renderSection(
      root,
      "calendar-off",
      this.plugin.t("section.undated"),
      "undated",
      undated
    );

    this.renderSection(
      root,
      "archive",
      this.plugin.t("section.archive"),
      "archive",
      archived
    );
  }

  private renderSection(
    root: HTMLElement,
    icon: string,
    title: string,
    kind: ViewSectionKind,
    items: CountedRecord[]
  ): void {
    if (!items.length) return;
    const section = root.createEl("section", {
      cls: `dayspann-section dayspann-section--${kind}`,
    });
    const collapsed =
      kind === "archive"
        ? this.plugin.settings.archiveCollapsed
        : kind === "undated"
          ? this.plugin.settings.undatedCollapsed
          : this.plugin.settings.collapsedSections.includes(kind);
    section.toggleClass("dayspann-section--collapsed", collapsed);

    const listId = `dayspann-list-${this.viewId}-${kind}`;
    const heading = section.createEl("button", {
      cls: "dayspann-section-heading",
      attr: {
        type: "button",
        "aria-expanded": String(!collapsed),
        "aria-controls": listId,
        "aria-label": this.plugin.t(
          collapsed ? "action.expandSection" : "action.collapseSection",
          { title }
        ),
      },
    });
    setIcon(heading.createSpan("dayspann-section-icon"), icon);
    heading.createSpan({
      text: this.plugin.t("section.heading", { title, count: items.length }),
    });
    heading.createSpan("dayspann-section-line");
    setIcon(heading.createSpan("dayspann-section-chevron"), "chevron-down");

    const list = section.createDiv({ cls: "dayspann-list", attr: { id: listId } });
    list.hidden = collapsed;
    for (const item of items) this.renderCard(list, item);

    heading.addEventListener("click", () => {
      const nextCollapsed = !section.hasClass("dayspann-section--collapsed");
      section.toggleClass("dayspann-section--collapsed", nextCollapsed);
      list.hidden = nextCollapsed;
      heading.setAttribute("aria-expanded", String(!nextCollapsed));
      heading.setAttribute(
        "aria-label",
        this.plugin.t(
          nextCollapsed ? "action.expandSection" : "action.collapseSection",
          { title }
        )
      );
      if (kind === "archive") {
        void this.plugin.setArchiveCollapsed(nextCollapsed);
      } else if (kind === "undated") {
        void this.plugin.setUndatedCollapsed(nextCollapsed);
      } else {
        void this.plugin.setSectionCollapsed(kind, nextCollapsed);
      }
    });
  }

  private renderCard(list: HTMLElement, item: CountedRecord): void {
    const { record, difference } = item;
    const card = list.createDiv("dayspann-card");
    if (difference !== null && difference >= 1 && difference <= SOON_DAYS) {
	card.addClass("dayspann-card--soon");
    }	
    if (record.archived) {
      card.addClass("dayspann-card--done");
    }
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.plugin.openRecordFile(record);
    });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void this.plugin.openRecordFile(record);
      }
    });
    card.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const menu = new Menu();
      menu.addItem((menuItem) =>
        menuItem.setTitle(this.plugin.t("action.edit")).setIcon("pencil").onClick(() => this.plugin.openEditEntry(record))
      );
      menu.addItem((menuItem) =>
        menuItem.setTitle(this.plugin.t("action.openRecord")).setIcon("file-text").onClick(() => void this.plugin.openRecordFile(record))
      );
      menu.addSeparator();
      this.addArchiveMenuItem(menu, record);
      menu.addItem((menuItem) =>
        menuItem.setTitle(this.plugin.t("action.delete")).setIcon("trash-2").onClick(() => void this.plugin.deleteRecord(record))
      );
      menu.showAtMouseEvent(event);
    });

    const accent = card.createDiv("dayspann-card-accent");
    accent.setText(record.title.slice(0, 1));

    const content = card.createDiv("dayspann-card-content");
    content.createEl("h3", { text: record.title });
    if (record.date) {
      content.createDiv({
        text: formatLocalizedDate(record.date, this.plugin.locale()),
        cls: "dayspann-card-date",
      });
    }
    if (record.excerpt) {
      content.createDiv({ text: record.excerpt.replace(/\s+/g, " "), cls: "dayspann-card-excerpt" });
    }

    const count = card.createDiv("dayspann-count");
    if (record.archived) {
      const completedDate = record.completed
        ? formatCompletedBadgeDate(record.completed, this.plugin.todayKey())
        : "";
      count.createSpan({
        text: completedDate
          ? this.plugin.t("view.doneOn", { date: completedDate })
          : this.plugin.t("view.done"),
        cls: "dayspann-count-done",
      });
    } else if (difference === null) {
      count.createSpan({ text: this.plugin.t("view.noDate"), cls: "dayspann-count-today" });
    } else if (difference === 0) {
      count.createSpan({ text: this.plugin.t("view.dueToday"), cls: "dayspann-count-today" });
    } else {
      const parts = formatDateSpan(record.date, this.plugin.todayKey(), record.displayMode);
      if (parts.length > 1) count.addClass("dayspann-count--compound");
      for (const part of parts) {
        const segment = count.createSpan("dayspann-count-segment");
        segment.createSpan({ text: String(part.value), cls: "dayspann-count-number" });
        segment.createSpan({
          text: durationUnit(this.plugin.locale(), part.unit, part.value),
          cls: "dayspann-count-unit",
        });
      }
      if (difference < 0) {
	count.createSpan({
	 text: this.plugin.t("view.overdueSuffix"),
	 cls: "dayspann-count-unit dayspann-count-suffix",
	});
       }		
    }

    const actions = card.createDiv("dayspann-card-actions");
    if (!record.archived) {
      this.iconButton(actions, "check", this.plugin.t("action.complete"), () => {
        void this.plugin.setRecordArchived(record, true);
      });
    }
    const more = this.iconButton(actions, "ellipsis", this.plugin.t("action.actions"), () => undefined);
    more.addEventListener("click", (event) => {
      event.stopPropagation();
      const menu = new Menu();
      menu.addItem((menuItem) =>
        menuItem.setTitle(this.plugin.t("action.edit")).setIcon("pencil").onClick(() => this.plugin.openEditEntry(record))
      );
      menu.addItem((menuItem) =>
        menuItem.setTitle(this.plugin.t("action.openRecord")).setIcon("file-text").onClick(() => void this.plugin.openRecordFile(record))
      );
      if (record.sourcePath) {
        menu.addItem((menuItem) =>
          menuItem.setTitle(this.plugin.t("action.openSource")).setIcon("external-link").onClick(() => void this.plugin.openRecordSource(record))
        );
      }
      menu.addSeparator();
      this.addArchiveMenuItem(menu, record);
      menu.addItem((menuItem) =>
        menuItem.setTitle(this.plugin.t("action.delete")).setIcon("trash-2").onClick(() => void this.plugin.deleteRecord(record))
      );
      const mouse = event as MouseEvent;
      menu.showAtPosition({ x: mouse.clientX, y: mouse.clientY });
    });
  }

  private addArchiveMenuItem(menu: Menu, record: DayspannRecord): void {
    const archived = record.archived;
    menu.addItem((menuItem) =>
      menuItem
        .setTitle(this.plugin.t(archived ? "action.restore" : "action.archive"))
        .setIcon(archived ? "archive-restore" : "archive")
        .onClick(() => void this.plugin.setRecordArchived(record, !archived))
    );
  }

  private iconButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    onClick: () => void
  ): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: "clickable-icon dayspann-icon-button",
      attr: { "aria-label": label },
    });
    setIcon(button, icon);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  private updateResponsiveState(width: number): void {
    this.contentEl.classList.toggle("dayspann-is-narrow", width <= 600);
    this.contentEl.classList.toggle("dayspann-is-extra-narrow", width <= 440);
  }
}
