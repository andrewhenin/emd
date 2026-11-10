import { expect, test } from "vitest";
import { cli } from "./helpers.ts";

// Through the real CLI. On macOS with Xcode it checks the machine itself;
// elsewhere it stops at "macos".
test("doctor lists what this machine has and how to add what is missing", () => {
  const run = cli("doctor");
  const result = JSON.parse(run.stdout);
  expect(result.checks[0]).toMatchObject({ name: "node", status: "ok" });
  const missing = result.checks.filter(
    (c: { status: string }) => c.status === "missing",
  );
  expect(result.verdict).toBe(missing.length > 0 ? "missing" : "ready");
  expect(run.status).toBe(missing.length > 0 ? 1 : 0);
  for (const check of missing) expect(check.fix).toBeTruthy();
  if (process.platform !== "darwin") {
    expect(result.checks.map((c: { name: string }) => c.name)).toEqual([
      "node",
      "macos",
    ]);
  }
});
