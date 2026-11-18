import { ItemView, Menu, setIcon, setTooltip, WorkspaceLeaf } from "obsidian";
import type DayspannPlugin from "../main";
import { planCardActions } from "./card-actions";
import {
  compareArchiveOrder,
  countThisMonth,
  daysUntilEndOfWeek,
  differenceInCalendarDays,
  dueSoonDays,
  formatArchiveMonthParts,
  formatCompletedCardDate,
  formatDateSpan,
  formatLocalizedDate,
  groupByMonth,
  monthKey,
  postponeTargets,
  shiftDateKey,
  stalledDays,
  toDateKey,
} from "./date-utils";
import { groupHabitsByCategory } from "./habit-category";
import {
  buildHeatmapWeeks,
  countActiveDays,
  countHabitDays,
  HabitLogDays,
  heatmapLevel,
  streakDays,
  streakWeeks,
  sundayOfDateKey,
} from "./habit-log";
import { habitTargetProgress, HabitTargetProgress, isHabitScheduled, weekStreakTarget } from "./habit-target";
import { durationUnit, formatCountUnit } from "./i18n";
import { choosePostponeDate } from "./modals";
import { DayspannRecord } from "./model";
import { displayTitle, excerptForCard, splitTitle } from "./note-template";
import { RECORD_TYPES, RecordType } from "./record-type";
import { ALL_HABITS_GROUP_KEY, DayspannSectionKind } from "./settings";

