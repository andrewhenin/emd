import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  dropped,
  type Expected,
  type LogSpec,
  readRecord,
  writeRecord,
} from "./checkrecord.js";
import { axeBackend } from "./device/axe.js";
import {
  detectEnvironment,
  readScreen,
  type ScreenRead,
} from "./device/backend.js";
import { maestroBackend } from "./device/maestro.js";
import { type ElementSpec, hasElement } from "./device/screen.js";
import { recordCheck } from "./evidence.js";
import { firstLine } from "./log.js";
import {
  allLines,
  type LogsOptions,
  type TaggedLine,
  tagPattern,
} from "./logs.js";
import { worktreeKey } from "./owned.js";
import type { CheckResult, LogsResult } from "./result.js";
import { type RunRef, resolveRun } from "./run.js";
import { runTool } from "./tool.js";

export type CheckOptions = RunRef & {
  logs?: LogSpec[];
  elements?: ElementSpec[];
  // The moment this check covers, and its label in the evidence bundle. Its
  // first expectations are recorded, and a later check under the name must
  // keep them (decision 0010). Never part of the count.
  name?: string;
  // The agent's own reading of the screenshot. Second opinion only.
  agentReading?: "pass" | "fail";
};

// What the check reads. The real ones read the simulator; tests pass their own.
export type Deps = {
  logs: (options: Omit<LogsOptions, "limit">) => Promise<LogsResult>;
  screen: (device: string) => Promise<ScreenRead>;
  // Undefined when the screenshot was saved, otherwise why not, in one line.
  screenshot: (device: string, path: string) => Promise<string | undefined>;
  // How long a check reads again before it fails (#140).
  recheckSeconds: number;
};

const realDeps: Deps = {
  // Measured by the result's `waited` in the e2e log. A tap through AXe
  // returns at once, and in 2 of 2 e2e runs the check after it waited 5 s.
  recheckSeconds: 10,
  logs: allLines,
  screen: async (device) =>
    readScreen(device, await detectEnvironment(), [axeBackend, maestroBackend]),
  screenshot: async (device, path) => {
    mkdirSync(dirname(path), { recursive: true });
    const shoot = (extra: string[]) =>
      runTool(
        "simctl screenshot",
        "xcrun",
        ["simctl", "io", device, "screenshot", ...extra, path],
        60,
      );
    const attempt = (extra: string[]) =>
      shoot(extra).then(
        () => undefined,
        (error: unknown) => String(error),
      );
    const first = await attempt([]);
    // Xcode 27 simulators have two displays and simctl asks which one.
    // The one it names "(primary)" shows the app (#142).
    const display = first === undefined ? undefined : primaryDisplay(first);
    const error =
      display === undefined ? first : await attempt([`--display=${display}`]);
    return error === undefined ? undefined : lastLine(error);
  },
};

// From simctl's "Specify one with --display" list, the display named
// "(primary)", not "(primary-1)".
export const primaryDisplay = (message: string): string | undefined =>
  /--display=(\d+)\s.*\(primary\)/m.exec(message)?.[1];

const lastLine = (error: string): string =>
  `simctl screenshot: ${error.trim().split("\n").at(-1)?.trim() ?? ""}`;

const defaultRetryLimit = 3;
const maxRetryLimit = 10;
const maxSpecs = 20;
const maxText = 200;
const maxName = 40;

// 3 unless a human sets EMD_RETRY_LIMIT; never an agent input.
function retryLimit(): number {
  const wanted = Number(process.env.EMD_RETRY_LIMIT);
  return Number.isInteger(wanted) && wanted >= 1 && wanted <= maxRetryLimit
    ? wanted
    : defaultRetryLimit;
}

