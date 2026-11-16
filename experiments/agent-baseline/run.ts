// Runs one trial of the agent baseline (#14): Claude Code headless in the app
// folder, with the group's model and the prompt every group gets, stopped at
// the time limit. Writes transcript.jsonl, claude-stderr.log and run.json to
// OUT_DIR. Results: experiments/agent-baseline.md
//
// Env: APP_DIR, OUT_DIR, MODEL, TRIAL_MINUTES, ANTHROPIC_API_KEY.
import { spawn } from "node:child_process";
import { createWriteStream, writeFileSync } from "node:fs";
import { join } from "node:path";

const need = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

// The task, word for word as #14 pre-registered it.
const prompt =
  'In this app, add a Save button to the home screen that shows "Saved" when tapped. Check it on the iOS simulator before and after your change, then tell me where the proof is.';
const out = need("OUT_DIR");
const minutes = Number(need("TRIAL_MINUTES"));
if (!(minutes > 0)) throw new Error("TRIAL_MINUTES must be a positive number");
const args = [
  "-p",
  prompt,
  "--model",
  need("MODEL"),
  "--output-format",
  "stream-json",
  "--verbose",
  // Each runner is thrown away after its job; every group gets the same.
  "--dangerously-skip-permissions",
];

const started = new Date();
// Its own process group, so the time limit stops the servers it started too.
const child = spawn("claude", args, {
  cwd: need("APP_DIR"),
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
child.stdout.pipe(createWriteStream(join(out, "transcript.jsonl")));
child.stderr.pipe(createWriteStream(join(out, "claude-stderr.log")));

const stop = (signal: NodeJS.Signals) => {
  try {
    if (child.pid) process.kill(-child.pid, signal);
  } catch {
    // Already gone.
  }
};
let timedOut = false;
const limit = setTimeout(() => {
  timedOut = true;
  stop("SIGTERM");
  setTimeout(() => stop("SIGKILL"), 10_000).unref();
}, minutes * 60_000);

let finished = false;
const done = (exitCode: number | null, signal: NodeJS.Signals | null) => {
  if (finished) return;
  finished = true;
  clearTimeout(limit);
  const ended = new Date();
  const record = {
    prompt,
    args: args.filter((a) => a !== prompt),
    started: started.toISOString(),
    ended: ended.toISOString(),
    seconds: (ended.getTime() - started.getTime()) / 1000,
    limitMinutes: minutes,
    timedOut,
    exitCode,
    signal,
  };
  writeFileSync(join(out, "run.json"), `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify(record));
};
child.on("error", (error) => {
  console.error(error);
  done(null, null);
});
child.on("close", done);
