import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import expo from "../src/adapters/expo/index.ts";
import gradle from "../src/adapters/gradle/index.ts";
import { builtApk } from "../src/core/buildrecord.ts";
import { createJob, runJob } from "../src/core/jobs.ts";
import { cli, makeDir } from "./helpers.ts";

// The Android paths that need no emulator. The real launch is
// test/e2e/android.test.ts.
const state = makeDir();
process.env.EMD_STATE_DIR = state;

const project = { packageManager: "npm" as const, exec: "npx" };
const plan = (dir: string, platform: "ios" | "android" = "android") =>
  gradle.launchPlan(project, {
    dir,
    platform,
    deviceId: "emulator-5554",
    port: 5554,
  });

test("the plan builds the debug APK of the one app module with its wrapper", async () => {
  expect(await plan("fixtures/android-native")).toEqual({
    build: "./gradlew --console=plain :app:assembleDebug",
    output: join("app", "build", "outputs", "apk", "debug"),
  });
  expect(await plan("fixtures/android-native", "ios")).toBeUndefined();
});

test.each([
  [
    "several app modules",
    {
      gradlew: "",
      "phone/build.gradle": "apply plugin: 'com.android.application'",
      "tv/build.gradle": "apply plugin: 'com.android.application'",
    },
    /several Android app modules: (phone, tv|tv, phone)/,
  ],
  [
    "no Gradle wrapper",
    { "app/build.gradle": "apply plugin: 'com.android.application'" },
    /no Gradle wrapper/,
  ],
])("a project with %s cannot launch", async (_name, files, reason) => {
  expect(await plan(makeDir(files))).toMatch(reason);
});

test("an Expo app builds as run:android does, with the port and the ABI", async () => {
  const request = {
    dir: "/work/app",
    platform: "android" as const,
    deviceId: "emulator-5556",
    port: 8090,
  };
  expect(await expo.launchPlan(project, { ...request, abi: "x86_64" })).toEqual(
    {
      server: "npx expo start --port 8090",
      build:
        "{ [ -d android ] || npx expo prebuild --platform android --no-install; } && cd android && ./gradlew --console=plain app:assembleDebug -PreactNativeDevServerPort=8090 -PreactNativeArchitectures=x86_64",
      output: join("android", "app", "build", "outputs", "apk", "debug"),
    },
  );
  const plain = await expo.launchPlan(project, request);
  expect(typeof plain === "object" && plain.build).not.toMatch(/Architectures/);
});

test("the APK and app ID come from the build's output-metadata.json", () => {
  const metadata = (outputFiles: string[]) =>
    JSON.stringify({
      version: 3,
      applicationId: "com.emd.androidfixture",
      variantName: "debug",
      elements: outputFiles.map((outputFile) => ({
        type: "SINGLE",
        outputFile,
      })),
    });
  const dir = makeDir({ "output-metadata.json": metadata(["app-debug.apk"]) });
  expect(builtApk(dir)).toEqual({
    apk: join(dir, "app-debug.apk"),
    appId: "com.emd.androidfixture",
  });
  const split = makeDir({
    "output-metadata.json": metadata(["a.apk", "b.apk"]),
  });
  expect(() => builtApk(split)).toThrow(/names 2 APKs/);
  expect(() => builtApk(makeDir())).toThrow(/ENOENT/);
});

test("launch refuses a platform the project does not target", () => {
  const dir = makeDir({ "App.xcodeproj/project.pbxproj": "" });
  const run = cli("launch", dir, "--platform", "android");
  expect(run.status).toBe(1);
  expect(JSON.parse(run.stdout)).toMatchObject({
    verdict: "unsupported",
    reason: "The project does not target Android.",
  });
  expect(cli("launch", dir, "--platform", "web").status).toBe(2);
});

test("on an Android run, logs read logcat's capture", async () => {
  const job = createJob("launch", { dir: "/work/app" });
  const logDir = join(state, "runs", job.id);
  await runJob(job.id, {
    launch: async () => ({
      verdict: "launched",
      root: "/work/app",
      platform: "android",
      appId: "com.emd.androidfixture",
      device: { id: "emulator-5554", name: "emd-test" },
      logDir,
    }),
    check: async () => ({ verdict: "error" }),
  });
  mkdirSync(logDir, { recursive: true });
  writeFileSync(
    join(logDir, "app.logcat"),
    "1795431772.512  4087  4087 I EMD     : [EMD:smoke] started\n",
  );
  expect(JSON.parse(cli("logs", job.id).stdout)).toMatchObject({
    verdict: "ok",
    lines: [{ tag: "smoke", message: "started" }],
  });
});
