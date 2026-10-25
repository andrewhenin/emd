import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, expect, test } from "vitest";
import { makeDir } from "./helpers.ts";

// The `check` paths that need no simulator, through the real CLI and the real
// MCP server (which runs each check as a job in a real worker process), so
// they run on any OS. Real checks are test/e2e/launch.test.ts.
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
  spawnSync("node", ["dist/bin.js", "check", ...args], { encoding: "utf8" });

type View = {
  jobId: string;
  kind: string;
  status: string;
  result?: Record<string, unknown>;
};

const call = async (name: string, args: Record<string, unknown>) =>
  (await client.callTool({ name, arguments: args })).structuredContent as View;

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

test("MCP server exposes the check tool", async () => {
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name)).toContain("check");
});

test.each([
  ["no expectation", [], { verdict: "error" }, /at least one expectation/],
  [
    "an unknown job",
    ["deadbeef", "--log", "smoke"],
    { verdict: "error" },
    /No job with id/,
  ],
])(
  "%s: the CLI blocks, MCP starts a check job that ends the same",
  async (_name, args, shape, reason) => {
    const run = cli(...args);
    expect(run.status).toBe(1);
    const fromCli = JSON.parse(run.stdout);
    expect(fromCli).toMatchObject(shape);
    expect(fromCli.reason).toMatch(reason);

    const mcpArgs =
      args[0] === "deadbeef"
        ? { jobId: "deadbeef", logs: [{ tag: "smoke" }] }
        : {};
    const started = Date.now();
    const job = await call("check", mcpArgs);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(job).toMatchObject({ kind: "check", status: "queued" });

    const done = await finished(job.jobId);
    expect(done).toMatchObject({ kind: "check", status: "failed" });
    expect(done.result).toEqual(fromCli);
  },
);

test("the CLI turns flags into expectations and refuses bad ones", () => {
  const withBadElement = cli("deadbeef", "--element", "bogus");
  expect(withBadElement.status).toBe(2);
  expect(withBadElement.stderr).toContain("--element");
  expect(cli("deadbeef", "--element", "{not json").status).toBe(2);
  expect(cli("deadbeef", "--agent", "maybe").status).toBe(2);
  // Well-formed flags get as far as the job lookup.
  const run = cli(
    "deadbeef",
    "--log",
    "smoke=tapped",
    "--element",
    "id=smoke-button",
    "--element",
    '{"text":"Tapped"}',
    "--retry-limit",
    "2",
    "--name",
    "demo",
    "--agent",
    "pass",
  );
  expect(JSON.parse(run.stdout).reason).toMatch(/No job with id/);
});

test("an out-of-range retry limit is refused on the CLI and by the MCP schema", async () => {
  const run = cli("deadbeef", "--log", "smoke", "--retry-limit", "0");
  expect(JSON.parse(run.stdout).reason).toMatch(/retryLimit/);
  const tooMany = await client.callTool({
    name: "check",
    arguments: { jobId: "deadbeef", logs: [{ tag: "a" }], retryLimit: 99 },
  });
  expect(tooMany.isError).toBe(true);
});
