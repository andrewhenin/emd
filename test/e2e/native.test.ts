import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { type E2eJob, e2eSession } from "../helpers.ts";

// The ios-native pair (decision 0007): a real build, launch and check of
// fixtures/ios-native on an iOS simulator, through the MCP server. It runs in
// `npm run test:e2e` on macOS with Xcode; skipped elsewhere.
describe.skipIf(!process.env.EMD_E2E_SANDBOX || process.platform !== "darwin")(
  "native iOS on a real simulator",
  () => {
    const { client, connect, run } = e2eSession("emd-e2e-native");
    let launched: E2eJob;

    beforeAll(async () => {
      // The Expo suite leaves EMD's own simulator booted. A second booted
      // simulator starved the runner: a clone's boot timed out at 300 s in
      // run 45107506814. Only simulators EMD named (emd-) are shut down.
      const { devices } = JSON.parse(
        execFileSync("xcrun", ["simctl", "list", "devices", "booted", "-j"], {
          encoding: "utf8",
        }),
      ) as { devices: Record<string, { name: string; udid: string }[]> };
      for (const device of Object.values(devices).flat()) {
        if (device.name.startsWith("emd-")) {
          execFileSync("xcrun", ["simctl", "shutdown", device.udid]);
        }
      }
      await connect();
      launched = await run("launch", { dir: resolve("fixtures/ios-native") });
      console.log(`native launch: ${JSON.stringify(launched.result)}`);
    }, 20 * 60_000);

    afterAll(() => client.close());

    test("launch builds, installs and opens the app, with no dev server", () => {
      expect(launched.status, JSON.stringify(launched.result)).toBe(
        "succeeded",
      );
      expect(launched.result).toMatchObject({
        verdict: "launched",
        appId: "com.emd.nativefixture",
        build: { action: "built" },
      });
      expect(launched.result?.metro).toBeUndefined();
    });

    test(
      "a check taps the button, then finds the tagged log line and the new label",
      async () => {
        const checked = await run("check", {
          jobId: launched.jobId,
          name: "native",
          actions: [{ tap: { id: "smoke-button" } }],
          logs: [{ tag: "smoke", message: "tapped" }],
          elements: [{ text: "Tapped" }],
        });
        expect(checked.result?.verdict, JSON.stringify(checked.result)).toBe(
          "passed",
        );
      },
      5 * 60_000,
    );
  },
);
