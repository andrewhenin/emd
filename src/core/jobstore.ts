import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CheckOptions } from "./check.js";
import type { LaunchOptions } from "./launch.js";
import type { CheckResult, JobView, LaunchResult } from "./result.js";
import { stateDir } from "./state.js";

// Jobs as JSON files in the shared state dir: any process can read one.

export type JobKind = "launch" | "check";

export type Job = {
  id: string;
  kind: JobKind;
  input: LaunchOptions | CheckOptions;
  status: JobView["status"];
  step?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  pid?: number;
  result?: LaunchResult | CheckResult;
};

// The id comes from callers, so it is checked before it touches a path.
const idPattern = /^[0-9a-f]{8}$/;

const jobsDir = () => join(stateDir(), "jobs");
const fileOf = (id: string) => join(jobsDir(), `${id}.json`);

export const now = () => new Date().toISOString();

export function write(job: Job): void {
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

export function update(id: string, patch: Partial<Job>): void {
  const job = readJob(id);
  if (job) write({ ...job, ...patch });
}