export const DAYSPANN_VIEW_TYPE = "pj-span-view";

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
    this.iconButton(actions, "plus", this.plugin.t("command.registerManually"), () =>
      this.plugin.openManualEntry(this.plugin.settings.activeTab)
    );

    // 上のタブで選んでいる種類（プロジェクト・習慣）の記録だけを出す。
    const tab = this.plugin.settings.activeTab;
    this.renderTabs(root, tab);
    const records = (await this.plugin.loadRecords()).filter((record) => record.type === tab);
    if (refreshVersion !== this.refreshVersion) return;

    const today = this.plugin.todayKey();
    if (tab === "habit") {
      const logs = await this.plugin.loadTaskChuteLogs(await this.plugin.listTaskChuteLogMonths(today));
      if (refreshVersion !== this.refreshVersion) return;
      this.renderHabits(root, records, today, logs);
      return;
    }
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
    const doneThisMonth = countThisMonth(
      counted.filter((item) => item.record.archived).map((item) => item.record.completed),
      today
    );
    const done = summary.createSpan({
      cls: "dayspann-summary-done",
      text: this.plugin.t("view.doneThisMonth", { count: doneThisMonth }),
    });
    if (doneThisMonth > 0) done.addClass("dayspann-summary-done--ok");

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
      button.addEventListener("click", () => this.plugin.openManualEntry("project"));
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

    this.renderArchiveSection(root, archived, today);
  }

  /** 上のタブ（プロジェクト・習慣）。選んだタブは設定に覚えておき、次に開いたときもそのタブにする。 */
  private renderTabs(root: HTMLElement, active: RecordType): void {
    const tabs = root.createDiv({
      cls: "dayspann-tabs",
      attr: { role: "tablist", "aria-label": this.plugin.t("tab.label") },
    });
    for (const type of RECORD_TYPES) {
      const tab = tabs.createEl("button", {
        cls: "dayspann-tab",
        text: this.plugin.t(type === "habit" ? "tab.habit" : "tab.project"),
        attr: { type: "button", role: "tab", "aria-selected": String(type === active) },
      });
      if (type === active) tab.addClass("is-active");
      tab.addEventListener("click", () => {
        if (type === this.plugin.settings.activeTab) return;
        void this.plugin.setActiveTab(type).then(() => this.refresh());
      });
    }
  }

  /** 習慣のタブ。続けている習慣を名前の順に並べ、分類があれば見出しごとにまとめ、アーカイブした習慣はいちばん下に月ごとにまとめる。 */
  private renderHabits(
    root: HTMLElement,
    records: DayspannRecord[],
    todayKey: string,
    logs: HabitLogDays
  ): void {
    if (!records.length) {
      const empty = root.createDiv("dayspann-empty");
      setIcon(empty.createDiv("dayspann-empty-icon"), "repeat");
      empty.createEl("h3", { text: this.plugin.t("view.habitEmptyTitle") });
      empty.createEl("p", { text: this.plugin.t("view.habitEmptyDescription") });
      const button = empty.createEl("button", {
        text: this.plugin.t("command.registerManually"),
        cls: "mod-cta",
      });
      button.addEventListener("click", () => this.plugin.openManualEntry("habit"));
      return;
    }

    const active = records
      .filter((record) => !record.archived)
      .sort((a, b) => displayTitle(a.title).localeCompare(displayTitle(b.title)));
    if (active.length) {
      const groups = groupHabitsByCategory(active);
      const useCategories = groups.some((group) => group.category);
      if (!useCategories) {
        this.renderHabitSection(root, this.plugin.t("section.habit"), ALL_HABITS_GROUP_KEY, active, logs);
      } else {
        for (const group of groups) {
          const title = group.category || this.plugin.t("section.other");
          this.renderHabitSection(root, title, group.category, group.items, logs);
        }
      }
    }

    const archived = records
      .filter((record) => record.archived)
      .map((record) => ({ record, difference: null }))
      .sort((a, b) =>
        compareArchiveOrder(a.record.completed, b.record.completed, a.record.date, b.record.date)
      );
    this.renderArchiveSection(root, archived, todayKey);
  }

  /** 習慣の見出しと、その下のカードを出す。見出しをクリックすると折りたためる。 */
  private renderHabitSection(
    root: HTMLElement,
    title: string,
    groupKey: string,
    records: DayspannRecord[],
    logs: HabitLogDays
  ): void {
    const section = root.createEl("section", { cls: "dayspann-section dayspann-section--habit" });
    const collapsed = this.plugin.settings.collapsedHabitGroups.includes(groupKey);
    section.toggleClass("dayspann-section--collapsed", collapsed);

    const listId = `dayspann-list-${this.viewId}-habit-${encodeURIComponent(groupKey)}`;
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
    setIcon(heading.createSpan("dayspann-section-icon"), "repeat");
    heading.createSpan({
      text: this.plugin.t("section.heading", { title, count: records.length }),
    });
    heading.createSpan("dayspann-section-line");
    setIcon(heading.createSpan("dayspann-section-chevron"), "chevron-down");

    const list = section.createDiv({ cls: "dayspann-list", attr: { id: listId } });
    list.hidden = collapsed;
    for (const record of records) this.renderHabitCard(list, record, logs);

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
      void this.plugin.setHabitGroupCollapsed(groupKey, nextCollapsed);
    });
  }

  /** 習慣のカード。頭文字の四角は出さず、名前の右上に「…」、ヒートマップの右に数字を並べる。名前の右に、今の期間の日数を出す。 */
  private renderHabitCard(list: HTMLElement, record: DayspannRecord, logs?: HabitLogDays): void {
    const card = list.createDiv("dayspann-card dayspann-card--habit");
    if (record.archived) card.addClass("dayspann-card--done");
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
      this.addHabitMenuItems(menu, record);
      menu.showAtMouseEvent(event);
    });

    const title = displayTitle(record.title);
    const content = card.createDiv("dayspann-card-content");
    const head = content.createDiv("dayspann-habit-head");
    const headText = head.createDiv("dayspann-habit-head-text");
    const todayKey = this.plugin.todayKey();
    const counts = logs && record.taskchute && !record.archived
      ? countHabitDays(logs, {
          taskId: record.taskchute.taskId,
          path: record.file.path,
          basename: record.file.basename,
        })
      : null;
    const progress = counts ? this.habitProgressCopy(habitTargetProgress(record.habitTarget, counts, todayKey)) : null;

    headText.createEl("h3", { text: title });
    const updated = formatCompletedCardDate(
      toDateKey(new Date(record.file.stat.mtime)),
      todayKey,
      this.plugin.locale()
    );
    headText.createDiv({
      text: this.plugin.t("view.lastUpdated", { date: updated }),
      cls: "dayspann-card-date",
    });

    const headActions = head.createDiv("dayspann-habit-head-actions");
    if (progress) {
      const progressEl = headActions.createDiv({
        text: progress.text,
        cls: progress.met ? "dayspann-habit-progress is-met" : "dayspann-habit-progress",
      });
      setTooltip(progressEl, progress.tooltip);
      progressEl.setAttribute("aria-label", progress.tooltip);
    }
    const stalled = record.archived
      ? null
      : stalledDays(record.file.stat.mtime, new Date(), this.plugin.settings.stalledDays);
    if (stalled !== null) {
      const mark = headActions.createDiv("dayspann-stalled");
      setIcon(mark, "hourglass");
      const tooltip = this.plugin.t("stalled.tooltip", { days: stalled });
      setTooltip(mark, tooltip);
      mark.setAttribute("aria-label", tooltip);
    }

    const actions = headActions.createDiv("dayspann-card-actions");
    const more = this.iconButton(actions, "ellipsis", this.plugin.t("action.actions"), () => undefined);
    more.addEventListener("click", (event) => {
      event.stopPropagation();
      const menu = new Menu();
      this.addHabitMenuItems(menu, record);
      const mouse = event as MouseEvent;
      menu.showAtPosition({ x: mouse.clientX, y: mouse.clientY });
    });

    // 続けている TaskChute のタスクなら、実行ログからヒートマップを出す。
    if (counts) this.renderHeatmap(content, record, counts, todayKey);
  }

  /** 名前の横の日数とツールチップ。目標に届いていれば ✓ を付けて出す。 */
  private habitProgressCopy(progress: HabitTargetProgress): { text: string; tooltip: string; met: boolean } {
    if (progress.period === "day") {
      return progress.met
        ? {
            text: this.plugin.t("habit.doneToday"),
            tooltip: this.plugin.t("habit.doneTodayTooltip"),
            met: true,
          }
        : {
            text: this.plugin.t("habit.pendingToday"),
            tooltip: this.plugin.t("habit.pendingTodayTooltip"),
            met: false,
          };
    }
    if (progress.period === "month") {
      return {
        text: this.plugin.t(progress.met ? "habit.doneMonth" : "habit.pendingMonth", {
          done: progress.done,
          target: progress.target,
        }),
        tooltip: this.plugin.t(progress.met ? "habit.doneMonthTooltip" : "habit.pendingMonthTooltip"),
        met: progress.met,
      };
    }
    return {
      text: this.plugin.t(progress.met ? "habit.doneWeek" : "habit.pendingWeek", {
        done: progress.done,
        target: progress.target,
      }),
      tooltip: this.plugin.t(
        progress.met ? "habit.doneWeekTooltip" : "habit.pendingWeekTooltip",
        { remaining: progress.remaining }
      ),
      met: progress.met,
    };
  }

  /** 習慣のヒートマップ。直近 4 週を左に出し、右に直近 30 日・連続・最長を並べる。 */
  private renderHeatmap(parent: HTMLElement, record: DayspannRecord, counts: Record<string, number>, todayKey: string): void {
    const body = parent.createDiv("dayspann-habit-body");
    const wrap = body.createDiv("dayspann-heatmap");
    const grid = wrap.createDiv({ cls: "dayspann-heatmap-grid", attr: { role: "img" } });
    const header = grid.createDiv({ cls: "dayspann-heatmap-dow", attr: { "aria-hidden": "true" } });
    const weekdays = this.plugin.t("heatmap.weekdays");
    for (let index = 0; index < weekdays.length; index += 1) {
      const cls = ["dayspann-heatmap-dow-cell"];
      if (index === 0) cls.push("is-sunday");
      if (index === 6) cls.push("is-saturday");
      header.createDiv({ text: weekdays[index], cls: cls.join(" ") });
    }
    const weeks = buildHeatmapWeeks(todayKey);
    const thisSunday = sundayOfDateKey(todayKey);
    for (const [weekIndex, week] of weeks.entries()) {
      const isThisWeek = weekIndex === weeks.length - 1;
      const row = grid.createDiv("dayspann-heatmap-week");
      for (let day = 0; day < week.length; day += 1) {
        const raw = week[day];
        const dateKey = raw ?? (isThisWeek ? shiftDateKey(thisSunday, day) : null);
        const cell = row.createDiv("dayspann-heatmap-cell");
        if (!dateKey) {
          cell.addClass("dayspann-heatmap-cell--future");
          continue;
        }
        const future = raw === null;
        const count = counts[dateKey] ?? 0;
        if (future) cell.addClass("dayspann-heatmap-cell--future");
        else cell.addClass(`dayspann-heatmap-cell--${heatmapLevel(count)}`);
        const planned = isThisWeek && isHabitScheduled(record.habitSchedule, dateKey);
        // 予定でまだやっていない日（今日より先も含む）だけ枠を付ける。やった日は緑のまま。
        if (planned && (future || count === 0)) cell.addClass("dayspann-heatmap-cell--planned");
        if (future && !planned) continue;
        const date = formatCompletedCardDate(dateKey, todayKey, this.plugin.locale());
        let label = count > 0
          ? this.plugin.t("heatmap.done", { date, count })
          : this.plugin.t("heatmap.none", { date });
        if (planned) label = this.plugin.t("heatmap.planned", { label });
        setTooltip(cell, label);
        cell.setAttribute("aria-label", label);
      }
    }
    const locale = this.plugin.locale();
    const recentDays = countActiveDays(counts, todayKey, 30);
    const streak = record.streakUnit === "day"
      ? streakDays(counts, todayKey)
      : streakWeeks(counts, todayKey, weekStreakTarget(record.habitTarget));
    const unit = record.streakUnit;
    const recentLabel = this.plugin.t("heatmap.recentLabel", { days: 30 });
    const recentValue = formatCountUnit(locale, recentDays, "day");
    const streakLabel = this.plugin.t("heatmap.streakLabel");
    const streakValue = formatCountUnit(locale, streak.current, unit);
    const bestLabel = this.plugin.t("heatmap.bestLabel");
    const bestValue = formatCountUnit(locale, streak.longest, unit);
    grid.setAttribute(
      "aria-label",
      `${recentLabel} ${recentValue} ${streakLabel} ${streakValue} ${bestLabel} ${bestValue}`
    );
    const stats = body.createDiv("dayspann-habit-stats");
    this.renderHabitStat(stats, recentLabel, recentValue);
    this.renderHabitStat(stats, streakLabel, streakValue, streak.current > 0);
    this.renderHabitStat(stats, bestLabel, bestValue);
  }

  /** ヒートマップの右に並べる 1 行（左が見出し、右が数字）。連続が続いているときは数字をオレンジにする。 */
  private renderHabitStat(parent: HTMLElement, label: string, value: string, emphasize = false): void {
    const row = parent.createDiv("dayspann-habit-stat");
    row.createDiv({ text: label, cls: "dayspann-habit-stat-label" });
    const valueEl = row.createDiv({ text: value, cls: "dayspann-habit-stat-value" });
    if (emphasize) valueEl.addClass("is-active");
  }

  /** 習慣のカードの「…」と右クリックのメニュー。延期はなく、編集・ノートを開く・元のノート・アーカイブ・削除だけ。 */
  private addHabitMenuItems(menu: Menu, record: DayspannRecord): void {
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
  }

  /** アーカイブを完了月ごとに分けて出す。今月のグループは開いておき、古い月はたたんでおく。 */
  private renderArchiveSection(root: HTMLElement, items: CountedRecord[], todayKey: string): void {
    if (!items.length) return;
    const section = root.createEl("section", {
      cls: "dayspann-section dayspann-section--archive",
    });
    const title = this.plugin.t("section.archive");
    const collapsed = this.plugin.settings.archiveCollapsed;
    section.toggleClass("dayspann-section--collapsed", collapsed);

    const listId = `dayspann-list-${this.viewId}-archive`;
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
    setIcon(heading.createSpan("dayspann-section-icon"), "archive");
    heading.createSpan({
      text: this.plugin.t("section.heading", { title, count: items.length }),
    });
    heading.createSpan("dayspann-section-line");
    setIcon(heading.createSpan("dayspann-section-chevron"), "chevron-down");

    const list = section.createDiv({ cls: "dayspann-list", attr: { id: listId } });
    list.hidden = collapsed;

    const currentMonth = monthKey(todayKey) ?? "";
    const groups = groupByMonth(items, (item) => item.record.completed);
    for (const group of groups) {
      this.renderArchiveMonth(list, group.monthKey, group.items, currentMonth);
    }

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
      void this.plugin.setArchiveCollapsed(nextCollapsed);
    });
  }

  private renderArchiveMonth(
    list: HTMLElement,
    groupKey: string,
    items: CountedRecord[],
    currentMonth: string
  ): void {
    const parts = formatArchiveMonthParts(groupKey, this.plugin.locale());
    const title = parts
      ? this.plugin.t("section.archiveMonth", {
          year: parts.year,
          month: parts.month,
          monthName: parts.monthName,
          count: items.length,
        })
      : this.plugin.t("section.archiveMonthUnknown", { count: items.length });
    const monthCollapsed = Boolean(groupKey) && groupKey !== currentMonth;
    const month = list.createDiv("dayspann-month");
    month.toggleClass("dayspann-month--collapsed", monthCollapsed);

    const monthListId = `dayspann-month-${this.viewId}-${groupKey || "unknown"}`;
    const heading = month.createEl("button", {
      cls: "dayspann-month-heading",
      attr: {
        type: "button",
        "aria-expanded": String(!monthCollapsed),
        "aria-controls": monthListId,
        "aria-label": this.plugin.t(
          monthCollapsed ? "action.expandSection" : "action.collapseSection",
          { title }
        ),
      },
    });
    heading.createSpan({ text: title });
    heading.createSpan("dayspann-section-line");
    setIcon(heading.createSpan("dayspann-section-chevron"), "chevron-down");

    const monthList = month.createDiv({ cls: "dayspann-list", attr: { id: monthListId } });
    monthList.hidden = monthCollapsed;
    for (const item of items) this.renderCard(monthList, item);

    heading.addEventListener("click", (event) => {
      event.stopPropagation();
      const nextCollapsed = !month.hasClass("dayspann-month--collapsed");
      month.toggleClass("dayspann-month--collapsed", nextCollapsed);
      monthList.hidden = nextCollapsed;
      heading.setAttribute("aria-expanded", String(!nextCollapsed));
      heading.setAttribute(
        "aria-label",
        this.plugin.t(
          nextCollapsed ? "action.expandSection" : "action.collapseSection",
          { title }
        )
      );
    });
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
    if (record.type === "habit") {
      this.renderHabitCard(list, record);
      return;
    }
    const card = list.createDiv("dayspann-card");
    // 完了していない記録で、期日が今日から設定の日数後までなら「期日が近い」としてオレンジ色にする。
    const dueSoon = record.archived || record.completed
      ? null
      : dueSoonDays(record.date, this.plugin.todayKey(), this.plugin.settings.soonDays);
    if (dueSoon !== null) {
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

    // 頭文字の四角は出さず、名前をカードの左端から出す（習慣のカードと同じ）。
    const title = displayTitle(record.title);

    const content = card.createDiv("dayspann-card-content");
    content.createEl("h3", { text: title });
    if (record.date) {
      content.createDiv({
        text: formatLocalizedDate(record.date, this.plugin.locale()),
        cls: "dayspann-card-date",
      });
    }
    if (record.goal) {
      const goal = content.createDiv({ cls: "dayspann-card-goal" });
      setIcon(goal.createSpan("dayspann-card-goal-icon"), "flag");
      goal.createSpan({ text: record.goal, cls: "dayspann-card-goal-text" });
      setTooltip(goal, record.goal);
    }
    // 完了していないカードは、タイトルの「｜」より後ろを「次の一手」として出す。
    const nextAction = record.archived ? "" : splitTitle(record.title).nextAction;
    if (nextAction) {
      const next = content.createDiv({ cls: "dayspann-card-next" });
      const icon = next.createSpan("dayspann-card-next-icon");
      setIcon(icon, "arrow-right");
      icon.setAttribute("aria-label", this.plugin.t("view.nextAction"));
      next.createSpan({ text: nextAction, cls: "dayspann-card-next-text" });
      next.setAttribute("title", nextAction);
      setTooltip(next, nextAction);
    }
    const excerpt = excerptForCard(record.excerpt);
    if (excerpt) {
      content.createDiv({ text: excerpt, cls: "dayspann-card-excerpt" });
    }

    // 日数とボタンを同じ行に並べて、カードの高さを抑える。
    const countRow = card.createDiv("dayspann-count-row");
    const count = countRow.createDiv("dayspann-count");
    // 期日が近いカードは、日数の前に時計の印を出す。
    if (dueSoon !== null) {
      const icon = count.createSpan("dayspann-count-soon-icon");
      setIcon(icon, "clock");
      const tooltip = dueSoon === 0
        ? this.plugin.t("dueSoon.today")
        : dueSoon === 1
          ? this.plugin.t("dueSoon.tomorrow")
          : this.plugin.t("dueSoon.tooltip", { days: dueSoon });
      setTooltip(count, tooltip);
      icon.setAttribute("aria-label", tooltip);
    }
    if (record.archived) {
      const completedDate = record.completed
        ? formatCompletedCardDate(record.completed, this.plugin.todayKey(), this.plugin.locale())
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

    // 完了していない記録で、ノートを設定の日数以上更新していなければ印を出す。
    const stalled = record.archived || record.completed
      ? null
      : stalledDays(record.file.stat.mtime, new Date(), this.plugin.settings.stalledDays);
    if (stalled !== null) {
      const mark = countRow.createDiv("dayspann-stalled");
      setIcon(mark, "hourglass");
      const tooltip = this.plugin.t("stalled.tooltip", { days: stalled });
      setTooltip(mark, tooltip);
      mark.setAttribute("aria-label", tooltip);
    }

    const plan = planCardActions(record, this.plugin.todayKey());
    const actions = countRow.createDiv("dayspann-card-actions");
    if (plan.today !== "none") this.todayButton(actions, record, plan.today === "inToday");
    if (plan.overdueActions) {
      this.textButton(actions, "calendar-clock", this.plugin.t("action.postpone"), (event) => {
        this.openPostponeMenu(event, record);
      });
      this.textButton(actions, "check", this.plugin.t("action.completeOverdue"), () => {
        void this.plugin.setRecordArchived(record, true);
      });
    }
    if (plan.complete) {
      this.iconButton(actions, "check", this.plugin.t("action.complete"), () => {
        void this.plugin.setRecordArchived(record, true);
      });
    }
    const more = this.iconButton(actions, "ellipsis", this.plugin.t("action.actions"), () => undefined);
    more.addEventListener("click", (event) => {
      event.stopPropagation();
      const menu = new Menu();
      if (plan.postponeInMenu) {
        menu.addItem((menuItem) =>
          menuItem.setTitle(this.plugin.t("action.postponeWeek")).setIcon("calendar-plus").onClick(() => void this.plugin.postponeRecord(record, 7))
        );
        menu.addSeparator();
      }
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

  /** 期日超過の「延期する」。今日から、明日・1週間後・1か月後・日付を選ぶ、を出す。 */
  private openPostponeMenu(event: MouseEvent, record: DayspannRecord): void {
    const today = this.plugin.todayKey();
    const targets = postponeTargets(today);
    const menu = new Menu();
    menu.addItem((menuItem) =>
      menuItem
        .setTitle(this.plugin.t("action.postponeTomorrow"))
        .setIcon("sun")
        .onClick(() => void this.plugin.setRecordDate(record, targets.tomorrow))
    );
    menu.addItem((menuItem) =>
      menuItem
        .setTitle(this.plugin.t("action.postponeInWeek"))
        .setIcon("calendar-plus")
        .onClick(() => void this.plugin.setRecordDate(record, targets.inOneWeek))
    );
    menu.addItem((menuItem) =>
      menuItem
        .setTitle(this.plugin.t("action.postponeInMonth"))
        .setIcon("calendar-clock")
        .onClick(() => void this.plugin.setRecordDate(record, targets.inOneMonth))
    );
    menu.addSeparator();
    menu.addItem((menuItem) =>
      menuItem
        .setTitle(this.plugin.t("action.postponePick"))
        .setIcon("calendar")
        .onClick(() => void this.pickPostponeDate(record, today, targets.pickDefault))
    );
    menu.showAtMouseEvent(event);
  }

  private async pickPostponeDate(record: DayspannRecord, todayKey: string, defaultDateKey: string): Promise<void> {
    const picked = await choosePostponeDate(this.app, defaultDateKey, todayKey, (key, variables) =>
      this.plugin.t(key, variables)
    );
    if (picked) await this.plugin.setRecordDate(record, picked);
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

  /** 「今日やる」ボタン。今日の一覧に入っているときは枠だけの「入っています」の形にする。 */
  private todayButton(parent: HTMLElement, record: DayspannRecord, inToday: boolean): HTMLButtonElement {
    const label = this.plugin.t(inToday ? "action.inTodayLabel" : "action.todayLabel");
    const button = parent.createEl("button", {
      cls: "dayspann-today-button" + (inToday ? " dayspann-today-button--done" : ""),
      attr: { type: "button", "aria-label": label },
    });
    setIcon(button.createSpan("dayspann-today-icon"), "sun");
    if (inToday) setIcon(button.createSpan("dayspann-today-check"), "check");
    setTooltip(button, label);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      void this.plugin.addRecordToTaskChuteToday(record);
    });
    return button;
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

  /** 期日超過の「延期する」「完了する」。アイコンと短い文字を出す。 */
  private textButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    onClick: (event: MouseEvent) => void
  ): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: "dayspann-text-button",
      attr: { type: "button", "aria-label": label },
    });
    setIcon(button.createSpan("dayspann-text-button-icon"), icon);
    button.createSpan({ text: label, cls: "dayspann-text-button-label" });
    setTooltip(button, label);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick(event);
    });
    return button;
  }

  private updateResponsiveState(width: number): void {
    this.contentEl.classList.toggle("dayspann-is-narrow", width <= 600);
    this.contentEl.classList.toggle("dayspann-is-extra-narrow", width <= 440);
  }
}
