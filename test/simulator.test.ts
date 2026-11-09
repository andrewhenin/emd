import { expect, test } from "vitest";
import {
  type Device,
  newerThan,
  parseSdkVersion,
  pickDevice,
} from "../src/core/simulator.ts";

const device = (
  id: string,
  name: string,
  version: number[],
  state = "Shutdown",
): Device => ({ id, name, version, state });

const devices = [
  device("a", "iPhone 16", [18, 3]),
  device("b", "iPhone 17", [26, 5]),
  device("c", "iPad Pro 13-inch", [26, 5]),
  device("d", "iPhone 17 Pro", [26, 5]),
  device("e", "iPhone 15", [17, 5], "Booted"),
];

test("prefers a booted iPhone over a newer one", () => {
  expect(pickDevice(devices)?.id).toBe("e");
});

test("otherwise takes the newest iPhone, ignoring iPads", () => {
  const shutdown = devices.filter((d) => d.state !== "Booted");
  expect(pickDevice(shutdown)?.name).toBe("iPhone 17");
});

test("a named device wins by name or UDID, case-insensitively", () => {
  expect(pickDevice(devices, "iphone 16")?.id).toBe("a");
  expect(pickDevice(devices, "D")?.name).toBe("iPhone 17 Pro");
  expect(pickDevice(devices, "iPad Pro 13-inch")?.id).toBe("c");
});

test("returns nothing when no device matches", () => {
  expect(pickDevice(devices, "iPhone 99")).toBeUndefined();
  expect(pickDevice([device("c", "iPad", [26, 5])])).toBeUndefined();
  expect(pickDevice([])).toBeUndefined();
});

// #122: Xcode 26.6 with an iOS 27.1 runtime installed picked 27.1, and the
// build failed. With no device named, the pick stays within the SDK.
test("with no device named, skips runtimes newer than the Xcode SDK", () => {
  const withNewer = [
    ...devices.filter((d) => d.state !== "Booted"),
    device("f", "iPhone 18", [27, 1]),
    device("g", "iPhone 18 Pro", [27, 1], "Booted"),
  ];
  expect(pickDevice(withNewer)?.id).toBe("g");
  expect(pickDevice(withNewer, undefined, [26, 6])?.name).toBe("iPhone 17");
  expect(pickDevice(withNewer, "iPhone 18", [26, 6])?.id).toBe("f");
});

test("a runtime is newer than the SDK by major and minor only", () => {
  expect(newerThan(device("x", "iPhone", [27, 1]), [26, 6])).toBe(true);
  expect(newerThan(device("x", "iPhone", [26, 6, 1]), [26, 6])).toBe(false);
  expect(newerThan(device("x", "iPhone", [18, 3]), [27, 2])).toBe(false);
});

test("reads the SDK version that xcrun prints", () => {
  expect(parseSdkVersion("26.6\n")).toEqual([26, 6]);
  expect(parseSdkVersion("27.2.1\n")).toEqual([27, 2]);
  expect(parseSdkVersion("xcrun: error: SDK not found\n")).toBeUndefined();
});
