// The outcome grader of the agent baseline (#14), the same for every group.
// It builds the app as the trial left it, launches it on the pinned simulator,
// taps "Save" and checks that "Saved" appears. "Saved" on screen before the tap
// is a fail. The agent's own claim never counts. Writes grade.json, grade.png,
// grade-tree.json, grade-build.log and grade-metro.log to OUT_DIR.
// Results: experiments/agent-baseline.md
//
// Env: APP_DIR, OUT_DIR, AXE (the grader's AXe binary).
import { spawn, spawnSync } from "node:child_process";
import { openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
// prepare.sh copies EMD's built dist next to this script.
import { parseAxe } from "./dist/core/device/axe.js";

const need = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};
const app = need("APP_DIR");
const out = need("OUT_DIR");
const axe = need("AXE");
const appId = "com.emd.sandbox";
const { udid } = JSON.parse(readFileSync(join(out, "prepare.json"), "utf8"))
  .device as { udid: string };

const run = (cmd: string, args: string[], seconds: number, log?: string) => {
  const fd = log ? openSync(join(out, log), "a") : undefined;
  const r = spawnSync(cmd, args, {
    cwd: app,
    timeout: seconds * 1000,
    encoding: "utf8",
    maxBuffer: 64 << 20,
    stdio: ["ignore", fd ?? "pipe", fd ?? "pipe"],
  });
  return { code: r.status, stdout: r.stdout ?? "" };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Read = { raw: string; texts: string[] };
let last: Read = { raw: "", texts: [] };
const readScreen = (): Read => {
  const { stdout } = run(axe, ["describe-ui", "--udid", udid], 60);
  try {
    last = {
      raw: stdout,
      texts: parseAxe(stdout).flatMap((node) => node.texts),
    };
  } catch {
    last = { raw: stdout, texts: [] };
  }
  return last;
};
// Polls the screen once a second until `found` holds or the time is up.
const waitFor = async (
  found: (texts: string[]) => boolean,
  seconds: number,
): Promise<number | undefined> => {
  const start = Date.now();
  do {
    if (found(readScreen().texts)) return (Date.now() - start) / 1000;
    await sleep(1000);
  } while (Date.now() - start < seconds * 1000);
  return undefined;
};
const isSave = (text: string) => text.trim().toLowerCase() === "save";
const hasSaved = (texts: string[]) => texts.some((t) => t.includes("Saved"));

const grade: Record<string, unknown> = { udid };
const finish = (outcome: "pass" | "fail", reason: string) => {
  run(
    "xcrun",
    ["simctl", "io", udid, "screenshot", join(out, "grade.png")],
    60,
  );
  writeFileSync(join(out, "grade-tree.json"), last.raw);
  Object.assign(grade, { outcome, reason });
  writeFileSync(join(out, "grade.json"), `${JSON.stringify(grade, null, 2)}\n`);
  console.log(JSON.stringify(grade));
};

run("xcrun", ["simctl", "boot", udid], 120);
run("xcrun", ["simctl", "bootstatus", udid, "-b"], 300);

// The app as the trial left it: a fresh build and install.
const build = run(
  "npx",
  ["expo", "run:ios", "--device", udid, "--no-bundler"],
  2400,
  "grade-build.log",
);
grade.buildExit = build.code;
const installed =
  run("xcrun", ["simctl", "get_app_container", udid, appId], 60).code === 0;

let metro: ReturnType<typeof spawn> | undefined;
if (!installed) {
  finish("fail", "The app did not build or install.");
} else {
  const log = openSync(join(out, "grade-metro.log"), "a");
  metro = spawn("npx", ["expo", "start", "--port", "8081"], {
    cwd: app,
    env: { ...process.env, CI: "1" },
    stdio: ["ignore", log, log],
    detached: true,
  });
  let metroUp = false;
  for (let i = 0; i < 120 && !metroUp; i++) {
    await sleep(1000);
    metroUp = await fetch("http://localhost:8081/status")
      .then(async (r) => (await r.text()).includes("packager-status:running"))
      .catch(() => false);
  }
  grade.metroUp = metroUp;
  run("xcrun", ["simctl", "terminate", udid, appId], 30);
  run("xcrun", ["simctl", "launch", udid, appId], 60);

  // EMD's screen-read bound, about twice the slowest first read.
  const saveSeconds = await waitFor((texts) => texts.some(isSave), 180);
  grade.saveSeconds = saveSeconds;
  const label = last.texts.find(isSave);
  if (saveSeconds === undefined || label === undefined) {
    finish("fail", 'No "Save" on screen within 180 s.');
  } else if (hasSaved(last.texts)) {
    finish("fail", '"Saved" was on screen before the tap.');
  } else {
    const tap = run(axe, ["tap", "--label", label, "--udid", udid], 60);
    grade.tapExit = tap.code;
    const savedSeconds = await waitFor(hasSaved, 10);
    grade.savedSeconds = savedSeconds;
    if (savedSeconds === undefined) {
      finish("fail", 'No "Saved" on screen within 10 s of the tap.');
    } else {
      finish("pass", '"Saved" appeared after the tap.');
    }
  }
}

if (metro?.pid) {
  try {
    process.kill(-metro.pid, "SIGTERM");
  } catch {
    // Already gone.
  }
}
