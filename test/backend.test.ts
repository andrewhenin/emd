import { expect, test } from "vitest";
import {
  type BackendId,
  type DeviceBackend,
  type Environment,
  readScreen,
} from "../src/core/device/backend.ts";
import type { UiNode } from "../src/core/device/screen.ts";

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

test("hands each backend the path it was found at", async () => {
  const paths: string[] = [];
  const at = (id: BackendId): DeviceBackend => ({
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
