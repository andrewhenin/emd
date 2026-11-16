// Scores one trial of the agent baseline (#14) from its transcript, after the
// grader. Writes init.json (the session's model, tools and skills), claim.txt
// (the agent's final answer, never the outcome), diff.patch (the app's final
// change), proof.json (H1: a machine read of the screen before the first edit
// and after the last) and meta.json (group, versions, cost, turns, time,
// validity) to OUT_DIR. Results: experiments/agent-baseline.md
//
// Env: APP_DIR, OUT_DIR, GROUP, ARM, MODEL, LABEL, EMD_VERSION.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const need = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};
const out = need("OUT_DIR");
const app = need("APP_DIR");
const arm = need("ARM");
const model = need("MODEL");
const json = (file: string): Record<string, unknown> =>
  existsSync(join(out, file))
    ? JSON.parse(readFileSync(join(out, file), "utf8"))
    : {};
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
spawnSync("git", ["-C", app, "add", "-A"]);
const diff = spawnSync("git", ["-C", app, "diff", "--cached", "--binary"], {
  encoding: "utf8",
  maxBuffer: 256 << 20,
});
write("diff.patch", diff.stdout ?? "");

// What each tool call did, in order. A screen read is a machine read of the
// element tree (or a UI test), not a screenshot. Patterns cover the common
// tools; a person reads every failed transcript and a sample of passed ones.
type Kind = "edit" | "screen" | "log" | "screenshot";
const shell: [Kind, RegExp][] = [
  ["screen", /\baxe\s+describe-ui\b/],
  ["screen", /\bidb\s+ui\s+describe/],
  ["screen", /\bmaestro\s+(hierarchy|test)\b/],
  ["screen", /\bxcodebuild\b[^\n]*\btest\b/],
  ["log", /\blog\s+(show|stream)\b/],
  ["screenshot", /\bsimctl\s+io\s+\S+\s+screenshot\b/],
  ["edit", /(sed\s+-i|>\s*\S+\.(tsx?|jsx?)\b|\btee\s+\S+\.(tsx?|jsx?)\b)/],
];
const kindsOf = (name: string, input: Record<string, unknown>): Kind[] => {
  const path = String(input.file_path ?? "");
  if (name === "mcp__emd__check") return ["screen"];
  if (name === "mcp__emd__logs") return ["log"];
  if (name === "mcp__emd__evidence") return ["screenshot"];
  if (name === "Read" && /\.png$/i.test(path)) return ["screenshot"];
  if (
    ["Edit", "MultiEdit", "Write"].includes(name) &&
    /\.(tsx?|jsx?)$/.test(path) &&
    !/\/(node_modules|ios)\//.test(path)
  ) {
    return ["edit"];
  }
  if (name === "Bash") {
    const command = String(input.command ?? "");
    return shell.filter(([, re]) => re.test(command)).map(([kind]) => kind);
  }
  return [];
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
    return {
      index,
      name: b.name ?? "",
      ok: !failed.has(b.id),
      kinds: kindsOf(b.name ?? "", input),
      summary: String(
        input.command ?? input.file_path ?? JSON.stringify(input),
      ).slice(0, 200),
      key: `${b.name}:${JSON.stringify(input)}`,
    };
  });
const edits = calls.filter((c) => c.kinds.includes("edit"));
const firstEdit = edits[0]?.index;
const lastEdit = edits.at(-1)?.index;
const around = (kind: Kind) => {
  const ok = calls.filter((c) => c.ok && c.kinds.includes(kind));
  return {
    before: firstEdit !== undefined && ok.some((c) => c.index < firstEdit),
    after: lastEdit !== undefined && ok.some((c) => c.index > lastEdit),
  };
};
const screen = around("screen");
const proof = {
  h1: screen.before && screen.after,
  firstEdit,
  lastEdit,
  screen,
  log: around("log"),
  screenshot: around("screenshot"),
  calls: calls
    .filter((c) => c.kinds.length > 0)
    .map(({ key: _key, ...c }) => c),
};
write("proof.json", proof);

// Void when the session's tools don't match its group (#14): EMD's MCP tools
// in the EMD groups and only there; the same for the emd skill when the init
// event lists skills.
const tools = Array.isArray(init?.tools) ? (init.tools as string[]) : [];
const emdTools = tools.some((t) => t.startsWith("mcp__emd__"));
const skills = Array.isArray(init?.skills) ? (init.skills as unknown[]) : null;
const emdSkill = skills?.some((s) => JSON.stringify(s).includes('"emd"'));
const reasons = [
  init ? "" : "no init event",
  init && init.model !== model ? `model ${init.model}, not ${model}` : "",
  emdTools !== (arm === "emd") ? `EMD tools: ${emdTools}` : "",
  skills && emdSkill !== (arm === "emd") ? `emd skill: ${emdSkill}` : "",
].filter(Boolean);

// The same tool with the same input again.
const seen = new Set<string>();
let repeatedCalls = 0;
for (const call of calls) {
  if (seen.has(call.key)) repeatedCalls++;
  seen.add(call.key);
}
const runRecord = json("run.json");
write("meta.json", {
  group: Number(need("GROUP")),
  arm,
  model,
  label: need("LABEL"),
  emdVersion: arm === "emd" ? need("EMD_VERSION") : null,
  harnessCommit: process.env.GITHUB_SHA ?? null,
  runId: process.env.GITHUB_RUN_ID ?? null,
  ...json("prepare.json"),
  run: runRecord,
  valid: { ok: reasons.length === 0, reasons },
  outcome: json("grade.json").outcome ?? null,
  h1: proof.h1,
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
  toolErrors: calls.filter((c) => !c.ok).length,
  repeatedCalls,
});
console.log(readFileSync(join(out, "meta.json"), "utf8"));
