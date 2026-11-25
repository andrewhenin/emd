import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { recordTiming } from "../src/core/launch.ts";
import {
  buildTiming,
  firstErrors,
  knownCause,
  onlyOpenFailed,
  stripAnsi,
} from "../src/core/log.ts";
import { makeDir } from "./helpers.ts";

const esc = String.fromCharCode(27);

test("strips terminal colors", () => {
  expect(stripAnsi(`${esc}[31merror${esc}[0m: boom`)).toBe("error: boom");
});

test("returns the first error lines, not the whole log", () => {
  const log = [
    "› Compiling App.swift",
    "› Compiling Other.swift",
    `${esc}[31merror${esc}[0m: no such module 'Foo'`,
    "› Compiling More.swift",
    "** BUILD FAILED **",
    "› 0 error(s), and 2 warning(s)",
    "xcodebuild: error: Unable to find a destination",
  ].join("\n");
  expect(firstErrors(log)).toEqual([
    "error: no such module 'Foo'",
    "** BUILD FAILED **",
    "xcodebuild: error: Unable to find a destination",
  ]);
});

test("finds the compile error in Expo's format, from a real failed build", () => {
  // Copied from a real `expo run:ios` log with a deliberate Swift error.
  const log = [
    "› Executing emdsandbox » [Expo] Configure project",
    "› Preparing emdsandbox » Info.plist",
    "",
    "❌  (ios/emdsandbox/AppDelegate.swift:46:31)",
    "",
    "  44 | }",
    "  45 |",
    '> 46 | let emdDeliberateBreak: Int = "not an int"',
    "     |                               ^ cannot convert value of type 'String' to specified type 'Int'",
    "  47 |",
    "",
    "",
    "› 1 error(s), and 1 warning(s)",
    "",
    'CommandError: Failed to build iOS project. "xcodebuild" exited with error code 65.',
    "Build logs written to /Users/me/app/.expo/xcodebuild.log",
  ].join("\n");
  expect(firstErrors(log)).toEqual([
    "ios/emdsandbox/AppDelegate.swift:46:31: cannot convert value of type 'String' to specified type 'Int'",
    'CommandError: Failed to build iOS project. "xcodebuild" exited with error code 65.',
  ]);
});

test("caps the number of lines, dedupes and truncates long ones", () => {
  const many = Array.from({ length: 20 }, (_, i) => `error: problem ${i}`);
  expect(firstErrors(many.join("\n"))).toHaveLength(5);
  expect(firstErrors("error: same\nerror: same\nerror: same")).toEqual([
    "error: same",
  ]);
  expect(firstErrors(`error: ${"x".repeat(500)}`)[0]).toHaveLength(200);
});

test("falls back to the last lines when nothing looks like an error", () => {
  const log = Array.from({ length: 12 }, (_, i) => `line ${i}`).join("\n");
  expect(firstErrors(log)).toEqual([
    "line 7",
    "line 8",
    "line 9",
    "line 10",
    "line 11",
  ]);
});

// Lines copied from CI run 41329647784: the build compiled and installed, then
// Expo's own `simctl openurl` timed out (code 60) and `expo run:ios` exited 1.
const openTimedOut = [
  "\u203a Build Succeeded",
  "\u203a 0 error(s), and 4 warning(s)",
  "\u203a Installing on emd-f3854e2698c7",
  "\u203a Opening on emd-f3854e2698c7 (com.emd.sandbox)",
  "Error: xcrun simctl openurl 27E16346-5520-4AE2-A1AF-0C12F764D373 com.emd.sandbox://?__expo_url=http%3A%2F%2F192.168.64.22%3A8081 exited with non-zero code: 60",
  "An error was encountered processing the command (domain=NSPOSIXErrorDomain, code=60):",
  "Operation timed out",
];

test("recognizes a build that failed only in Expo's open step", () => {
  expect(onlyOpenFailed(openTimedOut.join("\n"))).toBe(true);
});

