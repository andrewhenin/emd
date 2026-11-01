import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { delimiter, join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { makeDir } from "./helpers.ts";

// `emd gc` through the built CLI. A stub `xcrun` on PATH stands in for simctl,
// so no real simulator is touched; it logs each call and fails on request.
let state: string;
let bin: string;
let calls: string;
beforeEach(() => {
  state = makeDir();
  bin = makeDir();
  calls = join(bin, "calls.log");
  writeFileSync(
    join(bin, "xcrun"),
    `#!/bin/sh
echo "$@" >> "${calls}"
case "$*" in
  "simctl list devices --json") cat "${join(bin, "sims.json")}" ;;
  *"$GC_FAIL"*) [ -n "$GC_FAIL" ] && { echo "\${GC_FAIL_MESSAGE:-boom}" >&2; exit 1; } ;;
esac
exit 0
`,
  );
  chmodSync(join(bin, "xcrun"), 0o755);
  sims([]);
});

const sims = (list: { id: string; name: string; state?: string }[]) =>
  writeFileSync(
    join(bin, "sims.json"),
    JSON.stringify({
      devices: {
        "com.apple.CoreSimulator.SimRuntime.iOS-26-5": list.map((s) => ({
          udid: s.id,
          name: s.name,
          state: s.state ?? "Shutdown",
        })),
      },
    }),
  );

// A ledger, its DerivedData and bin folders and its check count.
function worktree(key: string, root: string, simulator = `UDID-${key}`) {
  const derived = join(
    state,
    "derived",
    key,
    "Developer/Xcode/DerivedData/app",
  );
  mkdirSync(derived, { recursive: true });
  writeFileSync(join(derived, "build"), "x");
  mkdirSync(join(state, "bin", key), { recursive: true });
  mkdirSync(join(state, "checks"), { recursive: true });
  writeFileSync(join(state, "checks", `${key}.json`), '{"failures":2}');
  mkdirSync(join(state, "owned"), { recursive: true });
  writeFileSync(
    join(state, "owned", `${key}.json`),
    JSON.stringify({
      root,
      resources: [
        { kind: "simulator", id: simulator, state: "owned" },
        { kind: "port", id: "8081", state: "owned" },
        { kind: "derivedData", id: derived, state: "owned" },
      ],
    }),
  );
  return derived;
}

const gc = (args: string[] = [], env: Record<string, string> = {}) => {
  const run = spawnSync("node", ["dist/bin.js", "gc", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      EMD_STATE_DIR: state,
      PATH: `${bin}${delimiter}${process.env.PATH}`,
      ...env,
    },
  });
  return { status: run.status, out: JSON.parse(run.stdout) };
};

const log = () =>
  existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : [];
const has = (...parts: string[]) => existsSync(join(state, ...parts));

test("a dry run lists a stale entry and changes nothing", () => {
  const derived = worktree("aaaaaaaaaaaa", join(state, "gone"));
  sims([{ id: "UDID-aaaaaaaaaaaa", name: "emd-aaaaaaaaaaaa" }]);
  const { status, out } = gc();
  expect(status).toBe(0);
  expect(out.verdict).toBe("dry-run");
  expect(out.entries).toEqual([
    expect.objectContaining({
      key: "aaaaaaaaaaaa",
      root: join(state, "gone"),
      simulator: "UDID-aaaaaaaaaaaa",
      derivedData: derived,
      status: "stale",
    }),
  ]);
  expect(has("owned", "aaaaaaaaaaaa.json")).toBe(true);
  expect(has("derived", "aaaaaaaaaaaa")).toBe(true);
  expect(log()).toEqual(["simctl list devices --json"]);
});

test("an entry whose root exists is never touched", () => {
  worktree("bbbbbbbbbbbb", state);
  const { out } = gc(["--apply"]);
  expect(out.entries).toEqual([]);
  expect(has("owned", "bbbbbbbbbbbb.json")).toBe(true);
  expect(has("derived", "bbbbbbbbbbbb")).toBe(true);
  expect(log()).toEqual(["simctl list devices --json"]);
});

