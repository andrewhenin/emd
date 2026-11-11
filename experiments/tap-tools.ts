// Taps the sandbox app's button four ways and records, for each tap: seconds,
// the bytes an agent reads back, and whether the app reacted ("Tapped" on
// screen within 5 s). Results: experiments/tap-tools.md
//
// Usage: node --experimental-strip-types experiments/tap-tools.ts <udid> [rounds]
// The sandbox app must be installed (`emd launch fixtures/expo`). Needs `axe` and
// `maestro` on PATH and Node's npx. MAESTRO_ROUNDS (default 3) caps Maestro,
// which is slow. OUT_DIR (default ./tap-tools-out) gets one sample of each reply.
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const exec = promisify(execFile);
const [udid, roundsArg] = process.argv.slice(2);
if (!udid) throw new Error("usage: tap-tools.ts <udid> [rounds]");
const rounds = Number(roundsArg ?? 10);
const maestroRounds = Number(process.env.MAESTRO_ROUNDS ?? 3);
const app = process.env.APP_ID ?? "com.emd.sandbox";
const mbm = "mobilebuildmcp@2.7.1";
const id = "smoke-button";
const out = process.env.OUT_DIR ?? "tap-tools-out";
mkdirSync(out, { recursive: true });

const run = async (cmd: string, args: string[], seconds = 240) => {
  try {
    const r = await exec(cmd, args, {
      timeout: seconds * 1000,
      maxBuffer: 64 << 20,
    });
    return { ok: true, stdout: r.stdout, stderr: r.stderr };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    return {
      ok: false,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message,
    };
  }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const screenHas = async (label: string) =>
  (await run("axe", ["describe-ui", "--udid", udid], 15)).stdout.includes(
    `"${label}"`,
  );
const waitFor = async (label: string, seconds: number) => {
  const end = Date.now() + seconds * 1000;
  do {
    if (await screenHas(label)) return true;
    await sleep(250);
  } while (Date.now() < end);
  return false;
};
// A fresh app shows "Ready"; a tap that reaches it shows "Tapped".
const reset = async () => {
  await run("xcrun", ["simctl", "terminate", udid, app], 30);
  await run("xcrun", ["simctl", "launch", udid, app], 60);
  return waitFor("Ready", 120);
};
const saved = new Set<string>();
const sample = (name: string, text: string) => {
  if (saved.has(name)) return;
  saved.add(name);
  writeFileSync(join(out, `${name}.txt`), text);
  console.log(`--- sample ${name} (${text.length} bytes)\n${text}\n--- end`);
};
const textOf = (r: unknown) =>
  ((r as { content?: { type: string; text?: string }[] }).content ?? [])
    .map((c) => c.text ?? "")
    .join("\n");
// A snapshot target row is ref|action|role|label|value|id.
const refFor = (text: string) =>
  new RegExp(
    `([A-Za-z0-9_-]+)\\|tap\\|[^|"\\n]*\\|[^|"\\n]*\\|[^|"\\n]*\\|${id}`,
  ).exec(text)?.[1];

// The agent's way today (option A): MobileBuildMCP's MCP server, started once.
const client = new Client({ name: "tap-tools", version: "0" });
await client.connect(
  new StdioClientTransport({
    command: "npx",
    args: ["-y", mbm, "mcp"],
    env: {
      ...(process.env as Record<string, string>),
      MOBILEBUILDMCP_ENABLED_WORKFLOWS: "simulator,ui-automation",
    },
  }),
);
const defaults = await client.callTool({
  name: "session_set_defaults",
  arguments: { simulatorId: udid },
});
sample("A-session_set_defaults", textOf(defaults));
// Some clients pass structuredContent to the model too; log its size once.
const structured = (name: string, r: unknown) =>
  sample(
    `${name}-structured`,
    JSON.stringify(
      (r as { structuredContent?: unknown }).structuredContent ?? null,
    ),
  );
structured("A-session_set_defaults", defaults);
const viaMcp = async () => {
  const snapReply = await client.callTool({
    name: "snapshot_ui",
    arguments: {},
  });
  structured("A-snapshot_ui", snapReply);
  const snap = textOf(snapReply);
  sample("A-snapshot_ui", snap);
  const ref = refFor(snap);
  if (!ref) return { ok: false, bytes: snap.length, note: "no ref" };
  const reply = await client.callTool({
    name: "tap",
    arguments: { elementRef: ref },
  });
  structured("A-tap", reply);
  const tap = textOf(reply);
  sample("A-tap", tap);
  return {
    ok: reply.isError !== true && !tap.includes("FAILED"),
    bytes: snap.length + tap.length,
  };
};

// Option B: EMD runs MobileBuildMCP's CLI; the agent reads only EMD's reply.
const viaCli = async () => {
  const ui = (tool: string, args: object) =>
    run("npx", [
      "-y",
      mbm,
      "ui-automation",
      tool,
      "--json",
      JSON.stringify({ simulatorId: udid, ...args }),
      "--output",
      "json",
    ]);
  const snap = await ui("snapshot-ui", {});
  const ref = refFor(snap.stdout);
  if (!ref) return { ok: false, bytes: 0, note: "no ref" };
  const tap = await ui("tap", { elementRef: ref });
  return { ok: tap.ok, bytes: 0 };
};

// Option C: EMD runs AXe, or Maestro when AXe can't.
const viaAxe = async () => {
  const r = await run(
    "axe",
    ["tap", "--id", id, "--wait-timeout", "5", "--udid", udid],
    60,
  );
  sample("C-axe-tap", r.stdout + r.stderr);
  return { ok: r.ok, bytes: 0 };
};
const flow = join(out, "tap.yaml");
writeFileSync(flow, `appId: ${app}\n---\n- tapOn:\n    id: ${id}\n`);
const viaMaestro = async () => {
  const r = await run("maestro", ["--device", udid, "test", flow], 300);
  return { ok: r.ok, bytes: 0 };
};

type Row = {
  way: string;
  round: number;
  seconds: number;
  reported: boolean;
  reacted: boolean;
  bytes: number;
  note?: string;
};
const rows: Row[] = [];
const ways: [
  string,
  () => Promise<{ ok: boolean; bytes: number; note?: string }>,
][] = [
  ["A mcp", viaMcp],
  ["B cli", viaCli],
  ["C axe", viaAxe],
  ["C maestro", viaMaestro],
];
// Maestro runs in its own phase at the end: its driver can leave the
// simulator slow to read for a while, which would bias the others.
const once = async (
  way: string,
  round: number,
  tap: () => Promise<{ ok: boolean; bytes: number; note?: string }>,
) => {
  if (!(await reset())) {
    const row = {
      way,
      round,
      seconds: 0,
      reported: false,
      reacted: false,
      bytes: 0,
      note: "reset: no Ready",
    };
    rows.push(row);
    console.log(JSON.stringify(row));
    return;
  }
  const start = Date.now();
  const r = await tap();
  const seconds = (Date.now() - start) / 1000;
  const reacted = await waitFor("Tapped", 5);
  const row = {
    way,
    round,
    seconds,
    reported: r.ok,
    reacted,
    bytes: r.bytes,
    ...(r.note ? { note: r.note } : {}),
  };
  rows.push(row);
  console.log(JSON.stringify(row));
};
const fast = ways.filter(([way]) => way !== "C maestro");
for (let round = 1; round <= rounds; round++) {
  for (const [way, tap] of round % 2 ? fast : [...fast].reverse())
    await once(way, round, tap);
}
for (let round = 1; round <= maestroRounds; round++)
  await once("C maestro", round, viaMaestro);
await client.close();

console.log(
  "\nway | taps | reported ok | app reacted | median s | min s | max s | agent bytes per tap (median)",
);
const median = (xs: number[]) =>
  [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)] ?? Number.NaN;
for (const [way] of ways) {
  // A failed reset is not a tap: it shows only in the tap count.
  const all = rows.filter((r) => r.way === way);
  const rs = all.filter((r) => r.note !== "reset: no Ready");
  const secs = rs.map((r) => r.seconds);
  console.log(
    [
      way,
      all.length,
      rs.filter((r) => r.reported).length,
      rs.filter((r) => r.reacted).length,
      median(secs).toFixed(1),
      Math.min(...secs).toFixed(1),
      Math.max(...secs).toFixed(1),
      median(rs.map((r) => r.bytes)),
    ].join(" | "),
  );
}
writeFileSync(join(out, "rows.json"), JSON.stringify(rows, null, 1));
