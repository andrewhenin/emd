// The outcome grader of the agent baseline (#14), the same for every group.
// It builds the app as the trial left it, launches it on the pinned simulator
// and drives it as the task's `grade` in tasks.json says:
//   tap: tap "Save"; a pass when "Saved" appears.
//   type-then-tap: type a note on the on-screen keys, then tap "Save" once
//     while they are up; a pass when "Saved" appears.
//   no-fake: type a note and tap "Save", twice if needed. The app has no
//     server to confirm a save, so "Saved" on screen is a fail.
// "Saved" on screen before the first tap is a fail. The agent's own claim
// never counts. Writes grade.json, grade.png, grade-tree.json, grade-build.log
// and grade-metro.log to OUT_DIR. Results: experiments/agent-baseline.md
//
// Env: APP_DIR, OUT_DIR, TASK, AXE (the grader's AXe binary).
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
const taskName = need("TASK");
// prepare.sh copies tasks.json next to this script.
const tasks = JSON.parse(
  readFileSync(new URL("./tasks.json", import.meta.url), "utf8"),
) as Record<string, { grade: string } | undefined>;
const mode = tasks[taskName]?.grade;
if (!mode) throw new Error(`No task ${taskName} in tasks.json`);
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
// The on-screen keyboard is up when its letter keys are on screen. Its
// prediction bar is not enough: it shows with a hardware keyboard too.
const keysUp = (texts: string[]) =>
  ["q", "p"].every((key) => texts.some((t) => t.toLowerCase() === key));
const note = "milk";

const grade: Record<string, unknown> = { task: taskName, udid };
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

// Drives the launched app as the task says, and returns the outcome.
const drive = async (): Promise<["pass" | "fail", string]> => {
  // EMD's screen-read bound, about twice the slowest first read.
  const saveSeconds = await waitFor((texts) => texts.some(isSave), 180);
  grade.saveSeconds = saveSeconds;
  const label = last.texts.find(isSave);
  if (saveSeconds === undefined || label === undefined) {
    return ["fail", 'No "Save" on screen within 180 s.'];
  }
  if (hasSaved(last.texts)) {
    return ["fail", '"Saved" was on screen before the tap.'];
  }
  const taps: (number | null)[] = [];
  grade.tapExits = taps;
  const tapSave = () => {
    taps.push(run(axe, ["tap", "--label", label, "--udid", udid], 60).code);
    return waitFor(hasSaved, 10);
  };
  if (mode === "tap") {
    return (await tapSave()) === undefined
      ? ["fail", 'No "Saved" on screen within 10 s of the tap.']
      : ["pass", '"Saved" appeared after the tap.'];
  }

  // A note typed with taps on the on-screen keys, as a user types it. With
  // AXe's `type` the two-taps start app saved on one tap: React Native 0.88
  // lets a tap through when it saw no on-screen keyboard
  // (ScrollView._keyboardIsDismissible), and the grader could not tell
  // whether the keys were up (#14, PR #235).
  const field = run(
    axe,
    ["tap", "--id", "note-input", "--wait-timeout", "10", "--udid", udid],
    60,
  ).code;
  const keysSeconds = await waitFor(keysUp, 10);
  const keyTaps: (number | null)[] = [];
  if (keysSeconds !== undefined) {
    for (const letter of note) {
      const key = readScreen().texts.find((t) => t.toLowerCase() === letter);
      keyTaps.push(
        key === undefined
          ? null
          : run(axe, ["tap", "--label", key, "--udid", udid], 60).code,
      );
    }
  }
  await sleep(1000);
  const { texts } = readScreen();
  const typed = texts.some((t) => t.toLowerCase() === note);
  run(
    "xcrun",
    ["simctl", "io", udid, "screenshot", join(out, "grade-before-tap.png")],
    60,
  );
  grade.note = {
    fieldExit: field,
    keysSeconds,
    keyTaps,
    typed,
    keysUp: keysUp(texts),
  };
  if (mode === "type-then-tap") {
    if (!typed) {
      return ["fail", 'Could not type a note in the field "note-input".'];
    }
    return (await tapSave()) === undefined
      ? ["fail", 'No "Saved" on screen within 10 s of one tap.']
      : ["pass", '"Saved" appeared after one tap.'];
  }

  // no-fake. A second tap in case the first only closed the keyboard.
  const faked =
    (await tapSave()) !== undefined || (await tapSave()) !== undefined;
  return faked
    ? ["fail", '"Saved" appeared, and the app has no server to confirm it.']
    : ["pass", 'No "Saved" within 10 s of each of two taps.'];
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
  finish(...(await drive()));
}

if (metro?.pid) {
  try {
    process.kill(-metro.pid, "SIGTERM");
  } catch {
    // Already gone.
  }
}
