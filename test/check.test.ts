import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import {
  type CheckOptions,
  check,
  type Deps,
  resetChecks,
} from "../src/core/check.ts";
import type { ScreenRead } from "../src/core/device/backend.ts";
import type { UiNode } from "../src/core/device/screen.ts";
import { createJob, runJob } from "../src/core/jobs.ts";
import type { LogsResult } from "../src/core/result.ts";
import { cli, makeDir } from "./helpers.ts";

// The attempt counter, verdicts and validation, with real job and count files
// in a temp state dir. What the check reads (logs, screen, screenshot) is
// passed in by small functions; the real readers run in test/e2e.
const device = "829564DA-13EC-4DE7-95B0-1E3EFF6FE713";

let state: string;
beforeEach(() => {
  state = makeDir();
  process.env.EMD_STATE_DIR = state;
  delete process.env.EMD_RETRY_LIMIT;
});

// A finished launch job, so there is a run to check.
async function launched(root = "/work/app"): Promise<string> {
  const job = createJob("launch", { dir: root });
  await runJob(job.id, {
    launch: async () => ({
      verdict: "launched",
      root,
      appId: "com.emd.sandbox",
      device: { id: device, name: "iPhone 17" },
      logDir: join(state, "runs", job.id),
    }),
    check: async () => ({ verdict: "error" }),
  });
  return job.id;
}

type Screen = { logs?: Record<string, string[]>; nodes?: UiNode[] };
type Calls = { logs: number; screen: number; screenshot: number };

function readers(screen: Screen = {}, overrides: Partial<Deps> = {}) {
  const calls: Calls = { logs: 0, screen: 0, screenshot: 0 };
  const deps: Deps = {
    logs: async ({ tag }): Promise<LogsResult> => {
      calls.logs++;
      const messages = screen.logs?.[tag ?? ""] ?? [];
      return {
        verdict: "ok",
        lines: messages.map((message) => ({
          time: "2026-10-24T18:00:00.000Z",
          tag: tag ?? "",
          message,
        })),
        total: messages.length,
      };
    },
    screen: async (): Promise<ScreenRead> => {
      calls.screen++;
      return { nodes: screen.nodes ?? [], backend: "axe" };
    },
    screenshot: async (_device, path) => {
      calls.screenshot++;
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, "png");
      return true;
    },
    ...overrides,
  };
  return { deps, calls };
}

const tapped: Screen = {
  logs: { smoke: ["tapped"] },
  nodes: [
    { id: "smoke-label", texts: ["Tapped"] },
    { id: "smoke-button", texts: ["Tap me"] },
  ],
};

const expectTapped = {
  logs: [{ tag: "smoke", message: "tapped" }],
  elements: [{ id: "smoke-button" }, { text: "Tapped" }],
};

const run = (opts: CheckOptions, deps: Deps) => check(opts, () => {}, deps);

test("passes when every log event and element is found", async () => {
  const jobId = await launched();
  const { deps } = readers(tapped);
  const result = await run({ jobId, ...expectTapped }, deps);
  expect(result).toMatchObject({
    verdict: "passed",
    logs: [{ tag: "smoke", message: "tapped", found: true }],
    elements: [
      { id: "smoke-button", found: true },
      { text: "Tapped", found: true },
    ],
  });
  expect(result.attempt).toBeUndefined();
  const shot = result.secondOpinion?.screenshot ?? "";
  expect(shot).toMatch(/check-\d+\.png$/);
  expect(existsSync(shot)).toBe(true);
});

test("a result names the backend that read the screen, and any it passed over", async () => {
  const jobId = await launched();
  const first = await run(
    { jobId, elements: [{ id: "smoke-button" }] },
    readers(tapped).deps,
  );
  expect(first.backend).toBe("axe");
  expect(first.fellBack).toBeUndefined();

  const fallback = readers(tapped, {
    screen: async () => ({
      nodes: tapped.nodes ?? [],
      backend: "maestro",
      fellBack: [{ backend: "axe", reason: "axe is not installed" }],
    }),
  });
  const second = await run(
    { jobId, elements: [{ id: "smoke-button" }] },
    fallback.deps,
  );
  expect(second).toMatchObject({
    verdict: "passed",
    backend: "maestro",
    fellBack: [{ backend: "axe", reason: "axe is not installed" }],
  });

  // A failing check names its backend too.
  const failing = await run(
    { jobId, elements: [{ text: "Nope" }] },
    fallback.deps,
  );
  expect(failing).toMatchObject({ verdict: "failed", backend: "maestro" });
});

