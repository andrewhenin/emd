import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { type Deps as CheckDeps, check } from "../src/core/check.ts";
import { evidence } from "../src/core/evidence.ts";
import { createJob } from "../src/core/jobs.ts";
import type { LogsResult } from "../src/core/result.ts";
import { expoProject, launchedJob, makeDir } from "./helpers.ts";

// The bundle from real run folders, job files and project files in a temp
// state dir. What a check reads from the simulator is passed in; the real
// readers run in test/e2e.
let state: string;
beforeEach(() => {
  state = makeDir();
  process.env.EMD_STATE_DIR = state;
});

const taps = [
  { time: "2026-10-24T18:00:01.000Z", tag: "smoke", message: "tapped" },
];
const deps = {
  logs: async (): Promise<LogsResult> => ({
    verdict: "ok",
    lines: taps,
    total: 1,
  }),
};

const readers = (found: boolean): CheckDeps => ({
  logs: async () => ({
    verdict: "ok",
    lines: found ? taps : [],
    total: found ? 1 : 0,
  }),
  screen: async () => ({ nodes: [], backend: "axe" }),
  screenshot: async (_device, path) => {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "png");
    return true;
  },
});

const sandbox = () => expoProject({ ".maestro/smoke.yaml": "appId: x\n" });
const smoke = { logs: [{ tag: "smoke" }] };
const read = (dir: string | undefined, file: string) =>
  JSON.parse(readFileSync(join(dir ?? "", file), "utf8"));

test("the bundle holds the checks that ran, the log lines, screenshots and flows", async () => {
  const jobId = await launchedJob(state, sandbox());
  const miss = await check({ jobId, ...smoke }, undefined, readers(false));
  const hit = await check({ jobId, ...smoke }, undefined, readers(true));
  expect([miss.verdict, hit.verdict]).toEqual(["failed", "passed"]);

  const result = await evidence({ jobId }, deps);
  expect(result).toMatchObject({
    verdict: "written",
    checks: 2,
    logLines: 1,
    screenshots: 2,
    flows: 1,
  });
  expect(Object.keys(result.layout ?? {})).toEqual([
    "manifest.json",
    "logs.json",
    "screenshots/",
    "flows/",
  ]);

  const manifest = read(result.dir, "manifest.json");
  expect(manifest.run).toMatchObject({ jobId, appId: "com.emd.sandbox" });
  expect(
    manifest.checks.map(
      (c: { result: { verdict: string } }) => c.result.verdict,
    ),
  ).toEqual(["failed", "passed"]);
  expect(manifest.logs).toEqual({ file: "logs.json", total: 1 });
  expect(manifest.flows).toEqual(["flows/smoke.yaml"]);
  for (const c of manifest.checks) {
    const shot = c.result.secondOpinion.screenshot as string;
    expect(shot).toMatch(/^screenshots\/check-\d+\.png$/);
    expect(existsSync(join(result.dir ?? "", shot))).toBe(true);
  }
  expect(read(result.dir, "logs.json")).toEqual(taps);
});

test("only checks that ran are listed: not invalid ones, not ones refused for the retry limit", async () => {
  const jobId = await launchedJob(state, sandbox());
  const options = { jobId, ...smoke, retryLimit: 1 };
  const invalid = await check({ jobId }, undefined, readers(true));
  const first = await check(options, undefined, readers(false));
  const refused = await check(options, undefined, readers(false));
  expect([invalid.verdict, first.verdict, refused.verdict]).toEqual([
    "error",
    "stopped",
    "stopped",
  ]);

  const result = await evidence({ jobId }, deps);
  expect(result.checks).toBe(1);
  expect(read(result.dir, "manifest.json").checks).toHaveLength(1);
});

test("a run with no checks still gets a bundle", async () => {
  const jobId = await launchedJob(state, sandbox());
  const result = await evidence({ jobId }, deps);
  expect(result).toMatchObject({
    verdict: "written",
    checks: 0,
    screenshots: 0,
  });
  expect(read(result.dir, "manifest.json").checks).toEqual([]);
});

test("the same run gives the same bundle", async () => {
  const jobId = await launchedJob(state, sandbox());
  await check({ jobId, ...smoke }, undefined, readers(true));
  const bundle = async () => {
    const { dir } = await evidence({ jobId }, deps);
    return readdirSync(dir ?? "", { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name))
      .sort()
      .map((path) => [path, readFileSync(path, "utf8")]);
  };
  const once = await bundle();
  expect(await bundle()).toEqual(once);
  expect(once).toHaveLength(4);
});

test("a job that does not exist is refused in one line", async () => {
  const result = await evidence({ jobId: "deadbeef" }, deps);
  expect(result).toEqual({
    verdict: "failed",
    reason: 'No job with id "deadbeef".',
  });
});

test("a job that has not launched an app is refused", async () => {
  const result = await evidence({ jobId: createJob("launch", {}).id }, deps);
  expect(result.verdict).toBe("failed");
  expect(result.reason).toMatch(/not launched/);
  expect(result.dir).toBeUndefined();
});

test("logs that cannot be read fail the bundle without writing it", async () => {
  const jobId = await launchedJob(state, sandbox());
  const result = await evidence(
    { jobId },
    {
      logs: async () => ({
        verdict: "failed",
        reason: "simulator is not booted",
      }),
    },
  );
  expect(result).toEqual({
    verdict: "failed",
    reason: "simulator is not booted",
  });
  expect(existsSync(join(state, "runs"))).toBe(false);
});
