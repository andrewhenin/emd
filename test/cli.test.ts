import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("emd prints its version", () => {
  const out = execFileSync("node", ["dist/bin.js"], { encoding: "utf8" });
  expect(out).toMatch(/^emd \d+\.\d+\.\d+/);
});

test("the package ships one bin, emd; the MCP server is `emd mcp`", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    bin: Record<string, string>;
  };
  expect(pkg.bin).toEqual({ emd: "dist/bin.js" });
});
