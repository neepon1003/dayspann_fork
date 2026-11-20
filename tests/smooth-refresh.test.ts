import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RefreshCoalescer,
  decideImmediateRefresh,
  decideScheduledRefresh,
  isOwnWriteEcho,
  OWN_WRITE_IGNORE_MS,
  REFRESH_DEBOUNCE_MS,
  rememberOwnWrites,
} from "../src/refresh-coalesce";
import {
  cardFlipKey,
  computeFlipPlan,
  isHiddenFlipRect,
  sectionFlipKey,
  type FlipRect,
} from "../src/smooth-refresh";

function rect(key: string, left: number, top: number, width = 100, height = 40): FlipRect {
  return { key, left, top, width, height };
}

test("カードと見出しのキーは、記録の場所と見出しの種類で安定している", () => {
  assert.equal(cardFlipKey("PJ-span/カード支払.md"), "card:PJ-span/カード支払.md");
  assert.equal(sectionFlipKey("inToday"), "section:inToday");
  assert.equal(isHiddenFlipRect({ width: 0, height: 0 }), true);
  assert.equal(isHiddenFlipRect({ width: 10, height: 0 }), false);
});

test("FLIP は、同じキーの位置の差を計算し、新しいキーはフェードインにする", () => {
  const first = new Map([
    ["card:a", rect("card:a", 0, 80)],
    ["card:b", rect("card:b", 0, 160)],
    ["section:due", rect("section:due", 0, 40)],
  ]);
  const last = new Map([
    ["card:b", rect("card:b", 0, 80)],
    ["card:c", rect("card:c", 0, 160)],
    ["section:due", rect("section:due", 0, 40)],
  ]);
  const plan = computeFlipPlan(first, last);
  assert.deepEqual(plan.moves, [{ key: "card:b", dx: 0, dy: 80 }]);
  assert.deepEqual(plan.appear, ["card:c"]);
});

test("位置が変わっていない要素は動かさない", () => {
  const first = new Map([["card:a", rect("card:a", 10, 20)]]);
  const last = new Map([["card:a", rect("card:a", 10, 20)]]);
  assert.deepEqual(computeFlipPlan(first, last), { moves: [], appear: [] });
});

test("自分の書き込みの直後の同じファイルはエコー、別のファイルはエコーではない", () => {
  const written = rememberOwnWrites(new Map(), ["PJ-span/a.md"], 1000);
  assert.equal(isOwnWriteEcho(written, ["PJ-span/a.md"], 1000 + OWN_WRITE_IGNORE_MS - 1), true);
  assert.equal(isOwnWriteEcho(written, ["PJ-span/a.md"], 1000 + OWN_WRITE_IGNORE_MS), false);
  assert.equal(isOwnWriteEcho(written, ["PJ-span/a.md", "PJ-span/b.md"], 1100), false);
  assert.equal(isOwnWriteEcho(written, [], 1100), false);
  assert.equal(decideImmediateRefresh(false), "run-now");
  assert.equal(decideImmediateRefresh(true), "queue-trailing");
  assert.equal(decideScheduledRefresh({ inFlight: false, isEcho: true }), "ignore");
  assert.equal(decideScheduledRefresh({ inFlight: true, isEcho: false }), "queue-trailing");
  assert.equal(decideScheduledRefresh({ inFlight: false, isEcho: false }), "start-timer");
});

test("読み直しのまとめは、自分の書き込みの予約を無視し、ほかの変更は残す", async () => {
  const calls: number[] = [];
  let now = 0;
  const timers = new Map<number, { callback: () => void | Promise<void>; at: number }>();
  let nextId = 1;
  const coalescer = new RefreshCoalescer(
    async () => {
      calls.push(now);
    },
    {
      now: () => now,
      setTimeout: (callback, ms) => {
        const id = nextId;
        nextId += 1;
        timers.set(id, { callback, at: now + ms });
        return id;
      },
      clearTimeout: (id) => {
        timers.delete(id);
      },
    }
  );

  const flush = async () => {
    const ready = [...timers.entries()].filter(([, timer]) => timer.at <= now);
    for (const [id, timer] of ready) {
      timers.delete(id);
      await timer.callback();
    }
  };

  coalescer.noteOwnWrites(["PJ-span/a.md"]);
  coalescer.requestScheduled(["PJ-span/a.md"]);
  now = OWN_WRITE_IGNORE_MS - 1;
  await flush();
  assert.equal(calls.length, 0);

  await coalescer.requestImmediate();
  assert.deepEqual(calls, [OWN_WRITE_IGNORE_MS - 1]);

  coalescer.requestScheduled(["PJ-span/b.md"]);
  now += REFRESH_DEBOUNCE_MS;
  await flush();
  assert.deepEqual(calls, [OWN_WRITE_IGNORE_MS - 1, now]);

  coalescer.dispose();
});
