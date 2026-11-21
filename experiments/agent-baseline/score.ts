// Scores one trial of the agent baseline (#14) from its transcript, after the
// grader. Writes init.json (the session's model, tools and skills), claim.txt
// (the agent's final answer, never the outcome), diff.patch (the app's final
// change), proof.json (H1: a machine read of the screen before the first edit
// and after the last) and meta.json (group, versions, cost, turns, time,
// validity) to OUT_DIR. Results: experiments/agent-baseline.md
//
// Env: APP_DIR, OUT_DIR, GROUP, ARM, MODEL, LABEL, EMD_VERSION.
// To score a downloaded trial again, set only OUT_DIR: the rest comes from its
// meta.json, and its diff.patch stays as it is.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = process.env.OUT_DIR;
if (!out) throw new Error("OUT_DIR is not set");
const json = (file: string): Record<string, unknown> =>
  existsSync(join(out, file))
    ? JSON.parse(readFileSync(join(out, file), "utf8"))
    : {};
const prior = json("meta.json");
const need = (name: string, key: string): string => {
  const value = process.env[name] ?? prior[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`${name} is not set`);
  }
  return String(value);
};
const app = process.env.APP_DIR;
const arm = need("ARM", "arm");
const model = need("MODEL", "model");
const write = (file: string, data: unknown) =>
  writeFileSync(
    join(out, file),
    typeof data === "string" ? data : `${JSON.stringify(data, null, 2)}\n`,
  );

type Event = Record<string, unknown> & {
  type?: string;
  subtype?: string;
  message?: { content?: unknown };
};
type Block = {
  type?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean;
};
const events: Event[] = existsSync(join(out, "transcript.jsonl"))
  ? readFileSync(join(out, "transcript.jsonl"), "utf8")
      .split("\n")
      .filter((line) => line.trim().startsWith("{"))
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as Event];
        } catch {
          return [];
        }
      })
  : [];
const blocks = (e: Event): Block[] =>
  Array.isArray(e.message?.content) ? (e.message.content as Block[]) : [];

const init = events.find((e) => e.type === "system" && e.subtype === "init");
const result = events.findLast((e) => e.type === "result");
write("init.json", init ?? {});
write("claim.txt", typeof result?.result === "string" ? result.result : "");

// The app's final change, untracked files included.
if (app) {
  spawnSync("git", ["-C", app, "add", "-A"]);
  const diff = spawnSync("git", ["-C", app, "diff", "--cached", "--binary"], {
    encoding: "utf8",
    maxBuffer: 256 << 20,
  });
  write("diff.patch", diff.stdout ?? "");
}

