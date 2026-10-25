import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { detect } from "./detect.js";
import { type LogsOptions, logs as readLogs } from "./logs.js";
import type { CheckResult, EvidenceResult, LogsResult } from "./result.js";
import { type RunRef, resolveRun } from "./run.js";

// Every check that ran against a run is appended here, in the run's folder, so
// the bundle lists what was checked and nothing else.
const checksFile = (logDir: string) => join(logDir, "checks.jsonl");

type Recorded = { time: string; name: string; result: CheckResult };

export function recordCheck(
  logDir: string,
  name: string,
  result: CheckResult,
): void {
  mkdirSync(logDir, { recursive: true });
  const line: Recorded = { time: new Date().toISOString(), name, result };
  appendFileSync(checksFile(logDir), `${JSON.stringify(line)}\n`);
}

function recordedChecks(logDir: string): Recorded[] {
  try {
    return readFileSync(checksFile(logDir), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Recorded);
  } catch {
    return [];
  }
}

// The layout is part of the tool result, so no agent has to look it up.
const layout = {
  "manifest.json":
    "The run, every check that ran with its result, and the files below.",
  "logs.json": "Tagged log lines the app wrote during the run, oldest first.",
  "screenshots/": "The screenshot each check took, named as in the manifest.",
  "flows/": "The project's Maestro flow files, copied as they are.",
};

type Deps = {
  logs: (options: LogsOptions) => Promise<LogsResult>;
};

// Gathers a run's evidence into <run folder>/evidence. Nothing is timestamped
// with the time of writing, so the same run gives the same bundle.
export async function evidence(
  ref: RunRef,
  deps: Deps = { logs: readLogs },
): Promise<EvidenceResult> {
  const failed = (reason: string): EvidenceResult => ({
    verdict: "failed",
    reason,
  });
  const resolved = resolveRun(ref);
  if ("reason" in resolved) return failed(resolved.reason);
  const { device, appId, since, root, logDir } = resolved.run;
  if (!logDir) return failed("Give the jobId of a launch job.");

  const lines = await deps.logs({
    jobId: ref.jobId,
    device,
    appId,
    since: since.toISOString(),
    limit: 500,
  });
  if (lines.verdict !== "ok") {
    return failed(lines.reason ?? "Could not read the logs.");
  }

  const dir = join(logDir, "evidence");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "screenshots"), { recursive: true });

  const screenshots: string[] = [];
  const checks = recordedChecks(logDir).map(({ time, name, result }) => {
    const shot = result.secondOpinion?.screenshot;
    if (!shot || !existsSync(shot)) return { time, name, result };
    const file = `screenshots/${basename(shot)}`;
    copyFileSync(shot, join(dir, file));
    screenshots.push(file);
    return {
      time,
      name,
      result: {
        ...result,
        secondOpinion: { ...result.secondOpinion, screenshot: file },
      },
    };
  });

  const flows: string[] = [];
  if (root) {
    for (const flow of (await detect(root)).maestroFlows ?? []) {
      mkdirSync(join(dir, "flows"), { recursive: true });
      copyFileSync(join(root, flow), join(dir, "flows", basename(flow)));
      flows.push(`flows/${basename(flow)}`);
    }
  }

  const logLines = lines.lines ?? [];
  writeFileSync(join(dir, "logs.json"), JSON.stringify(logLines, null, 2));
  const manifest = {
    run: {
      ...(ref.jobId ? { jobId: ref.jobId } : {}),
      device,
      appId,
      since: since.toISOString(),
      ...(root ? { root } : {}),
    },
    checks,
    logs: { file: "logs.json", total: lines.total ?? logLines.length },
    screenshots,
    flows,
  };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));

  return {
    verdict: "written",
    dir,
    layout,
    checks: checks.length,
    logLines: logLines.length,
    screenshots: screenshots.length,
    flows: flows.length,
  };
}
