import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, expect, test } from "vitest";
import { expoProject, makeDir } from "./helpers.ts";

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

test.each([
  ["an Expo project", expoProject],
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

test("results stay small: a verdict, the root and the stack, nothing else", async () => {
  const result = cli(expoProject());
  expect(Object.keys(result).sort()).toEqual(["root", "stack", "verdict"]);
  expect(JSON.stringify(result).length).toBeLessThan(300);
});

test("unknown CLI command exits non-zero", () => {
  expect(() =>
    execFileSync("node", ["dist/bin.js", "bogus"], { stdio: "pipe" }),
  ).toThrow();
});
