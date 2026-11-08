import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { cli, launchedJob, makeDir, mcpSession } from "./helpers.ts";

// `steps` through the real CLI and the real MCP server (a real job worker),
// with stand-ins for the device tools on PATH, so it runs on any OS. The
// target a step names decides what the stand-in does. Real taps are
// test/e2e/launch.test.ts.
const state = makeDir();
process.env.EMD_STATE_DIR = state;
const calls = join(state, "calls.ndjson");
const bin = makeDir();
process.env.PATH = `${bin}:${process.env.PATH}`;
const jobId = await launchedJob(state);
const logDir = join(state, "runs", jobId);
const capture = join(logDir, "app.ndjson");
mkdirSync(logDir, { recursive: true });
writeFileSync(capture, "");
const device = "829564DA-13EC-4DE7-95B0-1E3EFF6FE713";
const { client, call, finished } = mcpSession(state);

// Each stand-in records its arguments, and the stand-in maestro the flow it
// ran. A tap writes tagged lines to the run's capture, as the app would.
const standIn = (name: string, body: string) => {
  const path = join(bin, name);
  writeFileSync(
    path,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const log = (message) => fs.appendFileSync(${JSON.stringify(capture)},
  JSON.stringify({ timestamp: new Date().toISOString(), eventMessage: "[EMD:smoke] " + message }) + "\\n");
const record = (extra = {}) => fs.appendFileSync(${JSON.stringify(calls)},
  JSON.stringify({ tool: ${JSON.stringify(name)}, args, ...extra }) + "\\n");
${body}
`,
  );
  chmodSync(path, 0o755);
};

// AXe's own words when nothing matches (Sources/AXe/Commands/Tap.swift, v1.8.0)
// and when a character is not on a US keyboard (TextToHIDEvents.swift). A
// gesture fails while the file \`gestureFails\` exists.
const gestureFails = join(state, "gesture-fails");
standIn(
  "axe",
  `record();
const stuck = () => {
  console.error("Timed out creating the simulator remote automation session");
  process.exit(1);
};
if (args[0] === "type") {
  const text = args[args.length - 1];
  if (text.includes("é")) {
    console.error("Error: No keycode found for character: 'é'");
    process.exit(1);
  }
  if (text === "stuck") stuck();
  log("typed " + text);
  process.exit(0);
}
if (args[0] === "gesture") {
  if (fs.existsSync(${JSON.stringify(gestureFails)})) stuck();
  log("scrolled");
  process.exit(0);
}
const target = args[args.indexOf("tap") + 2];
if (target.startsWith("missing")) {
  const tip = "Make sure the app is on the expected screen, then run \`axe describe-ui --udid <SIMULATOR_UDID>\` and prefer --id when available.";
  console.error("Warning: No accessibility element matched --id '" + target + "'. " + tip + " No tap performed.");
  console.error("Error: No accessibility element matched --id '" + target + "'. " + tip);
  process.exit(1);
}
if (target === "stuck") stuck();
const times = target === "chatty" ? 7 : 1;
for (let i = 1; i <= times; i++) log("tapped " + target + (times > 1 ? " " + i : ""));`,
);
standIn(
  "maestro",
  `const flow = fs.readFileSync(args[3], "utf8");
record({ flow });
if (flow.includes("gone")) {
  console.error("Element not found: Id matching regex: gone");
  process.exit(1);
}
log(flow.includes("inputText") ? "maestro typed" : "maestro tapped");`,
);
standIn(
  "xcrun",
  `record();
fs.writeFileSync(args[args.length - 1], "png");`,
);

type Result = {
  verdict: string;
  reason?: string;
  dir?: string;
  steps?: {
    step: unknown;
    backend?: string;
    fellBack?: { backend: string; reason: string }[];
    screenshot?: string;
    total: number;
    lines: { tag: string; message: string }[];
    error?: string;
  }[];
};

// One run, from a clean capture: a line written before the run must not
// land in any step.
const run = (...steps: unknown[]) => {
  writeFileSync(
    capture,
    `${JSON.stringify({ timestamp: "2020-01-01T00:00:00Z", eventMessage: "[EMD:smoke] before the run" })}\n`,
  );
  rmSync(calls, { force: true });
  const out = cli(
    "steps",
    jobId,
    ...steps.flatMap((s) => ["--step", JSON.stringify(s)]),
  );
  return { status: out.status, result: JSON.parse(out.stdout) as Result };
};

const called = () =>
  existsSync(calls)
    ? readFileSync(calls, "utf8")
        .split("\n")
        .filter(Boolean)
        .map(
          (line) =>
            JSON.parse(line) as { tool: string; args: string[]; flow?: string },
        )
    : [];

const messages = (lines: { message: string }[]) => lines.map((l) => l.message);

test("MCP exposes steps with only jobId and steps as inputs", async () => {
  const { tools } = await client.listTools();
  const input = tools.find((t) => t.name === "steps")?.inputSchema;
  expect(Object.keys(input?.properties ?? {})).toEqual(["jobId", "steps"]);
});

test("a tap through MCP is a job; the answer is small and the rest stays on disk", async () => {
  const job = await call("steps", {
    jobId,
    steps: [{ tapOn: { id: "smoke-button" } }],
  });
  expect(job).toMatchObject({ kind: "steps", status: "queued" });
  const done = await finished(job.jobId);
  expect(done.status).toBe("succeeded");
  const result = done.result as Result;
  expect(result).toMatchObject({
    verdict: "ran",
    steps: [
      {
        step: { tapOn: { id: "smoke-button" } },
        backend: "axe",
        screenshot: "01.png",
        total: 1,
        lines: [{ tag: "smoke", message: "tapped smoke-button" }],
      },
    ],
  });
  expect(JSON.stringify(result).length).toBeLessThan(1000);
  const dir = result.dir ?? "";
  expect(readFileSync(join(dir, "01.png"), "utf8")).toBe("png");
  expect(readFileSync(join(dir, "flow.yaml"), "utf8")).toBe(
    'appId: com.emd.sandbox\n---\n- tapOn:\n    id: "smoke-button"\n',
  );
  const saved = JSON.parse(readFileSync(join(dir, "steps.json"), "utf8"));
  expect(saved.steps[0]).toMatchObject({
    backend: "axe",
    start: expect.any(String),
    lines: [{ message: "tapped smoke-button" }],
  });
}, 20_000);

test("AXe taps by testID or exact label; each step gets only its own lines", async () => {
  const { status, result } = run(
    { tapOn: { id: "smoke-button" } },
    { tapOn: "Tap me (1)" },
  );
  expect(status).toBe(0);
  expect(result.verdict).toBe("ran");
  expect(
    called()
      .filter((c) => c.tool === "axe")
      .map((c) => c.args),
  ).toEqual([
    ["tap", "--id", "smoke-button", "--wait-timeout", "10", "--udid", device],
    ["tap", "--label", "Tap me (1)", "--wait-timeout", "10", "--udid", device],
  ]);
  expect(result.steps?.map((s) => messages(s.lines))).toEqual([
    ["tapped smoke-button"],
    ["tapped Tap me (1)"],
  ]);
  // Maestro reads text as a regular expression; the saved flow is exact.
  expect(readFileSync(join(result.dir ?? "", "flow.yaml"), "utf8")).toBe(
    'appId: com.emd.sandbox\n---\n- tapOn:\n    id: "smoke-button"\n- tapOn: "Tap me \\\\(1\\\\)"\n',
  );
}, 20_000);

test("when AXe proves it did not tap, Maestro taps, and the result says why", async () => {
  const { status, result } = run({ tapOn: { id: "missing" } });
  expect(status).toBe(0);
  const [step] = result.steps ?? [];
  expect(step?.backend).toBe("maestro");
  expect(step?.fellBack?.[0]?.backend).toBe("axe");
  expect(step?.fellBack?.[0]?.reason).toContain(
    "No accessibility element matched --id 'missing'",
  );
  expect(messages(step?.lines ?? [])).toEqual(["maestro tapped"]);
  const maestro = called().find((c) => c.tool === "maestro");
  expect(maestro?.args.slice(0, 3)).toEqual(["--device", device, "test"]);
  expect(maestro?.flow).toBe(
    'appId: com.emd.sandbox\n---\n- tapOn:\n    id: "missing"\n',
  );
}, 20_000);

test("any other AXe error fails the step without a second tap, and the run stops", async () => {
  const { status, result } = run(
    { tapOn: { id: "stuck" } },
    { tapOn: { id: "smoke-button" } },
  );
  expect(status).toBe(1);
  expect(result).toMatchObject({
    verdict: "failed",
    reason: "Step 1 failed; the 1 after it did not run.",
  });
  expect(result.steps).toHaveLength(1);
  const [step] = result.steps ?? [];
  expect(step).toMatchObject({ backend: "axe", screenshot: "01.png" });
  expect(step?.error).toContain(
    "Timed out creating the simulator remote automation session",
  );
  expect(step?.fellBack).toBeUndefined();
  expect(called().map((c) => c.tool)).toEqual(["axe", "xcrun"]);
}, 20_000);

test("when Maestro fails after AXe found nothing, the step names Maestro and its error", async () => {
  const { status, result } = run({ tapOn: { id: "missing-gone" } });
  expect(status).toBe(1);
  expect(result.verdict).toBe("failed");
  const [step] = result.steps ?? [];
  expect(step).toMatchObject({
    backend: "maestro",
    fellBack: [{ backend: "axe" }],
    screenshot: "01.png",
  });
  expect(step?.error).toContain("Element not found");
}, 20_000);

test("AXe types into the field that has focus and scrolls; the flow replays them", async () => {
  const { status, result } = run(
    { tapOn: { id: "smoke-input" } },
    { inputText: '-a "b"' },
    "scroll",
  );
  expect(status).toBe(0);
  expect(
    called()
      .filter((c) => c.tool === "axe")
      .map((c) => c.args),
  ).toEqual([
    ["tap", "--id", "smoke-input", "--wait-timeout", "10", "--udid", device],
    ["type", "--udid", device, "--", '-a "b"'],
    ["gesture", "scroll-up", "--udid", device],
  ]);
  expect(result.steps?.map((s) => [s.backend, messages(s.lines)])).toEqual([
    ["axe", ["tapped smoke-input"]],
    ["axe", ['typed -a "b"']],
    ["axe", ["scrolled"]],
  ]);
  expect(readFileSync(join(result.dir ?? "", "flow.yaml"), "utf8")).toBe(
    'appId: com.emd.sandbox\n---\n- tapOn:\n    id: "smoke-input"\n- inputText: "-a \\"b\\""\n- scroll\n',
  );
}, 20_000);

test("when AXe proves it did not type, Maestro types, and the result says why", async () => {
  const { status, result } = run({ inputText: "café" });
  expect(status).toBe(0);
  const [step] = result.steps ?? [];
  expect(step?.backend).toBe("maestro");
  expect(step?.fellBack?.[0]).toEqual({
    backend: "axe",
    reason:
      "Error: axe type failed (exit 1): Error: No keycode found for character: 'é'",
  });
  expect(messages(step?.lines ?? [])).toEqual(["maestro typed"]);
  expect(called().find((c) => c.tool === "maestro")?.flow).toBe(
    'appId: com.emd.sandbox\n---\n- inputText: "café"\n',
  );
}, 20_000);

test("any other AXe error while typing or scrolling fails the step without a second try", async () => {
  for (const step of [{ inputText: "stuck" }, "scroll"]) {
    if (step === "scroll") writeFileSync(gestureFails, "");
    const { status, result } = run(step);
    rmSync(gestureFails, { force: true });
    expect(status).toBe(1);
    const [ran] = result.steps ?? [];
    expect(ran).toMatchObject({ backend: "axe", screenshot: "01.png" });
    expect(ran?.error).toContain("Timed out creating the simulator");
    expect(ran?.fellBack).toBeUndefined();
    expect(called().map((c) => c.tool)).toEqual(["axe", "xcrun"]);
  }
}, 20_000);

test("a step returns its newest 5 lines and the total; steps.json keeps all", async () => {
  const { result } = run({ tapOn: { id: "chatty" } });
  const [step] = result.steps ?? [];
  expect(step?.total).toBe(7);
  expect(messages(step?.lines ?? [])).toEqual(
    [3, 4, 5, 6, 7].map((i) => `tapped chatty ${i}`),
  );
  const saved = JSON.parse(
    readFileSync(join(result.dir ?? "", "steps.json"), "utf8"),
  );
  expect(saved.steps[0].lines).toHaveLength(7);
}, 20_000);

test.each([
  ["no step", []],
  ["a command EMD does not run yet", [{ swipe: { direction: "UP" } }]],
  // biome-ignore lint/suspicious/noTemplateCurlyInString: Maestro's syntax, not a template.
  ["text Maestro would run as JavaScript", [{ inputText: "a ${b}" }]],
  ["empty text", [{ inputText: "" }]],
  ["scroll as an object", [{ scroll: null }]],
  ["a tap with both id and text", [{ tapOn: { id: "a", text: "b" } }]],
  ["more than 20 steps", Array(21).fill({ tapOn: "a" })],
])("refuses %s before it touches the device", (_name, steps) => {
  rmSync(calls, { force: true });
  const out = cli(
    "steps",
    jobId,
    ...steps.flatMap((s) => ["--step", JSON.stringify(s)]),
  );
  expect(out.status).toBe(1);
  expect(JSON.parse(out.stdout)).toMatchObject({
    verdict: "error",
    reason: expect.stringContaining("Each is a Maestro command"),
  });
  expect(called()).toEqual([]);
});

test("refuses bad JSON, a missing job, and on MCP a command outside the schema", async () => {
  expect(cli("steps", jobId, "--step", "{nope").status).toBe(2);
  expect(cli("steps").status).toBe(2);
  const unknown = cli("steps", "deadbeef", "--step", '{"tapOn":"a"}');
  expect(JSON.parse(unknown.stdout).reason).toMatch(/No job with id/);
  const refused = await client.callTool({
    name: "steps",
    arguments: { jobId, steps: [{ swipe: { direction: "UP" } }] },
  });
  expect(refused.isError).toBe(true);
});
