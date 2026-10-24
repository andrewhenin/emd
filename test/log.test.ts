import { expect, test } from "vitest";
import { firstErrors, stripAnsi } from "../src/core/log.ts";

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
