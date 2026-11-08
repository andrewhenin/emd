import { beforeEach, expect, test } from "vitest";
import type { UiNode } from "../src/core/device/screen.ts";
import {
  type Clock,
  waitForSettle,
  waitForStill,
} from "../src/core/device/settle.ts";

// Decision 0008. A clock that moves only when the code sleeps or reads, and
// reads that return a script, so the waits run in no real time. An AXe read
// takes about 0.8 s (experiments/screen-read.md).
let now = 0;
const clock: Clock = {
  now: () => now,
  sleep: async (ms) => {
    now += ms;
  },
};
beforeEach(() => {
  now = 0;
});

const screen = (label: string, button = true): UiNode[] => [
  ...(button ? [{ id: "smoke-button", texts: ["Tap me"] }] : []),
  { id: "smoke-label", texts: [label] },
];

// Each read takes 0.8 s and gives the next entry; the last one repeats.
const reads = (...script: (UiNode[] | undefined)[]) => {
  let i = 0;
  return async () => {
    now += 800;
    return script[Math.min(i++, script.length - 1)];
  };
};

const ready = screen("Ready");
const tapped = screen("Tapped");
const hasButton = (nodes: UiNode[]) =>
  nodes.some((n) => n.id === "smoke-button");

test("after an action: changed once the screen differs, then holds for two reads", async () => {
  const done = await waitForSettle(reads(ready, ready, tapped), ready, clock);
  expect(done).toEqual({ screen: "changed", last: tapped });
  expect(now).toBe(4 * 800);
});

test("after an action: a screen still moving after the change is followed until it holds", async () => {
  const moving = screen("Tapped…");
  const done = await waitForSettle(reads(moving, tapped), ready, clock);
  expect(done).toEqual({ screen: "changed", last: tapped });
});

test("after an action: failed and empty reads do not count", async () => {
  const done = await waitForSettle(
    reads(tapped, undefined, undefined, tapped),
    ready,
    clock,
  );
  expect(done).toEqual({ screen: "changed", last: tapped });
});

test("after an action: no change means unchanged, at the 10 s cap", async () => {
  const done = await waitForSettle(reads(ready), ready, clock);
  expect(done).toEqual({ screen: "unchanged", last: ready });
  expect(now).toBeGreaterThanOrEqual(10_000);
  expect(now).toBeLessThan(10_000 + 800);
});

test("after an action: a screen that never holds is unstable, at the cap", async () => {
  let i = 0;
  const flicker = async () => {
    now += 800;
    return screen(`frame ${i++}`);
  };
  const done = await waitForSettle(flicker, ready, clock);
  expect(done.screen).toBe("unstable");
  expect(now).toBeGreaterThanOrEqual(10_000);
});

test("after an action: unread when no read works, when there is no reader, or no read before the action", async () => {
  expect(await waitForSettle(reads(undefined), ready, clock)).toEqual({
    screen: "unread",
  });
  for (const [read, before] of [
    [undefined, ready],
    [reads(tapped), undefined],
  ] as const) {
    now = 0;
    expect(await waitForSettle(read, before, clock)).toEqual({
      screen: "unread",
    });
    // It still waits the full cap, so a late reaction lands in the step.
    expect(now).toBe(10_000);
  }
});

test("before an action: two matching reads with the target on screen", async () => {
  const loading = screen("Loading", false);
  const still = await waitForStill(
    reads(loading, loading, ready, ready),
    hasButton,
    clock,
  );
  expect(still).toEqual(ready);
  expect(now).toBe(4 * 800);
});

test("before an action: the last read after the previous action counts as the first", async () => {
  expect(await waitForStill(reads(tapped), hasButton, clock, tapped)).toEqual(
    tapped,
  );
  expect(now).toBe(800);
});

test("before an action: at the cap it gives the last good read; with no reader, nothing", async () => {
  let i = 0;
  const flicker = async () => {
    now += 800;
    return screen(`frame ${i++}`);
  };
  const last = await waitForStill(flicker, hasButton, clock);
  expect(last?.[1]?.texts[0]).toMatch(/^frame /);
  expect(now).toBeGreaterThanOrEqual(10_000);
  now = 0;
  expect(await waitForStill(undefined, hasButton, clock)).toBeUndefined();
  expect(now).toBe(0);
});
