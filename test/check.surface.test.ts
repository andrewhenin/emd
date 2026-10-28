import { expect, test } from "vitest";
import { makeDir, mcpSession, cli as run } from "./helpers.ts";

// The `check` paths that need no simulator, through the real CLI and the real
// MCP server (which runs each check as a job in a real worker process), so
// they run on any OS. Real checks are test/e2e/launch.test.ts.
const state = makeDir();
process.env.EMD_STATE_DIR = state;
const { client, call, finished } = mcpSession(state);

const cli = (...args: string[]) => run("check", ...args);

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
    "--agent",
    "pass",
  );
  expect(JSON.parse(run.stdout).reason).toMatch(/No job with id/);
});

test("neither the CLI nor the MCP tool lets the agent set the limit or reset the count", async () => {
  for (const flag of ["--retry-limit", "--reset"]) {
    expect(cli("deadbeef", "--log", "smoke", flag, "1").stderr).toMatch(
      /Unknown option/,
    );
  }
  const { tools } = await client.listTools();
  const input = tools.find((t) => t.name === "check")?.inputSchema;
  expect(Object.keys(input?.properties ?? {})).toEqual([
    "jobId",
    "device",
    "appId",
    "since",
    "logs",
    "elements",
    "name",
    "agentReading",
  ]);
});
