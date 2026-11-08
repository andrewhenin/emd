import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { axeBackend } from "./device/axe.js";
import { detectEnvironment, type Tap, tap } from "./device/backend.js";
import { maestroBackend } from "./device/maestro.js";
import {
  maestroFlow,
  type Step,
  stepsHelp,
  stepsSchema,
  targetOf,
} from "./device/step.js";
import { allLines, capturePath, type TaggedLine } from "./logs.js";
import type { StepsResult } from "./result.js";
import { type RunRef, resolveRun } from "./run.js";
import { screenshot } from "./simulator.js";

export type StepsOptions = RunRef & { steps: Step[] };

// After each step, before its screenshot: time for the app to react. After
// the last step: time for the log stream to write the step's lines. Both are
// guesses; e2e logs the real delay (decision 0008).
const settleMs = 1000;
const flushMs = 1000;
const newestLines = 5;

type Ran = Tap & { step: Step; start: number; end: number; shot?: string };

// What steps.json holds: every step that ran, with all its lines. `evidence`
// reads it with this type.
export type SavedSteps = {
  run: { jobId: string; device: string; appId: string };
  steps: (Tap & {
    step: Step;
    start: string;
    end: string;
    screenshot?: string;
    lines: TaggedLine[];
  })[];
};

// Runs the steps in order on a launched run's app. Each step gets a
// screenshot and the tagged lines the app wrote from its start to the next
// step's start. The first failed step ends the run.
export async function steps(
  options: StepsOptions,
  report: (step: string) => void = () => {},
): Promise<StepsResult> {
  const error = (reason: string): StepsResult => ({ verdict: "error", reason });
  const parsed = stepsSchema.safeParse(options.steps);
  if (!parsed.success) return error(stepsHelp);
  const asked = parsed.data;

  const resolved = resolveRun(options);
  if ("reason" in resolved) return error(resolved.reason);
  const { device, appId, logDir } = resolved.run;
  if (!existsSync(capturePath(logDir))) {
    return error("This run has no captured log.");
  }

  const dir = join(logDir, `steps-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "flow.yaml"), maestroFlow(appId, asked));

  const env = await detectEnvironment();
  const ran: Ran[] = [];
  for (const [i, step] of asked.entries()) {
    report(`step ${i + 1} of ${asked.length}`);
    const start = Date.now();
    const done = await tap(targetOf(step), { device, appId }, env, [
      axeBackend,
      maestroBackend,
    ]);
    await sleep(settleMs);
    const file = `${String(i + 1).padStart(2, "0")}.png`;
    const shot = (await screenshot(device, join(dir, file))) ? file : undefined;
    ran.push({ ...done, step, start, end: Date.now(), shot });
    if (done.error) break;
  }
  await sleep(flushMs);

  const all = (await allLines({ jobId: options.jobId })).lines ?? [];
  const end = Date.now();
  const during = (from: number, to: number): TaggedLine[] =>
    all.filter((line) => {
      const at = Date.parse(line.time);
      return at >= from && at < to;
    });
  const windows = ran.map((r, i) => during(r.start, ran[i + 1]?.start ?? end));

  const iso = (ms: number) => new Date(ms).toISOString();
  const saved: SavedSteps = {
    run: { jobId: options.jobId, device, appId },
    steps: ran.map(({ shot, start, end: stop, ...r }, i) => ({
      ...r,
      start: iso(start),
      end: iso(stop),
      screenshot: shot,
      lines: windows[i] ?? [],
    })),
  };
  writeFileSync(join(dir, "steps.json"), JSON.stringify(saved, null, 2));

  const results = ran.map(
    ({ step, backend, fellBack, error, start, end: stop, shot }, i) => {
      const lines = windows[i] ?? [];
      return {
        step,
        ...(backend ? { backend } : {}),
        ...(fellBack ? { fellBack } : {}),
        seconds: Math.round((stop - start) / 100) / 10,
        ...(shot ? { screenshot: shot } : {}),
        total: lines.length,
        lines: lines.slice(-newestLines),
        ...(error ? { error } : {}),
      };
    },
  );
  const failed = ran.findIndex((r) => r.error);
  if (failed < 0) return { verdict: "ran", dir, steps: results };
  const notRun = asked.length - failed - 1;
  return {
    verdict: "failed",
    reason: `Step ${failed + 1} failed${notRun > 0 ? `; the ${notRun} after it did not run` : ""}.`,
    dir,
    steps: results,
  };
}
