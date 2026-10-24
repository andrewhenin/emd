import { expect, test } from "vitest";
import { type Device, pickDevice } from "../src/core/simulator.ts";

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
