/**
 * 画面の読み直しをまとめる。
 * ボタン操作の直後に、自分で書いたファイルの変更イベントがもう一度読み直しを予約しても、それを無視する。
 * ほかのファイルの変更は落とさない。
 */

export const REFRESH_DEBOUNCE_MS = 150;
export const OWN_WRITE_IGNORE_MS = 250;

export function rememberOwnWrites(
  writtenAt: ReadonlyMap<string, number>,
  paths: readonly string[],
  now: number
): Map<string, number> {
  const next = new Map(writtenAt);
  for (const path of paths) {
    if (path) next.set(path, now);
  }
  return next;
}

/** 予約されたパスが、すべて自分で書いた直後のファイルなら、二重の読み直しとみなす。 */
export function isOwnWriteEcho(
  writtenAt: ReadonlyMap<string, number>,
  paths: readonly string[],
  now: number,
  ttlMs = OWN_WRITE_IGNORE_MS
): boolean {
  const relevant = paths.filter(Boolean);
  if (!relevant.length) return false;
  return relevant.every((path) => {
    const written = writtenAt.get(path);
    return written !== undefined && now - written < ttlMs;
  });
}

export type ImmediateRefreshDecision = "run-now" | "queue-trailing";
export type ScheduledRefreshDecision = "ignore" | "queue-trailing" | "start-timer";

export function decideImmediateRefresh(inFlight: boolean): ImmediateRefreshDecision {
  return inFlight ? "queue-trailing" : "run-now";
}

export function decideScheduledRefresh(options: {
  inFlight: boolean;
  isEcho: boolean;
}): ScheduledRefreshDecision {
  if (options.isEcho) return "ignore";
  if (options.inFlight) return "queue-trailing";
  return "start-timer";
}

export interface RefreshCoalescerHooks {
  now: () => number;
  setTimeout: (callback: () => void | Promise<void>, ms: number) => number;
  clearTimeout: (id: number) => void;
}

/**
 * いま動いている読み直しと、150ms の予約、自分の書き込みのエコーをまとめる。
 * タイマーや時刻はテストで差し替えられる。
 */
export class RefreshCoalescer {
  private inFlight: Promise<void> | null = null;
  private trailingImmediate = false;
  private trailingScheduled = false;
  private timerId: number | undefined;
  private pendingScheduledPaths: string[] = [];
  private writtenAt = new Map<string, number>();

  constructor(
    private readonly run: () => Promise<void>,
    private readonly hooks: RefreshCoalescerHooks
  ) {}

  noteOwnWrites(paths: readonly string[]): void {
    const now = this.hooks.now();
    this.writtenAt = rememberOwnWrites(this.writtenAt, paths, now);
    // 書き込み中に予約されたタイマーが、自分の変更だけなら取り消す。
    if (
      this.timerId !== undefined &&
      isOwnWriteEcho(this.writtenAt, this.pendingScheduledPaths, now)
    ) {
      this.clearTimer();
    }
  }

  requestImmediate(): Promise<void> {
    const pending = this.pendingScheduledPaths;
    const now = this.hooks.now();
    this.clearTimer();
    // 予約していたのが自分の書き込み以外なら、今の読み直しのあとに一度だけ残す。
    if (pending.length && !isOwnWriteEcho(this.writtenAt, pending, now)) {
      this.trailingScheduled = true;
      this.pendingScheduledPaths = pending;
    }
    if (decideImmediateRefresh(this.inFlight !== null) === "queue-trailing") {
      this.trailingImmediate = true;
      return this.inFlight ?? this.start();
    }
    return this.start();
  }

  requestScheduled(paths: readonly string[]): void {
    const decision = decideScheduledRefresh({
      inFlight: this.inFlight !== null,
      isEcho: isOwnWriteEcho(this.writtenAt, paths, this.hooks.now()),
    });
    if (decision === "ignore") return;
    if (decision === "queue-trailing") {
      this.trailingScheduled = true;
      this.pendingScheduledPaths = [...this.pendingScheduledPaths, ...paths.filter(Boolean)];
      return;
    }
    this.pendingScheduledPaths = [...this.pendingScheduledPaths, ...paths.filter(Boolean)];
    this.startTimer();
  }

  dispose(): void {
    this.clearTimer();
  }

  private start(): Promise<void> {
    const work = (async () => {
      try {
        await this.run();
      } finally {
        this.inFlight = null;
      }
      const runAgain = this.trailingImmediate;
      const scheduleAgain = this.trailingScheduled;
      this.trailingImmediate = false;
      this.trailingScheduled = false;
      if (runAgain) {
        await this.start();
        return;
      }
      if (scheduleAgain && !isOwnWriteEcho(this.writtenAt, this.pendingScheduledPaths, this.hooks.now())) {
        this.startTimer();
      } else {
        this.pendingScheduledPaths = [];
      }
    })();
    this.inFlight = work;
    return work;
  }

  private startTimer(): void {
    if (this.timerId !== undefined) {
      this.hooks.clearTimeout(this.timerId);
      this.timerId = undefined;
    }
    this.timerId = this.hooks.setTimeout(() => {
      this.timerId = undefined;
      this.pendingScheduledPaths = [];
      return this.requestImmediate();
    }, REFRESH_DEBOUNCE_MS);
  }

  private clearTimer(): void {
    if (this.timerId !== undefined) {
      this.hooks.clearTimeout(this.timerId);
      this.timerId = undefined;
    }
    this.pendingScheduledPaths = [];
  }
}
