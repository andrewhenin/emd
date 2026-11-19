// Runs one trial of the agent baseline (#14): Claude Code headless in the app
// folder, with the group's model and the prompt every group gets, stopped at
// the time limit. Writes transcript.jsonl, claude-stderr.log, otel.jsonl and
// run.json to OUT_DIR. Results: experiments/agent-baseline.md
//
// Env: APP_DIR, OUT_DIR, MODEL, TRIAL_MINUTES, ANTHROPIC_API_KEY.
import { spawn } from "node:child_process";
import { createWriteStream, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

const need = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

// The task, word for word as #14 pre-registered it.
const prompt =
  'In this app, add a Save button to the home screen that shows "Saved" when tapped. Check it on the iOS simulator before and after your change, then tell me where the proof is.';
const out = need("OUT_DIR");
const minutes = Number(need("TRIAL_MINUTES"));
if (!(minutes > 0)) throw new Error("TRIAL_MINUTES must be a positive number");
const args = [
  "-p",
  prompt,
  "--model",
  need("MODEL"),
  "--output-format",
  "stream-json",
  "--verbose",
  // Each runner is thrown away after its job; every group gets the same.
  "--dangerously-skip-permissions",
];

// The agent's environment: the runner's, minus what a developer's terminal
// lacks. GitHub sets CI=true in every step, which turns off Metro's file
// watching; in the pilot, both agents without EMD lost turns to it. The
// GITHUB_, RUNNER_ and ACTIONS_ variables and the harness's own (ARM=raw,
// LABEL=pilot) tell the agent it is being evaluated.
const harnessVars = new Set([
  "CI",
  "APP_DIR",
  "OUT_DIR",
  "HARNESS",
  "MODEL",
  "ARM",
  "GROUP",
  "LABEL",
  "TRIAL_MINUTES",
  "EMD_VERSION",
  "CLAUDE_CODE_VERSION",
  "DEVICE_NAME",
]);
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name]) =>
      !harnessVars.has(name) && !/^(GITHUB|RUNNER|ACTIONS)_/.test(name),
  ),
);

// Claude Code's own telemetry (OpenTelemetry): log events with the duration
// of each tool call and model request, and trace spans that add each model
// request's time to first token. Both export in the background. A local
// receiver keeps only these fields in otel.jsonl; the others name the
// account, and records are public.
const kept = new Set([
  "event.name",
  "event.sequence",
  "tool_name",
  "tool_use_id",
  "success",
  "duration_ms",
  "ttft_ms",
  "first_content_ms",
  "attempt",
  "stop_reason",
  "model",
  "cost_usd",
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_creation_tokens",
  "tool_input_size_bytes",
  "tool_result_size_bytes",
  "result_tokens",
]);
type Attribute = {
  key: string;
  value?: Record<string, string | number | boolean>;
};
type Item = {
  name?: string;
  startTimeUnixNano?: string;
  attributes?: Attribute[];
};
type Otlp = {
  resourceLogs?: { scopeLogs?: { logRecords?: Item[] }[] }[];
  resourceSpans?: { scopeSpans?: { spans?: Item[] }[] }[];
};
const items = (body: Otlp) => [
  ...(body.resourceLogs ?? []).flatMap((r) =>
    (r.scopeLogs ?? []).flatMap((s) => s.logRecords ?? []),
  ),
  ...(body.resourceSpans ?? []).flatMap((r) =>
    (r.scopeSpans ?? []).flatMap((s) => s.spans ?? []),
  ),
];
const fields = (item: Item) => ({
  // A span: its name and start time (ms since the epoch).
  ...(item.name
    ? {
        span: item.name,
        start: Math.round(Number(item.startTimeUnixNano ?? 0) / 1e6),
      }
    : {}),
  ...Object.fromEntries(
    (item.attributes ?? [])
      .filter((a) => kept.has(a.key))
      // OTLP JSON sends 64-bit integers as strings.
      .map((a) => [a.key, Object.values(a.value ?? {})[0]]),
  ),
});
const telemetry = createWriteStream(join(out, "otel.jsonl"));
const receiver = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => {
    try {
      for (const item of items(JSON.parse(Buffer.concat(chunks).toString())))
        telemetry.write(`${JSON.stringify(fields(item))}\n`);
    } catch {
      // Not OTLP JSON: nothing to keep.
    }
    response.writeHead(200, { "content-type": "application/json" }).end("{}");
  });
});
await new Promise<void>((resolve) =>
  receiver.listen(0, "127.0.0.1", () => resolve()),
);
const endpoint = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`;
Object.assign(env, {
  CLAUDE_CODE_ENABLE_TELEMETRY: "1",
  CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: "1",
  OTEL_METRICS_EXPORTER: "none",
  OTEL_LOGS_EXPORTER: "otlp",
  OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: "http/json",
  OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `${endpoint}/v1/logs`,
  OTEL_TRACES_EXPORTER: "otlp",
  OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: "http/json",
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${endpoint}/v1/traces`,
  // The defaults are 5 s; a shorter wait loses less if the process is stopped.
  OTEL_LOGS_EXPORT_INTERVAL: "1000",
  OTEL_BSP_SCHEDULE_DELAY: "1000",
});

const started = new Date();
// Its own process group, so the time limit stops the servers it started too.
const child = spawn("claude", args, {
  cwd: need("APP_DIR"),
  env,
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
child.stdout.pipe(createWriteStream(join(out, "transcript.jsonl")));
child.stderr.pipe(createWriteStream(join(out, "claude-stderr.log")));

const stop = (signal: NodeJS.Signals) => {
  try {
    if (child.pid) process.kill(-child.pid, signal);
  } catch {
    // Already gone.
  }
};
let timedOut = false;
const limit = setTimeout(() => {
  timedOut = true;
  stop("SIGTERM");
  setTimeout(() => stop("SIGKILL"), 10_000).unref();
}, minutes * 60_000);

let finished = false;
const done = (exitCode: number | null, signal: NodeJS.Signals | null) => {
  if (finished) return;
  finished = true;
  clearTimeout(limit);
  const ended = new Date();
  const record = {
    prompt,
    args: args.filter((a) => a !== prompt),
    started: started.toISOString(),
    ended: ended.toISOString(),
    seconds: (ended.getTime() - started.getTime()) / 1000,
    limitMinutes: minutes,
    timedOut,
    exitCode,
    signal,
  };
  writeFileSync(join(out, "run.json"), `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify(record));
  // A last batch can still be on its way when the process ends.
  setTimeout(() => {
    receiver.close();
    receiver.closeAllConnections();
    telemetry.end();
  }, 2000);
};
child.on("error", (error) => {
  console.error(error);
  done(null, null);
});
child.on("close", done);
