import { axeBackend } from "./device/axe.js";
import {
  type DeviceBackend,
  type Direction,
  detectEnvironment,
  directions,
  firstWorking,
  type Target,
  type Where,
} from "./device/backend.js";
import { maestroBackend } from "./device/maestro.js";
import { firstLine } from "./log.js";
import type { InputResult } from "./result.js";
import { type RunRef, resolveRun } from "./run.js";

// Taps, typing and swipes on a launched app (decision 0009). Each acts once
// and says which backend did it; whether the app reacted is for `check`.

async function act(
  what: string,
  { jobId }: RunRef,
  gesture: (backend: DeviceBackend, where: Where, bin: string) => Promise<void>,
): Promise<InputResult> {
  const resolved = resolveRun({ jobId });
  if ("reason" in resolved)
    return { verdict: "failed", reason: resolved.reason };
  const where = { device: resolved.run.device, appId: resolved.run.appId };
  try {
    const { backend, fellBack } = await firstWorking(
      what,
      await detectEnvironment(),
      [axeBackend, maestroBackend],
      (b, bin) => gesture(b, where, bin),
    );
    return { verdict: "ok", backend, ...(fellBack ? { fellBack } : {}) };
  } catch (error) {
    return { verdict: "failed", reason: firstLine(error) };
  }
}

export type TapOptions = RunRef & {
  id?: string;
  text?: string;
  x?: number;
  y?: number;
};

// One target: an id, a text, or a point (x and y together).
function targetOf({ id, text, x, y }: TapOptions): Target | undefined {
  const given = [id, text, x, y].filter((v) => v !== undefined).length;
  if (id !== undefined && given === 1) return { id };
  if (text !== undefined && given === 1) return { text };
  if (x !== undefined && y !== undefined && given === 2) return { x, y };
  return undefined;
}

export function tap(options: TapOptions): Promise<InputResult> {
  const target = targetOf(options);
  if (!target) {
    return Promise.resolve({
      verdict: "failed",
      reason: "Give one target: id, text, or both x and y.",
    });
  }
  const started = Date.now();
  const done = act("tap", options, (b, where, bin) =>
    b.tap(where, bin, target),
  );
  if ("x" in target) return done;
  // The backends wait for an element: AXe up to 10 s, Maestro its own limit.
  return done.then((result) => {
    const seconds = Math.round((Date.now() - started) / 100) / 10;
    if (result.verdict === "ok") return { ...result, seconds };
    if (!result.reason?.includes("no backend could tap")) return result;
    const element =
      "id" in target ? `id "${target.id}"` : `text "${target.text}"`;
    return {
      ...result,
      seconds,
      reason: `Element ${element} did not appear in ${seconds} s. Nothing was tapped. ${result.reason}`,
    };
  });
}

export function typeText(
  options: RunRef & { text: string },
): Promise<InputResult> {
  const { text } = options;
  if (text.length === 0) {
    return Promise.resolve({ verdict: "failed", reason: "Give text to type." });
  }
  return act("type", options, (b, where, bin) => b.type(where, bin, text));
}

const isDirection = (value: string): value is Direction =>
  (directions as readonly string[]).includes(value);

export function swipe(
  options: RunRef & { direction: string },
): Promise<InputResult> {
  const { direction } = options;
  if (!isDirection(direction)) {
    return Promise.resolve({
      verdict: "failed",
      reason: `Give a direction: ${directions.join(", ")}.`,
    });
  }
  return act("swipe", options, (b, where, bin) =>
    b.swipe(where, bin, direction),
  );
}
