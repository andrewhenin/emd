import { expect, test } from "vitest";
import {
  localStamp,
  logs,
  parseTagged,
  predicateFor,
} from "../src/core/logs.ts";

// Shapes copied from a real `simctl spawn <udid> log show --style ndjson` run.
const entry = (eventMessage: string, timestamp: string) =>
  JSON.stringify({ timestamp, eventMessage, messageType: "Info" });

const app = entry("[EMD:smoke] tapped", "2026-10-24 14:17:51.748472-0400");
// `log show` logs its own arguments, which contain the tag marker.
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

test("formats the window start the way `log show` reads it", () => {
  expect(localStamp(new Date(2026, 9, 24, 4, 7, 9))).toBe(
    "2026-10-24 04:07:09",
  );
});

test("the predicate names the app's process and the tag marker", () => {
  expect(predicateFor("emdsandbox")).toBe(
    'processImagePath ENDSWITH "/emdsandbox" AND eventMessage CONTAINS "[EMD:"',
  );
  expect(predicateFor("emdsandbox", "smoke")).toContain(
    'CONTAINS "[EMD:smoke]"',
  );
});

test.each([
  ['x" OR TRUEPREDICATE OR "', undefined],
  ["app", 'a"b'],
  ["app", "a b"],
  ["app", "a]"],
  ["", undefined],
])("the predicate refuses unsafe input (%j, %j)", (exe, tag) => {
  expect(() => predicateFor(exe, tag)).toThrow();
});

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
