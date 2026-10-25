import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { detect } from "./detect.js";
import {
  derivedDataPath,
  diskMB,
  pickPort,
  xcodebuildShim,
} from "./isolate.js";
import { firstErrors } from "./log.js";
import { confirm, reserve, worktreeKey } from "./owned.js";
import { startLogged } from "./process.js";
import { inspectProject } from "./project.js";
import { loadAdapter } from "./registry.js";
import type { LaunchResult } from "./result.js";
import {
  boot,
  cloneDevice,
  type Device,
  launchApp,
  listDevices,
  pickDevice,
} from "./simulator.js";
import { stateDir } from "./state.js";

const metroStartSeconds = 120;
const defaultTimeoutSeconds = 900;

export type LaunchOptions = {
  dir?: string;
  // Simulator to clone for this worktree, by name or UDID. Default: the newest
  // shut-down iPhone. Ignored once the worktree has its own simulator.
  device?: string;
  // How long the build may take.
  timeoutSeconds?: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function metroRunning(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/status`, {
      signal: AbortSignal.timeout(2000),
    });
    return (await response.text()).includes("packager-status:running");
  } catch {
    return false;
  }
}

async function untilReady(
  ready: () => Promise<boolean>,
  exited: Promise<number>,
  seconds: number,
): Promise<"ready" | "exited" | "timeout"> {
  let gone = false;
  void exited.then(() => {
    gone = true;
  });
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (await ready()) return "ready";
    if (gone) return "exited";
    await sleep(1000);
  }
  return "timeout";
}

// Resolves with the exit code, or "timeout". Clears its timer so a finished
// build does not keep the process alive.
async function withTimeout(
  exited: Promise<number>,
  seconds: number,
): Promise<number | "timeout"> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), seconds * 1000);
  });
  try {
    return await Promise.race([exited, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const logTail = async (path: string): Promise<string[]> =>
  firstErrors(await readFile(path, "utf8").catch(() => ""));

export async function launch(
  options: LaunchOptions = {},
  report: (step: string) => void = () => {},
): Promise<LaunchResult> {
  const started = Date.now();
  const seconds = () => Math.round((Date.now() - started) / 100) / 10;
  report("checking the project");
  const detected = await detect(options.dir);
  const { root } = detected;
  const unsupported = (reason: string): LaunchResult => ({
    verdict: "unsupported",
    root,
    reason,
  });
  const failed = (reason: string, rest: Partial<LaunchResult> = {}) =>
    ({ verdict: "failed", root, reason, seconds: seconds(), ...rest }) as const;

  if (detected.verdict !== "detected" || !detected.stack) {
    return unsupported("No supported mobile project found here.");
  }
  if (!detected.platforms?.includes("ios")) {
    return unsupported("The project does not target iOS.");
  }
  const appId = detected.appIds?.ios;
  if (!appId) {
    return unsupported(
      "No iOS app ID found; set expo.ios.bundleIdentifier in app.json.",
    );
  }
  if (process.platform !== "darwin") {
    return unsupported("iOS simulators need macOS.");
  }

  // Each worktree gets its own simulator, DerivedData and Metro port, recorded
  // as EMD-owned before they exist (decision 0006).
  const prefix = "emd-";
  let device: Device | undefined;
  let port: number;
  let derivedData: string;
  let shimDir: string;
  try {
    const devices = await listDevices();
    const simulator = await reserve(
      root,
      "simulator",
      () => `${prefix}${worktreeKey(root)}`,
    );
    device = devices.find(
      (d) => d.id === simulator.id || d.name === simulator.id,
    );
    if (!device) {
      const base = pickDevice(
        devices.filter(
          (d) => !d.name.startsWith(prefix) && d.state !== "Booted",
        ),
        options.device,
      );
      if (!base) {
        return failed(
          options.device
            ? `No shut-down simulator matches "${options.device}" to clone.`
            : "No shut-down iPhone simulator is available to clone.",
        );
      }
      report("cloning a simulator");
      const id = await cloneDevice(base, simulator.id);
      device = {
        id,
        name: simulator.id,
        state: "Shutdown",
        version: base.version,
      };
    }
    if (simulator.state !== "owned" || simulator.id !== device.id) {
      confirm(root, "simulator", device.id);
    }
    port = Number((await reserve(root, "port", pickPort)).id);
    derivedData = (
      await reserve(root, "derivedData", () => derivedDataPath(root))
    ).id;
    await mkdir(derivedData, { recursive: true });
    confirm(root, "derivedData");
    shimDir = xcodebuildShim(root, derivedData);
  } catch (error) {
    return failed(
      "Could not set up this worktree's simulator and build folders.",
      {
        errors: String(error).split("\n").slice(0, 3),
      },
    );
  }

  const plan = (await loadAdapter(detected.stack)).launchPlan(
    await inspectProject(root),
    { platform: "ios", deviceId: device.id, port },
  );
  if (!plan) return unsupported(`${detected.stack} cannot launch on iOS.`);

  const logDir = join(
    stateDir(),
    "runs",
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${basename(root)}`,
  );
  const buildLog = join(logDir, "build.log");
  const metroLog = join(logDir, "metro.log");
  const where = { device: { id: device.id, name: device.name }, logDir };

  report("booting the simulator");
  try {
    await boot(device);
  } catch (error) {
    return failed("The simulator did not boot.", {
      ...where,
      errors: String(error).split("\n").slice(0, 3),
    });
  }

  if (await metroRunning(port)) {
    return failed(
      `Port ${port} already serves a dev server. Stop it and retry.`,
      where,
    );
  }
  report("starting the dev server");
  const env = {
    CI: "1",
    RCT_METRO_PORT: String(port),
    PATH: `${shimDir}:${process.env.PATH}`,
  };
  const metro = startLogged(plan.server, { cwd: root, logPath: metroLog, env });
  const metroState = await untilReady(
    () => metroRunning(port),
    metro.exited,
    metroStartSeconds,
  );
  if (metroState !== "ready") {
    metro.kill();
    return failed(
      metroState === "exited"
        ? "The dev server exited before it was ready."
        : `The dev server was not ready after ${metroStartSeconds}s.`,
      { ...where, errors: await logTail(metroLog) },
    );
  }

  confirm(root, "port");
  report("building and installing the app");
  const build = startLogged(plan.build, { cwd: root, logPath: buildLog, env });
  const outcome = await withTimeout(
    build.exited,
    options.timeoutSeconds ?? defaultTimeoutSeconds,
  );
  if (outcome !== 0) {
    build.kill();
    metro.kill();
    return failed(
      outcome === "timeout"
        ? `The build did not finish in ${options.timeoutSeconds ?? defaultTimeoutSeconds}s.`
        : `The build failed (exit ${outcome}).`,
      { ...where, errors: await logTail(buildLog) },
    );
  }

  report("launching the app");
  let appPid: number;
  try {
    appPid = await launchApp(device, appId);
  } catch (error) {
    metro.kill();
    return failed(`Built, but launching ${appId} failed.`, {
      ...where,
      errors: String(error).split("\n").slice(0, 3),
    });
  }

  return {
    verdict: "launched",
    root,
    ...where,
    appId,
    appPid,
    metro: { pid: metro.pid, port },
    derivedData,
    diskMB: {
      derivedData: await diskMB(derivedData),
      simulator: await diskMB(
        join(homedir(), "Library/Developer/CoreSimulator/Devices", device.id),
      ),
    },
    seconds: seconds(),
  };
}
