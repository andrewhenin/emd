import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { detect } from "./detect.js";
import { firstErrors } from "./log.js";
import { startLogged } from "./process.js";
import { inspectProject } from "./project.js";
import { loadAdapter } from "./registry.js";
import type { LaunchResult } from "./result.js";
import {
  boot,
  type Device,
  launchApp,
  listDevices,
  pickDevice,
} from "./simulator.js";
import { stateDir } from "./state.js";

const metroPort = 8081;
const metroStartSeconds = 120;
const defaultTimeoutSeconds = 900;

export type LaunchOptions = {
  dir?: string;
  // Simulator name or UDID. Default: a booted iPhone, else the newest iPhone.
  device?: string;
  // How long the build may take.
  timeoutSeconds?: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function metroRunning(): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${metroPort}/status`, {
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

  let device: Device | undefined;
  try {
    device = pickDevice(await listDevices(), options.device);
  } catch {
    return unsupported("xcrun simctl is not available. Install Xcode.");
  }
  if (!device) {
    return failed(
      options.device
        ? `No simulator matches "${options.device}".`
        : "No iPhone simulator is available.",
    );
  }

  const plan = (await loadAdapter(detected.stack)).launchPlan(
    await inspectProject(root),
    { platform: "ios", deviceId: device.id },
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

  if (await metroRunning()) {
    return failed(
      `Port ${metroPort} already serves a dev server. Stop it and retry.`,
      where,
    );
  }
  report("starting the dev server");
  const env = { CI: "1" };
  const metro = startLogged(plan.server, { cwd: root, logPath: metroLog, env });
  const metroState = await untilReady(
    metroRunning,
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
    metro: { pid: metro.pid, port: metroPort },
    seconds: seconds(),
  };
}
