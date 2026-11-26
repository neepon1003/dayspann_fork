import { ItemView, Menu, setIcon, setTooltip, WorkspaceLeaf } from "obsidian";
import type DayspannPlugin from "../main";
import { planCardActions } from "./card-actions";
import {
  compareArchiveOrder,
  differenceInCalendarDays,
  dueSoonDays,
  formatArchiveMonthParts,
  formatCompletedCardDate,
  formatLocalizedDate,
  groupByMonth,
  monthKey,
  parseDateKey,
  postponeTargets,
  shiftDateKey,
  stalledDays,
} from "./date-utils";
import { buildDuePill, DuePillModel } from "./due-pill";
import { groupHabitsByCategory, partitionHabitsDoneToday } from "./habit-category";
import {
  buildHeatmapWeeks,
  countTotalActiveDays,
  countHabitDays,
  HabitLogDays,
  heatmapLevel,
  streakDays,
  streakWeeks,
  sundayOfDateKey,
  sundayWeekNumber,
} from "./habit-log";
import { findPjSpanEntries } from "./habit-record";
import {
  buildNextDateBadge,
  collectProjectCategories,
  countInTodayProgress,
  countProjectSummary,
  filterProjectsByCategory,
  hasFutureTargetDate,
  parseProjectCategoryOrder,
  partitionProjectGroups,
  PROJECT_FILTER_ALL,
  PROJECT_FILTER_UNCATEGORIZED,
  resolveProjectCategoryColor,
  resolveProjectCategoryFilter,
  shouldShowInTodaySection,
  type InTodayProgress,
  type NextDateBadgeModel,
} from "./project-groups";
import { cardFlipKey, collectFlipRects, FLIP_KEY_ATTR, playFlipTransition, prefersReducedMotion, sectionFlipKey } from "./smooth-refresh";
import {
  habitTargetProgress,
  HabitTargetProgress,
  isHabitScheduled,
  nextHabitScheduledDate,
  plannedDateKeysInWeek,
  sortHabitsByPending,
  habitScheduledTodayStatus,
  filterHabitsScheduledToday,
  summarizeHabitTargets,
  weekStreakTarget,
} from "./habit-target";
import { formatCountUnit, formatDueOverdue, formatDueRemaining } from "./i18n";
import { choosePostponeDate, showGoal } from "./modals";
import { DayspannRecord } from "./model";
import { displayTitle, excerptForCard, habitNextAction, splitTitle } from "./note-template";
import { RECORD_TYPES, RecordType } from "./record-type";
import { ALL_HABITS_GROUP_KEY, DONE_HABITS_GROUP_KEY, DayspannSectionKind } from "./settings";

export const DAYSPANN_VIEW_TYPE = "pj-span-view";

interface CountedRecord {
  record: DayspannRecord;
  difference: number | null;
  workedToday?: boolean;
  showCategory?: boolean;
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
    // 先にデータを読み、できてから一度に差し替える（空の画面を出さない）。
    const tab = this.plugin.settings.activeTab;
    const records = (await this.plugin.loadRecords()).filter((record) => record.type === tab);
    if (refreshVersion !== this.refreshVersion) return;

    const today = this.plugin.todayKey();
    const logMonths = tab === "habit"
      ? await this.plugin.listTaskChuteLogMonths(today)
      : [today.slice(0, 7)];
    if (refreshVersion !== this.refreshVersion) return;
    const habitLogs = await this.plugin.loadTaskChuteLogs(logMonths);
    if (refreshVersion !== this.refreshVersion) return;

    const root = this.viewRoot();
    const scrollTop = root.scrollTop;
    const scrollLeft = root.scrollLeft;
    const reducedMotion = prefersReducedMotion(root.ownerDocument.defaultView?.matchMedia("(prefers-reduced-motion: reduce)"));
    const first = reducedMotion ? new Map() : collectFlipRects(root);

    // いまの画面には足さず、外で組み立てる（空の瞬間を出さない）。
    const next = createDiv();
    this.renderView(next, tab, records, today, habitLogs);
    if (refreshVersion !== this.refreshVersion) return;

