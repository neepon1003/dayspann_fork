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
import { countInTodayProgress, countProjectSummary, partitionProjectGroups, shouldShowInTodaySection, type InTodayProgress } from "./project-groups";
import {
  habitTargetProgress,
  HabitTargetProgress,
  isHabitScheduled,
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
      this.renderHabits(root, heading, records, today, logs);
      return;
    }
    const counted = records.map((record) => ({
      record,
      difference: record.date ? differenceInCalendarDays(record.date, today) : null,
    }));

    const counts = countProjectSummary(records, today);
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

    // 今日の一覧に入っているカードは「今日やる」へ。期日順・期日なしには出さない。完了はアーカイブへ。
    const groups = partitionProjectGroups(records, today);
    const inTodayProgress = countInTodayProgress(records, today);
    const toCounted = (list: typeof records): CountedRecord[] =>
      list.map((record) => ({
        record,
        difference: parseDateKey(record.date) ? differenceInCalendarDays(record.date, today) : null,
      }));

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

    // 「✓ 今日やった」は名前の右、「…」の左に置く。「今日まだ」は出さない（ボタンで分かる）。
    if (counts) this.renderHabitLogButton(headActions, record, doneToday);

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
    if (counts) {
      const periodProgress = progress && progress.period !== "day" ? progress : null;
      this.renderHeatmap(content, record, counts, todayKey, periodProgress);
    }
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

  /**
   * 名前の横の日数と同じ決め方で、今の期間の目標に届いているかを返す。
   * 日数を出さない習慣（TaskChute とつながっていないなど）は null。
   */
  private habitMet(record: DayspannRecord, logs: HabitLogDays, todayKey: string): boolean | null {
    if (!record.taskchute || record.archived) return null;
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
    const streak = record.streakUnit === "day"
      ? streakDays(counts, todayKey)
      : streakWeeks(counts, todayKey, weekStreakTarget(record.habitTarget));
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
    const stalled = record.archived || record.completed
      ? null
      : stalledDays(record.file.stat.mtime, new Date(), this.plugin.settings.stalledDays);
    const hasLineActions = plan.today !== "none" || plan.complete || stalled !== null;
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

    // 「今日やる」「完了」は本文の下、カード右下の右寄せ行に出す。本文を切らない。「…」は名前の右。
    if (hasLineActions) {
      const actions = content.createDiv("dayspann-card-actions dayspann-project-line-actions dayspann-project-action-row");
      if (stalled !== null) {
        const mark = actions.createDiv("dayspann-stalled");
        setIcon(mark, "hourglass");
        const tooltip = this.plugin.t("stalled.tooltip", { days: stalled });
        setTooltip(mark, tooltip);
        mark.setAttribute("aria-label", tooltip);
      }
      if (plan.today !== "none") this.todayButton(actions, record, plan.today === "inToday");
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

  /** 「今日やる」の文字ピル。今日の一覧に入っているときは「今日 ✓」にして、アクセント色の塗りにする。ツールチップはこれまでと同じ。 */
  private todayButton(parent: HTMLElement, record: DayspannRecord, inToday: boolean): HTMLButtonElement {
    const tooltip = this.plugin.t(inToday ? "action.inTodayLabel" : "action.todayLabel");
    const button = parent.createEl("button", {
      cls: "dayspann-today-button" + (inToday ? " dayspann-today-button--done" : ""),
      attr: { type: "button", "aria-label": tooltip },
    });
    if (inToday) setIcon(button.createSpan("dayspann-today-check"), "check");
    button.createSpan({
      text: this.plugin.t(inToday ? "action.inTodayShort" : "action.todayShort"),
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
