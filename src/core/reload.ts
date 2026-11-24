import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { launchesIn } from "./jobstore.js";
import type { LaunchResult } from "./result.js";
import type { Device } from "./simulator.js";
import { runTool } from "./tool.js";

// The same message Expo's R key broadcasts to connected apps: the dev server's
// message socket relays a "reload" from a local client to every app.
export async function sendReload(port: number): Promise<void> {
  const socket = new WebSocket(`ws://localhost:${port}/message`);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("socket timeout")), 5000);
    socket.onopen = () => {
      socket.send(JSON.stringify({ version: 2, method: "reload" }));
      clearTimeout(timer);
      resolve();
    };
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error("socket error"));
    };
  });
  // The server answers the close; a silent one must not hold this process.
  await new Promise<void>((resolve) => {
    socket.onclose = () => resolve();
    socket.close();
    setTimeout(resolve, 1000).unref();
  });
}

// The pid of the app when it runs on the device; undefined when it does not.
export async function runningPid(
  device: Device,
  appId: string,
): Promise<number | undefined> {
  try {
    const { stdout } = await runTool(
      "simctl spawn launchctl list",
      "xcrun",
      ["simctl", "spawn", device.id, "launchctl", "list"],
      60,
    );
    const mark = `UIKitApplication:${appId}[`;
    for (const line of stdout.split("\n")) {
      if (!line.includes(mark)) continue;
      const pid = Number(line.trim().split(/\s+/)[0]);
      return Number.isInteger(pid) ? pid : undefined;
    }
  } catch {}
  return undefined;
}

// The earlier launch in this worktree whose dev server still listens on `port`,
// or undefined. `listening` tells which recorded dev server pids do.
export const earlierLaunch = (
  root: string,
  port: number,
  listening: number[],
): LaunchResult | undefined =>
  // Reloads share one dev server, so the newest run (its folder name starts
  // with its start time) is the one whose log window is open.
  launchesIn(root)
    .filter(
      ({ verdict, platform, metro, device, logDir }) =>
        verdict === "launched" &&
        (platform ?? "ios") === "ios" &&
        metro?.port === port &&
        listening.includes(metro.pid) &&
        device &&
        logDir,
    )
    .sort((a, b) =>
      basename(b.logDir ?? "").localeCompare(basename(a.logDir ?? "")),
    )[0];

const bundled = /Bundled \d+ms/g;
const bundleFailed = /Bundling failed/g;
const read = (path: string) => readFile(path, "utf8").catch(() => "");
const count = async (path: string) =>
  ((await read(path)).match(bundled) ?? []).length;

// Resolves when the dev server log shows a bundle served after `before`
// bundles, or a bundle that failed to build after `failedBefore` failures.
export async function untilBundled(
  logDir: string,
  before: number,
  seconds: number,
  failedBefore = Number.POSITIVE_INFINITY,
): Promise<"bundled" | "failed" | "timeout"> {
  const path = join(logDir, "metro.log");
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const text = await read(path);
    if ((text.match(bundled) ?? []).length > before) return "bundled";
    if ((text.match(bundleFailed) ?? []).length > failedBefore) return "failed";
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return "timeout";
}

export const bundlesServed = (logDir: string) =>
  count(join(logDir, "metro.log"));
