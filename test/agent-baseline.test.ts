import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { makeDir } from "./helpers.ts";

// The #14 scorer, run as a script on a downloaded trial folder: only OUT_DIR is
// set, so the group, arm and model come from the folder's meta.json.
type Trial = {
  arm: string;
  events: object[];
  timedOut?: boolean;
  otel?: object[];
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

function score({ arm, events, timedOut = false, otel }: Trial) {
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
  if (otel)
    writeFileSync(
      join(out, "otel.jsonl"),
      otel.map((e) => JSON.stringify(e)).join("\n"),
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

// The summary, run as a script on a folder of trial records.
test("the summary splits a group by app case and shows warm-up times", () => {
  const dir = makeDir();
  const trial = (name: string, meta: object) => {
    const folder = join(dir, name);
    mkdirSync(folder);
    writeFileSync(
      join(folder, "meta.json"),
      JSON.stringify({
        group: 6,
        arm: "primed",
        model: "claude-haiku-5-5",
        valid: { ok: true, reasons: [] },
        outcome: "pass",
        h1: true,
        seconds: 300,
        result: { numTurns: 9, costUsd: 0.05 },
        toolErrors: 0,
        ...meta,
      }),
    );
  };
  // A record from before the app case counts as fresh.
  trial("a", { label: "round-1", warmup: { seconds: 400 } });
  trial("b", { label: "round-1", app: "installed", warmup: { seconds: 200 } });
  trial("c", { label: "round-2", app: "installed", warmup: { seconds: 300 } });
  const run = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "experiments/agent-baseline/summarize.ts",
      dir,
    ],
    { encoding: "utf8", timeout: 30_000 },
  );
  expect(run.status, run.stderr).toBe(0);
  const lines = run.stdout.split("\n");
  expect(lines).toContain(
    "| 6 | primed | claude-haiku-5-5 | fresh | 1 of 1 | 1 | 1 | 0 | 1 | 9 | 0.05 | 300 | 0 | 400 |",
  );
  expect(lines).toContain(
    "| 6 | primed | claude-haiku-5-5 | installed | 2 of 2 | 2 | 2 | 0 | 2 | 9 | 0.05 | 300 | 0 | 250 |",
  );
  expect(lines).toContain(
    "| round-2 | 6 | installed | yes | pass | yes | 9 | 0.050 | 300 |  |  | 300 |  |",
  );
});

test("telemetry splits a trial's time into model, tools and slowest calls", () => {
  const meta = score({
    arm: "emd",
    events: [
      init(),
      use("t1", "Bash", { command: "npx expo run:ios" }),
      use("t2", "mcp__emd__launch", {}),
      answer,
    ],
    otel: [
      { "event.name": "api_request", duration_ms: 2000 },
      { "event.name": "api_request", duration_ms: 3000 },
      {
        "event.name": "tool_result",
        tool_name: "Bash",
        tool_use_id: "t1",
        duration_ms: 4000,
      },
      // OTLP JSON can send integers as strings.
      {
        "event.name": "tool_result",
        tool_name: "mcp__emd__launch",
        tool_use_id: "t2",
        duration_ms: "12000",
      },
    ],
  });
  expect(meta.timing).toEqual({
    modelSeconds: 5,
    toolSeconds: 16,
    byTool: {
      Bash: { calls: 1, seconds: 4 },
      mcp__emd__launch: { calls: 1, seconds: 12 },
    },
    slowest: [
      { seconds: 12, tool: "mcp__emd__launch", call: "{}" },
      { seconds: 4, tool: "Bash", call: "npx expo run:ios" },
    ],
    complete: true,
  });
});

test("the runner keeps only timing, token and cost fields from telemetry", () => {
  const dir = makeDir();
  const bin = join(dir, "bin");
  const out = join(dir, "out");
  mkdirSync(bin);
  mkdirSync(out);
  // A stand-in for Claude Code: sends one OTLP JSON batch, then answers.
  const batch = {
    resourceLogs: [
      {
        scopeLogs: [
          {
            logRecords: [
              {
                attributes: [
                  { key: "event.name", value: { stringValue: "tool_result" } },
                  { key: "user.email", value: { stringValue: "a@b.c" } },
                  { key: "tool_name", value: { stringValue: "Bash" } },
                  { key: "duration_ms", value: { intValue: "1500" } },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  writeFileSync(
    join(bin, "claude"),
    `#!${process.execPath}
await fetch(process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: ${JSON.stringify(JSON.stringify(batch))},
});
console.log(JSON.stringify({ type: "result", telemetry: process.env.CLAUDE_CODE_ENABLE_TELEMETRY }));
`,
    { mode: 0o755 },
  );
  const run = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "experiments/agent-baseline/run.ts"],
    {
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        APP_DIR: dir,
        OUT_DIR: out,
        MODEL: "claude-haiku-5-5",
        TRIAL_MINUTES: "1",
      },
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  expect(run.status, run.stderr).toBe(0);
  expect(readFileSync(join(out, "transcript.jsonl"), "utf8")).toContain(
    '"telemetry":"1"',
  );
  expect(readFileSync(join(out, "otel.jsonl"), "utf8")).toBe(
    `${JSON.stringify({ "event.name": "tool_result", tool_name: "Bash", duration_ms: "1500" })}\n`,
  );
});
