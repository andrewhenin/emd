import { expect, test } from "vitest";
import { cli, expoConfig, makeDir } from "./helpers.ts";

const detect = (dir: string) => JSON.parse(cli("detect", dir).stdout);

test("detects the native Android fixture with no device", () => {
  expect(detect("fixtures/android-native")).toMatchObject({
    verdict: "detected",
    stack: "gradle",
    platforms: ["android"],
    appIds: {},
    problem: expect.stringContaining("does not launch them yet"),
    notes: ["Android app module: app."],
    maestroFlows: [".maestro/smoke.yaml"],
  });
});

test.each([
  [
    "a plugin id (Kotlin DSL)",
    "build.gradle.kts",
    'id("com.android.application")',
  ],
  [
    "a version catalog alias",
    "build.gradle.kts",
    "alias(libs.plugins.android.application)",
  ],
  [
    "apply plugin (Groovy)",
    "build.gradle",
    "apply plugin: 'com.android.application'",
  ],
])("an app module found by %s", (_name, file, line) => {
  const dir = makeDir({
    "settings.gradle": "include ':mobile'",
    [`mobile/${file}`]: line,
  });
  expect(detect(dir)).toMatchObject({
    stack: "gradle",
    notes: ["Android app module: mobile."],
  });
});

test("a Gradle build with no Android app module is not a mobile app", () => {
  const dir = makeDir({
    "settings.gradle.kts": "",
    "lib/build.gradle.kts": 'plugins { id("com.android.library") }',
  });
  expect(detect(dir).verdict).toBe("none");
});

test("an Expo app with an android/ Gradle build still detects as expo", () => {
  const dir = makeDir({
    "package.json": JSON.stringify({ dependencies: { expo: "~58.0.0" } }),
    ...expoConfig({ name: "x" }),
    "android/settings.gradle": "",
    "android/app/build.gradle": "apply plugin: 'com.android.application'",
  });
  expect(detect(dir).stack).toBe("expo");
});
