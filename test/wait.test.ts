import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createJob } from "../src/core/jobs.ts";
import { defaultWait } from "../src/mcp/server.ts";
import { makeDir } from "./helpers.ts";

// #223: how long launch, check and job_status wait by default, the progress
// they send while they wait, and what a cancelled call changes. Through the
// real MCP server, with EMD_WAIT_SECONDS set as setup sets it for Claude Code
// (2 s here, so the tests stay short). A job with no worker stays queued.
const state = makeDir();
const client = new Client({ name: "emd-test", version: "0.0.0" });

beforeAll(async () => {
  await client.connect(
    new StdioClientTransport({
      command: "node",
      args: ["dist/bin.js", "mcp"],
      env: {
        ...process.env,
        EMD_STATE_DIR: state,
        EMD_WAIT_SECONDS: "2",
      } as Record<string, string>,
    }),
  );
});

afterAll(async () => {
  await client.close();
});

const queued = () => {
  process.env.EMD_STATE_DIR = state;
  return createJob("launch", { dir: makeDir() }).id;
};

test("EMD_WAIT_SECONDS sets the default wait, and the wait sends the job's state as progress", async () => {
  const jobId = queued();
  const progress: { progress: number; message?: string }[] = [];
  const started = Date.now();
  const reply = await client.callTool(
    { name: "job_status", arguments: { jobId } },
    { onprogress: (p) => progress.push(p) },
  );
  const seconds = (Date.now() - started) / 1000;
  expect(reply.structuredContent).toMatchObject({ status: "queued" });
  // 2 s from EMD_WAIT_SECONDS, not the built-in 30 s.
  expect(seconds).toBeGreaterThan(1.5);
  expect(seconds).toBeLessThan(10);
  expect(progress[0]).toMatchObject({ progress: 0, message: "queued" });
});

test("after a cancelled call, the session keeps the built-in waits", async () => {
  const jobId = queued();
  const first = new AbortController();
  const cancelled = client.callTool(
    { name: "job_status", arguments: { jobId, waitSeconds: 20 } },
    { signal: first.signal },
  );
  setTimeout(() => first.abort(), 300);
  await expect(cancelled).rejects.toThrow();

  // The next default wait is 30 s, not 2: the call is still waiting at 4 s.
  const second = new AbortController();
  let done = false;
  const next = client
    .callTool(
      { name: "job_status", arguments: { jobId } },
      {
        signal: second.signal,
      },
    )
    .finally(() => {
      done = true;
    });
  await new Promise((resolve) => setTimeout(resolve, 4000));
  expect(done).toBe(false);
  second.abort();
  await expect(next).rejects.toThrow();
});

test("the default wait: the configured one, else the tool's own", () => {
  expect(defaultWait(30, false, "100")).toBe(100);
  expect(defaultWait(25, false, undefined)).toBe(25);
  expect(defaultWait(25, false, "")).toBe(25);
  // Out of range or not a number: the tool's own.
  expect(defaultWait(30, false, "111")).toBe(30);
  expect(defaultWait(30, false, "-1")).toBe(30);
  expect(defaultWait(30, false, "soon")).toBe(30);
  // Once a call was cancelled, the tool's own.
  expect(defaultWait(30, true, "100")).toBe(30);
});
