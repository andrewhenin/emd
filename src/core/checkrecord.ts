import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ElementSpec } from "./device/screen.js";
import { worktreeKey } from "./owned.js";
import type { CheckResult } from "./result.js";
import { homeDir } from "./state.js";

// A tagged log event the run must have produced: the tag, and optionally text
// its message must contain.
export type LogSpec = { tag: string; message?: string };
export type Expected = { logs: LogSpec[]; elements: ElementSpec[] };

// Per worktree and outside it: the failed-check count, and for each check
// name its first expectations and its last verdict (decisions 0006, 0010).
// The agent has no input that clears it: a pass starts only the count over;
// `emd check reset` and `gc` remove the whole record.
type CheckRecord = {
  failures: number;
  names: Record<string, { expected: Expected; last: CheckResult["verdict"] }>;
};

const recordFile = (key: string) => join(homeDir(), "checks", `${key}.json`);

export function readRecord(key: string): CheckRecord {
  try {
    const { failures, names } = JSON.parse(
      readFileSync(recordFile(key), "utf8"),
    );
    return {
      failures: Number.isInteger(failures) && failures > 0 ? failures : 0,
      names: typeof names === "object" && names !== null ? names : {},
    };
  } catch {
    return { failures: 0, names: {} };
  }
}

export function writeRecord(key: string, record: CheckRecord): void {
  mkdirSync(dirname(recordFile(key)), { recursive: true });
  writeFileSync(recordFile(key), JSON.stringify(record));
}

export function resetChecks(root: string): void {
  rmSync(recordFile(worktreeKey(root)), { force: true });
}

// Each first expectation that the new ones leave out or change, in words.
export function dropped(first: Expected, now: Expected): string[] {
  const logs = first.logs
    .filter(
      (a) => !now.logs.some((b) => b.tag === a.tag && b.message === a.message),
    )
    .map(({ tag, message }) =>
      message === undefined ? `log ${tag}` : `log ${tag} "${message}"`,
    );
  const elements = first.elements
    .filter(
      (a) => !now.elements.some((b) => b.id === a.id && b.text === a.text),
    )
    .map(
      ({ id, text }) =>
        `element${id === undefined ? "" : ` id=${id}`}${text === undefined ? "" : ` text "${text}"`}`,
    );
  return [...logs, ...elements];
}