// Independent pass or fail from machine-checkable signals: the tagged log
// events the run wrote and the elements on the simulator's screen. It counts
// failed checks per worktree, so fix-and-retry stops at the retry limit.
export async function check(
  options: CheckOptions,
  report: (step: string) => void = () => {},
  deps: Deps = realDeps,
): Promise<CheckResult> {
  const error = (reason: string): CheckResult => ({ verdict: "error", reason });
  const logSpecs = options.logs ?? [];
  const elementSpecs = options.elements ?? [];

  if (logSpecs.length + elementSpecs.length === 0) {
    return error("Give at least one expectation: logs or elements.");
  }
  if (logSpecs.length > maxSpecs || elementSpecs.length > maxSpecs) {
    return error(`At most ${maxSpecs} expectations of each kind.`);
  }
  for (const spec of logSpecs) {
    if (!tagPattern.test(spec.tag) || (spec.message?.length ?? 0) > maxText) {
      return error(
        `A log expectation needs a tag (letters, digits, dot, dash, underscore) and a message of at most ${maxText} characters.`,
      );
    }
  }
  for (const spec of elementSpecs) {
    const lengths = [spec.id?.length ?? 0, spec.text?.length ?? 0];
    if (
      (spec.id === undefined && spec.text === undefined) ||
      lengths.some((n) => n > maxText)
    ) {
      return error(
        `An element expectation needs an id or a text, each at most ${maxText} characters.`,
      );
    }
  }
  // Any other character is stored as a dash, so an agent's first name works.
  const name =
    (options.name ?? "").replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, maxName) ||
    "default";
  const limit = retryLimit();

  const resolved = resolveRun(options);
  if ("reason" in resolved) return error(resolved.reason);
  const { device, root, logDir } = resolved.run;

  // Failed checks count per worktree, across relaunches, because a fix
  // usually means launching again.
  const key = worktreeKey(root);
  const record = readRecord(key);
  const before = record.failures;
  if (before >= limit) {
    return {
      verdict: "stopped",
      attempt: before,
      retryLimit: limit,
      reason: `${before} failed checks already. Stop retrying and report what is still missing. Only a person can start over (emd check reset).`,
    };
  }

  // A name's first expectations are its bar: a later check under the name
  // can add to them but not drop or change one (decision 0010).
  const expected: Expected = { logs: logSpecs, elements: elementSpecs };
  const first = record.names[name]?.expected;
  const missing = first ? dropped(first, expected) : [];
  if (missing.length > 0) {
    return error(
      `Check "${name}" first expected: ${missing.join("; ")}. Keep each of these unchanged; you can add more. For a different moment, use a new name. Only a person can clear this (emd check reset).`,
    );
  }

  const byTag = new Map<string, TaggedLine[]>();
  const readLogs = async (): Promise<string | undefined> => {
    for (const tag of new Set(logSpecs.map((spec) => spec.tag))) {
      const got = await deps.logs({ jobId: options.jobId, tag });
      if (got.verdict !== "ok") return got.reason ?? "Could not read the logs.";
      byTag.set(tag, got.lines ?? []);
    }
  };
  let screen: ScreenRead | undefined;
  const readTheScreen = async (): Promise<string | undefined> => {
    try {
      screen = await deps.screen(device);
    } catch (failure) {
      return `Could not read the screen: ${firstLine(failure)}`;
    }
  };
  const judge = () => {
    const logs = logSpecs.map((spec) => ({
      tag: spec.tag,
      ...(spec.message === undefined ? {} : { message: spec.message }),
      found: (byTag.get(spec.tag) ?? []).some(
        (line) =>
          spec.message === undefined || line.message.includes(spec.message),
      ),
    }));
    const elements = elementSpecs.map((spec) => ({
      ...(spec.id === undefined ? {} : { id: spec.id }),
      ...(spec.text === undefined ? {} : { text: spec.text }),
      found: hasElement(screen?.nodes ?? [], spec),
    }));
    return { logs, elements };
  };

  // Read, then read again what is still missing until the limit, so a check
  // run a moment after an action doesn't fail on a line still on its way.
  const started = Date.now();
  let logResults: ReturnType<typeof judge>["logs"] = [];
  let elementResults: ReturnType<typeof judge>["elements"] = [];
  for (let first = true; ; first = false) {
    const logsMissing = first || logResults.some((r) => !r.found);
    const screenMissing = first || elementResults.some((r) => !r.found);
    if (logSpecs.length > 0 && logsMissing) {
      report(first ? "reading the logs" : "reading the logs again");
      const failure = await readLogs();
      if (failure) return error(failure);
    }
    if (elementSpecs.length > 0 && screenMissing) {
      report(first ? "reading the screen" : "reading the screen again");
      const failure = await readTheScreen();
      if (failure) return error(failure);
    }
    ({ logs: logResults, elements: elementResults } = judge());
    const missing = [...logResults, ...elementResults].some((r) => !r.found);
    if (!missing || Date.now() - started >= deps.recheckSeconds * 1000) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const waited = Math.round((Date.now() - started) / 1000);
  const nodes = screen?.nodes ?? [];
  const passed = [...logResults, ...elementResults].every((r) => r.found);

  report("taking a screenshot");
  const stamp = Date.now();
  const shotPath = join(logDir, `check-${stamp}.png`);
  const shotError = await deps.screenshot(device, shotPath);
  const shot = shotError === undefined ? shotPath : undefined;
  // What the screen reader got, next to the screenshot, for when they disagree.
  if (screen) {
    mkdirSync(logDir, { recursive: true });
    writeFileSync(join(logDir, `screen-${stamp}.json`), JSON.stringify(nodes));
  }
  const reading = options.agentReading;
  const secondOpinion = {
    ...(shot ? { screenshot: shot } : { screenshotError: shotError }),
    ...(reading
      ? { agent: reading, agrees: (reading === "pass") === passed }
      : {}),
  };
  const evidence = {
    ...(waited > 0 ? { waited } : {}),
    logs: logResults.length > 0 ? logResults : undefined,
    elements: elementResults.length > 0 ? elementResults : undefined,
    // Which backend read the screen, and any it passed over (decision 0004).
    backend: screen?.backend,
    fellBack: screen?.fellBack,
    secondOpinion,
  };

  // Only a check that read something is a check that ran. It sets the count
  // (a pass starts it over) and the name's last verdict.
  const ran = (result: CheckResult): CheckResult => {
    recordCheck(logDir, name, result);
    writeRecord(key, {
      failures: result.verdict === "passed" ? 0 : before + 1,
      names: {
        ...record.names,
        [name]: { expected: first ?? expected, last: result.verdict },
      },
    });
    return result;
  };

  if (passed) return ran({ verdict: "passed", ...evidence });
  const failures = before + 1;
  const stopped = failures >= limit;
  return ran({
    verdict: stopped ? "stopped" : "failed",
    attempt: failures,
    retryLimit: limit,
    reason: stopped
      ? `${failures} failed checks. Stop retrying and report what is missing.`
      : `${failures} of ${limit} attempts used. Fix the cause and check again.`,
    ...evidence,
  });
}