// What each tool call did, in order. A screen read is a machine read of the
// element tree (or a UI test), not a screenshot. Patterns cover the common
// tools; a person reads every failed transcript and a sample of passed ones.
// One shell call can read, edit and read again (#14 round 1), so each match
// keeps its place in the command.
type Kind = "edit" | "screen" | "log" | "screenshot";
const source = /\.(tsx?|jsx?)\b/;
const shell: [Kind, RegExp][] = [
  ["screen", /\baxe\s+describe-ui\b/g],
  ["screen", /\bidb\s+ui\s+describe/g],
  ["screen", /\bmaestro\s+(hierarchy|test)\b/g],
  ["screen", /\bxcodebuild\b[^\n]*\btest\b/g],
  // agent-device: `open` returns the first interactive snapshot, and an
  // action with --settle returns what changed on screen.
  ["screen", /\bagent-device\s+(open|snapshot|diff|get|is|find|wait)\b/g],
  ["screen", /\bagent-device\s[^\n;&|]*--settle\b/g],
  ["log", /\blog\s+(show|stream)\b/g],
  ["log", /\bagent-device\s+logs\b/g],
  ["screenshot", /\bsimctl\s+io\s+\S+\s+screenshot\b/g],
  ["screenshot", /\bagent-device\s+screenshot\b/g],
  ["edit", /sed\s+-i|perl\s+-\w*i/g],
  ["edit", />\s*["']?\S+\.(tsx?|jsx?)\b|\btee\s+\S+\.(tsx?|jsx?)\b/g],
];
// A script that writes a file (python, node), counted only when the command
// names a source file.
const scriptWrite = /\.write(_text)?\(|writeFileSync\(/g;
type Step = { kind: Kind; at: number };
const stepsOf = (name: string, input: Record<string, unknown>): Step[] => {
  const path = String(input.file_path ?? "");
  if (name === "mcp__emd__check") return [{ kind: "screen", at: 0 }];
  if (name === "mcp__emd__logs") return [{ kind: "log", at: 0 }];
  if (name === "mcp__emd__evidence") return [{ kind: "screenshot", at: 0 }];
  if (name === "Read" && /\.png$/i.test(path)) {
    return [{ kind: "screenshot", at: 0 }];
  }
  if (
    ["Edit", "MultiEdit", "Write"].includes(name) &&
    source.test(path) &&
    !/\/(node_modules|ios)\//.test(path)
  ) {
    return [{ kind: "edit", at: 0 }];
  }
  if (name !== "Bash") return [];
  const command = String(input.command ?? "");
  const found = shell.flatMap(([kind, re]) =>
    [...command.matchAll(re)].map((m) => ({ kind, at: m.index ?? 0 })),
  );
  if (source.test(command)) {
    for (const m of command.matchAll(scriptWrite)) {
      found.push({ kind: "edit", at: m.index ?? 0 });
    }
  }
  return found.sort((a, b) => a.at - b.at);
};

const failed = new Set(
  events
    .flatMap(blocks)
    .filter((b) => b.type === "tool_result" && b.is_error === true)
    .map((b) => b.tool_use_id),
);
const calls = events
  .flatMap(blocks)
  .filter((b) => b.type === "tool_use")
  .map((b, index) => {
    const input = b.input ?? {};
    const steps = stepsOf(b.name ?? "", input);
    return {
      index,
      id: b.id,
      name: b.name ?? "",
      ok: !failed.has(b.id),
      steps,
      kinds: [...new Set(steps.map((step) => step.kind))],
      summary: String(
        input.command ?? input.file_path ?? JSON.stringify(input),
      ).slice(0, 200),
      key: `${b.name}:${JSON.stringify(input)}`,
    };
  });
// Every step in order: by call, then by place in the call.
type Placed = { call: number; at: number; kind: Kind; ok: boolean };
const timeline: Placed[] = calls.flatMap((c) =>
  c.steps.map((step) => ({ call: c.index, ok: c.ok, ...step })),
);
const order = (a: Placed, b: Placed) => a.call - b.call || a.at - b.at;
const edits = timeline.filter((s) => s.kind === "edit");
const firstEdit = edits[0];
const lastEdit = edits.at(-1);
const around = (kind: Kind) => {
  const ok = timeline.filter((s) => s.ok && s.kind === kind);
  return {
    before: !!firstEdit && ok.some((s) => order(s, firstEdit) < 0),
    after: !!lastEdit && ok.some((s) => order(s, lastEdit) > 0),
  };
};
const screen = around("screen");
const proof = {
  h1: screen.before && screen.after,
  firstEdit: firstEdit && { call: firstEdit.call, at: firstEdit.at },
  lastEdit: lastEdit && { call: lastEdit.call, at: lastEdit.at },
  screen,
  log: around("log"),
  screenshot: around("screenshot"),
  calls: calls
    .filter((c) => c.kinds.length > 0)
    .map(({ key: _key, steps: _steps, ...c }) => c),
};
write("proof.json", proof);

// Void when the session's tools don't match its group (#14): EMD's MCP tools
// in the EMD groups and only there; the same for the emd skill, and for
// agent-device's skill in the agent-device group, when the init event lists
// skills. EMD's server counts when init lists it still connecting: in round 2
// two Haiku trials started that way, then used its tools.
const tools = Array.isArray(init?.tools) ? (init.tools as string[]) : [];
const servers = Array.isArray(init?.mcp_servers)
  ? (init.mcp_servers as { name?: string }[])
  : [];
const emdTools =
  tools.some((t) => t.startsWith("mcp__emd__")) ||
  servers.some((s) => s.name === "emd");
const skills = Array.isArray(init?.skills) ? (init.skills as unknown[]) : null;
const hasSkill = (name: string) =>
  skills?.some((s) => JSON.stringify(s).includes(`"${name}"`));
const emdSkill = hasSkill("emd");
const agentDeviceSkill = hasSkill("agent-device");
const reasons = [
  init ? "" : "no init event",
  init && init.model !== model ? `model ${init.model}, not ${model}` : "",
  emdTools !== (arm === "emd") ? `EMD tools: ${emdTools}` : "",
  skills && emdSkill !== (arm === "emd") ? `emd skill: ${emdSkill}` : "",
  skills && agentDeviceSkill !== (arm === "agent-device")
    ? `agent-device skill: ${agentDeviceSkill}`
    : "",
].filter(Boolean);

// The same tool with the same input again.
const seen = new Set<string>();
let repeatedCalls = 0;
for (const call of calls) {
  if (seen.has(call.key)) repeatedCalls++;
  seen.add(call.key);
}
// Claude Code's telemetry (run.ts writes otel.jsonl): time in model requests
// and, when its trace spans came, the part spent waiting for the first token;
// time and result size per tool; the slowest calls. `complete` is false when
// a tool event is missing, such as a last batch lost when the process stopped.
type Telemetry = {
  "event.name"?: string;
  span?: string;
  tool_name?: string;
  tool_use_id?: string;
  duration_ms?: number | string;
  ttft_ms?: number | string;
  tool_result_size_bytes?: number | string;
};
const telemetry: Telemetry[] = existsSync(join(out, "otel.jsonl"))
  ? readFileSync(join(out, "otel.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  : [];
const ms = (e: Telemetry) => Number(e.duration_ms ?? 0);
const total = (list: Telemetry[]) =>
  Math.round(list.reduce((sum, e) => sum + ms(e), 0) / 100) / 10;
const toolEvents = telemetry.filter((e) => e["event.name"] === "tool_result");
// Telemetry names every MCP call "mcp_tool"; the transcript has its real name.
const toolName = (e: Telemetry) =>
  calls.find((c) => c.id === e.tool_use_id)?.name ?? e.tool_name ?? "?";
// Summed in ms and bytes, rounded once at the end.
const sums: Record<string, { calls: number; ms: number; bytes: number }> = {};
for (const e of toolEvents) {
  const name = toolName(e);
  const sum = sums[name] ?? { calls: 0, ms: 0, bytes: 0 };
  sums[name] = {
    calls: sum.calls + 1,
    ms: sum.ms + ms(e),
    bytes: sum.bytes + Number(e.tool_result_size_bytes ?? 0),
  };
}
const byTool = Object.fromEntries(
  Object.entries(sums).map(([name, sum]) => [
    name,
    {
      calls: sum.calls,
      seconds: Math.round(sum.ms / 100) / 10,
      resultKB: Math.round(sum.bytes / 102.4) / 10,
    },
  ]),
);
const requests = telemetry.filter((e) => e.span === "claude_code.llm_request");
const timing = telemetry.length
  ? {
      modelSeconds: total(
        telemetry.filter((e) => e["event.name"] === "api_request"),
      ),
      firstTokenSeconds: requests.length
        ? Math.round(
            requests.reduce((sum, e) => sum + Number(e.ttft_ms ?? 0), 0) / 100,
          ) / 10
        : null,
      toolSeconds: total(toolEvents),
      byTool,
      slowest: [...toolEvents]
        .sort((a, b) => ms(b) - ms(a))
        .slice(0, 5)
        .map((e) => ({
          seconds: Math.round(ms(e) / 100) / 10,
          tool: toolName(e),
          call: calls.find((c) => c.id === e.tool_use_id)?.summary ?? null,
        })),
      complete: toolEvents.length === calls.length,
    }
  : null;
const runRecord = json("run.json");
// A trial hit the limit only when no final answer came before it. A process
// that answered and then stayed alive until the limit did not (#14 round 2).
const hitLimit = runRecord.timedOut === true && !result;
write("meta.json", {
  group: Number(need("GROUP", "group")),
  arm,
  model,
  label: need("LABEL", "label"),
  emdVersion: arm === "emd" ? need("EMD_VERSION", "emdVersion") : null,
  harnessCommit: process.env.GITHUB_SHA ?? prior.harnessCommit ?? null,
  runId: process.env.GITHUB_RUN_ID ?? prior.runId ?? null,
  ...json("prepare.json"),
  run: runRecord,
  valid: { ok: reasons.length === 0, reasons },
  hitLimit,
  // A trial that hit the limit fails, whatever the app shows (#14).
  outcome: hitLimit ? "fail" : (json("grade.json").outcome ?? null),
  h1: proof.h1,
  // Prompt to final answer; the process can outlive the answer.
  seconds:
    typeof result?.duration_ms === "number"
      ? result.duration_ms / 1000
      : (runRecord.seconds ?? null),
  result: result
    ? {
        subtype: result.subtype,
        isError: result.is_error,
        numTurns: result.num_turns,
        durationMs: result.duration_ms,
        costUsd: result.total_cost_usd,
        usage: result.usage,
        permissionDenials: Array.isArray(result.permission_denials)
          ? result.permission_denials.length
          : null,
      }
    : null,
  toolCalls: calls.length,
  timing,
  toolErrors: calls.filter((c) => !c.ok).length,
  repeatedCalls,
});
console.log(readFileSync(join(out, "meta.json"), "utf8"));