test.each([
  ["the compile did not succeed", 0],
  ["the install had not returned", 3],
  ["a different command failed", 4],
])("does not continue when %s", (_name, drop) => {
  const lines = [...openTimedOut];
  if (drop === 4)
    lines[4] = "Error: xcrun simctl install 27E1 exited with non-zero code: 1";
  else lines.splice(drop, 1);
  expect(onlyOpenFailed(lines.join("\n"))).toBe(false);
});

// #127 and #285: the lines from real runs. A fix that changes the machine
// asks the user first; launching again does not.
test.each([
  [
    "Can't determine id of Simulator app; the Simulator is most likely not installed",
    "this Expo SDK looks for Simulator.app",
    "Select Xcode 26 with `xcode-select`",
    false,
  ],
  [
    "\u274c  error: Scanning for @ExpoModule classes didn't complete (see the warnings above), so the module classes of these packages are missing from the modules provider: expo-modules-core.",
    "Expo's module scan timed out",
    "Launch again",
    true,
  ],
])("names the cause and its fix: %s", (line, reason, fix, safe) => {
  const known = knownCause(`\u001b[31m${line}\u001b[39m\n`);
  expect(known?.reason).toContain(reason);
  expect(known?.fix.do).toContain(fix);
  expect(known?.fix.safe).toBe(safe);
});

test("names no cause for a log it doesn't know", () => {
  expect(knownCause("\u203a Build Succeeded\n")).toBeUndefined();
});

// #208: xcodebuild's -showBuildTimingSummary, as it ends a raw build log,
// here out of order.
const timed = [
  "\u001b[1mBuild Timing Summary\u001b[0m",
  "",
  "Ld (4 tasks) | 3.2 seconds",
  "",
  "CopySwiftLibs (1 task) | 0.4 seconds",
  "",
  "CompileC (212 tasks) | 96.402 seconds",
  "",
  "CodeSign (1 task) | 0.9 seconds",
  "",
  "SwiftCompile (31 tasks) | 40.5 seconds",
  "",
  "PhaseScriptExecution (9 tasks) | 61.118 seconds",
  "",
  "** BUILD SUCCEEDED ** [187.623 sec]",
].join("\n");

test("reads xcodebuild's total and its slowest steps from the timing summary", () => {
  expect(buildTiming(timed)).toEqual({
    seconds: 187.623,
    slowest: [
      { step: "CompileC", tasks: 212, seconds: 96.402 },
      { step: "PhaseScriptExecution", tasks: 9, seconds: 61.118 },
      { step: "SwiftCompile", tasks: 31, seconds: 40.5 },
      { step: "Ld", tasks: 4, seconds: 3.2 },
      { step: "CodeSign", tasks: 1, seconds: 0.9 },
    ],
  });
});

test("a failed build still has a total; a log without a summary has no timing", () => {
  expect(buildTiming("** BUILD FAILED ** [12.5 sec]")).toEqual({
    seconds: 12.5,
    slowest: [],
  });
  expect(buildTiming("› Build Succeeded\n")).toBeUndefined();
});

test("recordTiming appends the slowest steps to build.log, only from a log newer than the build", async () => {
  const root = makeDir({ ".expo/xcodebuild.log": timed });
  const log = join(
    makeDir({ "build.log": "› Build Succeeded\n" }),
    "build.log",
  );
  expect(await recordTiming(root, log, Date.now() + 60_000)).toBeUndefined();
  expect(await recordTiming(root, log, 0)).toBe(187.623);
  const text = readFileSync(log, "utf8");
  expect(text).toContain("EMD: xcodebuild took 187.623 s.");
  expect(text).toContain("EMD:   CompileC (212 tasks): 96.402 s");
  expect(text).not.toContain("CopySwiftLibs");
  // No raw log: nothing to record.
  expect(await recordTiming(makeDir(), log, 0)).toBeUndefined();
});