    root.addClass("dayspann-view");
    root.setCssProps({
      "--dayspann-future-color": this.plugin.settings.futureColor,
      "--dayspann-past-color": this.plugin.settings.pastColor,
    });
    root.replaceChildren(...Array.from(next.childNodes));
    root.scrollTop = scrollTop;
    root.scrollLeft = scrollLeft;
    playFlipTransition(root, first, { reducedMotion });
  }

  /**
   * 一覧の箱。Obsidian の ItemView では containerEl の 2 つ目の子（.view-content）がスクロールする。
   * contentEl と同じことが多い。
   */
  private viewRoot(): HTMLElement {
    const fromChildren = this.containerEl.children[1];
    if (fromChildren instanceof HTMLElement) return fromChildren;
    return this.contentEl;
  }

  private setFlipKey(element: HTMLElement, key: string): void {
    element.setAttribute(FLIP_KEY_ATTR, key);
  }

  /** ヘッダー・タブ・カードを、渡した箱に組み立てる（まだ画面には出さない）。 */
  private renderView(
    root: HTMLElement,
    tab: RecordType,
    records: DayspannRecord[],
    today: string,
    habitLogs?: HabitLogDays
  ): void {
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
    this.renderTabs(root, tab);
    if (tab === "habit") {
      this.renderHabits(root, heading, records, today, habitLogs ?? {});
      return;
    }
    const { categories: projectCategories, hasUncategorized } = collectProjectCategories(
      records,
      parseProjectCategoryOrder(this.plugin.settings.projectCategoryOrder)
    );
    const activeProjectFilter = resolveProjectCategoryFilter(
      this.plugin.settings.projectCategoryFilter,
      projectCategories,
      hasUncategorized
    );
    const filteredRecords = filterProjectsByCategory(records, activeProjectFilter);

    const counted = filteredRecords.map((record) => ({
      record,
      difference: record.date ? differenceInCalendarDays(record.date, today) : null,
    }));

    const counts = countProjectSummary(filteredRecords, today);
    const summary = heading.createDiv("dayspann-summary");
    summary.createSpan({
      cls: "dayspann-summary-pill" + (counts.dueThisWeek > 0 ? " is-week" : ""),
      text: this.plugin.t("view.dueThisWeek", { count: counts.dueThisWeek }),
    });
    summary.createSpan({
      cls: "dayspann-summary-pill" + (counts.overdue > 0 ? " is-overdue" : ""),
      text: this.plugin.t("view.overdueCount", { count: counts.overdue }),
    });
    summary.createSpan({
      cls: "dayspann-summary-pill" + (counts.doneThisMonth > 0 ? " is-done" : ""),
      text: this.plugin.t("view.doneThisMonth", { count: counts.doneThisMonth }),
    });

    if (projectCategories.length > 0) {
      this.renderProjectCategoryFilter(root, projectCategories, hasUncategorized, activeProjectFilter);
    }

    if (!records.length) {
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

    // 今日 TaskChute で 1 回でも完了記録があるプロジェクトを集める（「今日やる」の進捗と並び順に使う）。
    const workedTodayPaths = new Set<string>();
    if (habitLogs) {
      for (const record of filteredRecords) {
        if (record.archived || !record.taskchute) continue;
        const logCounts = countHabitDays(habitLogs, {
          taskId: record.taskchute.taskId,
          path: record.file.path,
          basename: record.file.basename,
        });
        if ((logCounts[today] ?? 0) > 0) workedTodayPaths.add(record.file.path);
      }
    }
    const isWorkedToday = (record: DayspannRecord): boolean => workedTodayPaths.has(record.file.path);
    const showCategoryBadge = activeProjectFilter === PROJECT_FILTER_ALL && projectCategories.length > 0;

    // 今日の一覧に入っているカードは「今日やる」へ。期日順・期日なしには出さない。完了はアーカイブへ。
    const groups = partitionProjectGroups(filteredRecords, today, isWorkedToday);
    const inTodayProgress = countInTodayProgress(filteredRecords, today, isWorkedToday);
    const toCounted = (list: typeof records): CountedRecord[] =>
      list.map((record) => ({
        record,
        difference: parseDateKey(record.date) ? differenceInCalendarDays(record.date, today) : null,
        workedToday: isWorkedToday(record),
        showCategory: showCategoryBadge,
      }));
    void counted;

    this.renderSection(
      root,
      "sun",
      this.plugin.t("section.inToday"),
      "inToday",
      toCounted(groups.inToday),
      inTodayProgress
    );

    this.renderSection(
      root,
      "calendar-clock",
      this.plugin.t("section.due"),
      "due",
      toCounted(groups.dated)
    );

    this.renderSection(
      root,
      "calendar-off",
      this.plugin.t("section.undated"),
      "undated",
      toCounted(groups.undated)
    );

    this.renderArchiveSection(root, toCounted(groups.archived), today);
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

  /**
   * 習慣のタブ。いちばん上（プロジェクトの「今週締め切り」と同じ場所）に目標達成の数を出し、
   * 続けている習慣を、まだ目標に届いていないものから名前の順に並べ、分類があれば見出しごとにまとめ、
   * アーカイブした習慣はいちばん下に月ごとにまとめる。
   */
  private renderHabits(
    root: HTMLElement,
    heading: HTMLElement,
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

    const byName = records
      .filter((record) => !record.archived)
      .sort((a, b) => displayTitle(a.title).localeCompare(displayTitle(b.title)));
    // 目標に届いたかは 1 回だけ調べて、並べ替えに使う（カードの日数と同じ決め方）。
    const metByRecord = new Map(byName.map((record) => [record, this.habitMet(record, logs, todayKey)]));
    // 上の「目標達成」は、今日が予定日の習慣のうち、今日やった数だけを数える（表示の切り替えでは変えない）。
    const scheduledTodayByRecord = new Map(
      byName.map((record) => [record, this.habitScheduledToday(record, logs, todayKey)])
    );
    this.renderHabitSummary(
      heading,
      summarizeHabitTargets(byName.map((record) => scheduledTodayByRecord.get(record) ?? null))
    );
    this.renderHabitFilter(root);
    // 「今日」のときは、今日が予定日の習慣だけを出す。今日やったものは分類から外し、いちばん下の「完了」にまとめる。
    const todayMode = this.plugin.settings.habitFilter === "today";
    const visible = todayMode
      ? filterHabitsScheduledToday(byName, (record) => scheduledTodayByRecord.get(record) ?? null)
      : byName;
    const { pending, done } = todayMode
      ? partitionHabitsDoneToday(visible, (record) => scheduledTodayByRecord.get(record) === true)
      : { pending: visible, done: [] };
    // まだ目標に届いていない習慣を上に、届いた習慣（✓）を下にする。見出しの中でも、この順番のまま並ぶ。
    const active = sortHabitsByPending(pending, (record) => metByRecord.get(record) ?? null);
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
    } else if (todayMode && !done.length) {
      root.createDiv({
        cls: "dayspann-habit-filter-empty",
        text: this.plugin.t("view.habitFilterEmpty"),
      });
    }
    // 「今日」のときだけ、今日やった習慣をいちばん下の「完了」に出す。「すべて」では出さない。
    if (todayMode && done.length) {
      this.renderHabitSection(
        root,
        this.plugin.t("section.habitDone"),
        DONE_HABITS_GROUP_KEY,
        done,
        logs,
        "check"
      );
    }

    // 「すべて」のときだけ、アーカイブした習慣をいちばん下に出す。
    if (this.plugin.settings.habitFilter === "all") {
      const archived = records
        .filter((record) => record.archived)
        .map((record) => ({ record, difference: null }))
        .sort((a, b) =>
          compareArchiveOrder(a.record.completed, b.record.completed, a.record.date, b.record.date)
        );
      this.renderArchiveSection(root, archived, todayKey);
    }
  }

  /** 「目標達成：3/5」の 1 行。今日が予定日の習慣が無ければ「今日の予定なし」。全部やったら ✓ を付けて緑にする。 */
  private renderHabitSummary(heading: HTMLElement, summary: { met: number; total: number }): void {
    const allMet = summary.total > 0 && summary.met === summary.total;
    const line = heading.createDiv("dayspann-summary");
    const count = line.createSpan({
      cls: "dayspann-summary-habit",
      text: summary.total
        ? this.plugin.t(allMet ? "view.habitTargetsAllMet" : "view.habitTargetsMet", {
            met: summary.met,
            total: summary.total,
          })
        : this.plugin.t("view.habitTargetsNone"),
    });
    if (allMet) count.addClass("dayspann-summary-habit--met");
    const tooltip = this.plugin.t("view.habitTargetsTooltip");
    setTooltip(count, tooltip);
    count.setAttribute("aria-label", tooltip);
  }

  /** プロジェクトの分類絞り込み（「すべて」「仕事」「家族」「個人」など）。選んだ値は設定に覚える。 */
  private renderProjectCategoryFilter(
    root: HTMLElement,
    categories: string[],
    hasUncategorized: boolean,
    current: string
  ): void {
    const group = root.createDiv({
      cls: "dayspann-habit-filter dayspann-project-filter",
      attr: { role: "radiogroup", "aria-label": this.plugin.t("view.projectFilterLabel") },
    });
    const options: Array<{ value: string; label: string }> = [
      { value: PROJECT_FILTER_ALL, label: this.plugin.t("view.projectFilterAll") },
      ...categories.map((name) => ({ value: name, label: name })),
    ];
    if (hasUncategorized) {
      options.push({ value: PROJECT_FILTER_UNCATEGORIZED, label: this.plugin.t("section.other") });
    }
    for (const option of options) {
      const button = group.createEl("button", {
        cls: "dayspann-habit-filter-button",
        text: option.label,
        attr: { type: "button", role: "radio", "aria-checked": String(option.value === current) },
      });
      if (option.value === current) button.addClass("is-active");
      button.addEventListener("click", () => {
        if (option.value === current) return;
        void this.plugin.setProjectCategoryFilter(option.value).then(() => this.refresh());
      });
    }
  }

  /** 「今日」と「すべて」を切り替えるボタン。選んだほうは設定に覚えておき、次に開いたときもそのままにする。 */
  private renderHabitFilter(root: HTMLElement): void {
    const current = this.plugin.settings.habitFilter;
    const group = root.createDiv({
      cls: "dayspann-habit-filter",
      attr: { role: "radiogroup", "aria-label": this.plugin.t("view.habitFilterLabel") },
    });
    for (const value of ["today", "all"] as const) {
      const button = group.createEl("button", {
        cls: "dayspann-habit-filter-button",
        text: this.plugin.t(value === "today" ? "view.habitFilterToday" : "view.habitFilterAll"),
        attr: { type: "button", role: "radio", "aria-checked": String(value === current) },
      });
      if (value === current) button.addClass("is-active");
      button.addEventListener("click", () => {
        if (value === this.plugin.settings.habitFilter) return;
        void this.plugin.setHabitFilter(value).then(() => this.refresh());
      });
    }
  }

  /** 習慣の見出しと、その下のカードを出す。見出しをクリックすると折りたためる。 */
  private renderHabitSection(
    root: HTMLElement,
    title: string,
    groupKey: string,
    records: DayspannRecord[],
    logs: HabitLogDays,
    icon = "repeat"
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
    this.setFlipKey(heading, sectionFlipKey(`habit:${groupKey}`));
    setIcon(heading.createSpan("dayspann-section-icon"), icon);
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
    this.setFlipKey(card, cardFlipKey(record.file.path));
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
      this.addHabitMenuItems(menu, record, undoable);
      menu.showAtMouseEvent(event);
    });

    const title = displayTitle(record.title);
    const content = card.createDiv("dayspann-card-content");
    const head = content.createDiv("dayspann-habit-head");
    const headText = head.createDiv("dayspann-habit-head-text");
    const todayKey = this.plugin.todayKey();
    const habit = { taskId: record.taskchute?.taskId, path: record.file.path, basename: record.file.basename };
    const counts = logs && record.taskchute && !record.archived ? countHabitDays(logs, habit) : null;
    const progress = counts ? this.habitProgressCopy(habitTargetProgress(record.habitTarget, counts, todayKey)) : null;
    // 今日の記録があるか（「今日やった」ボタン）と、そのうち PJ-span で記録した分があるか（「今日の記録を取り消す」）。
    const doneToday = counts ? (counts[todayKey] ?? 0) > 0 : false;
    const undoable = logs && counts ? findPjSpanEntries(logs, habit, todayKey).length > 0 : false;

    headText.createEl("h3", { text: title });
    // 完了していない習慣は、タイトルの「｜」より後ろを「次の一手」として出す（プロジェクトのカードと同じ）。
    const nextAction = record.archived ? "" : habitNextAction(record.title);
    if (nextAction) {
      const next = headText.createDiv({ cls: "dayspann-card-next" });
      const icon = next.createSpan("dayspann-card-next-icon");
      setIcon(icon, "arrow-right");
      icon.setAttribute("aria-label", this.plugin.t("view.nextAction"));
      next.createSpan({ text: nextAction, cls: "dayspann-card-next-text" });
      next.setAttribute("title", nextAction);
      setTooltip(next, nextAction);
    }

    const headActions = head.createDiv("dayspann-habit-head-actions");
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

    // 「✓ 今日やった」は設定がオンのときだけ出す。
    if (counts && this.plugin.settings.habitLogButtonEnabled) {
      this.renderHabitLogButton(headActions, record, doneToday);
    }

    const actions = headActions.createDiv("dayspann-card-actions");
    const more = this.iconButton(actions, "ellipsis", this.plugin.t("action.actions"), () => undefined);
    more.addEventListener("click", (event) => {
      event.stopPropagation();
      const menu = new Menu();
      this.addHabitMenuItems(menu, record, undoable);
      const mouse = event as MouseEvent;
      menu.showAtPosition({ x: mouse.clientX, y: mouse.clientY });
    });

    // 続けている TaskChute のタスクなら、実行ログからヒートマップを出す。
    // 「今週 1/2」「今月 0/1」は、毎日の「今日まだ」と違ってボタンだけでは分からないので、数字の上に出す。
    // 隔週などで今週が予定のない週（休み週）のときは「今週 0/1」を出さない。
    if (counts) {
      const restWeek = this.isHabitRestWeek(record, todayKey);
      const periodProgress = progress && progress.period !== "day" && !restWeek ? progress : null;
      this.renderHeatmap(content, record, counts, todayKey, periodProgress);
    }
    if (!record.archived && record.taskchute) {
      const nextDateKey = nextHabitScheduledDate(record.habitSchedule, todayKey, doneToday);
      this.renderHabitNextDate(content, record, nextDateKey, todayKey);
    }
  }

  /** 習慣カード下部に出す「次回予定日」ボタン。クリックすると TaskChute のルーチン設定を開く。 */
  private renderHabitNextDate(
    parent: HTMLElement,
    record: DayspannRecord,
    nextDateKey: string | null,
    todayKey: string
  ): void {
    const locale = this.plugin.locale();
    let label: string;
    let tooltip: string;
    let muted = false;
    if (!nextDateKey) {
      label = this.plugin.t("nextDate.none");
      tooltip = this.plugin.t("habit.nextDateNoneTooltip");
      muted = true;
    } else if (nextDateKey === todayKey) {
      label = this.plugin.t("habit.nextDateToday");
      tooltip = this.plugin.t("habit.nextDateTooltip", { date: formatLocalizedDate(nextDateKey, locale) });
    } else {
      const shortDate = formatCompletedCardDate(nextDateKey, todayKey, locale);
      const parsed = parseDateKey(nextDateKey);
      const weekdayChar = parsed
        ? this.plugin.t("heatmap.weekdays")[
            new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay()
          ] ?? ""
        : "";
      const withWeekday = locale === "ja" && weekdayChar ? `${shortDate}(${weekdayChar})` : shortDate;
      label = this.plugin.t("habit.nextDate", { date: withWeekday });
      tooltip = this.plugin.t("habit.nextDateTooltip", { date: formatLocalizedDate(nextDateKey, locale) });
    }
    const row = parent.createDiv("dayspann-habit-next-row");
    const button = row.createEl("button", {
      cls: muted ? "dayspann-habit-next-date is-muted" : "dayspann-habit-next-date",
      attr: { type: "button", "aria-label": tooltip },
    });
    setIcon(button.createSpan("dayspann-next-date-icon"), "calendar");
    button.createSpan({ text: label, cls: "dayspann-next-date-label" });
    setTooltip(button, tooltip);
    button.addEventListener("keydown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.plugin.openHabitRoutineModal(record);
    });
  }

  /**
   * カードの名前の右の「✓ 今日やった」ピル。押すと TaskChute の実行ログに今日の分を 1 件書く。
   * 今日の記録がもうあれば、緑の「今日 ✓」にして、押しても何もしない（取り消しは「…」メニューから）。
   */
  private renderHabitLogButton(parent: HTMLElement, record: DayspannRecord, doneToday: boolean): void {
    const tooltip = this.plugin.t(doneToday ? "habit.loggedTodayTooltip" : "habit.logTodayTooltip");
    const button = parent.createEl("button", {
      cls: doneToday ? "dayspann-habit-log-button is-done" : "dayspann-habit-log-button",
      attr: { type: "button", "aria-label": tooltip, "aria-disabled": String(doneToday) },
    });
    if (!doneToday) setIcon(button.createSpan("dayspann-habit-log-icon"), "check");
    button.createSpan({ text: this.plugin.t(doneToday ? "habit.doneToday" : "habit.logToday") });
    setTooltip(button, tooltip);
    // カードの Enter（ノートを開く）に伝わらないようにする。
    button.addEventListener("keydown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (doneToday || button.hasClass("is-busy")) return;
      // 書き終わるまでは押せないようにして、続けて押しても 2 回書かないようにする。
      button.addClass("is-busy");
      button.setAttribute("aria-disabled", "true");
      void this.plugin.recordHabitToday(record).finally(() => {
        button.removeClass("is-busy");
        button.setAttribute("aria-disabled", "false");
      });
    });
  }

  /** 隔週（routine_interval > 1）の週次習慣で、今週に予定日が 1 日も無い休み週か。 */
  private isHabitRestWeek(record: DayspannRecord, todayKey: string): boolean {
    return (
      record.habitSchedule.kind === "weekly" &&
      (record.habitSchedule.interval ?? 1) > 1 &&
      plannedDateKeysInWeek(record.habitSchedule, todayKey).length === 0
    );
  }

  /**
   * 名前の横の日数と同じ決め方で、今の期間の目標に届いているかを返す。
   * 日数を出さない習慣（TaskChute とつながっていないなど）や、隔週の休み週は null。
   */
  private habitMet(record: DayspannRecord, logs: HabitLogDays, todayKey: string): boolean | null {
    if (!record.taskchute || record.archived) return null;
    if (this.isHabitRestWeek(record, todayKey)) return null;
    const counts = countHabitDays(logs, {
      taskId: record.taskchute.taskId,
      path: record.file.path,
      basename: record.file.basename,
    });
    return habitTargetProgress(record.habitTarget, counts, todayKey).met;
  }

  /**
   * 今日が予定日の習慣なら、今日やったかどうかを返す。
   * 予定日でない習慣、TaskChute とつながっていない習慣、アーカイブした習慣は null。
   */
  private habitScheduledToday(record: DayspannRecord, logs: HabitLogDays, todayKey: string): boolean | null {
    if (!record.taskchute || record.archived) return null;
    const counts = countHabitDays(logs, {
      taskId: record.taskchute.taskId,
      path: record.file.path,
      basename: record.file.basename,
    });
    return habitScheduledTodayStatus(record.habitSchedule, todayKey, (counts[todayKey] ?? 0) > 0);
  }

  /** 週・月の目標の日数とツールチップ。目標に届いていれば ✓ を付けて出す。毎日の「今日まだ」はカードには出さない。 */
  private habitProgressCopy(
    progress: HabitTargetProgress
  ): { text: string; tooltip: string; met: boolean; period: HabitTargetProgress["period"] } {
    if (progress.period === "day") {
      return progress.met
        ? {
            text: this.plugin.t("habit.doneToday"),
            tooltip: this.plugin.t("habit.doneTodayTooltip"),
            met: true,
            period: "day" as const,
          }
        : {
            text: this.plugin.t("habit.pendingToday"),
            tooltip: this.plugin.t("habit.pendingTodayTooltip"),
            met: false,
            period: "day" as const,
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
        period: "month",
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
      period: "week",
    };
  }

  /** 習慣のヒートマップ。直近 4 週を左に出し（各行の左に週番号、今週の行は色づけ）、右に連続を大きく、通算・最長を小さく並べる。 */
  private renderHeatmap(
    parent: HTMLElement,
    record: DayspannRecord,
    counts: Record<string, number>,
    todayKey: string,
    periodProgress: { text: string; tooltip: string; met: boolean } | null = null
  ): void {
    const body = parent.createDiv("dayspann-habit-body");
    const wrap = body.createDiv("dayspann-heatmap");
    const grid = wrap.createDiv({ cls: "dayspann-heatmap-grid", attr: { role: "img" } });
    const header = grid.createDiv({ cls: "dayspann-heatmap-dow", attr: { "aria-hidden": "true" } });
    // 週番号の列の上は空けて、曜日とマスの列をそろえる。
    header.createDiv("dayspann-heatmap-weeknum");
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
      if (isThisWeek) row.addClass("dayspann-heatmap-week--current");
      const weekNumber = sundayWeekNumber(week[0] ?? thisSunday);
      const weekNumberEl = row.createDiv({ text: String(weekNumber.week), cls: "dayspann-heatmap-weeknum" });
      setTooltip(weekNumberEl, this.plugin.t("heatmap.weekNumber", weekNumber));
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
    const totalDays = countTotalActiveDays(counts);
    const scheduleInterval = record.habitSchedule.kind === "none" ? 1 : (record.habitSchedule.interval ?? 1);
    const streak = record.streakUnit === "day"
      ? streakDays(counts, todayKey, scheduleInterval)
      : streakWeeks(
          counts,
          todayKey,
          weekStreakTarget(record.habitTarget),
          record.habitSchedule.kind === "weekly" ? scheduleInterval : 1
        );
    const unit = record.streakUnit;
    const totalLabel = this.plugin.t("heatmap.totalLabel");
    const totalValue = formatCountUnit(locale, totalDays, "day");
    const streakLabel = this.plugin.t("heatmap.streakLabel");
    const streakValue = formatCountUnit(locale, streak.current, unit);
    const bestLabel = this.plugin.t("heatmap.bestLabel");
    const bestValue = formatCountUnit(locale, streak.longest, unit);
    grid.setAttribute(
      "aria-label",
      `${totalLabel} ${totalValue} ${streakLabel} ${streakValue} ${bestLabel} ${bestValue}`
    );
    const stats = body.createDiv("dayspann-habit-stats");
    if (periodProgress) {
      const periodEl = stats.createDiv({
        text: periodProgress.text,
        cls: periodProgress.met ? "dayspann-habit-period is-met" : "dayspann-habit-period",
      });
      setTooltip(periodEl, periodProgress.tooltip);
      periodEl.setAttribute("aria-label", periodProgress.tooltip);
    }
    this.renderHabitStat(stats, streakLabel, streakValue, streak.current > 0, "streak");
    this.renderHabitStat(stats, totalLabel, totalValue, false, "muted");
    this.renderHabitStat(stats, bestLabel, bestValue, false, "muted");
  }

  /** ヒートマップの右に並べる 1 行。連続は大きく、通算と最長は小さく薄く出す。連続が続いているときは数字をオレンジにする。 */
  private renderHabitStat(
    parent: HTMLElement,
    label: string,
    value: string,
    emphasize = false,
    variant?: "streak" | "muted"
  ): void {
    const cls = ["dayspann-habit-stat"];
    if (variant === "streak") cls.push("dayspann-habit-stat--streak");
    if (variant === "muted") cls.push("dayspann-habit-stat--muted");
    const row = parent.createDiv(cls.join(" "));
    row.createDiv({ text: label, cls: "dayspann-habit-stat-label" });
    const valueEl = row.createDiv({ text: value, cls: "dayspann-habit-stat-value" });
    if (emphasize) valueEl.addClass("is-active");
  }

  /**
   * 習慣のカードの「…」と右クリックのメニュー。延期はなく、編集・ノートを開く・元のノート・今日の記録を取り消す・アーカイブ・削除だけ。
   * 「今日の記録を取り消す」は、PJ-span で記録した今日の分があるとき（undoable）だけ押せる。
   */
  private addHabitMenuItems(menu: Menu, record: DayspannRecord, undoable = false): void {
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
    if (record.taskchute && !record.archived) {
      menu.addItem((menuItem) =>
        menuItem
          .setTitle(this.plugin.t("action.undoHabitToday"))
          .setIcon("undo-2")
          .setDisabled(!undoable)
          .onClick(() => void this.plugin.undoHabitToday(record))
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
    this.setFlipKey(heading, sectionFlipKey("archive"));
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
    this.setFlipKey(heading, sectionFlipKey(`archive-month:${groupKey || "unknown"}`));
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
    items: CountedRecord[],
    inTodayProgress?: InTodayProgress
  ): void {
    // 「今日やる」は、残りも今日の完了も 0 のときだけ出さない。全部終わった日は見出しを残す。
    if (kind === "inToday") {
      if (!inTodayProgress || !shouldShowInTodaySection(inTodayProgress)) return;
    } else if (!items.length) {
      return;
    }
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
    this.setFlipKey(heading, sectionFlipKey(kind));
    setIcon(heading.createSpan("dayspann-section-icon"), icon);
    if (kind === "inToday" && inTodayProgress) {
      const label = heading.createSpan("dayspann-section-label");
      label.createSpan({ text: title, cls: "dayspann-section-title" });
      const progressText =
        inTodayProgress.remaining === 0
          ? this.plugin.t("section.inTodayAllDone")
          : this.plugin.t("section.inTodayProgress", {
              remaining: inTodayProgress.remaining,
              done: inTodayProgress.doneToday,
            });
      label.createSpan({ text: progressText, cls: "dayspann-section-progress" });
    } else {
      heading.createSpan({
        text: this.plugin.t("section.heading", { title, count: items.length }),
      });
    }
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
    this.setFlipKey(card, cardFlipKey(record.file.path));
    const categoryColor = !record.archived ? resolveProjectCategoryColor(record.category) : null;
    if (categoryColor) {
      card.addClass("dayspann-card--has-category");
      card.setCssProps({ "--dayspann-category-color": categoryColor });
    }
    const workedToday = !record.archived && Boolean(item.workedToday);
    if (workedToday) {
      card.addClass("dayspann-card--worked-today");
    }
    // 完了していない記録で、期日が今日から設定の日数後までなら「期日が近い」としてオレンジ色にする。
    const dueSoon = record.archived || record.completed
      ? null
      : dueSoonDays(record.date, this.plugin.todayKey(), this.plugin.settings.soonDays);
    if (dueSoon !== null) {
      card.addClass("dayspann-card--soon");
    }
    if (record.archived) {
      card.addClass("dayspann-card--done");
    } else if (difference !== null && difference < 0) {
      // 見出しをひとつにまとめたあとでも、超過のカードは赤、これから先は緑、今日はアクセント色にする。
      card.addClass("dayspann-card--overdue");
    } else if (difference === 0) {
      card.addClass("dayspann-card--today");
    } else if (difference !== null && difference > 0) {
      card.addClass("dayspann-card--upcoming");
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
    const todayKey = this.plugin.todayKey();
    const locale = this.plugin.locale();
    const pill = buildDuePill(record, todayKey, this.plugin.settings.soonDays);
    const plan = planCardActions(record, todayKey);

    const content = card.createDiv("dayspann-card-content");
    const head = content.createDiv("dayspann-project-head");
    const headText = head.createDiv("dayspann-project-head-text");
    const headingEl = headText.createEl("h3", { text: title });
    // 完了していないカードの完了条件は、次の一手とタイトルのツールチップにする（旗の行は次の一手があるときは出さない）。
    const goalText = record.archived ? "" : record.goal;
    const goalTooltip = goalText ? this.plugin.t("view.goalTooltip", { goal: goalText }) : "";
    if (goalTooltip) {
      headingEl.setAttribute("title", goalTooltip);
      setTooltip(headingEl, goalTooltip);
    }
    const headActions = head.createDiv("dayspann-project-head-actions");
    this.renderDuePill(headActions, pill, locale);
    const more = this.iconButton(headActions, "ellipsis", this.plugin.t("action.actions"), () => undefined);
    more.addEventListener("click", (event) => {
      event.stopPropagation();
      const menu = new Menu();
      if (plan.overdueActions) {
        menu.addItem((menuItem) =>
          menuItem.setTitle(this.plugin.t("action.postpone")).setIcon("calendar-clock").onClick((click) => {
            this.openPostponeMenu(click as MouseEvent, record);
          })
        );
        menu.addSeparator();
      }
      if (plan.postponeInMenu) {
        menu.addItem((menuItem) =>
          menuItem.setTitle(this.plugin.t("action.postponeWeek")).setIcon("calendar-plus").onClick(() => void this.plugin.postponeRecord(record, 7))
        );
        menu.addItem((menuItem) =>
          menuItem.setTitle(this.plugin.t("action.postponeMonth")).setIcon("calendar-clock").onClick(() => void this.plugin.postponeRecordMonths(record, 1))
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
      if (goalText) {
        menu.addItem((menuItem) =>
          menuItem.setTitle(this.plugin.t("action.viewGoal")).setIcon("flag").onClick(() => {
            showGoal(this.app, goalText, (key, variables) => this.plugin.t(key, variables));
          })
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

    // 完了していないカードは、タイトルの「｜」より後ろを「次の一手」として出す。全文を折り返して出す（切らない）。
    const nextAction = record.archived ? "" : splitTitle(record.title).nextAction;
    // 次の一手があるときは完了条件の旗行を出さない。次の一手がなく完了条件だけあるときは、空にしないため旗行を残す。アーカイブでは出さない。
    if (goalText && !nextAction) {
      const goal = content.createDiv({ cls: "dayspann-card-goal" });
      setIcon(goal.createSpan("dayspann-card-goal-icon"), "flag");
      goal.createSpan({ text: goalText, cls: "dayspann-card-goal-text" });
      setTooltip(goal, goalTooltip);
    }
    const stalled = record.archived || record.completed || hasFutureTargetDate(record, todayKey)
      ? null
      : stalledDays(record.file.stat.mtime, new Date(), this.plugin.settings.stalledDays);
    const nextDateBadge = buildNextDateBadge(record, todayKey);
    const categoryLabel = !record.archived && item.showCategory ? record.category.trim() : "";
    const hasLineActions =
      plan.today !== "none" || plan.complete || stalled !== null || nextDateBadge !== null || Boolean(categoryLabel);
    if (nextAction) {
      const next = content.createDiv({ cls: "dayspann-card-next" });
      const icon = next.createSpan("dayspann-card-next-icon");
      setIcon(icon, "arrow-right");
      icon.setAttribute("aria-label", this.plugin.t("view.nextAction"));
      next.createSpan({ text: nextAction, cls: "dayspann-card-next-text" });
      const nextTooltip = goalTooltip || nextAction;
      next.setAttribute("title", nextTooltip);
      setTooltip(next, nextTooltip);
    }
    const excerpt = excerptForCard(record.excerpt);
    if (excerpt) {
      content.createDiv({ text: excerpt, cls: "dayspann-card-excerpt" });
    }

    // 左に「分類」「次回予定日」、右に「今日やる」「完了」を並べる。本文を切らない。「…」は名前の右。
    if (hasLineActions) {
      const actions = content.createDiv("dayspann-card-actions dayspann-project-line-actions dayspann-project-action-row");
      if (categoryLabel || nextDateBadge) {
        const leftMeta = actions.createDiv("dayspann-project-left-meta");
        if (categoryLabel) {
          leftMeta.createSpan({ text: categoryLabel, cls: "dayspann-project-category" });
        }
        if (nextDateBadge) {
          this.renderNextDateBadge(leftMeta, record, nextDateBadge, todayKey, locale);
        }
      }
      if (stalled !== null) {
        const mark = actions.createDiv("dayspann-stalled");
        setIcon(mark, "hourglass");
        const tooltip = this.plugin.t("stalled.tooltip", { days: stalled });
        setTooltip(mark, tooltip);
        mark.setAttribute("aria-label", tooltip);
      }
      if (plan.today !== "none") this.todayButton(actions, record, plan.today === "inToday", workedToday);
      if (plan.complete) {
        this.completeButton(
          actions,
          this.plugin.t(plan.overdueActions ? "action.completeOverdue" : "action.complete"),
          () => {
            void this.plugin.setRecordArchived(record, true);
          }
        );
      }
    }
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

  /** 名前の右に出す残日数ピル。ツールチップは期日の全文（例：2026年11月27日(金)）。 */
  private renderDuePill(parent: HTMLElement, pill: DuePillModel, locale: "ja" | "en"): void {
    const text = this.duePillText(pill, locale);
    const el = parent.createSpan({ text, cls: `dayspann-due-pill is-${pill.appearance}` });
    const tooltip = pill.tooltipDateKey
      ? formatLocalizedDate(pill.tooltipDateKey, locale)
      : text;
    if (tooltip) {
      el.setAttribute("title", tooltip);
      setTooltip(el, tooltip);
      el.setAttribute("aria-label", tooltip === text ? text : `${text}（${tooltip}）`);
    }
  }

  private duePillText(pill: DuePillModel, locale: "ja" | "en"): string {
    if (pill.kind === "remaining") return formatDueRemaining(locale, pill.days ?? 0);
    if (pill.kind === "overdue") return formatDueOverdue(locale, pill.days ?? 0);
    if (pill.kind === "today") return this.plugin.t("view.dueByToday");
    if (pill.kind === "none") return this.plugin.t("view.noDate");
    const completedDate = pill.completedDateKey
      ? formatCompletedCardDate(pill.completedDateKey, this.plugin.todayKey(), locale)
      : "";
    return completedDate
      ? this.plugin.t("view.doneOn", { date: completedDate })
      : this.plugin.t("view.done");
  }

  /** カード左下の「次回予定日（target_date）」ピル。押すと次回予定日を変更できる。 */
  private renderNextDateBadge(
    parent: HTMLElement,
    record: DayspannRecord,
    badge: NextDateBadgeModel,
    todayKey: string,
    locale: "ja" | "en"
  ): void {
    let text: string;
    let tooltip: string;
    if (badge.kind === "future") {
      const shortDate = formatCompletedCardDate(badge.dateKey, todayKey, locale);
      const fullDate = formatLocalizedDate(badge.dateKey, locale);
      text = this.plugin.t("nextDate.scheduled", { date: shortDate });
      tooltip = this.plugin.t("nextDate.tooltipScheduled", { date: fullDate });
    } else if (badge.kind === "past") {
      const shortDate = formatCompletedCardDate(badge.dateKey, todayKey, locale);
      const fullDate = formatLocalizedDate(badge.dateKey, locale);
      text = this.plugin.t("nextDate.overdue", { date: shortDate });
      tooltip = this.plugin.t("nextDate.tooltipOverdue", { date: fullDate, days: badge.days });
    } else {
      text = this.plugin.t("nextDate.none");
      tooltip = this.plugin.t("nextDate.tooltipNone");
    }

    const button = parent.createEl("button", {
      cls: `dayspann-next-date-badge is-${badge.appearance}`,
      attr: { type: "button", "aria-label": tooltip },
    });
    setIcon(
      button.createSpan("dayspann-next-date-icon"),
      badge.kind === "past" ? "alert-circle" : "calendar"
    );
    button.createSpan({ text, cls: "dayspann-next-date-label" });
    setTooltip(button, tooltip);
    button.addEventListener("keydown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openNextDateMenu(event, record);
    });
  }

  /** 次回予定日（target_date）を変えるメニュー。今日・明日・3日後・1週間後・日付を選ぶ・外す。 */
  private openNextDateMenu(event: MouseEvent, record: DayspannRecord): void {
    const today = this.plugin.todayKey();
    const menu = new Menu();
    menu.addItem((menuItem) =>
      menuItem
        .setTitle(this.plugin.t("action.todayShort"))
        .setIcon("sun")
        .onClick(() => void this.plugin.addRecordToTaskChuteToday(record))
    );
    menu.addItem((menuItem) =>
      menuItem
        .setTitle(this.plugin.t("action.postponeTomorrow"))
        .setIcon("sunrise")
        .onClick(() => void this.plugin.setRecordTargetDate(record, shiftDateKey(today, 1)))
    );
    menu.addItem((menuItem) =>
      menuItem
        .setTitle(this.plugin.t("action.nextDateIn3Days"))
        .setIcon("calendar-plus")
        .onClick(() => void this.plugin.setRecordTargetDate(record, shiftDateKey(today, 3)))
    );
    menu.addItem((menuItem) =>
      menuItem
        .setTitle(this.plugin.t("action.postponeInWeek"))
        .setIcon("calendar-clock")
        .onClick(() => void this.plugin.setRecordTargetDate(record, shiftDateKey(today, 7)))
    );
    menu.addSeparator();
    menu.addItem((menuItem) =>
      menuItem
        .setTitle(this.plugin.t("action.postponePick"))
        .setIcon("calendar")
        .onClick(() => void this.pickNextTargetDate(record, today))
    );
    if (record.taskchute?.targetDate) {
      menu.addItem((menuItem) =>
        menuItem
          .setTitle(this.plugin.t("action.nextDateClear"))
          .setIcon("x")
          .onClick(() => void this.plugin.setRecordTargetDate(record, ""))
      );
    }
    menu.showAtMouseEvent(event);
  }

  private async pickNextTargetDate(record: DayspannRecord, todayKey: string): Promise<void> {
    const current = record.taskchute?.targetDate;
    const defaultDateKey =
      current && parseDateKey(current) && differenceInCalendarDays(current, todayKey) >= 0
        ? current
        : shiftDateKey(todayKey, 1);
    const picked = await choosePostponeDate(this.app, defaultDateKey, todayKey, (key, variables) =>
      this.plugin.t(key === "postponePick.title" ? "nextDate.pickTitle" : key, variables)
    );
    if (picked) await this.plugin.setRecordTargetDate(record, picked);
  }

  /** 「今日やる」の文字ピル。今日の一覧に入っているときは「✓ 今日」、今日 TaskChute で実行済みなら緑の「✓ 今日やった」にする。 */
  private todayButton(
    parent: HTMLElement,
    record: DayspannRecord,
    inToday: boolean,
    workedToday = false
  ): HTMLButtonElement {
    const isWorked = inToday && workedToday;
    const tooltip = this.plugin.t(
      isWorked ? "action.workedTodayLabel" : inToday ? "action.inTodayLabel" : "action.todayLabel"
    );
    const cls =
      "dayspann-today-button" +
      (isWorked
        ? " dayspann-today-button--worked"
        : inToday
          ? " dayspann-today-button--done"
          : "");
    const button = parent.createEl("button", {
      cls,
      attr: { type: "button", "aria-label": tooltip },
    });
    if (inToday) setIcon(button.createSpan("dayspann-today-check"), "check");
    button.createSpan({
      text: this.plugin.t(
        isWorked ? "action.workedTodayShort" : inToday ? "action.inTodayShort" : "action.todayShort"
      ),
      cls: "dayspann-today-label",
    });
    setTooltip(button, tooltip);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      void this.plugin.addRecordToTaskChuteToday(record);
    });
    return button;
  }

  /** 「完了」の文字ピル。見た目の文字は短く「完了」、ツールチップは「完了にする」「完了する」。 */
  private completeButton(parent: HTMLElement, tooltip: string, onClick: () => void): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: "dayspann-complete-button",
      attr: { type: "button", "aria-label": tooltip },
    });
    button.createSpan({ text: this.plugin.t("action.completeShort"), cls: "dayspann-complete-label" });
    setTooltip(button, tooltip);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
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