test("--apply removes the simulator, folders and check count, then the ledger", () => {
  worktree("aaaaaaaaaaaa", join(state, "gone"));
  sims([
    { id: "UDID-aaaaaaaaaaaa", name: "emd-aaaaaaaaaaaa", state: "Booted" },
  ]);
  const { out } = gc(["--apply"]);
  expect(out.verdict).toBe("applied");
  expect(out.entries[0]).toMatchObject({
    key: "aaaaaaaaaaaa",
    status: "removed",
  });
  expect(typeof out.freedMB).toBe("number");
  expect(log()).toEqual([
    "simctl list devices --json",
    "simctl shutdown UDID-aaaaaaaaaaaa",
    "simctl delete UDID-aaaaaaaaaaaa",
  ]);
  for (const path of [
    ["owned", "aaaaaaaaaaaa.json"],
    ["derived", "aaaaaaaaaaaa"],
    ["bin", "aaaaaaaaaaaa"],
    ["checks", "aaaaaaaaaaaa.json"],
  ]) {
    expect(has(...path)).toBe(false);
  }
});

test("a failed step keeps the ledger and the check count, and says why", () => {
  worktree("aaaaaaaaaaaa", join(state, "gone"));
  sims([{ id: "UDID-aaaaaaaaaaaa", name: "emd-aaaaaaaaaaaa" }]);
  const { status, out } = gc(["--apply"], { GC_FAIL: "delete" });
  expect(status).toBe(1);
  expect(out.entries[0].status).toBe("failed");
  expect(out.entries[0].reason).toContain("simctl delete UDID-aaaaaaaaaaaa");
  expect(has("owned", "aaaaaaaaaaaa.json")).toBe(true);
  expect(has("checks", "aaaaaaaaaaaa.json")).toBe(true);
  expect(has("derived", "aaaaaaaaaaaa")).toBe(true);
});

test("an entry whose key folder holds anything else is skipped", () => {
  const derived = worktree("aaaaaaaaaaaa", join(state, "gone"));
  writeFileSync(join(derived, "..", "stray.txt"), "mine");
  sims([{ id: "UDID-aaaaaaaaaaaa", name: "emd-aaaaaaaaaaaa" }]);
  const { out } = gc(["--apply"]);
  expect(out.entries[0].status).toBe("skipped");
  expect(out.entries[0].reason).toContain("holds more");
  expect(has("owned", "aaaaaaaaaaaa.json")).toBe(true);
  expect(
    has("derived", "aaaaaaaaaaaa", "Developer/Xcode/DerivedData", "stray.txt"),
  ).toBe(true);
  expect(log()).toEqual(["simctl list devices --json"]);
});

test("a simulator not named emd-<key> is never deleted", () => {
  worktree("aaaaaaaaaaaa", join(state, "gone"));
  sims([{ id: "UDID-aaaaaaaaaaaa", name: "iPhone 17 Pro" }]);
  const { out } = gc(["--apply"]);
  expect(out.entries[0].status).toBe("skipped");
  expect(out.entries[0].reason).toContain("not emd-aaaaaaaaaaaa");
  expect(log()).toEqual(["simctl list devices --json"]);
  expect(has("owned", "aaaaaaaaaaaa.json")).toBe(true);
});

test("emd-* simulators no ledger mentions are listed and left alone", () => {
  worktree("bbbbbbbbbbbb", state);
  sims([
    { id: "UDID-bbbbbbbbbbbb", name: "emd-bbbbbbbbbbbb" },
    { id: "UDID-orphan", name: "emd-orphan" },
    { id: "UDID-other", name: "iPhone 17" },
  ]);
  const { out } = gc(["--apply"]);
  expect(out.unreferencedSimulators).toEqual([
    { id: "UDID-orphan", name: "emd-orphan" },
  ]);
  expect(log()).toEqual(["simctl list devices --json"]);
});

test("a shutdown that finds the simulator already shut down still deletes it", () => {
  worktree("aaaaaaaaaaaa", join(state, "gone"));
  sims([
    { id: "UDID-aaaaaaaaaaaa", name: "emd-aaaaaaaaaaaa", state: "Booted" },
  ]);
  const { status, out } = gc(["--apply"], {
    GC_FAIL: "shutdown",
    GC_FAIL_MESSAGE: "current state: Shutdown",
  });
  expect(status).toBe(0);
  expect(out.entries[0].status).toBe("removed");
  expect(log()).toContain("simctl delete UDID-aaaaaaaaaaaa");
});
