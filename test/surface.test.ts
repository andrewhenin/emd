import { execFileSync, spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, expect, test } from "vitest";
import { appJson, expoProject, makeDir } from "./helpers.ts";

// Real CLI and real MCP server (`emd mcp`), built into dist/ by `npm test`. No mocks.
const client = new Client({ name: "emd-test", version: "0.0.0" });

beforeAll(async () => {
  await client.connect(
    new StdioClientTransport({ command: "node", args: ["dist/bin.js", "mcp"] }),
  );
});

afterAll(async () => {
  await client.close();
});

const cli = (dir: string) =>
  JSON.parse(
    execFileSync("node", ["dist/bin.js", "detect", dir], { encoding: "utf8" }),
  );

const mcp = (dir: string) =>
  client.callTool({ name: "detect", arguments: { dir } });

test("MCP server exposes the detect tool", async () => {
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name)).toContain("detect");
});

const sandbox = () =>
  expoProject({
    "app.json": appJson({
      ios: { bundleIdentifier: "com.emd.sandbox" },
      android: { package: "com.emd.sandbox" },
    }),
    ".maestro/smoke.yaml": "",
    "AGENTS.md": "",
  });

test.each([
  ["an Expo project", sandbox],
  ["an empty directory", () => makeDir()],
])("CLI and MCP return the same result for %s", async (_name, make) => {
  const dir = make();
  const fromCli = cli(dir);
  const fromMcp = await mcp(dir);
  expect(fromMcp.structuredContent).toEqual(fromCli);
  expect(
    JSON.parse((fromMcp.content as { text: string }[])[0]?.text ?? ""),
  ).toEqual(fromCli);
});

test("results stay small: only the fields launching needs", async () => {
  const result = cli(sandbox());
  expect(Object.keys(result).sort()).toEqual([
    "appIds",
    "commands",
    "maestroFlows",
    "notes",
    "packageManager",
    "platforms",
    "root",
    "stack",
    "verdict",
  ]);
  expect(JSON.stringify(result).length).toBeLessThan(800);
});

test("unknown CLI command exits non-zero", () => {
  expect(() =>
    execFileSync("node", ["dist/bin.js", "bogus"], { stdio: "pipe" }),
  ).toThrow();
});

test("CLI and MCP both refuse evidence for a job that does not exist", async () => {
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name)).toContain("evidence");
  const refused = { verdict: "failed", reason: 'No job with id "deadbeef".' };
  const fromMcp = await client.callTool({
    name: "evidence",
    arguments: { jobId: "deadbeef" },
  });
  expect(fromMcp.structuredContent).toEqual(refused);
  const fromCli = spawnSync("node", ["dist/bin.js", "evidence", "deadbeef"], {
    encoding: "utf8",
  });
  expect(fromCli.status).toBe(1);
  expect(JSON.parse(fromCli.stdout)).toEqual(refused);
});
