import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type CheckOptions, check } from "./check.js";
import {
  type Job,
  type JobKind,
  now,
  readJob,
  update,
  write,
} from "./jobstore.js";
import { type LaunchOptions, launch } from "./launch.js";
import type { CheckResult, JobView, LaunchResult } from "./result.js";

// A job is one long-running piece of work, recorded as a JSON file in the
// shared state dir and run by a detached worker process (`emd job run <id>`).
// Any process can read it, and it outlives the process that started it. A
// queue (M2) adds a scheduler that decides when a queued job's worker starts.

export type { JobKind } from "./jobstore.js";

type Inputs = { launch: LaunchOptions; check: CheckOptions };
type Results = { launch: LaunchResult; check: CheckResult };

export type Report = (step: string) => void;
export type Handlers = {
  [K in JobKind]: (input: Inputs[K], report: Report) => Promise<Results[K]>;
};

const handlers: Handlers = { launch, check };

const workerGraceMs = 30_000;
const defaultWorker = fileURLToPath(new URL("../bin.js", import.meta.url));

function fail(id: string, reason: string): void {
  const job = readJob(id);
  if (!job) return;
  write({
    ...job,
    status: "failed",
    step: undefined,
    finishedAt: now(),
    result:
      job.kind === "launch"
        ? {
            verdict: "failed",
            root: resolve((job.input as LaunchOptions).dir ?? "."),
            reason,
          }
        : { verdict: "error", reason },
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
export function createJob<K extends JobKind>(kind: K, input: Inputs[K]): Job {
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
export function startJob<K extends JobKind>(
  kind: K,
  input: Inputs[K],
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

const execute = (
  job: Job,
  run: Handlers,
  report: Report,
): Promise<LaunchResult | CheckResult> =>
  job.kind === "launch"
    ? run.launch(job.input as LaunchOptions, report)
    : run.check(job.input as CheckOptions, report);

// What the worker process runs.
export async function runJob(
  id: string,
  run: Handlers = handlers,
): Promise<void> {
  const job = readJob(id);
  if (job?.status !== "queued") return;
  update(id, { status: "running", pid: process.pid, startedAt: now() });
  try {
    const result = await execute(job, run, (step) => update(id, { step }));
    update(id, {
      status:
        result.verdict === "launched" || result.verdict === "passed"
          ? "succeeded"
          : "failed",
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

export { readJob };
