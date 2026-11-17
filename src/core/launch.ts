import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { readBuildRecord, whyBuild, writeBuildRecord } from "./buildrecord.js";
import { detect } from "./detect.js";
import { axeBackend } from "./device/axe.js";
import { detectEnvironment, untilReadable } from "./device/backend.js";
import {
  derivedDataPath,
  diskMB,
  pickPort,
  xcodebuildShim,
} from "./isolate.js";
import { launchesIn } from "./jobstore.js";
import { firstErrors, knownFix, onlyOpenFailed } from "./log.js";
import { startCapture, stopCaptures } from "./logs.js";
import { confirm, reserve, worktreeKey } from "./owned.js";
import { type LoggedProcess, startLogged } from "./process.js";
import { inspectProject } from "./project.js";
import { loadAdapter } from "./registry.js";
import type { LaunchResult } from "./result.js";
import {
  appAccessibilityOn,
  appInstalled,
  boot,
  cloneDevice,
  type Device,
  enableAppAccessibility,
  launchApp,
  listDevices,
  newerThan,
  pickDevice,
  removeSimulator,
  simulatorSdk,
  terminateApp,
} from "./simulator.js";
import { stateDir } from "./state.js";
import { runTool } from "./tool.js";

const metroStartSeconds = 120;
const stopSeconds = 10;
const defaultTimeoutSeconds = 900;
// How long AXe may take to read the screen after the app started, about twice
// the slowest measurement: first launch 7.8 to 51.4 s on CI iOS 26 and up to
// 86 s on iOS 27.1; relaunch 5.9 to 31.3 s.
const screenReadSeconds = 180;
// An empty tree this long after the app started means accessibility is off.
const emptyTreeSeconds = 5;

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

// Process groups with a process that listens on `port`; none when nothing does.
async function listeningGroups(port: number): Promise<number[]> {
  try {
    const { stdout } = await runTool(
      "lsof",
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fg"],
      60,
    );
    return stdout
      .split("\n")
      .filter((line) => line.startsWith("g"))
      .map((line) => Number(line.slice(1)));
  } catch {
    return [];
  }
}

