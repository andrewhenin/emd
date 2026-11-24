import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { type E2eJob, e2eSession } from "../helpers.ts";

// The android-native pair (decision 0007): a real build, install and launch of
// fixtures/android-native on an emulator, through the MCP server. Runs where an
// AVD is named in EMD_TEST_AVD: the android-e2e workflow on a Linux runner.

const avd = process.env.EMD_TEST_AVD;
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
    const serial = first?.result?.device?.id;
    const home = process.env.ANDROID_HOME;
    const adb = home ? join(home, "platform-tools", "adb") : "adb";
    if (serial) execFileSync(adb, ["-s", serial, "emu", "kill"]);
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
      const checked = await run("check", {
        jobId: first.jobId,
        name: "android-tap",
        actions: [{ tap: { id: "smoke-button" } }],
        logs: [{ tag: "smoke", message: "tapped" }],
        elements: [{ id: "smoke-label", text: "Tapped" }],
      });
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
