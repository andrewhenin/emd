import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

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
  const { stdout } = await run("xcrun", [
    "simctl",
    "list",
    "devices",
    "available",
    "--json",
  ]);
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
export function pickDevice(
  devices: Device[],
  wanted?: string,
): Device | undefined {
  const sorted = [...devices].sort(newest);
  if (wanted) {
    const key = wanted.toLowerCase();
    return sorted.find(
      (d) => d.id.toLowerCase() === key || d.name.toLowerCase() === key,
    );
  }
  const iphones = sorted.filter((d) => d.name.startsWith("iPhone"));
  return iphones.find((d) => d.state === "Booted") ?? iphones[0];
}

export async function boot(device: Device): Promise<void> {
  if (device.state !== "Booted") {
    try {
      await run("xcrun", ["simctl", "boot", device.id]);
    } catch (error) {
      // Booting a device that is already booted is not a failure.
      if (!/current state: Booted/i.test(String(error))) throw error;
    }
  }
  await run("xcrun", ["simctl", "bootstatus", device.id, "-b"], {
    timeout: 300_000,
  });
}

// Returns the app's pid. Brings the app forward if it is already running.
export async function launchApp(
  device: Device,
  appId: string,
): Promise<number> {
  const { stdout } = await run("xcrun", ["simctl", "launch", device.id, appId]);
  const pid = Number(stdout.trim().split(":").pop());
  if (!Number.isInteger(pid)) throw new Error(`unexpected output: ${stdout}`);
  return pid;
}
