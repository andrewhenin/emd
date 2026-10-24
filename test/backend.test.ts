import { expect, test } from "vitest";
import {
  type BackendId,
  type DeviceBackend,
  type Environment,
  readScreen,
  unavailableReason,
} from "../src/core/device/backend.ts";
import type { UiNode } from "../src/core/device/screen.ts";

// Decision 0004. The backends here are small real objects, not the tools; the
// real ones run in test/e2e.
const env = (
  xcodeMajor: number | undefined,
  installed: Partial<Record<BackendId, boolean>> = {},
): Environment => ({
  xcodeMajor,
  installed: { axe: true, maestro: true, ...installed },
});

const nodesFrom = (id: BackendId): UiNode[] => [
  { id: `from-${id}`, texts: [] },
];

const works = (id: BackendId, calls: BackendId[] = []): DeviceBackend => ({
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
  }) as DeviceBackend;

test.each([
  ["axe", env(27), undefined],
  ["axe", env(28), undefined],
  ["axe", env(26), "Xcode 26; AXe needs 27 or newer"],
  ["axe", env(undefined), "Xcode not found; AXe needs 27 or newer"],
  ["axe", env(27, { axe: false }), "axe is not installed"],
  ["maestro", env(26), undefined],
  ["maestro", env(undefined), undefined],
  ["maestro", env(27, { maestro: false }), "maestro is not installed"],
] as const)("%s on %j: unavailable because %s", (id, environment, reason) => {
  expect(unavailableReason(id, environment)).toBe(reason);
});

test("uses AXe, and says so, when Xcode is 27 or newer and it is installed", async () => {
  const calls: BackendId[] = [];
  const read = await readScreen("udid", env(27), [
    works("axe", calls),
    works("maestro", calls),
  ]);
  expect(read).toEqual({ nodes: nodesFrom("axe"), backend: "axe" });
  expect(calls).toEqual(["axe"]);
});

test("uses Maestro below Xcode 27 and names why AXe was skipped", async () => {
  const calls: BackendId[] = [];
  const read = await readScreen("udid", env(26), [
    works("axe", calls),
    works("maestro", calls),
  ]);
  expect(read.backend).toBe("maestro");
  expect(read.nodes).toEqual(nodesFrom("maestro"));
  expect(read.fellBack).toEqual([
    { backend: "axe", reason: "Xcode 26; AXe needs 27 or newer" },
  ]);
  expect(calls).toEqual(["maestro"]);
});

test("falls back to Maestro when AXe is not installed", async () => {
  const read = await readScreen("udid", env(27, { axe: false }), [
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
  const read = await readScreen("udid", env(27), [
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
    readScreen("udid", env(27), [
      breaks("axe", "session timed out"),
      breaks("maestro", "driver crashed"),
    ]),
  ).rejects.toThrow(
    "no backend could read the screen (axe: Error: session timed out; maestro: Error: driver crashed)",
  );
  await expect(
    readScreen("udid", env(26, { maestro: false }), []),
  ).rejects.toThrow(
    "axe: Xcode 26; AXe needs 27 or newer; maestro: maestro is not installed",
  );
});

test("a backend that is missing from the list counts as failed, not as success", async () => {
  const read = await readScreen("udid", env(27), [works("maestro")]);
  expect(read.backend).toBe("maestro");
  expect(read.fellBack).toEqual([
    { backend: "axe", reason: "Error: no such backend" },
  ]);
});
