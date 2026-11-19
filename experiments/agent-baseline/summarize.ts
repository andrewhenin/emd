// Summarizes the agent baseline (#14) from downloaded trial records: one row
// per group and app case, then one row per trial. Void trials (tools not
// matching their group) are listed but not counted. The warm-up build's time
// shows how fast each trial's runner was. Results: experiments/agent-baseline.md
//
// Usage: node --experimental-strip-types experiments/agent-baseline/summarize.ts <dir>
// where <dir> holds the downloaded artifacts, one folder per trial
// (`gh run download <run id> -R andrewhenin/emd -D <dir>`, once per round).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) throw new Error("usage: summarize.ts <dir>");

type Meta = {
  group: number;
  arm: string;
  model: string;
  label: string;
  // Records from before the app case (#14) have none: they are fresh.
  app?: string;
  warmup?: { seconds?: number };
  valid: { ok: boolean; reasons: string[] };
  outcome: string | null;
  h1: boolean;
  hitLimit?: boolean;
  seconds?: number | null;
  run?: { seconds?: number; timedOut?: boolean };
  result: {
    numTurns?: number;
    costUsd?: number;
    permissionDenials?: number | null;
  } | null;
  toolErrors: number;
};
const trials = readdirSync(dir)
  .map((name) => join(dir, name, "meta.json"))
  .filter((path) => existsSync(path))
  .map((path) => JSON.parse(readFileSync(path, "utf8")) as Meta)
  .sort(
    (a, b) =>
      a.group - b.group ||
      (a.app ?? "fresh").localeCompare(b.app ?? "fresh") ||
      a.label.localeCompare(b.label),
  );

const median = (values: (number | undefined)[]) => {
  const v = values
    .filter((x): x is number => typeof x === "number")
    .sort((a, b) => a - b);
  if (v.length === 0) return "";
  const mid = Math.floor(v.length / 2);
  const m =
    v.length % 2 ? (v[mid] ?? 0) : ((v[mid - 1] ?? 0) + (v[mid] ?? 0)) / 2;
  return String(Math.round(m * 100) / 100);
};
const row = (cells: (string | number)[]) => `| ${cells.join(" | ")} |`;
// Records scored before the limit rule (#14) have only run.timedOut.
const hitLimit = (t: Meta) => t.hitLimit ?? !!t.run?.timedOut;
const seconds = (t: Meta) => t.seconds ?? t.run?.seconds;
const app = (t: Meta) => t.app ?? "fresh";

console.log(
  row([
    "Group",
    "Arm",
    "Model",
    "App",
    "Valid",
    "Outcome pass",
    "H1 proof",
    "Timed out",
    "No stop (H4)",
    "Median turns",
    "Median $",
    "Median s",
    "Median tool errors",
    "Median warm-up s",
  ]),
);
console.log(row(Array(14).fill("---")));
for (const key of [...new Set(trials.map((t) => `${t.group} ${app(t)}`))]) {
  const all = trials.filter((t) => `${t.group} ${app(t)}` === key);
  const valid = all.filter((t) => t.valid.ok);
  const first = all[0];
  console.log(
    row([
      first?.group ?? "",
      first?.arm ?? "",
      first?.model ?? "",
      first ? app(first) : "",
      `${valid.length} of ${all.length}`,
      valid.filter((t) => t.outcome === "pass").length,
      valid.filter((t) => t.h1).length,
      valid.filter(hitLimit).length,
      valid.filter(
        (t) => !hitLimit(t) && !t.result?.permissionDenials && t.result,
      ).length,
      median(valid.map((t) => t.result?.numTurns)),
      median(valid.map((t) => t.result?.costUsd)),
      median(valid.map(seconds)),
      median(valid.map((t) => t.toolErrors)),
      median(all.map((t) => t.warmup?.seconds)),
    ]),
  );
}

console.log();
console.log(
  row([
    "Label",
    "Group",
    "App",
    "Valid",
    "Outcome",
    "H1",
    "Turns",
    "$",
    "s",
    "Warm-up s",
    "Void reasons",
  ]),
);
console.log(row(Array(11).fill("---")));
for (const t of trials) {
  console.log(
    row([
      t.label,
      t.group,
      app(t),
      t.valid.ok ? "yes" : "no",
      t.outcome ?? "",
      t.h1 ? "yes" : "no",
      t.result?.numTurns ?? "",
      t.result?.costUsd?.toFixed(3) ?? "",
      Math.round(seconds(t) ?? 0) || "",
      t.warmup?.seconds ?? "",
      t.valid.reasons.join("; "),
    ]),
  );
}
