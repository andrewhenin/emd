import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, expect, test } from "vitest";
import { appJson, expoProject, makeDir } from "./helpers.ts";

// The paths that need no simulator, through the real CLI and the real MCP
// server (which starts a real worker process per job), so they run on any OS.
// The real launch is test/e2e/launch.test.ts.
const state = makeDir();
process.env.EMD_STATE_DIR = state;

const client = new Client({ name: "emd-test", version: "0.0.0" });

beforeAll(async () => {
  await client.connect(
    new StdioClientTransport({
      command: "node",
      args: ["dist/bin.js", "mcp"],
      env: { ...process.env, EMD_STATE_DIR: state } as Record<string, string>,
    }),
  );
});

afterAll(async () => {
  await client.close();
});

const cli = (...args: string[]) =>
  spawnSync("node", ["dist/bin.js", ...args], { encoding: "utf8" });

type View = {
  jobId: string;
  kind: string;
  status: string;
  step?: string;
  seconds: number;
  result?: Record<string, unknown>;
};

const call = async (name: string, args: Record<string, unknown>) => {
  const reply = await client.callTool({ name, arguments: args });
  return reply.structuredContent as View;
};

const finished = async (jobId: string): Promise<View> => {
  let job = await call("job_status", { jobId });
  for (
    let i = 0;
    i < 80 && !["succeeded", "failed"].includes(job.status);
    i++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    job = await call("job_status", { jobId });
  }
  return job;
};

const noAppId = () => expoProject({ "app.json": appJson({ name: "x" }) });
const androidOnly = () =>
  expoProject({
    "app.json": appJson({
      platforms: ["android"],
      android: { package: "com.emd.sandbox" },
    }),
  });

test("MCP server exposes launch and job_status", async () => {
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name)).toEqual(
    expect.arrayContaining(["launch", "job_status"]),
  );
});

test.each([
  ["a directory that is not a mobile project", () => makeDir(), /No supported/],
  ["a project without an iOS app ID", noAppId, /No iOS app ID/],
  ["a project that does not target iOS", androidOnly, /does not target iOS/],
])(
  "%s is unsupported: the CLI blocks, MCP starts a job that ends the same",
  async (_name, make, reason) => {
    const dir = make();
    const run = cli("launch", dir);
    expect(run.status).toBe(1);
    const fromCli = JSON.parse(run.stdout);
    expect(fromCli).toEqual({
      verdict: "unsupported",
      root: dir,
      reason: expect.stringMatching(reason),
    });

    const started = Date.now();
    const job = await call("launch", { dir });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(job).toMatchObject({ kind: "launch", status: "queued" });
    expect(job.result).toBeUndefined();

    const done = await finished(job.jobId);
    expect(done).toMatchObject({ jobId: job.jobId, status: "failed" });
    expect(done.result).toEqual(fromCli);
  },
);

test("any process can read a job another process started", async () => {
  const job = await call("launch", { dir: makeDir() });
  const done = await finished(job.jobId);
  const run = cli("job", "status", job.jobId);
  expect(run.status).toBe(0);
  expect(JSON.parse(run.stdout)).toEqual(done);
});

test("an unknown job is an error over MCP and the CLI", async () => {
  const reply = await client.callTool({
    name: "job_status",
    arguments: { jobId: "deadbeef" },
  });
  expect(reply.isError).toBe(true);
  expect(cli("job", "status", "deadbeef").status).toBe(1);
  expect(cli("job", "status", "../../etc/passwd").status).toBe(1);
});

test("rejects a bad --timeout", () => {
  const run = cli("launch", makeDir(), "--timeout", "soon");
  expect(run.status).toBe(2);
  expect(run.stderr).toContain("--timeout");
});
