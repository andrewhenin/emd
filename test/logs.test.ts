import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { write } from "../src/core/jobstore.ts";
import {
  logs,
  parseTagged,
  predicateFor,
  stopCaptures,
} from "../src/core/logs.ts";
import { makeDir } from "./helpers.ts";

process.env.EMD_STATE_DIR = makeDir();

// Shapes copied from a real `simctl spawn <udid> log show --style ndjson` run;
// `log stream --style ndjson` writes the same shape.
const entry = (eventMessage: string, timestamp: string) =>
  JSON.stringify({ timestamp, eventMessage, messageType: "Info" });

const app = entry("[EMD:smoke] tapped", "2026-10-24 14:17:51.748472-0400");
// A `log` process logs its own arguments, which contain the tag marker.
const self = entry(
  `log run noninteractively, parent: 52519 (launchd_sim), args: 'log' 'show' '--predicate' 'eventMessage CONTAINS "[EMD:"'`,
  "2026-10-24 14:18:47.822870-0400",
);

test("parses a tagged line: ISO time, tag and message", () => {
  expect(parseTagged(app)).toEqual([
    { time: "2026-10-24T18:17:51.748Z", tag: "smoke", message: "tapped" },
  ]);
});

test("ignores the marker inside other text, bad JSON and untagged lines", () => {
  const out = [
    self,
    "Filtering the log data using ...",
    "",
    entry("just a message", "2026-10-24 14:17:52.000000-0400"),
    JSON.stringify({ timestamp: "x" }),
    app,
  ].join("\n");
  expect(parseTagged(out).map((l) => l.message)).toEqual(["tapped"]);
});

test("keeps order, multi-word messages and a tag filter", () => {
  const out = [
    entry(
      "[EMD:nav] opened  Settings screen",
      "2026-10-24 14:00:01.000000-0400",
    ),
    entry("[EMD:smoke] tapped", "2026-10-24 14:00:02.000000-0400"),
    entry("prefix [EMD:nav] second", "2026-10-24 14:00:03.000000-0400"),
  ].join("\n");
  expect(parseTagged(out).map((l) => `${l.tag}:${l.message}`)).toEqual([
    "nav:opened  Settings screen",
    "smoke:tapped",
    "nav:second",
  ]);
  expect(parseTagged(out, "nav")).toHaveLength(2);
  expect(parseTagged(out, "nope")).toEqual([]);
});

test("a timestamp it cannot parse is kept as it came", () => {
  const out = entry("[EMD:a] b", "not a time");
  expect(parseTagged(out)[0]?.time).toBe("not a time");
});

test("the predicate names the app's process and the tag marker", () => {
  expect(predicateFor("emdsandbox")).toBe(
    'processImagePath ENDSWITH "/emdsandbox" AND eventMessage CONTAINS "[EMD:"',
  );
});

test.each(['x" OR TRUEPREDICATE OR "', ""])(
  "the predicate refuses unsafe input (%j)",
  (exe) => {
    expect(() => predicateFor(exe)).toThrow();
  },
);

test.each([
  ["a tag with a quote", { jobId: "deadbeef", tag: 'a"b' }, /A tag has/],
  ["a limit of zero", { jobId: "deadbeef", limit: 0 }, /limit must be/],
  ["a limit too large", { jobId: "deadbeef", limit: 501 }, /limit must be/],
  [
    "a limit that is not whole",
    { jobId: "deadbeef", limit: 1.5 },
    /limit must be/,
  ],
  ["an unknown job", { jobId: "deadbeef" }, /No job with id/],
])(
  "refuses %s before touching the simulator",
  async (_name, options, reason) => {
    const result = await logs(options);
    expect(result.verdict).toBe("failed");
    expect(result.reason).toMatch(reason);
  },
);

// A launch job that got as far as a running app, with its capture file.
function launched(id: string, root: string, capture?: string, pid?: number) {
  const logDir = makeDir();
  if (capture !== undefined) writeFileSync(join(logDir, "app.ndjson"), capture);
  write({
    id,
    kind: "launch",
    input: {},
    status: "succeeded",
    createdAt: "2026-10-24T14:00:00.000Z",
    startedAt: "2026-10-24T14:00:00.000Z",
    result: {
      verdict: "launched",
      root,
      device: { id: "D", name: "emd-x" },
      appId: "com.example",
      logDir,
      ...(pid ? { logStream: { pid } } : {}),
    },
  });
}

test("logs reads the lines captured during the run, skipping a torn last line", async () => {
  const other = entry("[EMD:nav] opened", "2026-10-24 14:17:52.000000-0400");
  launched("aaaaaaa1", "/r", [app, other, '{"timestamp":"2026-10'].join("\n"));
  const all = await logs({ jobId: "aaaaaaa1" });
  expect(all).toMatchObject({ verdict: "ok", total: 2 });
  const tagged = await logs({ jobId: "aaaaaaa1", tag: "nav" });
  expect(tagged.lines?.map((l) => l.message)).toEqual(["opened"]);
});

test("a run without a capture file says so", async () => {
  launched("aaaaaaa2", "/r");
  expect(await logs({ jobId: "aaaaaaa2" })).toEqual({
    verdict: "failed",
    reason: "This run has no captured log.",
  });
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const stand = (command: string) => {
  const child = spawn("sh", ["-c", command], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return child.pid ?? -1;
};

test("the next launch in a worktree stops its earlier capture, and only that", async () => {
  const mine = stand("sleep 60; true # log stream");
  const elsewhere = stand("sleep 60; true # log stream");
  const unrelated = stand("sleep 60; true");
  launched("bbbbbbb1", "/mine", "", mine);
  launched("bbbbbbb2", "/elsewhere", "", elsewhere);
  launched("bbbbbbb3", "/mine", "", unrelated);
  try {
    stopCaptures("/mine");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(alive(mine)).toBe(false);
    expect(alive(elsewhere)).toBe(true);
    expect(alive(unrelated)).toBe(true);
  } finally {
    for (const pid of [mine, elsewhere, unrelated]) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {}
    }
  }
});
