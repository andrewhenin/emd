import { expect, test } from "vitest";
import {
  act,
  type BackendId,
  type DeviceBackend,
  DidNotAct,
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
  act: async () => {
    calls.push(id);
  },
});

const breaks = (id: BackendId, message: string, calls: BackendId[] = []) =>
  ({
    id,
    readScreen: async () => {
      calls.push(id);
      throw new Error(message);
    },
    act: async () => {
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
    act: async () => {},
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

const empty = (id: BackendId): DeviceBackend => ({
  id,
  readScreen: async () => [],
  act: async () => {},
});

test("an empty tree is a failed read: the next backend answers, and why is recorded", async () => {
  const read = await readScreen("udid", env(), [
    empty("axe"),
    works("maestro"),
  ]);
  expect(read.backend).toBe("maestro");
  expect(read.nodes).toEqual(nodesFrom("maestro"));
  expect(read.fellBack).toEqual([
    { backend: "axe", reason: "Error: returned an empty tree" },
  ]);
});

test("when every backend reads nothing, the read fails and names each", async () => {
  await expect(
    readScreen("udid", env(), [empty("axe"), empty("maestro")]),
  ).rejects.toThrow(
    "no backend could read the screen (axe: Error: returned an empty tree; maestro: Error: returned an empty tree)",
  );
});

// Decision 0008: a tap is not safe to repeat, so it passes to the next backend
// only when this one is not installed or proves it did not tap.
const app = { device: "udid", appId: "com.emd.sandbox" };
const button = { tapOn: { id: "smoke-button" } };

const notFound = (calls: BackendId[]): DeviceBackend => ({
  ...works("axe"),
  act: async () => {
    calls.push("axe");
    throw new DidNotAct(
      "axe tap failed (exit 1): Warning: No accessibility element matched",
    );
  },
});

test("a tap uses AXe when it is installed, and says so", async () => {
  const calls: BackendId[] = [];
  expect(
    await act(button, app, env(), [
      works("axe", calls),
      works("maestro", calls),
    ]),
  ).toEqual({ backend: "axe" });
  expect(calls).toEqual(["axe"]);
});

test("a tap falls back to Maestro when AXe is not installed", async () => {
  expect(
    await act(button, app, env({ axe: false }), [
      works("axe"),
      works("maestro"),
    ]),
  ).toEqual({
    backend: "maestro",
    fellBack: [{ backend: "axe", reason: "axe is not installed" }],
  });
});

test("a tap falls back to Maestro when AXe proves it did not tap", async () => {
  const calls: BackendId[] = [];
  const done = await act(button, app, env(), [
    notFound(calls),
    works("maestro", calls),
  ]);
  expect(done.backend).toBe("maestro");
  expect(done.fellBack?.[0]?.reason).toContain(
    "No accessibility element matched",
  );
  expect(calls).toEqual(["axe", "maestro"]);
});

test.each([
  "axe tap timed out after 60s",
  "Timed out creating the simulator remote automation session",
])(
  "a tap that fails with %j does not fall back: it names the backend and the error",
  async (message) => {
    const calls: BackendId[] = [];
    const done = await act(button, app, env(), [
      breaks("axe", message, calls),
      works("maestro", calls),
    ]);
    expect(done).toEqual({ backend: "axe", error: `Error: ${message}` });
    expect(calls).toEqual(["axe"]);
  },
);

test("when no backend can tap, the error names each reason", async () => {
  const done = await act(button, app, env({ maestro: false }), [
    notFound([]),
    works("maestro"),
  ]);
  expect(done.backend).toBeUndefined();
  expect(done.error).toMatch(
    /^no backend could run the step \(axe: Error: axe tap failed .*; maestro: maestro is not installed\)$/,
  );
});
