// Summarizes the agent baseline (#14) from downloaded trial records: one
// table per group, then one row per trial. Void trials (tools not matching
// their group) are listed but not counted. Results: experiments/agent-baseline.md
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
  .sort((a, b) => a.group - b.group || a.label.localeCompare(b.label));

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

console.log(
  row([
    "Group",
    "Arm",
    "Model",
    "Valid",
    "Outcome pass",
    "H1 proof",
    "Timed out",
    "No stop (H4)",
    "Median turns",
    "Median $",
    "Median s",
    "Median tool errors",
  ]),
);
console.log(row(Array(12).fill("---")));
for (const group of [...new Set(trials.map((t) => t.group))]) {
  const all = trials.filter((t) => t.group === group);
  const valid = all.filter((t) => t.valid.ok);
  const first = all[0];
  console.log(
    row([
      group,
      first?.arm ?? "",
      first?.model ?? "",
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
    ]),
  );
}

console.log();
console.log(
  row([
    "Label",
    "Group",
    "Valid",
    "Outcome",
    "H1",
    "Turns",
    "$",
    "s",
    "Void reasons",
  ]),
);
console.log(row(Array(9).fill("---")));
for (const t of trials) {
  console.log(
    row([
      t.label,
      t.group,
      t.valid.ok ? "yes" : "no",
      t.outcome ?? "",
      t.h1 ? "yes" : "no",
      t.result?.numTurns ?? "",
      t.result?.costUsd ?? "",
      seconds(t) ?? "",
      t.valid.reasons.join("; "),
    ]),
  );
}
