import { expect, test } from "vitest";
import { pickScheme } from "../src/adapters/xcode/index.ts";
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
  expect(result.problem).toBeUndefined();
  expect(result.commands).toBeUndefined();
  expect(result.notes).toEqual(["Xcode project: EMDNative.xcodeproj."]);
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
])("%s (%s): launch needs a prepare command first", (tool, file) => {
  const result = detect(makeDir({ [file]: "" }));
  expect(result).toMatchObject({ verdict: "detected", stack: "xcode" });
  expect(result.problem).toBeUndefined();
  expect(result.needsPrepare).toContain(`with ${tool} (${file})`);
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

test("Xcode files below the root folder do not count", () => {
  const dir = makeDir({ "ios/App.xcodeproj/project.pbxproj": "" });
  expect(detect(dir).verdict).toBe("none");
});

test.each([
  [
    "the scheme named like the project",
    { project: { name: "App", schemes: ["Lib", "App"] } },
    { scheme: "App" },
  ],
  [
    "the scheme named like the workspace",
    { workspace: { name: "App", schemes: ["Pods-App", "App"] } },
    { scheme: "App" },
  ],
  [
    "the only scheme",
    { project: { name: "App", schemes: ["Other"] } },
    { scheme: "Other" },
  ],
  [
    "no guess among several",
    { project: { name: "App", schemes: ["A", "B"] } },
    { schemes: ["A", "B"] },
  ],
])("launch builds %s", (_name, list, picked) => {
  expect(pickScheme(list)).toEqual(picked);
});