// Stops the dev server that an earlier launch in this worktree left on `port`.
// Only a recorded process group that still listens on the port is signalled,
// so a reused pid or a server EMD did not start is never touched. Stopped, not
// reused: it can serve an older config, and its log is in the earlier run.
export async function stopEarlierServer(
  root: string,
  port: number,
): Promise<void> {
  const recorded = new Set(
    launchesIn(root).flatMap(({ metro }) =>
      metro?.port === port ? [metro.pid] : [],
    ),
  );
  if (recorded.size === 0) return;
  const ours = async () =>
    (await listeningGroups(port)).filter((group) => recorded.has(group));
  for (const group of await ours()) {
    try {
      process.kill(-group, "SIGTERM");
    } catch {}
  }
  const deadline = Date.now() + stopSeconds * 1000;
  while (Date.now() < deadline && (await ours()).length > 0) await sleep(250);
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

// Runs the build and install. Returns why it failed; undefined when the app is
// installed.
async function runBuild(
  command: string,
  cwd: string,
  logPath: string,
  env: Record<string, string>,
  options: LaunchOptions,
): Promise<{ reason: string; errors: string[] } | undefined> {
  const seconds = options.timeoutSeconds ?? defaultTimeoutSeconds;
  const build = startLogged(command, { cwd, logPath, env });
  const outcome = await withTimeout(build.exited, seconds);
  if (outcome === 0) return undefined;
  build.kill();
  const text = await readFile(logPath, "utf8").catch(() => "");
  // Expo's own open step timed out after the install; EMD opens the app next.
  if (outcome !== "timeout" && onlyOpenFailed(text)) return undefined;
  const fix = knownFix(text);
  let reason = `The build failed (exit ${outcome}).`;
  if (outcome === "timeout") {
    reason = `The build did not finish in ${seconds}s.`;
  } else if (fix) {
    reason = fix;
  } else if (text.includes("\u203a Build Succeeded")) {
    reason = `The app compiled, but the install or open step failed (exit ${outcome}).`;
  }
  return { reason, errors: firstErrors(text) };
}

export async function launch(
  options: LaunchOptions = {},
  report: (step: string) => void = () => {},
): Promise<LaunchResult> {
  const started = Date.now();
  const tenths = (ms: number) => Math.round(ms / 100) / 10;
  const seconds = () => tenths(Date.now() - started);
  // Seconds each phase took, in order, under a short name (#203). A phase ends
  // when the next one starts or the launch returns.
  const phases: Record<string, number> = {};
  let current: { name: string; at: number } | undefined;
  const endPhase = () => {
    if (current) phases[current.name] = tenths(Date.now() - current.at);
    current = undefined;
    return phases;
  };
  const phase = (name: string, step: string) => {
    endPhase();
    current = { name, at: Date.now() };
    report(step);
  };
  phase("project", "checking the project");
  const detected = await detect(options.dir);
  const { root } = detected;
  const unsupported = (reason: string): LaunchResult => ({
    verdict: "unsupported",
    root,
    reason,
  });
  const failed = (reason: string, rest: Partial<LaunchResult> = {}) =>
    ({
      verdict: "failed",
      root,
      reason,
      seconds: seconds(),
      phases: endPhase(),
      ...rest,
    }) as const;

  if (detected.verdict !== "detected" || !detected.stack) {
    return unsupported("No supported mobile project found here.");
  }
  if (!detected.platforms?.includes("ios")) {
    return unsupported("The project does not target iOS.");
  }
  // Without an ID, Expo's own build sets one (ios.bundleIdentifier) and the
  // ID is read again after it. EMD writes nothing to the app config.
  if (detected.problem) return unsupported(detected.problem);
  let appId = detected.appIds?.ios;
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
    const sdk = await simulatorSdk();
    const name = `${prefix}${worktreeKey(root)}`;
    const simulator = await reserve(root, "simulator", () => name);
    device = devices.find(
      (d) => d.id === simulator.id || d.name === simulator.id,
    );
    // A clone on a runtime newer than the selected Xcode's SDK does not build
    // (#122). It is EMD's own, so it is replaced, not reused.
    if (device && sdk && newerThan(device, sdk)) {
      phase(
        "replace",
        `replacing the simulator: iOS ${device.version.join(".")} is newer than Xcode's iOS ${sdk.join(".")} SDK`,
      );
      await removeSimulator(device);
      device = undefined;
    }
    if (!device) {
      const base = pickDevice(
        devices.filter(
          (d) => !d.name.startsWith(prefix) && d.state !== "Booted",
        ),
        options.device,
        sdk,
      );
      if (!base) {
        return failed(
          options.device
            ? `No shut-down simulator matches "${options.device}" to clone.`
            : "No shut-down iPhone simulator is available to clone.",
        );
      }
      phase("clone", "cloning a simulator");
      const id = await cloneDevice(base, name);
      device = {
        id,
        name,
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
  const sizes = async () => ({
    derivedData: await diskMB(derivedData),
    simulator: await diskMB(
      join(homedir(), "Library/Developer/CoreSimulator/Devices", device.id),
    ),
  });
  // A failure after the reservations still reports what they hold.
  const stuck = async (reason: string, rest: Partial<LaunchResult> = {}) =>
    failed(reason, {
      ...where,
      port,
      derivedData,
      diskMB: await sizes(),
      ...rest,
    });

  phase("boot", "booting the simulator");
  try {
    await boot(device);
  } catch (error) {
    return stuck("The simulator did not boot.", {
      errors: String(error).split("\n").slice(0, 3),
    });
  }

  await stopEarlierServer(root, port);
  if (await metroRunning(port)) {
    return stuck(
      `Port ${port} already serves a dev server. Stop it and retry.`,
    );
  }
  await stopCaptures(root);
  phase("server", "starting the dev server");
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
    return stuck(
      metroState === "exited"
        ? "The dev server exited before it was ready."
        : `The dev server was not ready after ${metroStartSeconds}s.`,
      { errors: await logTail(metroLog) },
    );
  }

  confirm(root, "port");
  // Reuse the installed build when nothing native changed. A fingerprint that
  // cannot be computed means a normal build.
  let fingerprint: string | undefined;
  let why: string | undefined;
  try {
    fingerprint = await (await loadAdapter(detected.stack)).fingerprint(
      root,
      "ios",
    );
  } catch (error) {
    why = `fingerprint failed: ${String(error).split("\n")[0]}`;
  }
  if (fingerprint !== undefined) {
    why = whyBuild(
      readBuildRecord(derivedData),
      { fingerprint, port },
      appId !== undefined && (await appInstalled(device, appId)),
    );
  }
  const reused = why === undefined;
  if (reused) {
    phase("reuse", "reusing the installed build");
  } else {
    phase("build", "building and installing the app");
    const failure = await runBuild(plan.build, root, buildLog, env, options);
    if (failure) {
      metro.kill();
      return stuck(failure.reason, { errors: failure.errors });
    }
    if (fingerprint !== undefined) {
      try {
        writeBuildRecord(derivedData, { fingerprint, port });
      } catch {}
    }
  }

  let appIdSet: string | undefined;
  if (appId === undefined) {
    appId = (await detect(root)).appIds?.ios;
    if (appId === undefined) {
      metro.kill();
      return stuck(
        "The build finished, but the app config still has no iOS app ID. Expo may have built from an existing ios/ project.",
        { errors: await logTail(buildLog) },
      );
    }
    appIdSet = appId;
    // The config changed, so the fingerprint did too. A failure here only costs
    // one rebuild on the next launch.
    try {
      fingerprint = await (await loadAdapter(detected.stack)).fingerprint(
        root,
        "ios",
      );
      writeBuildRecord(derivedData, { fingerprint, port });
    } catch {}
  }

  phase("open", "launching the app");
  let capture: LoggedProcess;
  try {
    capture = await startCapture(device.id, appId, logDir);
  } catch (error) {
    metro.kill();
    return stuck(
      `${reused ? "Reused the build" : "Built"}, but could not capture the app's log.`,
      {
        errors: String(error).split("\n").slice(0, 3),
      },
    );
  }
  let appPid: number;
  try {
    // A running app still talks to the dev server it started with; a restart
    // makes it load the new JavaScript from this one.
    if (reused) await terminateApp(device, appId);
    appPid = await launchApp(device, appId);
  } catch (error) {
    capture.kill();
    metro.kill();
    return stuck(
      `${reused ? "Reused the build" : "Built"}, but launching ${appId} failed.`,
      {
        errors: String(error).split("\n").slice(0, 3),
      },
    );
  }

  const axe = (await detectEnvironment()).axe;
  phase("screen", "waiting for the screen");
  // This device is EMD's own clone. On some iOS versions AXe reads an empty
  // tree until application accessibility is on, and only an app that starts
  // after the write sees it. An AXe error never triggers the write.
  const screen = axe
    ? await untilReadable(
        () => axeBackend.readScreen(device.id, axe),
        screenReadSeconds,
        {
          afterSeconds: emptyTreeSeconds,
          act: async () => {
            if (await appAccessibilityOn(device)) return;
            await enableAppAccessibility(device);
            await terminateApp(device, appId);
            appPid = await launchApp(device, appId);
          },
        },
      )
    : undefined;

  return {
    verdict: "launched",
    root,
    ...where,
    appId,
    ...(appIdSet && { appIdSet }),
    ...(screen && { screen }),
    appPid,
    build: reused ? { action: "reused" } : { action: "built", reason: why },
    metro: { pid: metro.pid, port },
    logStream: { pid: capture.pid },
    derivedData,
    diskMB: await sizes(),
    seconds: seconds(),
    phases: endPhase(),
  };
}