test("a check on logs alone reads no screen and names no backend", async () => {
  const jobId = await launched();
  const { deps, calls } = readers(tapped);
  const result = await run({ jobId, logs: [{ tag: "smoke" }] }, deps);
  expect(result.verdict).toBe("passed");
  expect(result.backend).toBeUndefined();
  expect(calls.screen).toBe(0);
});

test("fails, and says which expectation, when a log event is missing", async () => {
  const jobId = await launched();
  const { deps } = readers({ ...tapped, logs: { smoke: ["something else"] } });
  const result = await run({ jobId, ...expectTapped }, deps);
  expect(result).toMatchObject({
    verdict: "failed",
    attempt: 1,
    retryLimit: 3,
    logs: [{ tag: "smoke", message: "tapped", found: false }],
  });
  expect(result.elements?.every((e) => e.found)).toBe(true);
  expect(result.reason).toContain("1 of 3");
});

test("fails when an element is missing, and needs id and text on one node", async () => {
  const jobId = await launched();
  const { deps } = readers(tapped);
  const missing = await run({ jobId, elements: [{ text: "Nope" }] }, deps);
  expect(missing).toMatchObject({
    verdict: "failed",
    elements: [{ text: "Nope", found: false }],
  });
  const other = await run(
    {
      jobId,
      elements: [{ id: "smoke-button", text: "Tapped" }],
    },
    deps,
  );
  expect(other.verdict).toBe("failed");
});

test("a log expectation without a message matches any line with the tag", async () => {
  const jobId = await launched();
  const { deps } = readers(tapped);
  expect((await run({ jobId, logs: [{ tag: "smoke" }] }, deps)).verdict).toBe(
    "passed",
  );
  expect((await run({ jobId, logs: [{ tag: "nav" }] }, deps)).verdict).toBe(
    "failed",
  );
});

test("stops at the retry limit and then refuses to run", async () => {
  process.env.EMD_RETRY_LIMIT = "2";
  const jobId = await launched();
  const { deps, calls } = readers({});
  const options = { jobId, elements: [{ text: "Nope" }] };
  expect(await run(options, deps)).toMatchObject({
    verdict: "failed",
    attempt: 1,
  });
  expect(await run(options, deps)).toMatchObject({
    verdict: "stopped",
    attempt: 2,
    elements: [{ found: false }],
  });
  const ran = calls.screen;
  const third = await run(options, deps);
  expect(third).toMatchObject({ verdict: "stopped", attempt: 2 });
  expect(third.reason).toContain("Stop retrying");
  expect(calls.screen).toBe(ran);
});

test("a pass starts the count over", async () => {
  const jobId = await launched();
  const failing = readers({});
  const passing = readers(tapped);
  const options = { jobId, elements: [{ id: "smoke-button" }] };
  expect((await run(options, failing.deps)).attempt).toBe(1);
  expect((await run(options, passing.deps)).verdict).toBe("passed");
  expect((await run(options, failing.deps)).attempt).toBe(1);
});

test("the agent cannot start a stopped count over", async () => {
  const jobId = await launched();
  const { deps } = readers({});
  const options = { jobId, elements: [{ text: "Nope" }] };
  expect((await run(options, deps)).attempt).toBe(1);
  expect((await run(options, deps)).attempt).toBe(2);
  expect((await run(options, deps)).verdict).toBe("stopped");
  // Neither a stray reset or name, nor a new limit in the input, changes it.
  const sneaky = { ...options, reset: true, name: "fresh", retryLimit: 10 };
  expect(await run(sneaky as CheckOptions, deps)).toMatchObject({
    verdict: "stopped",
    attempt: 3,
  });
});

test("a person's reset clears the count; the CLI refuses without a terminal", async () => {
  const jobId = await launched();
  const { deps } = readers({});
  const options = { jobId, elements: [{ text: "Nope" }] };
  await run(options, deps);
  await run(options, deps);
  expect((await run(options, deps)).verdict).toBe("stopped");
  const refused = cli("check", "reset", "/work/app");
  expect(refused.status).toBe(2);
  expect(refused.stderr).toContain("terminal");
  expect((await run(options, deps)).verdict).toBe("stopped");
  resetChecks("/work/app");
  expect((await run(options, deps)).attempt).toBe(1);
});

