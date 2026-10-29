import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { axeBackend } from "./device/axe.js";
import {
  detectEnvironment,
  readScreen,
  type ScreenRead,
} from "./device/backend.js";
import { maestroBackend } from "./device/maestro.js";
import { type ElementSpec, hasElement } from "./device/screen.js";
import { recordCheck } from "./evidence.js";
import { allLines, type LogsOptions, type TaggedLine } from "./logs.js";
import { worktreeKey } from "./owned.js";
import type { CheckResult, LogsResult } from "./result.js";
import { type RunRef, resolveRun } from "./run.js";
import { homeDir, stateDir } from "./state.js";
import { runTool } from "./tool.js";

// A tagged log event the run must have produced: the tag, and optionally text
// its message must contain.
type LogSpec = { tag: string; message?: string };

export type CheckOptions = RunRef & {
  logs?: LogSpec[];
  elements?: ElementSpec[];
  // A label for this check in the evidence bundle. Never part of the count.
  name?: string;
  // The agent's own reading of the screenshot. Second opinion only.
  agentReading?: "pass" | "fail";
};

// What the check reads. The real ones read the simulator; tests pass their own.
export type Deps = {
  logs: (options: Omit<LogsOptions, "limit">) => Promise<LogsResult>;
  screen: (device: string) => Promise<ScreenRead>;
  screenshot: (device: string, path: string) => Promise<boolean>;
};

const realDeps: Deps = {
  logs: allLines,
  screen: async (device) =>
    readScreen(device, await detectEnvironment(), [axeBackend, maestroBackend]),
  screenshot: async (device, path) => {
    try {
      mkdirSync(dirname(path), { recursive: true });
      await runTool(
        "simctl screenshot",
        "xcrun",
        ["simctl", "io", device, "screenshot", path],
        60,
      );
      return true;
    } catch {
      return false;
    }
  },
};

const tagPattern = /^[A-Za-z0-9_.-]{1,40}$/;
const namePattern = /^[A-Za-z0-9_.-]{1,40}$/;
const defaultRetryLimit = 3;
const maxRetryLimit = 10;
const maxSpecs = 20;
const maxText = 200;

// The count is per worktree and lives outside it. Only a pass or a human
// (`emd check reset`) clears it; the agent has no input that does (decision 0006).
const countFile = (key: string) => join(homeDir(), "checks", `${key}.json`);

// 3 unless a human sets EMD_RETRY_LIMIT; never an agent input.
function retryLimit(): number {
  const wanted = Number(process.env.EMD_RETRY_LIMIT);
  return Number.isInteger(wanted) && wanted >= 1 && wanted <= maxRetryLimit
    ? wanted
    : defaultRetryLimit;
}

export function resetChecks(root: string): void {
  rmSync(countFile(worktreeKey(root)), { force: true });
}

function failuresSoFar(key: string): number {
  try {
    const { failures } = JSON.parse(readFileSync(countFile(key), "utf8"));
    return Number.isInteger(failures) && failures > 0 ? failures : 0;
  } catch {
    return 0;
  }
}

function setFailures(key: string, failures: number): void {
  mkdirSync(dirname(countFile(key)), { recursive: true });
  writeFileSync(countFile(key), JSON.stringify({ key, failures }));
}

const firstLine = (error: unknown) => String(error).split("\n")[0] ?? "";

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
  const name = options.name ?? "default";
  if (!namePattern.test(name)) {
    return error(
      "A check name has letters, digits, dot, dash and underscore only.",
    );
  }
  const limit = retryLimit();

  const resolved = resolveRun(options);
  if ("reason" in resolved) return error(resolved.reason);
  const { device, appId, since, root, logDir } = resolved.run;

  // Failed checks count per worktree (or per device and app when no job names
  // one), across relaunches, because a fix usually means launching again.
  const key = root ? worktreeKey(root) : `${device}-${appId}`;
  const before = failuresSoFar(key);
  if (before >= limit) {
    return {
      verdict: "stopped",
      attempt: before,
      retryLimit: limit,
      reason: `${before} failed checks already. Stop retrying and report what is still missing. Only a person can start over (emd check reset).`,
    };
  }

  const ref = {
    jobId: options.jobId,
    device,
    appId,
    since: since.toISOString(),
  };
  const byTag = new Map<string, TaggedLine[]>();
  if (logSpecs.length > 0) {
    report("reading the logs");
    for (const tag of new Set(logSpecs.map((spec) => spec.tag))) {
      const got = await deps.logs({ ...ref, tag });
      if (got.verdict !== "ok") {
        return error(got.reason ?? "Could not read the logs.");
      }
      byTag.set(tag, got.lines ?? []);
    }
  }
  let screen: ScreenRead | undefined;
  if (elementSpecs.length > 0) {
    report("reading the screen");
    try {
      screen = await deps.screen(device);
    } catch (failure) {
      return error(`Could not read the screen: ${firstLine(failure)}`);
    }
  }
  const nodes = screen?.nodes ?? [];

  const logResults = logSpecs.map((spec) => ({
    tag: spec.tag,
    ...(spec.message === undefined ? {} : { message: spec.message }),
    found: (byTag.get(spec.tag) ?? []).some(
      (line) =>
        spec.message === undefined || line.message.includes(spec.message),
    ),
  }));
  const elementResults = elementSpecs.map((spec) => ({
    ...(spec.id === undefined ? {} : { id: spec.id }),
    ...(spec.text === undefined ? {} : { text: spec.text }),
    found: hasElement(nodes, spec),
  }));
  const passed = [...logResults, ...elementResults].every((r) => r.found);

  report("taking a screenshot");
  const shotPath = join(
    logDir ?? join(stateDir(), "checks"),
    `check-${Date.now()}.png`,
  );
  const shot = (await deps.screenshot(device, shotPath)) ? shotPath : undefined;
  const reading = options.agentReading;
  const secondOpinion =
    shot || reading
      ? {
          ...(shot ? { screenshot: shot } : {}),
          ...(reading
            ? { agent: reading, agrees: (reading === "pass") === passed }
            : {}),
        }
      : undefined;
  const evidence = {
    logs: logResults.length > 0 ? logResults : undefined,
    elements: elementResults.length > 0 ? elementResults : undefined,
    // Which backend read the screen, and any it passed over (decision 0004).
    backend: screen?.backend,
    fellBack: screen?.fellBack,
    secondOpinion,
  };

  // Only a check that read something is a check that ran.
  const ran = (result: CheckResult): CheckResult => {
    if (logDir) recordCheck(logDir, name, result);
    return result;
  };

  if (passed) {
    rmSync(countFile(key), { force: true });
    return ran({ verdict: "passed", ...evidence });
  }
  const failures = before + 1;
  setFailures(key, failures);
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
