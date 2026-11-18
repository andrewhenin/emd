import { existsSync } from "node:fs";
import { join } from "node:path";
import { runTool } from "./tool.js";

export type Device = {
  id: string;
  name: string;
  state: string;
  // iOS version from the runtime id, e.g. [26, 5].
  version: number[];
};

type SimctlList = {
  devices: Record<
    string,
    { udid: string; name: string; state: string; isAvailable?: boolean }[]
  >;
};

export async function listDevices(): Promise<Device[]> {
  const { stdout } = await runTool(
    "simctl list",
    "xcrun",
    ["simctl", "list", "devices", "available", "--json"],
    60,
  );
  const { devices } = JSON.parse(stdout) as SimctlList;
  return Object.entries(devices).flatMap(([runtime, list]) => {
    const match = runtime.match(/\.iOS-([\d-]+)$/);
    if (!match?.[1]) return [];
    const version = match[1].split("-").map(Number);
    return list
      .filter((d) => d.isAvailable !== false)
      .map((d) => ({ id: d.udid, name: d.name, state: d.state, version }));
  });
}

const newest = (a: Device, b: Device): number => {
  for (let i = 0; i < Math.max(a.version.length, b.version.length); i++) {
    const diff = (b.version[i] ?? 0) - (a.version[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return a.name.localeCompare(b.name);
};

// A named device wins; otherwise a booted iPhone; otherwise the newest iPhone.
// With no device named, only runtimes that `sdk` (the selected Xcode's iOS
// simulator SDK) can build for.
export function pickDevice(
  devices: Device[],
  wanted?: string,
  sdk?: number[],
): Device | undefined {
  const sorted = [...devices].sort(newest);
  if (wanted) {
    const key = wanted.toLowerCase();
    return sorted.find(
      (d) => d.id.toLowerCase() === key || d.name.toLowerCase() === key,
    );
  }
  const iphones = sorted.filter(
    (d) => d.name.startsWith("iPhone") && !(sdk && newerThan(d, sdk)),
  );
  return iphones.find((d) => d.state === "Booted") ?? iphones[0];
}

// True when the device's iOS major.minor is newer than `sdk`'s. A patch
// runtime (26.6.1) builds with its SDK (26.6).
export function newerThan(device: Device, sdk: number[]): boolean {
  for (let i = 0; i < 2; i++) {
    const diff = (device.version[i] ?? 0) - (sdk[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

// The selected Xcode's iOS simulator SDK version, e.g. [26, 6]; undefined when
// xcrun cannot tell, so the pick is not limited.
export async function simulatorSdk(): Promise<number[] | undefined> {
  try {
    const { stdout } = await runTool(
      "xcrun --show-sdk-version",
      "xcrun",
      ["--sdk", "iphonesimulator", "--show-sdk-version"],
      60,
    );
    return parseSdkVersion(stdout);
  } catch {
    return undefined;
  }
}

export function parseSdkVersion(output: string): number[] | undefined {
  const match = output.trim().match(/^(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2])] : undefined;
}

export async function boot(device: Device): Promise<void> {
  if (device.state !== "Booted") {
    try {
      await runTool("simctl boot", "xcrun", ["simctl", "boot", device.id], 120);
    } catch (error) {
      // Booting a device that is already booted is not a failure.
      if (!/current state: Booted/i.test(String(error))) throw error;
    }
  }
  await runTool(
    "simctl bootstatus",
    "xcrun",
    ["simctl", "bootstatus", device.id, "-b"],
    300,
  );
}

const accessibilityKey = "ApplicationAccessibilityEnabled";

// Whether application accessibility is on. An app that starts while it is off
// can show AXe an empty tree on some iOS versions (docs/findings.md).
export async function appAccessibilityOn(device: Device): Promise<boolean> {
  try {
    const { stdout } = await runTool(
      "simctl spawn defaults read",
      "xcrun",
      [
        "simctl",
        "spawn",
        device.id,
        "defaults",
        "read",
        "com.apple.Accessibility",
        accessibilityKey,
      ],
      60,
    );
    return stdout.trim() === "1";
  } catch {
    return false;
  }
}

// Turns it on, on a simulator EMD made. The setting stays on the device; an
// app that is already running must restart to see it.
export async function enableAppAccessibility(device: Device): Promise<void> {
  await runTool(
    "simctl spawn defaults write",
    "xcrun",
    [
      "simctl",
      "spawn",
      device.id,
      "defaults",
      "write",
      "com.apple.Accessibility",
      accessibilityKey,
      "-bool",
      "true",
    ],
    60,
  );
}

// Stops the app if it runs; a later launch then starts it fresh. Not running is
// not a failure.
export async function terminateApp(
  device: Device,
  appId: string,
): Promise<void> {
  try {
    await runTool(
      "simctl terminate",
      "xcrun",
      ["simctl", "terminate", device.id, appId],
      60,
    );
  } catch {}
}

// Returns the app's pid. Brings the app forward if it is already running.
export async function launchApp(
  device: Device,
  appId: string,
): Promise<number> {
  const { stdout } = await runTool(
    "simctl launch",
    "xcrun",
    ["simctl", "launch", device.id, appId],
    120,
  );
  const pid = Number(stdout.trim().split(":").pop());
  if (!Number.isInteger(pid)) throw new Error(`unexpected output: ${stdout}`);
  return pid;
}

// True when the app is installed on the device. `simctl` can name a container
// whose app files are gone, so the app's Info.plist must exist.
export async function appInstalled(
  device: Device,
  appId: string,
): Promise<boolean> {
  try {
    const { stdout } = await runTool(
      "simctl get_app_container",
      "xcrun",
      ["simctl", "get_app_container", device.id, appId],
      60,
    );
    return existsSync(join(stdout.trim(), "Info.plist"));
  } catch {
    return false;
  }
}

// Installs a built `.app` on the device.
export async function installApp(
  device: Device,
  appPath: string,
): Promise<void> {
  await runTool(
    "simctl install",
    "xcrun",
    ["simctl", "install", device.id, appPath],
    120,
  );
}

// A new simulator with the same type and runtime as `base`; returns its UDID.
// The base must be shut down.
export async function cloneDevice(base: Device, name: string): Promise<string> {
  const { stdout } = await runTool(
    "simctl clone",
    "xcrun",
    ["simctl", "clone", base.id, name],
    300,
  );
  return stdout.trim();
}

export type Simulator = { id: string; name: string; state: string };

// Every simulator on the machine, available or not.
export async function listSimulators(): Promise<Simulator[]> {
  const { stdout } = await runTool(
    "simctl list",
    "xcrun",
    ["simctl", "list", "devices", "--json"],
    60,
  );
  const { devices } = JSON.parse(stdout) as SimctlList;
  return Object.values(devices).flatMap((list) =>
    list.map((d) => ({ id: d.udid, name: d.name, state: d.state })),
  );
}

// Shuts a simulator down if it is booted, then deletes it. Each step names the
// simulator, so a failure says which one.
export async function removeSimulator(device: Simulator): Promise<void> {
  const simctl = (action: string) =>
    runTool(
      `simctl ${action} ${device.id}`,
      "xcrun",
      ["simctl", action, device.id],
      120,
    );
  if (device.state === "Booted") {
    try {
      await simctl("shutdown");
    } catch (error) {
      if (!/current state: Shutdown/i.test(String(error))) throw error;
    }
  }
  await simctl("delete");
}
