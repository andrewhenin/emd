import { detectEnvironment } from "./device/backend.js";
import { firstLine } from "./log.js";
import { listDevices } from "./simulator.js";
import { runTool } from "./tool.js";

type Check = {
  name: string;
  // `optional`: missing, but only some features need it.
  status: "ok" | "missing" | "optional";
  detail?: string;
  fix?: string;
};

export type DoctorResult = {
  // `ready`: everything required is there. Optional checks don't change it.
  verdict: "ready" | "missing";
  checks: Check[];
};

const minNode = 22;

// What EMD needs on this machine to launch and check an Expo app on the iOS
// simulator (vision.md). It only reads; it never installs.
export async function doctor(): Promise<DoctorResult> {
  const checks: Check[] = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push(
    major >= minNode
      ? { name: "node", status: "ok", detail: process.versions.node }
      : {
          name: "node",
          status: "missing",
          detail: process.versions.node,
          fix: `Install Node ${minNode} or newer.`,
        },
  );
  if (process.platform !== "darwin") {
    checks.push({
      name: "macos",
      status: "missing",
      detail: process.platform,
      fix: "iOS simulators need macOS. `detect` still works here.",
    });
    return done(checks);
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
    return done(checks);
  }

  try {
    const iphones = (await listDevices()).filter((d) =>
      d.name.startsWith("iPhone"),
    );
    checks.push(
      iphones.length > 0
        ? {
            name: "simulator",
            status: "ok",
            detail: `${iphones.length} iPhone simulators`,
          }
        : {
            name: "simulator",
            status: "missing",
            fix: "In Xcode, Settings > Components, add an iOS simulator runtime. It comes with iPhone simulators.",
          },
    );
  } catch (error) {
    checks.push({
      name: "simulator",
      status: "missing",
      detail: firstLine(error),
      fix: "Run `xcrun simctl list devices` to see why simulators can't be listed.",
    });
  }

  // Only element checks read the screen (decision 0004).
  const { axe, maestro } = await detectEnvironment();
  checks.push(
    axe || maestro
      ? { name: "screen reader", status: "ok", detail: axe ? "axe" : "maestro" }
      : {
          name: "screen reader",
          status: "optional",
          detail: "Checks of on-screen elements need AXe or Maestro.",
          fix: "brew install cameroncooke/axe/axe",
        },
  );
  return done(checks);
}

const done = (checks: Check[]): DoctorResult => ({
  verdict: checks.some((c) => c.status === "missing") ? "missing" : "ready",
  checks,
});
