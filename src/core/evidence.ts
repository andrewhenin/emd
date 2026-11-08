import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { type LogsOptions, logs as readLogs } from "./logs.js";
import { inspectProject } from "./project.js";
import type { CheckResult, EvidenceResult, LogsResult } from "./result.js";
import { type RunRef, resolveRun } from "./run.js";
import type { SavedSteps } from "./steps.js";

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

// Each `steps` call writes a steps-<ms> folder in the run's folder (steps.ts).
// Oldest first, by that number. A folder without a readable steps.json is
// still running, or its run stopped before the end, so it is left out.
function savedSteps(logDir: string): { name: string; saved: SavedSteps }[] {
  const found: { ms: number; name: string; saved: SavedSteps }[] = [];
  for (const name of readdirSync(logDir)) {
    const ms = /^steps-(\d+)$/.exec(name)?.[1];
    if (!ms) continue;
    let saved: SavedSteps;
    try {
      const file = join(logDir, name, "steps.json");
      saved = JSON.parse(readFileSync(file, "utf8")) as SavedSteps;
    } catch {
      continue;
    }
    found.push({ ms: Number(ms), name, saved });
  }
  return found.sort((a, b) => a.ms - b.ms);
}

// The layout is part of the tool result, so no agent has to look it up.
const layout = {
  "manifest.json":
    "The run, every check that ran with its result, every step that ran with its result, and the files below.",
  "logs.json": "Tagged log lines the app wrote during the run, oldest first.",
  "screenshots/": "The screenshot each check took, named as in the manifest.",
  "flows/": "The project's Maestro flow files, copied as they are.",
  "steps/":
    "One folder per steps call, oldest first, copied as it is: flow.yaml (replays the steps), a screenshot per step, steps.json (every log line per step).",
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

  const lines = await deps.logs({ jobId: ref.jobId, limit: 500 });
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
  for (const flow of (await inspectProject(root)).maestroFlows ?? []) {
    mkdirSync(join(dir, "flows"), { recursive: true });
    copyFileSync(join(root, flow), join(dir, "flows", basename(flow)));
    flows.push(`flows/${basename(flow)}`);
  }

  // Each step points into its folder's copy; its lines stay in steps.json.
  const steps = savedSteps(logDir).map(({ name, saved }) => {
    const folder = `steps/${name}`;
    mkdirSync(join(dir, folder), { recursive: true });
    for (const file of readdirSync(join(logDir, name))) {
      copyFileSync(join(logDir, name, file), join(dir, folder, file));
    }
    return {
      dir: folder,
      // Unset fields (backend, fellBack, screenshot, error) drop out of the JSON.
      steps: saved.steps.map((s) => ({
        step: s.step,
        result: s.error ? "failed" : "ran",
        backend: s.backend,
        fellBack: s.fellBack,
        start: s.start,
        end: s.end,
        screenshot: s.screenshot && `${folder}/${s.screenshot}`,
        total: s.lines.length,
        error: s.error,
      })),
    };
  });

  const logLines = lines.lines ?? [];
  writeFileSync(join(dir, "logs.json"), JSON.stringify(logLines, null, 2));
  const manifest = {
    run: {
      jobId: ref.jobId,
      device,
      appId,
      since: since.toISOString(),
      root,
    },
    checks,
    logs: { file: "logs.json", total: lines.total ?? logLines.length },
    screenshots,
    flows,
    steps,
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
    steps: steps.flatMap((s) => s.steps).length,
  };
}
