import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeEach, expect, test } from "vitest";
import {
  createJob,
  type Handlers,
  jobStatus,
  launchInline,
  runJob,
  startJob,
  waitForJob,
} from "../src/core/jobs.ts";
import { launchesIn, readJob } from "../src/core/jobstore.ts";
import type { CheckResult, JobView, LaunchResult } from "../src/core/result.ts";
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
): Handlers => ({
  launch: (_input, report) => run(id(), report),
  check: async () => ({ verdict: "error", reason: "not used here" }),
});

const checkHandlers = (
  run: (report: (step: string) => void) => Promise<CheckResult>,
): Handlers => ({
  launch: async () => ({ verdict: "failed", root: "/x" }),
  check: (_input, report) => run(report),
});

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

test("a check job succeeds only when the check passed", async () => {
  const passed = createJob("check", { jobId: "deadbeef" });
  await runJob(
    passed.id,
    checkHandlers(async (report) => {
      report("reading the screen");
      return { verdict: "passed" };
    }),
  );
  expect(jobStatus(passed.id)).toMatchObject({
    kind: "check",
    status: "succeeded",
    result: { verdict: "passed" },
  });

  for (const verdict of ["failed", "stopped", "error"] as const) {
    const job = createJob("check", { jobId: "deadbeef" });
    await runJob(
      job.id,
      checkHandlers(async () => ({ verdict })),
    );
    expect(jobStatus(job.id)).toMatchObject({
      kind: "check",
      status: "failed",
      result: { verdict },
    });
  }
});

test("a check handler that throws fails the job with an error verdict", async () => {
  const job = createJob("check", { jobId: "deadbeef" });
  await runJob(
    job.id,
    checkHandlers(async () => {
      throw new Error("no simulator");
    }),
  );
  expect(jobStatus(job.id)).toMatchObject({
    status: "failed",
    result: { verdict: "error", reason: "Error: no simulator" },
  });
});

test("a check job whose worker died is settled with an error verdict", () => {
  const job = createJob("check", { jobId: "deadbeef" });
  const dead = spawnSync("node", ["-e", "0"]).pid;
  edit(job.id, {
    status: "running",
    pid: dead,
    startedAt: new Date().toISOString(),
  });
  expect(jobStatus(job.id)).toMatchObject({
    kind: "check",
    status: "failed",
    result: { verdict: "error", reason: "The worker process died." },
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

test("waitForJob returns when the job ends, before the wait runs out", async () => {
  const job = createJob("launch", { dir: "/x" });
  const run = runJob(
    job.id,
    handlers(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return { verdict: "launched", root: "/x" };
      },
      () => job.id,
    ),
  );
  const started = Date.now();
  const done = await waitForJob(job.id, 20);
  expect(done?.status).toBe("succeeded");
  expect(Date.now() - started).toBeLessThan(5000);
  await run;
});

test("waitForJob answers at once with a wait of 0, and when the wait runs out", async () => {
  const job = createJob("launch", { dir: "/x" });
  expect((await waitForJob(job.id, 0))?.status).toBe("queued");
  const started = Date.now();
  expect((await waitForJob(job.id, 0.1))?.status).toBe("queued");
  expect(Date.now() - started).toBeGreaterThanOrEqual(100);
});

test("waitForJob starts no read after its deadline, even when a read is slow", async () => {
  const running = { status: "running" } as JobView;
  const reads: number[] = [];
  const job = await waitForJob("x", 1, () => {
    const at = Date.now();
    reads.push(at);
    // A read that blocks, as a file read on a busy machine can.
    while (Date.now() - at < 700) {}
    return running;
  });
  expect(job?.status).toBe("running");
  // The first read starts the wait, so every later one must start within 1 s.
  expect(Math.max(...reads) - reads[0]!).toBeLessThan(1000);
});

test("waitForJob ends at once when the caller cancels", async () => {
  const running = { status: "running" } as JobView;
  const cancel = new AbortController();
  setTimeout(() => cancel.abort(), 200);
  const started = Date.now();
  const job = await waitForJob("x", 20, () => running, cancel.signal);
  expect(job?.status).toBe("running");
  expect(Date.now() - started).toBeLessThan(2000);
});

test("an inline launch leaves the same record as a started job", async () => {
  const result: LaunchResult = {
    verdict: "launched",
    root: "/inline",
    metro: { pid: 1, port: 8081 },
  };
  expect(
    await launchInline(
      { dir: "/inline" },
      handlers(
        async () => result,
        () => "",
      ),
    ),
  ).toEqual(result);
  expect(launchesIn("/inline")).toEqual([result]);
});

// #285: a launch that fails as the one before it did says so, and its fix
// tells the agent to stop. Another failure, or a launch, starts over.
test("a launch that fails the same way again says how many times in a row", async () => {
  const failure = (reason: string): LaunchResult => ({
    verdict: "failed",
    root: "/repeat",
    reason,
    errors: ["Error: simctl bootstatus timed out after 300s"],
    fix: {
      do: "Close other simulators and heavy apps, then launch again.",
      safe: false,
    },
  });
  // Launches are ordered by their finish time in ms; real ones take seconds.
  const launchWith = async (result: LaunchResult) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return launchInline(
      { dir: "/repeat" },
      handlers(
        async () => result,
        () => "",
      ),
    );
  };
  const boot = failure("The simulator did not boot.");
  expect(await launchWith(boot)).toEqual(boot);
  expect(await launchWith(boot)).toMatchObject({
    repeated: 2,
    fix: {
      do: expect.stringMatching(/^Don't launch again\. Run `doctor`/),
      safe: true,
    },
  });
  expect((await launchWith(boot)).repeated).toBe(3);
  expect(
    await launchWith(failure("Could not plan the build.")),
  ).not.toHaveProperty("repeated");
  await launchWith({ verdict: "launched", root: "/repeat" });
  expect(await launchWith(boot)).not.toHaveProperty("repeated");
});
