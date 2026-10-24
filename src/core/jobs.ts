import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type LaunchOptions, launch } from "./launch.js";
import type { JobView, LaunchResult } from "./result.js";
import { stateDir } from "./state.js";

// A job is one long-running piece of work, recorded as a JSON file in the
// shared state dir and run by a detached worker process (`emd job run <id>`).
// Any process can read it, and it outlives the process that started it. A
// queue (M2) adds a scheduler that decides when a queued job's worker starts.

export type JobKind = "launch";

type Job = {
  id: string;
  kind: JobKind;
  input: LaunchOptions;
  status: JobView["status"];
  step?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  pid?: number;
  result?: LaunchResult;
};

export type Report = (step: string) => void;
export type Handlers = Record<
  JobKind,
  (input: LaunchOptions, report: Report) => Promise<LaunchResult>
>;

const handlers: Handlers = { launch };

// The id comes from callers, so it is checked before it touches a path.
const idPattern = /^[0-9a-f]{8}$/;
const workerGraceMs = 30_000;
const defaultWorker = fileURLToPath(new URL("../bin.js", import.meta.url));

const jobsDir = () => join(stateDir(), "jobs");
const fileOf = (id: string) => join(jobsDir(), `${id}.json`);
const now = () => new Date().toISOString();

function write(job: Job): void {
  mkdirSync(jobsDir(), { recursive: true });
  const temp = `${fileOf(job.id)}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(job));
  renameSync(temp, fileOf(job.id));
}

export function readJob(id: string): Job | undefined {
  if (!idPattern.test(id)) return undefined;
  try {
    return JSON.parse(readFileSync(fileOf(id), "utf8")) as Job;
  } catch {
    return undefined;
  }
}

function update(id: string, patch: Partial<Job>): void {
  const job = readJob(id);
  if (job) write({ ...job, ...patch });
}

function fail(id: string, reason: string): void {
  const job = readJob(id);
  if (!job) return;
  write({
    ...job,
    status: "failed",
    step: undefined,
    finishedAt: now(),
    result: {
      verdict: "failed",
      root: resolve(job.input.dir ?? "."),
      reason,
    },
  });
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

function view(job: Job): JobView {
  const from = Date.parse(job.startedAt ?? job.createdAt);
  const to = job.finishedAt ? Date.parse(job.finishedAt) : Date.now();
  return {
    jobId: job.id,
    kind: job.kind,
    status: job.status,
    ...(job.step ? { step: job.step } : {}),
    seconds: Math.round((to - from) / 100) / 10,
    ...(job.result ? { result: job.result } : {}),
  };
}

// Records a queued job. Nothing runs it yet.
export function createJob(kind: JobKind, input: LaunchOptions): Job {
  const job: Job = {
    id: randomBytes(4).toString("hex"),
    kind,
    input,
    status: "queued",
    createdAt: now(),
  };
  write(job);
  return job;
}

// Records the job and starts its worker. Returns at once; the job stays queued
// until the worker picks it up.
export function startJob(
  kind: JobKind,
  input: LaunchOptions,
  worker: string = defaultWorker,
): JobView {
  const job = createJob(kind, input);
  const child = spawn(process.execPath, [worker, "job", "run", job.id], {
    detached: true,
    stdio: "ignore",
  });
  child.on("error", (error) =>
    fail(job.id, `The worker did not start: ${error.message}`),
  );
  child.unref();
  return view(job);
}

// What the worker process runs.
export async function runJob(
  id: string,
  run: Handlers = handlers,
): Promise<void> {
  const job = readJob(id);
  if (job?.status !== "queued") return;
  update(id, { status: "running", pid: process.pid, startedAt: now() });
  try {
    const result = await run[job.kind](job.input, (step) =>
      update(id, { step }),
    );
    update(id, {
      status: result.verdict === "launched" ? "succeeded" : "failed",
      step: undefined,
      finishedAt: now(),
      result,
    });
  } catch (error) {
    fail(id, String(error).split("\n")[0] ?? "The job failed.");
  }
}

// A worker that died or never started would leave a job running forever, so
// reading a job also settles it.
export function jobStatus(id: string): JobView | undefined {
  const job = readJob(id);
  if (!job) return undefined;
  if (job.status === "running" && job.pid && !alive(job.pid)) {
    fail(id, "The worker process died.");
  } else if (
    job.status === "queued" &&
    Date.now() - Date.parse(job.createdAt) > workerGraceMs
  ) {
    fail(id, "The worker did not start.");
  }
  const current = readJob(id);
  return current && view(current);
}
