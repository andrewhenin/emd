import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { makeDir } from "./helpers.ts";

// The #14 scorer, run as a script on a downloaded trial folder: only OUT_DIR is
// set, so the group, arm and model come from the folder's meta.json.
type Trial = {
  arm: string;
  events: object[];
  timedOut?: boolean;
};

const model = "claude-sonnet-5-5";
const use = (id: string, name: string, input: object) => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", id, name, input }] },
});
const init = (extra: object = {}) => ({
  type: "system",
  subtype: "init",
  model,
  tools: ["Bash", "Edit"],
  ...extra,
});
const answer = {
  type: "result",
  subtype: "success",
  result: "Done.",
  num_turns: 9,
  duration_ms: 342_000,
  total_cost_usd: 0.09,
};

function score({ arm, events, timedOut = false }: Trial) {
  const out = makeDir();
  const write = (file: string, data: object) =>
    writeFileSync(join(out, file), JSON.stringify(data));
  write("meta.json", {
    group: 2,
    arm,
    model,
    label: "round-1",
    emdVersion: arm === "emd" ? "0.15.0" : null,
  });
  write("run.json", { seconds: 1260, timedOut });
  write("grade.json", { outcome: "pass" });
  writeFileSync(
    join(out, "transcript.jsonl"),
    events.map((e) => JSON.stringify(e)).join("\n"),
  );
  const env: Record<string, string> = { PATH: process.env.PATH ?? "" };
  env.OUT_DIR = out;
  const run = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "experiments/agent-baseline/score.ts"],
    { env, encoding: "utf8", timeout: 30_000 },
  );
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(readFileSync(join(out, "meta.json"), "utf8"));
}

test("a read, a script edit and a read in one shell call is proof", () => {
  const command = [
    "axe describe-ui --udid X > before.json",
    "python3 - <<'EOF'",
    "s = open('App.tsx').read()",
    "open('App.tsx', 'w').write(s.replace('a', 'b'))",
    "EOF",
    "axe describe-ui --udid X",
  ].join("\n");
  const meta = score({
    arm: "primed",
    events: [init(), use("1", "Bash", { command }), answer],
  });
  expect(meta.h1).toBe(true);
});

test("a read only after the edit, in the same call, is not proof", () => {
  const command = "sed -i '' 's/a/b/' App.tsx && axe describe-ui --udid X";
  const meta = score({
    arm: "primed",
    events: [init(), use("1", "Bash", { command }), answer],
  });
  expect(meta.h1).toBe(false);
});

test("EMD's server still connecting at the start is a valid EMD trial", () => {
  const meta = score({
    arm: "emd",
    events: [
      init({ mcp_servers: [{ name: "emd", status: "pending" }] }),
      answer,
    ],
  });
  expect(meta.valid).toEqual({ ok: true, reasons: [] });
});

test("an answer before the limit counts, even if the process outlived it", () => {
  const meta = score({ arm: "raw", events: [init(), answer], timedOut: true });
  expect(meta).toMatchObject({
    hitLimit: false,
    outcome: "pass",
    seconds: 342,
  });
});

test("no answer before the limit fails, whatever the app shows", () => {
  const meta = score({ arm: "raw", events: [init()], timedOut: true });
  expect(meta).toMatchObject({
    hitLimit: true,
    outcome: "fail",
    seconds: 1260,
  });
});
