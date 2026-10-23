import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";

test("emd prints its version", () => {
  const out = execFileSync("node", ["dist/cli.js"], { encoding: "utf8" });
  expect(out).toMatch(/^emd \d+\.\d+\.\d+/);
});
