import { expect, test } from "vitest";
import {
  type BackendId,
  type DeviceBackend,
  type Environment,
  readScreen,
  untilReadable,
} from "../src/core/device/backend.ts";
import type { UiNode } from "../src/core/device/screen.ts";

// What a screen read needs from a backend.
type Reader = Pick<DeviceBackend, "id" | "readScreen">;

// Decision 0004. The backends here are small real objects, not the tools; the
// real ones run in test/e2e.
const env = (
  installed: Partial<Record<BackendId, boolean>> = {},
): Environment => ({
  ...(installed.axe !== false && { axe: "/bin/axe" }),
  ...(installed.maestro !== false && { maestro: "/bin/maestro" }),
});

const nodesFrom = (id: BackendId): UiNode[] => [
  { id: `from-${id}`, texts: [] },
];

const works = (id: BackendId, calls: BackendId[] = []): Reader => ({
  id,
  readScreen: async () => {
    calls.push(id);
    return nodesFrom(id);
  },
});

const breaks = (id: BackendId, message: string, calls: BackendId[] = []) =>
  ({
    id,
    readScreen: async () => {
      calls.push(id);
      throw new Error(message);
    },
  }) as Reader;

test("hands each backend the path it was found at", async () => {
  const paths: string[] = [];
  const at = (id: BackendId): Reader => ({
    id,
    readScreen: async (_device, bin) => {
      paths.push(bin);
      throw new Error("next");
    },
  });
  await readScreen(
    "udid",
    { axe: "/not/on/path/axe", maestro: "/home/me/.maestro/bin/maestro" },
    [at("axe"), at("maestro")],
  ).catch(() => {});
  expect(paths).toEqual(["/not/on/path/axe", "/home/me/.maestro/bin/maestro"]);
});

test("uses AXe, and says so, whenever it is installed", async () => {
  const calls: BackendId[] = [];
  const read = await readScreen("udid", env(), [
    works("axe", calls),
    works("maestro", calls),
  ]);
  expect(read).toEqual({ nodes: nodesFrom("axe"), backend: "axe" });
  expect(calls).toEqual(["axe"]);
});

test("falls back to Maestro when AXe is not installed", async () => {
  const read = await readScreen("udid", env({ axe: false }), [
    works("axe"),
    works("maestro"),
  ]);
  expect(read.backend).toBe("maestro");
  expect(read.fellBack).toEqual([
    { backend: "axe", reason: "axe is not installed" },
  ]);
});

test("falls back to Maestro when AXe fails on the call, and says why", async () => {
  const calls: BackendId[] = [];
  const read = await readScreen("udid", env(), [
    breaks(
      "axe",
      "Timed out creating the simulator remote automation session\nmore",
      calls,
    ),
    works("maestro", calls),
  ]);
  expect(read.backend).toBe("maestro");
  expect(read.fellBack).toEqual([
    {
      backend: "axe",
      reason:
        "Error: Timed out creating the simulator remote automation session",
    },
  ]);
  expect(calls).toEqual(["axe", "maestro"]);
});

test("when no backend can read the screen, the error names each reason", async () => {
  await expect(
    readScreen("udid", env(), [
      breaks("axe", "session timed out"),
      breaks("maestro", "driver crashed"),
    ]),
  ).rejects.toThrow(
    "no backend could read the screen (axe: Error: session timed out; maestro: Error: driver crashed)",
  );
  await expect(
    readScreen("udid", env({ axe: false, maestro: false }), [
      works("axe"),
      works("maestro"),
    ]),
  ).rejects.toThrow(
    "axe: axe is not installed; maestro: maestro is not installed",
  );
});

const empty = (id: BackendId, calls: BackendId[] = []): Reader => ({
  id,
  readScreen: async () => {
    calls.push(id);
    return [];
  },
});

test("an empty tree is read again: AXe answers on its third read, before Maestro starts", async () => {
  const calls: BackendId[] = [];
  let reads = 0;
  const late: Reader = {
    id: "axe",
    readScreen: async () => {
      calls.push("axe");
      return ++reads < 3 ? [] : nodesFrom("axe");
    },
  };
  const read = await readScreen(
    "udid",
    env(),
    [late, works("maestro", calls)],
    undefined,
    0,
  );
  expect(read.backend).toBe("axe");
  expect(read.fellBack).toBeUndefined();
  expect(calls).toEqual(["axe", "axe", "axe"]);
});

test("a tree empty for three reads is a failed read: the next backend answers, and why is recorded", async () => {
  const calls: BackendId[] = [];
  const read = await readScreen(
    "udid",
    env(),
    [empty("axe", calls), works("maestro", calls)],
    undefined,
    0,
  );
  expect(calls).toEqual(["axe", "axe", "axe", "maestro"]);
  expect(read.backend).toBe("maestro");
  expect(read.nodes).toEqual(nodesFrom("maestro"));
  expect(read.fellBack).toEqual([
    { backend: "axe", reason: "Error: returned an empty tree" },
  ]);
});

test("an empty tree is not read again past the deadline", async () => {
  const calls: BackendId[] = [];
  await expect(
    readScreen(
      "udid",
      env(),
      [empty("axe", calls), empty("maestro", calls)],
      Date.now() + 500,
    ),
  ).rejects.toThrow("axe: Error: returned an empty tree");
  expect(calls).toEqual(["axe", "maestro"]);
});

test("when every backend reads nothing, the read fails and names each", async () => {
  await expect(
    readScreen("udid", env(), [empty("axe"), empty("maestro")], undefined, 0),
  ).rejects.toThrow(
    "no backend could read the screen (axe: Error: returned an empty tree; maestro: Error: returned an empty tree)",
  );
});

const ui = nodesFrom("axe");

test("a read with a deadline gives each backend only the time left, and starts none after it", async () => {
  const given: (number | undefined)[] = [];
  const slow: Reader = {
    id: "axe",
    readScreen: async (_device, _bin, seconds) => {
      given.push(seconds);
      await new Promise((resolve) => setTimeout(resolve, 60));
      throw new Error("axe describe-ui timed out");
    },
  };
  const read = readScreen(
    "dev",
    env(),
    [slow, works("maestro")],
    Date.now() + 50,
  );
  await expect(read).rejects.toThrow(/maestro: (Error: )?no time left/);
  expect(given).toHaveLength(1);
  expect(given[0]).toBeGreaterThan(0);
  expect(given[0]).toBeLessThanOrEqual(0.05);
});

test("waits until the screen can be read, and says how long", async () => {
  let reads = 0;
  const result = await untilReadable(
    async () => (++reads < 3 ? [] : ui),
    5,
    undefined,
    1,
  );
  expect(reads).toBe(3);
  expect(result.error).toBeUndefined();
});

test("gives AXe's first sentence when the screen stays unreadable", async () => {
  const result = await untilReadable(
    async () => {
      throw new Error("No translation object returned. More text.");
    },
    0.05,
    undefined,
    10,
  );
  expect(result.error).toBe("No translation object returned");
});

test("acts once on an empty tree, never on an error", async () => {
  let acts = 0;
  let reads = 0;
  const act = async () => {
    acts++;
  };
  await untilReadable(
    async () => (++reads < 4 ? [] : ui),
    5,
    { afterSeconds: 0, act },
    1,
  );
  expect(acts).toBe(1);
  acts = 0;
  await untilReadable(
    async () => {
      throw new Error("No translation object");
    },
    0.05,
    { afterSeconds: 0, act },
    10,
  );
  expect(acts).toBe(0);
});
