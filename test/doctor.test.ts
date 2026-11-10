import { expect, test } from "vitest";
import { cli } from "./helpers.ts";

// Through the real CLI. Off macOS, doctor stops at "macos" with a fix.
test.skipIf(process.platform === "darwin")(
  "off macOS, doctor reports Node, then macOS missing with its fix",
  () => {
    const run = cli("doctor");
    expect(run.status).toBe(1);
    const result = JSON.parse(run.stdout);
    expect(result.verdict).toBe("missing");
    expect(result.checks).toMatchObject([
      { name: "node", status: "ok" },
      { name: "macos", status: "missing", fix: expect.stringMatching(/macOS/) },
    ]);
  },
);

// On a Mac, every missing item says how to add it.
test.runIf(process.platform === "darwin")(
  "on macOS, each missing item has a fix",
  () => {
    const result = JSON.parse(cli("doctor").stdout);
    for (const check of result.checks) {
      if (check.status === "missing") expect(check.fix).toBeTruthy();
    }
  },
);
