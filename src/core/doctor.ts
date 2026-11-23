import { join } from "node:path";
import { type Platform, platforms } from "./adapter.js";
import { detect } from "./detect.js";
import { detectEnvironment } from "./device/backend.js";
import { listAvds, sdkTool } from "./emulator.js";
import { firstLine } from "./log.js";
import { listDevices } from "./simulator.js";
import { runTool } from "./tool.js";

type Check = {
  name: string;
  // The platform the check is for; none when every platform needs it.
  platform?: Platform;
  status: "ok" | "missing";
  detail?: string;
  fix?: string;
};

export type DoctorResult = {
  // ready: every platform the project targets is ready. Outside a project, at
  // least one platform is.
  verdict: "ready" | "missing";
  platforms: Partial<Record<Platform, "ready" | "missing">>;
  checks: Check[];
};

const minNode = 22;
// The Android Gradle plugin 8 needs JDK 17.
const minJava = 17;

// What EMD needs on this machine to launch and check the project in `dir` on
// each platform it targets, or on both outside a project (vision.md). It only
// reads; it never installs.
export async function doctor(
  options: { dir?: string } = {},
): Promise<DoctorResult> {
  const detected = await detect(options.dir).catch(() => undefined);
  const targets =
    detected?.verdict === "detected" && detected.platforms?.length
      ? detected.platforms
      : undefined;
  const wanted = targets ?? [...platforms];
  const major = Number(process.versions.node.split(".")[0]);
  const checks: Check[] = [
    major >= minNode
      ? { name: "node", status: "ok", detail: process.versions.node }
      : {
          name: "node",
          status: "missing",
          detail: process.versions.node,
          fix: `Install Node ${minNode} or newer.`,
        },
  ];
  if (wanted.includes("ios")) checks.push(...(await iosChecks()));
  if (wanted.includes("android")) checks.push(...(await androidChecks()));
  const state = (p: Platform) =>
    checks.some((c) => (c.platform ?? p) === p && c.status === "missing")
      ? "missing"
      : "ready";
  const byPlatform = Object.fromEntries(wanted.map((p) => [p, state(p)]));
  const ready = targets
    ? wanted.every((p) => byPlatform[p] === "ready")
    : wanted.some((p) => byPlatform[p] === "ready");
  return {
    verdict: ready ? "ready" : "missing",
    platforms: byPlatform,
    checks,
  };
}

// Xcode, an iPhone simulator and a device tool, on macOS.
async function iosChecks(): Promise<Check[]> {
  const checks: Check[] = [];
  const tagged = () => checks.map((c): Check => ({ ...c, platform: "ios" }));
  if (process.platform !== "darwin") {
    checks.push({
      name: "macos",
      status: "missing",
      detail: process.platform,
      fix: "iOS simulators need macOS. `detect` still works here.",
    });
    return tagged();
  }
  checks.push({ name: "macos", status: "ok" });

  try {
    const { stdout } = await runTool(
      "xcodebuild -version",
      "xcodebuild",
      ["-version"],
      60,
    );
    checks.push({ name: "xcode", status: "ok", detail: firstLine(stdout) });
  } catch (error) {
    checks.push({
      name: "xcode",
      status: "missing",
      detail: firstLine(error),
      fix: "Install Xcode from the App Store, open it once, then run `sudo xcode-select -s /Applications/Xcode.app`.",
    });
    return tagged();
  }

  const iphones = await listDevices().then(
    (devices) => devices.filter((d) => d.name.startsWith("iPhone")).length,
    () => 0,
  );
  checks.push(
    iphones > 0
      ? {
          name: "simulator",
          status: "ok",
          detail: `${iphones} iPhone simulators`,
        }
      : {
          name: "simulator",
          status: "missing",
          fix: "In Xcode, Settings > Components, add an iOS simulator runtime. It comes with iPhone simulators.",
        },
  );

  // Taps, typing, swipes and element checks go through AXe or Maestro
  // (decisions 0004, 0009).
  const { axe, maestro } = await detectEnvironment();
  checks.push(
    axe || maestro
      ? { name: "device tool", status: "ok", detail: axe ? "axe" : "maestro" }
      : {
          name: "device tool",
          status: "missing",
          detail:
            "Taps, typing, swipes and element checks need AXe or Maestro.",
          fix: "Run `emd setup`. It installs AXe.",
        },
  );
  return tagged();
}

// The SDK's adb, an AVD to run, and the JDK that Gradle builds with.
async function androidChecks(): Promise<Check[]> {
  const platform = "android";
  const checks: Check[] = [];
  try {
    const { stdout } = await runTool(
      "adb version",
      sdkTool("adb"),
      ["version"],
      30,
    );
    checks.push({
      name: "adb",
      platform,
      status: "ok",
      detail: firstLine(stdout),
    });
  } catch (error) {
    checks.push({
      name: "adb",
      platform,
      status: "missing",
      detail: firstLine(error),
      fix: "Install the Android SDK (Android Studio installs it) and set ANDROID_HOME to its folder.",
    });
    return checks;
  }

  const avds = await listAvds().then(
    (names) => names.length,
    (error: unknown) => firstLine(error),
  );
  checks.push(
    typeof avds === "number" && avds > 0
      ? { name: "avd", platform, status: "ok", detail: `${avds} AVDs` }
      : {
          name: "avd",
          platform,
          status: "missing",
          ...(typeof avds === "string" && { detail: avds }),
          fix:
            typeof avds === "string"
              ? "In Android Studio's SDK Manager, install the Android Emulator."
              : "In Android Studio's Device Manager, create a virtual device.",
        },
  );

  // Gradle runs on JAVA_HOME when it is set, else on the java in PATH.
  const home = process.env.JAVA_HOME;
  const java = home ? join(home, "bin", "java") : "java";
  const version = await runTool("java --version", java, ["--version"], 30).then(
    ({ stdout }) => firstLine(stdout),
    () => undefined,
  );
  const major = Number(version?.match(/\d+/)?.[0]);
  checks.push(
    major >= minJava
      ? { name: "java", platform, status: "ok", detail: version }
      : {
          name: "java",
          platform,
          status: "missing",
          ...(version && { detail: version }),
          fix: `Install JDK ${minJava} or newer and set JAVA_HOME to it. Android Studio's own JDK (its jbr folder) works.`,
        },
  );
  return checks;
}
