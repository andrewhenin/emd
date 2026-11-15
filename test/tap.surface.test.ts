import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { cli, launchedJob, makeDir, mcpSession } from "./helpers.ts";

// tap by id or text through the real CLI and MCP server, with stand-ins for
// AXe and Maestro first on the PATH: AXe taps any element but "missing" and
// records its arguments, Maestro always fails.
const bins = makeDir();
const log = join(bins, "axe.log");
writeFileSync(
  join(bins, "axe"),
  `#!/bin/sh
echo "$@" >> "${log}"
case "$*" in *missing*) echo "No accessibility element matched" >&2; exit 1;; esac
`,
);
writeFileSync(join(bins, "maestro"), "#!/bin/sh\nexit 1\n");
chmodSync(join(bins, "axe"), 0o755);
chmodSync(join(bins, "maestro"), 0o755);
process.env.PATH = `${bins}:${process.env.PATH}`;

const state = makeDir();
process.env.EMD_STATE_DIR = state;
const { client } = mcpSession(state);
const mcp = async (args: Record<string, unknown>) =>
  (await client.callTool({ name: "tap", arguments: args })).structuredContent;
const fromCli = (...args: string[]) => {
  const run = cli(...args);
  return { status: run.status, result: JSON.parse(run.stdout) };
};

test("a tap by id or text gives AXe 10 s to wait and reports its seconds", async () => {
  const jobId = await launchedJob(state);

  const byId = fromCli("tap", jobId, "--id", "save-button");
  expect(byId.status).toBe(0);
  expect(byId.result).toMatchObject({ verdict: "ok", backend: "axe" });
  expect(byId.result.seconds).toBeGreaterThanOrEqual(0);
  expect(await mcp({ jobId, text: "Save" })).toMatchObject({
    verdict: "ok",
    backend: "axe",
  });

  const calls = readFileSync(log, "utf8");
  expect(calls).toMatch(/--id save-button --wait-timeout 10/);
  expect(calls).toMatch(/--label Save --wait-timeout 10/);
});

test("an element that never appears is not tapped, and the result names it and the seconds", async () => {
  const jobId = await launchedJob(state);
  const never = fromCli("tap", jobId, "--id", "missing");
  expect(never.status).toBe(1);
  expect(never.result.verdict).toBe("failed");
  expect(never.result.reason).toMatch(
    /^Element id "missing" did not appear in [\d.]+ s\. Nothing was tapped\./,
  );
  expect(typeof never.result.seconds).toBe("number");
  expect(await mcp({ jobId, id: "missing" })).toMatchObject({
    verdict: "failed",
    reason: expect.stringContaining('Element id "missing"'),
  });
});

test("a tap at a point does not wait and reports no seconds", async () => {
  const jobId = await launchedJob(state);
  const point = fromCli("tap", jobId, "--x", "10", "--y", "20");
  expect(point.result.verdict).toBe("ok");
  expect(point.result.seconds).toBeUndefined();
  expect(readFileSync(log, "utf8")).toMatch(/-x 10 -y 20$/m);
});
