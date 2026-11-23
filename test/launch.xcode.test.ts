import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import xcode, { sharedSchemes } from "../src/adapters/xcode/index.ts";
import { cli, makeDir } from "./helpers.ts";

// How launch finds what to build in an Xcode project, without Xcode: shared
// scheme files, the scheme and configuration inputs, and the prepare command.

const scheme = (config: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<Scheme version = "1.7">\n   <BuildAction parallelizeBuildables = "YES">\n   </BuildAction>\n   <LaunchAction\n      buildConfiguration = "${config}"\n      launchStyle = "0">\n   </LaunchAction>\n</Scheme>\n`;
const shared = (container: string, names: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(names).map(([name, config]) => [
      `${container}/xcshareddata/xcschemes/${name}.xcscheme`,
      scheme(config),
    ]),
  );
const project = { packageManager: "npm" as const, exec: "npx" };
const plan = (
  dir: string,
  more: { scheme?: string; configuration?: string } = {},
) =>
  xcode.launchPlan(project, {
    dir,
    platform: "ios",
    deviceId: "UDID",
    port: 8081,
    ...more,
  });

test("shared schemes come with the configuration their Run action builds", async () => {
  const dir = makeDir({
    "App.xcodeproj/project.pbxproj": "",
    ...shared("App.xcodeproj", { App: "Debug-Dev", AppTests: "Debug" }),
  });
  expect(await sharedSchemes(dir, "App.xcodeproj")).toEqual(
    new Map([
      ["App", "Debug-Dev"],
      ["AppTests", "Debug"],
    ]),
  );
});

test("a workspace adds the shared schemes of the projects it lists", async () => {
  const dir = makeDir({
    "App.xcworkspace/contents.xcworkspacedata":
      '<Workspace version = "1.0">\n   <FileRef\n      location = "group:Sub/Core.xcodeproj">\n   </FileRef>\n</Workspace>\n',
    ...shared("App.xcworkspace", { App: "Debug" }),
    ...shared("Sub/Core.xcodeproj", { Core: "Release" }),
  });
  expect([...(await sharedSchemes(dir, "App.xcworkspace")).keys()]).toEqual([
    "App",
    "Core",
  ]);
});

test("the scheme named like the project builds with its Run configuration", async () => {
  const dir = makeDir({
    "App.xcodeproj/project.pbxproj": "",
    ...shared("App.xcodeproj", { App: "Debug-Dev", Widget: "Debug" }),
  });
  expect(await plan(dir)).toEqual({
    build:
      "xcodebuild -project 'App.xcodeproj' -scheme 'App' -configuration 'Debug-Dev' -destination id=UDID build",
  });
  expect(await plan(dir, { scheme: "Widget", configuration: "Beta" })).toEqual({
    build:
      "xcodebuild -project 'App.xcodeproj' -scheme 'Widget' -configuration 'Beta' -destination id=UDID build",
  });
  expect(await plan(dir, { scheme: "Nope" })).toBe(
    'App.xcodeproj has no scheme named "Nope". Schemes: App, Widget.',
  );
});

test("with many schemes and none named like the project, the list is short", async () => {
  const names = Object.fromEntries(
    Array.from({ length: 20 }, (_, i) => [
      `S${String(i).padStart(2, "0")}`,
      "Debug",
    ]),
  );
  const dir = makeDir({
    "App.xcodeproj/project.pbxproj": "",
    ...shared("App.xcodeproj", names),
  });
  expect(await plan(dir)).toMatch(
    /has 20 schemes and none is named like it: S00, .*, S14 and 5 more\. Pass scheme/,
  );
});

test("prepare runs in the project folder before anything else, and its failure is the reason", () => {
  const dir = makeDir({
    "settings.gradle": "",
    "app/build.gradle": "apply plugin: 'com.android.application'",
  });
  const run = cli(
    "launch",
    dir,
    "--prepare",
    "touch prepared && echo oops >&2 && exit 3",
  );
  expect(JSON.parse(run.stdout)).toMatchObject({
    verdict: "failed",
    reason: "The prepare command failed (exit 3).",
    errors: expect.arrayContaining([expect.stringContaining("oops")]),
  });
  expect(existsSync(join(dir, "prepared"))).toBe(true);
});
