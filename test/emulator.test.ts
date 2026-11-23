import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  adbDevices,
  listAvds,
  parseAdbDevices,
  parseAvds,
  pickAvd,
  pickEmulatorPort,
  serialOf,
  startEmulator,
  stopEmulator,
  untilBooted,
} from "../src/core/emulator.ts";
import { makeDir } from "./helpers.ts";

test("AVD names come one a line, after any INFO lines", () => {
  expect(
    parseAvds("INFO    | Storing crashdata\nPixel_8_API_35\nsmall\n\n"),
  ).toEqual(["Pixel_8_API_35", "small"]);
});

test("the base AVD is the one named, else the first listed", () => {
  expect(pickAvd(["a", "b"])).toBe("a");
  expect(pickAvd(["a", "b"], "b")).toBe("b");
  expect(pickAvd(["a", "b"], "c")).toBeUndefined();
  expect(pickAvd([])).toBeUndefined();
});

test("adb devices gives each serial and state", () => {
  expect(
    parseAdbDevices(
      "List of devices attached\nemulator-5554\tdevice\nemulator-5556\toffline\n\n",
    ),
  ).toEqual([
    { serial: "emulator-5554", state: "device" },
    { serial: "emulator-5556", state: "offline" },
  ]);
});

test("an emulator port is the first free even port from 5554", () => {
  expect(pickEmulatorPort(new Set())).toBe("5554");
  expect(pickEmulatorPort(new Set(["5554", "5556"]))).toBe("5558");
  expect(serialOf("5558")).toBe("emulator-5558");
});

// A real start of two read-only emulators from one AVD. Runs where an AVD is
// named in EMD_TEST_AVD: the android-emulator workflow on a Linux runner.
const avd = process.env.EMD_TEST_AVD;
describe.skipIf(!avd)("two worktrees' emulators from one AVD", () => {
  test(
    "both boot at once, and stopping one leaves the other",
    async () => {
      expect(await listAvds()).toContain(avd);
      const dir = makeDir();
      const ports = ["5560", "5562"];
      for (const port of ports) {
        startEmulator(avd ?? "", port, join(dir, `${port}.log`));
      }
      await Promise.all(ports.map((p) => untilBooted(serialOf(p), 600)));
      await stopEmulator("5560");
      const states = async () =>
        (await adbDevices())
          .map((d) => d.serial)
          .filter((s) => s.startsWith("emulator-556"));
      for (
        let i = 0;
        i < 30 && (await states()).includes("emulator-5560");
        i++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      expect(await states()).toEqual(["emulator-5562"]);
      await stopEmulator("5562");
      await stopEmulator("5560");
    },
    15 * 60_000,
  );
});
