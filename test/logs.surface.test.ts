import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, expect, test } from "vitest";
import { makeDir } from "./helpers.ts";

// The `logs` paths that need no simulator, through the real CLI and the real
// MCP server, so they run on any OS. Real capture is test/e2e/launch.test.ts.
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

const mcp = async (args: Record<string, unknown>) =>
  (await client.callTool({ name: "logs", arguments: args })).structuredContent;

test("MCP server exposes the logs tool", async () => {
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name)).toContain("logs");
});

test("an unknown job fails the same way through the CLI and MCP", async () => {
  const run = cli("logs", "deadbeef");
  expect(run.status).toBe(1);
  const fromCli = JSON.parse(run.stdout);
  expect(fromCli).toEqual({
    verdict: "failed",
    reason: 'No job with id "deadbeef".',
  });
  expect(await mcp({ jobId: "deadbeef" })).toEqual(fromCli);
});

test("a job that never launched an app has no run to read", async () => {
  const started = await client.callTool({
    name: "launch",
    arguments: { dir: makeDir() },
  });
  const { jobId } = started.structuredContent as { jobId: string };
  for (let i = 0; i < 80; i++) {
    const view = cli("job", "status", jobId);
    if (JSON.parse(view.stdout).status === "failed") break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const run = cli("logs", jobId);
  expect(run.status).toBe(1);
  expect(JSON.parse(run.stdout).reason).toMatch(/has not launched an app/);
  expect(await mcp({ jobId })).toEqual(JSON.parse(run.stdout));
});

test("bad input is refused: a bad tag and limit on the CLI, the schema on MCP", async () => {
  expect(
    JSON.parse(cli("logs", "deadbeef", "--tag", 'a"b').stdout).reason,
  ).toMatch(/A tag has/);
  expect(
    JSON.parse(cli("logs", "deadbeef", "--limit", "0").stdout).reason,
  ).toMatch(/limit must be/);
  const tooMany = await client.callTool({
    name: "logs",
    arguments: { jobId: "deadbeef", limit: 9999 },
  });
  expect(tooMany.isError).toBe(true);
});