test("EMD_RETRY_LIMIT, set by a person, changes the limit", async () => {
  process.env.EMD_RETRY_LIMIT = "1";
  const jobId = await launched();
  const result = await run(
    { jobId, elements: [{ text: "Nope" }] },
    readers({}).deps,
  );
  expect(result).toMatchObject({ verdict: "stopped", retryLimit: 1 });
});

test("the count follows the project across relaunches", async () => {
  process.env.EMD_RETRY_LIMIT = "2";
  const first = await launched("/work/app");
  const { deps } = readers({});
  const options = { elements: [{ text: "Nope" }] };
  expect((await run({ jobId: first, ...options }, deps)).attempt).toBe(1);
  const second = await launched("/work/app");
  expect(await run({ jobId: second, ...options }, deps)).toMatchObject({
    verdict: "stopped",
    attempt: 2,
  });
  const elsewhere = await launched("/work/other");
  expect((await run({ jobId: elsewhere, ...options }, deps)).attempt).toBe(1);
});

test("a check that cannot run is an error and does not count", async () => {
  const jobId = await launched();
  const options = { jobId, elements: [{ text: "Nope" }] };
  const broken = readers(
    {},
    {
      screen: async () => {
        throw new Error("no backend could read the screen\nmore");
      },
    },
  );
  expect(await run(options, broken.deps)).toEqual({
    verdict: "error",
    reason:
      "Could not read the screen: Error: no backend could read the screen",
  });
  const noLogs = readers(
    {},
    {
      logs: async () => ({ verdict: "failed", reason: "No simulator." }),
    },
  );
  expect(await run({ jobId, logs: [{ tag: "smoke" }] }, noLogs.deps)).toEqual({
    verdict: "error",
    reason: "No simulator.",
  });
  expect((await run(options, readers({}).deps)).attempt).toBe(1);
});

test("the agent's reading is a second opinion and never changes the verdict", async () => {
  const jobId = await launched();
  const options = { jobId, elements: [{ id: "smoke-button" }] };
  const passing = readers(tapped).deps;
  const failing = readers({}).deps;

  const wrongPass = await run({ ...options, agentReading: "pass" }, failing);
  expect(wrongPass.verdict).toBe("failed");
  expect(wrongPass.secondOpinion).toMatchObject({
    agent: "pass",
    agrees: false,
  });

  const wrongFail = await run({ ...options, agentReading: "fail" }, passing);
  expect(wrongFail.verdict).toBe("passed");
  expect(wrongFail.secondOpinion).toMatchObject({
    agent: "fail",
    agrees: false,
  });

  const agrees = await run({ ...options, agentReading: "pass" }, passing);
  expect(agrees.secondOpinion).toMatchObject({ agent: "pass", agrees: true });
});

test("the reading is kept even when no screenshot could be taken", async () => {
  const jobId = await launched();
  const { deps } = readers(tapped, { screenshot: async () => false });
  const result = await run(
    { jobId, elements: [{ id: "smoke-button" }], agentReading: "pass" },
    deps,
  );
  expect(result.secondOpinion).toEqual({ agent: "pass", agrees: true });
});

test.each([
  ["no expectation", {}, /at least one expectation/],
  ["an element with neither id nor text", { elements: [{}] }, /id or a text/],
  ["a bad tag", { logs: [{ tag: 'a"b' }] }, /needs a tag/],
  [
    "a message that is too long",
    { logs: [{ tag: "a", message: "x".repeat(201) }] },
    /needs a tag/,
  ],
  [
    "too many expectations",
    { logs: Array.from({ length: 21 }, () => ({ tag: "a" })) },
    /At most 20/,
  ],
  [
    "an unknown job",
    { logs: [{ tag: "a" }], jobId: "deadbeef" },
    /No job with id/,
  ],
  ["no run at all", { logs: [{ tag: "a" }] }, /Give a jobId/],
])("refuses %s before reading anything", async (_name, options, reason) => {
  const { deps, calls } = readers(tapped);
  const result = await check(options as CheckOptions, () => {}, deps);
  expect(result.verdict).toBe("error");
  expect(result.reason).toMatch(reason);
  expect(calls).toEqual({ logs: 0, screen: 0, screenshot: 0 });
});
