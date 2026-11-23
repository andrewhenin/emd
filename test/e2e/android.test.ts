import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { type E2eJob, e2eSession } from "../helpers.ts";

// The android-native pair and Expo on Android (decision 0007): real builds,
// installs, launches and checks of fixtures/android-native and fixtures/expo on
// an emulator, through the MCP server. Runs where an AVD is named in
// EMD_TEST_AVD: the android-e2e workflow on a Linux runner.

const avd = process.env.EMD_TEST_AVD;

// Stops the emulator a launch used, so the next suite boots its own alone.
const stopEmulatorOf = (job?: E2eJob) => {
  const serial = job?.result?.device?.id;
  const home = process.env.ANDROID_HOME;
  const adb = home ? join(home, "platform-tools", "adb") : "adb";
  if (serial) execFileSync(adb, ["-s", serial, "emu", "kill"]);
};

// A check that taps the fixture's button, then reads its log line and label.
const tapCheck = (jobId: string, name: string) => ({
  jobId,
  name,
  actions: [{ tap: { id: "smoke-button" } }],
  logs: [{ tag: "smoke", message: "tapped" }],
  elements: [{ id: "smoke-label", text: "Tapped" }],
});
describe.skipIf(!avd)("native Android on a real emulator", () => {
  const { client, connect, run } = e2eSession("emd-e2e-android");
  const dir = resolve("fixtures/android-native");
  let first: E2eJob;

  beforeAll(async () => {
    await connect();
    first = await run("launch", { dir, device: avd });
    console.log(`android launch: ${JSON.stringify(first.result)}`);
  }, 30 * 60_000);

  afterAll(async () => {
    await client.close();
    stopEmulatorOf(first);
  });

  test("launch boots an emulator, builds, installs and opens the app", () => {
    expect(first.status, JSON.stringify(first.result)).toBe("succeeded");
    expect(first.result).toMatchObject({
      verdict: "launched",
      platform: "android",
      appId: "com.emd.androidfixture",
      device: { id: expect.stringMatching(/^emulator-\d+$/), name: avd },
      appPid: expect.any(Number),
      build: { action: "built" },
    });
    expect(first.result?.phases).toHaveProperty("boot");
  });

  test(
    "a check finds the line the app logs at start, with a screenshot",
    async () => {
      const checked = await run("check", {
        jobId: first.jobId,
        name: "android-start",
        logs: [{ tag: "smoke", message: "started" }],
      });
      expect(checked.result, JSON.stringify(checked.result)).toMatchObject({
        verdict: "passed",
        logs: [{ tag: "smoke", message: "started", found: true }],
        secondOpinion: { screenshot: expect.stringMatching(/\.png$/) },
      });
    },
    5 * 60_000,
  );

  test(
    "a check taps the button, then finds the tagged log line and the new label",
    async () => {
      const checked = await run("check", tapCheck(first.jobId, "android-tap"));
      expect(checked.result, JSON.stringify(checked.result)).toMatchObject({
        verdict: "passed",
        actions: [{ verdict: "ok", backend: "adb" }],
        backend: "adb",
      });
    },
    5 * 60_000,
  );

  test(
    "a second launch reuses the running emulator",
    async () => {
      const second = await run("launch", { dir });
      expect(second.result).toMatchObject({
        verdict: "launched",
        device: first.result?.device,
      });
      expect(second.result?.phases).not.toHaveProperty("boot");
    },
    15 * 60_000,
  );
});

describe.skipIf(!avd)("Expo on a real Android emulator", () => {
  const { client, connect, run } = e2eSession("emd-e2e-expo-android");
  let launched: E2eJob;

  beforeAll(async () => {
    await connect();
    launched = await run("launch", {
      dir: resolve("fixtures/expo"),
      platform: "android",
      device: avd,
    });
    console.log(`expo android launch: ${JSON.stringify(launched.result)}`);
  }, 40 * 60_000);

  afterAll(async () => {
    await client.close();
    stopEmulatorOf(launched);
  });

  test("launch starts the dev server, builds, and opens the app with its JavaScript", () => {
    expect(launched.status, JSON.stringify(launched.result)).toBe("succeeded");
    expect(launched.result).toMatchObject({
      verdict: "launched",
      platform: "android",
      appId: "com.emd.sandbox",
      metro: { port: expect.any(Number) },
    });
    expect(launched.result?.phases).toHaveProperty("bundle");
  });

  test(
    "a check taps the button, then finds the tagged log line and the new label",
    async () => {
      const checked = await run("check", tapCheck(launched.jobId, "expo-tap"));
      expect(checked.result?.verdict, JSON.stringify(checked.result)).toBe(
        "passed",
      );
    },
    5 * 60_000,
  );

  test(
    "typing into a field shows the text and reaches the app",
    async () => {
      const checked = await run("check", {
        jobId: launched.jobId,
        name: "expo-type",
        actions: [{ tap: { id: "smoke-input" } }, { type: "milk" }],
        logs: [{ tag: "typed", message: "milk" }],
      });
      expect(checked.result?.verdict, JSON.stringify(checked.result)).toBe(
        "passed",
      );
    },
    5 * 60_000,
  );
});
