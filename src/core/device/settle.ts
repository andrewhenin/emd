import type { UiNode } from "./screen.js";

// Decision 0008: around each action EMD waits for the app, not the clock.
// Before it: until the screen is still and ready (e.g. the target is on it).
// After it: until the screen has changed and is still again. Each wait stops
// at the cap. Generic over the action; reads must be safe to repeat.

// What the wait after an action saw: changed, then still (changed); no change
// (unchanged); never still after it changed (unstable); no usable read
// (unread). The last three end at the cap.
export const screenStates = [
  "changed",
  "unchanged",
  "unstable",
  "unread",
] as const;
export type ScreenState = (typeof screenStates)[number];

// A read of the screen, or undefined when it failed or came back empty.
export type Read = () => Promise<UiNode[] | undefined>;

export type Clock = { now: () => number; sleep: (ms: number) => Promise<void> };

const capMs = 10_000;
// Reads start at most this often, so a read that fails at once does not spin.
const pollMs = 250;

const same = (a: UiNode[], b: UiNode[]) =>
  JSON.stringify(a) === JSON.stringify(b);

// Reads until `stop` says the read is the last one, or the cap. Failed and
// empty reads do not count. Returns the last good read and whether `stop` ended it.
async function poll(
  read: Read,
  clock: Clock,
  stop: (nodes: UiNode[], previous: UiNode[] | undefined) => boolean,
  first?: UiNode[],
): Promise<{ last?: UiNode[]; stopped: boolean }> {
  const end = clock.now() + capMs;
  let last = first;
  while (clock.now() < end) {
    const began = clock.now();
    const nodes = await read();
    if (nodes) {
      if (stop(nodes, last)) return { last: nodes, stopped: true };
      last = nodes;
    }
    await clock.sleep(Math.max(0, began + pollMs - clock.now()));
  }
  return { last, stopped: false };
}

// Before an action: the screen once two good reads in a row match and `ready`
// holds for it. `previous` (the last read after the previous action) counts as
// the first of the two. Undefined when no read was possible.
export async function waitForStill(
  read: Read | undefined,
  ready: (nodes: UiNode[]) => boolean,
  clock: Clock,
  previous?: UiNode[],
): Promise<UiNode[] | undefined> {
  if (!read) return undefined;
  const { last } = await poll(
    read,
    clock,
    (nodes, before) =>
      before !== undefined && same(nodes, before) && ready(nodes),
    previous,
  );
  return last;
}

// After an action: waits until the screen differs from `before`, the read
// taken just before the action, and then two good reads in a row match.
export async function waitForSettle(
  read: Read | undefined,
  before: UiNode[] | undefined,
  clock: Clock,
): Promise<{ screen: ScreenState; last?: UiNode[] }> {
  if (!read || !before) {
    await clock.sleep(capMs);
    return { screen: "unread" };
  }
  let changed = false;
  const { last, stopped } = await poll(read, clock, (nodes, previous) => {
    if (changed) return previous !== undefined && same(nodes, previous);
    changed = !same(nodes, before);
    return false;
  });
  if (stopped) return { screen: "changed", last };
  if (!last) return { screen: "unread" };
  return { screen: changed ? "unstable" : "unchanged", last };
}
