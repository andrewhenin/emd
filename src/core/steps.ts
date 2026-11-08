import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { axeBackend } from "./device/axe.js";
import {
  detectEnvironment,
  readScreen,
  type Tap,
  tap,
} from "./device/backend.js";
import { maestroBackend } from "./device/maestro.js";
import { hasElement } from "./device/screen.js";
import {
  type Clock,
  type Read,
  type ScreenState,
  waitForSettle,
  waitForStill,
} from "./device/settle.js";
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

// After the last step: time for the log stream to write the lines the app
// wrote before it settled. One e2e run measured 0.7 s (decision 0008).
const deliveryMs = 2000;
const newestLines = 5;

const clock: Clock = { now: Date.now, sleep };

type Ran = Tap & {
  step: Step;
  start: number;
  settled: number;
  screen?: ScreenState;
  shot?: string;
};

// Runs the steps in order on a launched run's app. Around each action it
// waits for the app (decision 0008), then takes a screenshot. A step's tagged
// lines run from its action to the next step's action; the last step's, to
// its settle plus the delivery wait. The first failed step ends the run.
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
  // Only AXe reads fast enough to wait with (a Maestro read takes ~30 s).
  const read: Read | undefined = env.axe
    ? async () => {
        try {
          return (await readScreen(device, env, [axeBackend])).nodes;
        } catch {
          return undefined;
        }
      }
    : undefined;
  const ran: Ran[] = [];
  let last: Awaited<ReturnType<Read>>;
  for (const [i, step] of asked.entries()) {
    report(`step ${i + 1} of ${asked.length}`);
    const target = targetOf(step);
    const before = await waitForStill(
      read,
      (nodes) => hasElement(nodes, target),
      clock,
      last,
    );
    const start = Date.now();
    const done = await tap(target, { device, appId }, env, [
      axeBackend,
      maestroBackend,
    ]);
    const after = done.error
      ? undefined
      : await waitForSettle(read, before, clock);
    last = after?.last;
    const settled = Date.now();
    const file = `${String(i + 1).padStart(2, "0")}.png`;
    const shot = (await screenshot(device, join(dir, file))) ? file : undefined;
    ran.push({ ...done, step, start, settled, screen: after?.screen, shot });
    if (done.error) break;
  }
  await sleep(deliveryMs);

  const all = (await allLines({ jobId: options.jobId })).lines ?? [];
  const end = Date.now();
  const during = (from: number, to: number): TaggedLine[] =>
    all.filter((line) => {
      const at = Date.parse(line.time);
      return at >= from && at < to;
    });
  const windows = ran.map((r, i) => during(r.start, ran[i + 1]?.start ?? end));

  const iso = (ms: number) => new Date(ms).toISOString();
  writeFileSync(
    join(dir, "steps.json"),
    JSON.stringify(
      {
        run: { jobId: options.jobId, device, appId },
        steps: ran.map(({ shot, start, settled, ...r }, i) => ({
          ...r,
          start: iso(start),
          settled: iso(settled),
          screenshot: shot,
          lines: windows[i],
        })),
      },
      null,
      2,
    ),
  );

  const results = ran.map(
    ({ step, backend, fellBack, error, start, settled, screen, shot }, i) => {
      const lines = windows[i] ?? [];
      return {
        step,
        ...(backend ? { backend } : {}),
        ...(fellBack ? { fellBack } : {}),
        seconds: Math.round((settled - start) / 100) / 10,
        ...(screen ? { screen } : {}),
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
