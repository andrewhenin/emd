import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeEach, expect, test } from "vitest";
import {
  createJob,
  type Handlers,
  jobStatus,
  readJob,
  runJob,
  startJob,
} from "../src/core/jobs.ts";
import type { LaunchResult } from "../src/core/result.ts";
import { makeDir } from "./helpers.ts";

// Jobs are real files in a temp state dir. Handlers here are small real
// functions standing in for launch, so no simulator is needed.
let state: string;
beforeEach(() => {
  state = makeDir();
  process.env.EMD_STATE_DIR = state;
});

const jobFile = (id: string) => join(state, "jobs", `${id}.json`);
const edit = (id: string, patch: object) =>
  writeFileSync(
    jobFile(id),
    JSON.stringify({
      ...JSON.parse(readFileSync(jobFile(id), "utf8")),
      ...patch,
    }),
  );

const handlers = (
  run: (id: string, report: (step: string) => void) => Promise<LaunchResult>,
  id: () => string,
): Handlers => ({ launch: (_input, report) => run(id(), report) });

test("a created job is queued until a worker runs it", () => {
  const job = createJob("launch", { dir: "/x" });
  expect(jobStatus(job.id)).toMatchObject({
    jobId: job.id,
    kind: "launch",
    status: "queued",
  });
  expect(jobStatus(job.id)?.result).toBeUndefined();
});

test("running a job records each step, then the result", async () => {
  const job = createJob("launch", { dir: "/x" });
  const seen: (string | undefined)[] = [];
  await runJob(
    job.id,
    handlers(
      async (id, report) => {
        seen.push(jobStatus(id)?.status);
        report("building");
        seen.push(jobStatus(id)?.step);
        return { verdict: "launched", root: "/x", appId: "com.x" };
      },
      () => job.id,
    ),
  );
  expect(seen).toEqual(["running", "building"]);
  const done = jobStatus(job.id);
  expect(done).toMatchObject({
    status: "succeeded",
    result: { verdict: "launched", appId: "com.x" },
  });
  expect(done?.step).toBeUndefined();
});

test("a verdict other than launched makes the job failed, result kept", async () => {
  const job = createJob("launch", {});
  await runJob(
    job.id,
    handlers(
      async () => ({ verdict: "unsupported", root: "/x", reason: "nope" }),
      () => job.id,
    ),
  );
  expect(jobStatus(job.id)).toMatchObject({
    status: "failed",
    result: { verdict: "unsupported", reason: "nope" },
  });
});

test("a handler that throws fails the job with the first line", async () => {
  const job = createJob("launch", { dir: "/x" });
  await runJob(
    job.id,
    handlers(
      async () => {
        throw new Error("boom\nsecond line");
      },
      () => job.id,
    ),
  );
  expect(jobStatus(job.id)).toMatchObject({
    status: "failed",
    result: { verdict: "failed", reason: "Error: boom" },
  });
});

test("a job runs only once", async () => {
  const job = createJob("launch", {});
  let runs = 0;
  const once = handlers(
    async () => {
      runs++;
      return { verdict: "launched", root: "/x" };
    },
    () => job.id,
  );
  await runJob(job.id, once);
  await runJob(job.id, once);
  expect(runs).toBe(1);
});

test("a running job whose worker died is settled as failed", () => {
  const job = createJob("launch", {});
  const dead = spawnSync("node", ["-e", "0"]).pid;
  edit(job.id, {
    status: "running",
    pid: dead,
    startedAt: new Date().toISOString(),
  });
  expect(jobStatus(job.id)).toMatchObject({
    status: "failed",
    result: { reason: "The worker process died." },
  });
});

test("a queued job whose worker never started is settled as failed", () => {
  const job = createJob("launch", {});
  edit(job.id, { createdAt: new Date(Date.now() - 120_000).toISOString() });
  expect(jobStatus(job.id)).toMatchObject({
    status: "failed",
    result: { reason: "The worker did not start." },
  });
});

test.each([
  "../../etc/passwd",
  "zzzzzzzz",
  "",
  "abc",
  "ABCDEF12",
  "0123456789",
])("the id %j never reaches the filesystem", (id) => {
  expect(readJob(id)).toBeUndefined();
  expect(jobStatus(id)).toBeUndefined();
});

test("startJob returns at once and a real worker process finishes the job", async () => {
  const started = Date.now();
  const job = startJob("launch", { dir: makeDir() }, resolve("dist/bin.js"));
  expect(Date.now() - started).toBeLessThan(2000);
  expect(job.status).toBe("queued");

  let view = jobStatus(job.jobId);
  for (let i = 0; i < 60 && view?.status !== "failed"; i++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    view = jobStatus(job.jobId);
  }
  expect(view).toMatchObject({
    status: "failed",
    result: {
      verdict: "unsupported",
      reason: expect.stringMatching(/No supported/),
    },
  });
});
