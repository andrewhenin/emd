import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, expect, test } from "vitest";
import { appJson, expoProject, makeDir } from "./helpers.ts";

// The paths that need no simulator, through the real CLI and the real MCP
// server, so they run on any OS. The real launch is test/e2e/launch.test.ts.
const client = new Client({ name: "emd-test", version: "0.0.0" });

beforeAll(async () => {
  await client.connect(
    new StdioClientTransport({ command: "node", args: ["dist/bin.js", "mcp"] }),
  );
});

afterAll(async () => {
  await client.close();
});

const cli = (...args: string[]) =>
  spawnSync("node", ["dist/bin.js", "launch", ...args], { encoding: "utf8" });

const mcp = (dir: string) =>
  client.callTool({ name: "launch", arguments: { dir } });

const noAppId = () => expoProject({ "app.json": appJson({ name: "x" }) });
const androidOnly = () =>
  expoProject({
    "app.json": appJson({
      platforms: ["android"],
      android: { package: "com.emd.sandbox" },
    }),
  });

test("MCP server exposes the launch tool", async () => {
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name)).toContain("launch");
});

test.each([
  ["a directory that is not a mobile project", () => makeDir(), /No supported/],
  ["a project without an iOS app ID", noAppId, /No iOS app ID/],
  ["a project that does not target iOS", androidOnly, /does not target iOS/],
])(
  "%s is unsupported, through the CLI and MCP",
  async (_name, make, reason) => {
    const dir = make();
    const run = cli(dir);
    expect(run.status).toBe(1);
    const fromCli = JSON.parse(run.stdout);
    expect(fromCli).toEqual({
      verdict: "unsupported",
      root: dir,
      reason: expect.stringMatching(reason),
    });
    expect((await mcp(dir)).structuredContent).toEqual(fromCli);
  },
);

test("rejects a bad --timeout", () => {
  const run = cli(makeDir(), "--timeout", "soon");
  expect(run.status).toBe(2);
  expect(run.stderr).toContain("--timeout");
});
