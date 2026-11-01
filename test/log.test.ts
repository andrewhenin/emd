import { expect, test } from "vitest";
import { firstErrors, onlyOpenFailed, stripAnsi } from "../src/core/log.ts";

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
