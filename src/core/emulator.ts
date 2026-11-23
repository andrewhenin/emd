import { join } from "node:path";
import { type LoggedProcess, startLogged } from "./process.js";
import { runTool } from "./tool.js";

// Android emulators, one per worktree: the base AVD runs read-only on a port
// EMD reserves, so several worktrees share one AVD and none writes to it
// (#254). The port is the owned resource (decision 0006).

// An SDK tool from ANDROID_HOME (or ANDROID_SDK_ROOT), else from PATH.
function sdkTool(name: "adb" | "emulator"): string {
  const home = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  const file = process.platform === "win32" ? `${name}.exe` : name;
  if (!home) return file;
  return join(home, name === "adb" ? "platform-tools" : "emulator", file);
}

// `emulator -list-avds` prints one AVD name a line, after any INFO lines.
export const parseAvds = (stdout: string): string[] =>
  stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^(INFO|WARNING|ERROR)\b/.test(line));

// The AVD `wanted` names, else the first one listed.
export const pickAvd = (avds: string[], wanted?: string): string | undefined =>
  wanted === undefined ? avds[0] : avds.find((avd) => avd === wanted);

// `adb devices`: serial and state, one a line after the header.
export const parseAdbDevices = (
  stdout: string,
): { serial: string; state: string }[] =>
  stdout
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts): parts is [string, string] => parts.length >= 2)
    .map(([serial, state]) => ({ serial, state }));

// Emulator console ports are even, from 5554 to 5682; adb uses port + 1.
export function pickEmulatorPort(taken: Set<string>): string {
  for (let port = 5554; port <= 5682; port += 2) {
    if (!taken.has(String(port))) return String(port);
  }
  throw new Error("No free emulator port between 5554 and 5682.");
}

export const serialOf = (port: string): string => `emulator-${port}`;

export async function listAvds(): Promise<string[]> {
  const { stdout } = await runTool(
    "emulator -list-avds",
    sdkTool("emulator"),
    ["-list-avds"],
    30,
  );
  return parseAvds(stdout);
}

export async function adbDevices(): Promise<
  { serial: string; state: string }[]
> {
  const { stdout } = await runTool(
    "adb devices",
    sdkTool("adb"),
    ["devices"],
    30,
  );
  return parseAdbDevices(stdout);
}

// Starts `avd` read-only on `port`, with no window. Its output goes to logPath.
export function startEmulator(
  avd: string,
  port: string,
  logPath: string,
): LoggedProcess {
  const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
  return startLogged(
    [
      quote(sdkTool("emulator")),
      `-avd ${quote(avd)}`,
      "-read-only",
      `-port ${port}`,
      // Software rendering: with no window, a host GPU may be missing (CI).
      "-no-window -gpu swiftshader_indirect -no-audio -no-boot-anim -no-snapshot-save",
    ].join(" "),
    { cwd: process.cwd(), logPath },
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Resolves when Android reports the boot complete; throws after `seconds`.
export async function untilBooted(
  serial: string,
  seconds: number,
): Promise<void> {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    const done = await runTool(
      "adb getprop",
      sdkTool("adb"),
      ["-s", serial, "shell", "getprop", "sys.boot_completed"],
      20,
    ).then(
      ({ stdout }) => stdout.trim() === "1",
      () => false,
    );
    if (done) return;
    await sleep(2000);
  }
  throw new Error(`${serial} did not finish booting in ${seconds}s.`);
}

// Stops the emulator on `port`. One that is not running counts as stopped;
// any other failure throws, so the port stays owned until a retry works.
export async function stopEmulator(port: string): Promise<void> {
  const serial = serialOf(port);
  if (!(await adbDevices()).some((d) => d.serial === serial)) return;
  await runTool(
    "adb emu kill",
    sdkTool("adb"),
    ["-s", serial, "emu", "kill"],
    30,
  );
}
