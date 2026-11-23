import { expect, test } from "vitest";
import { cli, expoConfig, makeDir } from "./helpers.ts";

const detect = (dir: string) => JSON.parse(cli("detect", dir).stdout);

test("detects the native iOS fixture with no device", () => {
  const result = detect("fixtures/ios-native");
  expect(result).toMatchObject({
    verdict: "detected",
    stack: "xcode",
    platforms: ["ios"],
    appIds: {},
    maestroFlows: [".maestro/smoke.yaml"],
  });
  expect(result.problem).toContain("does not launch them yet");
  expect(result.commands).toBeUndefined();
  expect(result.notes).toContain("Xcode project: EMDNative.xcodeproj.");
  expect(result.notes.join(" ")).toContain(
    "Launch reads it from the built app",
  );
});

test("a workspace is named before a project", () => {
  const dir = makeDir({
    "App.xcodeproj/project.pbxproj": "",
    "App.xcworkspace/contents.xcworkspacedata": "",
  });
  expect(detect(dir).notes).toContain("Xcode project: App.xcworkspace.");
});

test.each([
  ["Tuist", "Project.swift"],
  ["XcodeGen", "project.yml"],
  ["Bazel", "MODULE.bazel"],
  ["Bazel", "WORKSPACE"],
])("%s (%s) is named as the reason launch stops", (tool, file) => {
  const result = detect(makeDir({ [file]: "" }));
  expect(result).toMatchObject({ verdict: "detected", stack: "xcode" });
  expect(result.problem).toContain(tool);
});

test("an Expo app with an ios/ workspace still detects as expo", () => {
  const dir = makeDir({
    "package.json": JSON.stringify({ dependencies: { expo: "~58.0.0" } }),
    ...expoConfig({ name: "x" }),
    "ios/App.xcworkspace/contents.xcworkspacedata": "",
    "App.xcodeproj/project.pbxproj": "",
  });
  expect(detect(dir).stack).toBe("expo");
});

test("a React Native app does not detect as xcode", () => {
  const dir = makeDir({
    "package.json": JSON.stringify({
      dependencies: { "react-native": "0.80" },
    }),
    "App.xcodeproj/project.pbxproj": "",
  });
  expect(detect(dir).verdict).toBe("none");
});

test("Xcode files below the root folder do not count", () => {
  const dir = makeDir({ "ios/App.xcodeproj/project.pbxproj": "" });
  expect(detect(dir).verdict).toBe("none");
});
