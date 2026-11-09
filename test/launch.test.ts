import { createServer } from "node:net";
import { join } from "node:path";
import { expect, test } from "vitest";
import { write } from "../src/core/jobstore.ts";
import { stopEarlierServer } from "../src/core/launch.ts";
import { startLogged } from "../src/core/process.ts";
import {
  cli,
  expoConfig,
  expoProject,
  makeDir,
  mcpSession,
} from "./helpers.ts";

// The paths that need no simulator, through the real CLI and the real MCP
// server (which starts a real worker process per job), so they run on any OS.
// The real launch is test/e2e/launch.test.ts.
const state = makeDir();
process.env.EMD_STATE_DIR = state;
const { client, call, finished } = mcpSession(state);

const noAppId = () => expoProject(expoConfig({ name: "x" }));
const androidOnly = () =>
  expoProject(
    expoConfig({
      platforms: ["android"],
      android: { package: "com.emd.sandbox" },
    }),
  );

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

// A process as launch starts one (its own group, by startLogged), with a way
// to ask whether it has exited.
function started(command: string) {
  const child = startLogged(command, {
    cwd: makeDir(),
    logPath: join(makeDir(), "out.log"),
  });
  let gone = false;
  void child.exited.then(() => {
    gone = true;
  });
  return { ...child, gone: () => gone };
}

const serves = (port: number) =>
  fetch(`http://localhost:${port}/status`)
    .then(async (response) => (await response.text()).includes("running"))
    .catch(() => false);

// A dev server that answers Metro's status route on a free port.
async function devServer() {
  const port = await new Promise<number>((resolve) => {
    const probe = createServer().listen(0, () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
  const server = started(
    `node -e 'require("http").createServer((q, s) => s.end("packager-status:running")).listen(${port})'`,
  );
  for (let i = 0; i < 50 && !(await serves(port)); i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { ...server, port };
}

// A finished launch job that left a dev server running.
let jobs = 0;
const launchedWith = (root: string, metro: { pid: number; port: number }) =>
  write({
    id: (0xc0000000 + jobs++).toString(16),
    kind: "launch",
    input: {},
    status: "succeeded",
    createdAt: "2026-11-08T12:00:00.000Z",
    result: { verdict: "launched", root, metro },
  });

test("the next launch stops the dev server an earlier launch in the worktree left", async () => {
  const server = await devServer();
  try {
    launchedWith("/relaunch", { pid: server.pid, port: server.port });
    await stopEarlierServer("/relaunch", server.port);
    expect(await serves(server.port)).toBe(false);
    expect(server.gone()).toBe(true);
  } finally {
    server.kill();
  }
});

test("a server EMD did not record for this worktree is never stopped", async () => {
  const foreign = await devServer();
  const elsewhere = await devServer();
  // A recorded pid that does not listen on the port: reused, or not Metro.
  const idle = started("sleep 60");
  try {
    launchedWith("/mine", { pid: idle.pid, port: foreign.port });
    launchedWith("/other", { pid: elsewhere.pid, port: elsewhere.port });
    await stopEarlierServer("/mine", foreign.port);
    await stopEarlierServer("/mine", elsewhere.port);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await serves(foreign.port)).toBe(true);
    expect(await serves(elsewhere.port)).toBe(true);
    expect([foreign, elsewhere, idle].map((p) => p.gone())).toEqual([
      false,
      false,
      false,
    ]);
  } finally {
    for (const p of [foreign, elsewhere, idle]) p.kill();
  }
});
