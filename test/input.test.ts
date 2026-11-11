import { expect, test } from "vitest";
import { cli, launchedJob, makeDir, mcpSession } from "./helpers.ts";

// tap, type and swipe (decision 0009) through the real CLI and MCP server, on
// the paths that need no simulator. Real gestures are test/e2e/launch.test.ts.
const state = makeDir();
process.env.EMD_STATE_DIR = state;
const { client } = mcpSession(state);

const mcp = async (name: string, args: Record<string, unknown>) =>
  (await client.callTool({ name, arguments: args })).structuredContent;
const fromCli = (...args: string[]) => {
  const run = cli(...args);
  return { status: run.status, result: JSON.parse(run.stdout) };
};

test("the MCP server lists tap, type and swipe", async () => {
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name)).toEqual(
    expect.arrayContaining(["tap", "type", "swipe"]),
  );
});

test.each([
  ["no target", [], {}],
  ["two targets", ["--id", "a", "--text", "b"], { id: "a", text: "b" }],
  ["x without y", ["--x", "10"], { x: 10 }],
  ["a negative point", ["--x=-1", "--y=5"], { x: -1, y: 5 }],
])("tap refuses %s, from the CLI and MCP alike", async (_name, flags, args) => {
  const run = fromCli("tap", "deadbeef", ...flags);
  expect(run.status).toBe(1);
  expect(run.result.verdict).toBe("failed");
  expect(await mcp("tap", { jobId: "deadbeef", ...args })).toEqual(run.result);
});

test("each gesture needs a launched app", async () => {
  for (const args of [
    ["tap", "deadbeef", "--id", "smoke-button"],
    ["type", "deadbeef", "hello"],
    ["swipe", "deadbeef", "up"],
  ]) {
    const run = fromCli(...args);
    expect(run.status).toBe(1);
    expect(run.result.reason).toMatch(/No job with id "deadbeef"/);
  }
});

test("type needs text and swipe needs a direction", () => {
  expect(fromCli("type", "deadbeef").result.reason).toMatch(/characters/);
  expect(fromCli("swipe", "deadbeef", "sideways").result.reason).toMatch(
    /up, down, left, right/,
  );
});

// On a Mac, AXe or Maestro may be installed and would act on the stand-in
// device; there the e2e test covers real gestures.
test.skipIf(process.platform === "darwin")(
  "with no AXe and no Maestro, a gesture fails and names each backend",
  async () => {
    const jobId = await launchedJob(state);
    const run = fromCli("tap", jobId, "--id", "smoke-button");
    expect(run.status).toBe(1);
    expect(run.result.reason).toBe(
      "Error: no backend could tap (axe: axe is not installed; maestro: maestro is not installed)",
    );
    expect(await mcp("tap", { jobId, id: "smoke-button" })).toEqual(run.result);
  },
);
