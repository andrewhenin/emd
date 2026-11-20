// Input probe (#94, #213): taps and typing through EMD on a CI simulator, many
// times, with what the app and the screen showed for each attempt. It finds
// why inputs sometimes don't take effect, before anything is fixed. Results
// and how to run it: experiments/input-probe.md
//
// Usage, after `npm run build`, with AXe on PATH:
//   node --experimental-strip-types experiments/input-probe/probe.ts <out-dir> [attempts]
//
// Phases:
//   taps: tap the button; did the app get a touch, and did the button fire?
//   typing-launch: type into the field in the app as `launch` started it.
//   typing-relaunch: the same after a plain relaunch (the control).
//   typing-keyboard-domain: the same after KeyboardPrediction and
//     KeyboardAutocorrection are written as false to com.apple.keyboard.preferences
//     too, then a relaunch. EMD writes them to com.apple.Preferences only.
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type LaunchResult,
  startJob,
  tap,
  typeText,
  waitForJob,
} from "../../dist/core/index.js";
import { allLines } from "../../dist/core/logs.js";

const out = resolve(process.argv[2] ?? "input-probe-out");
const attempts = Number(process.argv[3] ?? 20);
mkdirSync(out, { recursive: true });
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const record = (entry: object) => {
  appendFileSync(join(out, "attempts.jsonl"), `${JSON.stringify(entry)}\n`);
  console.log(JSON.stringify(entry));
};
const sh = (cmd: string, args: string[]) => {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8",
      timeout: 60_000,
    }).trim();
  } catch (error) {
    return `error: ${String(error).split("\n")[0]}`;
  }
};

// Launch the test app the way an agent does.
const app = "com.emd.sandbox";
const started = startJob("launch", { dir: resolve("fixtures/expo") });
const jobId = started.jobId;
let job = await waitForJob(jobId, 25);
while (job && (job.status === "queued" || job.status === "running")) {
  job = await waitForJob(jobId, 25);
}
const launched = job?.result as LaunchResult | undefined;
console.log(
  JSON.stringify({
    launch: job?.status,
    phases: launched?.phases,
    build: launched?.build,
  }),
);
const udid = launched?.device?.id;
if (job?.status !== "succeeded" || !udid) {
  console.error("The launch failed; nothing to probe.");
  process.exit(1);
}

const domains = ["com.apple.Preferences", "com.apple.keyboard.preferences"];
const keys = ["KeyboardPrediction", "KeyboardAutocorrection"];
const prefs = () =>
  Object.fromEntries(
    domains.flatMap((domain) =>
      keys.map((key) => [
        `${domain} ${key}`,
        sh("xcrun", ["simctl", "spawn", udid, "defaults", "read", domain, key]),
      ]),
    ),
  );
// AXe's tree, read directly: an observer independent of EMD's parser.
const tree = () => sh("axe", ["describe-ui", "--udid", udid]);
const keep = (name: string) => {
  writeFileSync(join(out, `${name}-tree.json`), tree());
  sh("xcrun", ["simctl", "io", udid, "screenshot", join(out, `${name}.png`)]);
};
const count = async (tag: string) => {
  const got = await allLines({ jobId, tag });
  return got.verdict === "ok" ? (got.lines ?? []) : [];
};
const relaunch = async () => {
  sh("xcrun", ["simctl", "terminate", udid, app]);
  sh("xcrun", ["simctl", "launch", udid, app]);
  await sleep(8000);
};

record({ kind: "prefs", when: "after launch", ...prefs() });

for (let i = 0; i < attempts; i++) {
  const touches = (await count("touch")).length;
  const presses = (await count("smoke")).length;
  const at = Date.now();
  const result = await tap({ jobId, id: "smoke-button" });
  let touched = false;
  let pressed = false;
  for (let wait = 0; wait < 10 && !(touched && pressed); wait++) {
    await sleep(500);
    touched = (await count("touch")).length > touches;
    pressed = (await count("smoke")).length > presses;
  }
  if (!pressed) keep(`tap-${i}`);
  record({
    kind: "tap",
    i,
    verdict: result.verdict,
    reason: result.reason,
    backend: result.backend,
    seconds: (Date.now() - at) / 1000,
    touched,
    pressed,
  });
}

const typing = async (phase: string) => {
  for (let i = 0; i < attempts; i++) {
    // Letters and digits only, unique per attempt; the field keeps its text.
    const word = `q${phase.length}x${i}`;
    await tap({ jobId, id: "smoke-input" });
    const at = Date.now();
    const result = await typeText({ jobId, text: word });
    const seconds = (Date.now() - at) / 1000;
    await sleep(500);
    const last = (await count("typed")).at(-1)?.message ?? "";
    const screen = tree();
    const reached = last.endsWith(word);
    if (result.verdict !== "ok" || !reached) keep(`${phase}-${i}`);
    record({
      kind: "type",
      phase,
      i,
      word,
      verdict: result.verdict,
      reason: result.reason,
      retyped: result.retyped,
      seconds,
      appGotIt: reached,
      predictionsShown: screen.includes("Typing Predictions"),
    });
  }
};

await typing("typing-launch");
await relaunch();
record({ kind: "prefs", when: "before typing-relaunch", ...prefs() });
await typing("typing-relaunch");
for (const key of keys) {
  sh("xcrun", [
    "simctl",
    "spawn",
    udid,
    "defaults",
    "write",
    domains[1],
    key,
    "-bool",
    "false",
  ]);
}
await relaunch();
record({ kind: "prefs", when: "before typing-keyboard-domain", ...prefs() });
await typing("typing-keyboard-domain");

console.log("summary: see experiments/input-probe.md for how to read it");
process.exit(0);
