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

const maxText = 500;

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

export function tap(options: TapOptions): Promise<InputResult> {
  const { id, text, x, y } = options;
  const given = [id, text, x ?? y].filter((v) => v !== undefined).length;
  if (given !== 1 || (x === undefined) !== (y === undefined)) {
    return Promise.resolve({
      verdict: "failed",
      reason: "Give one target: id, text, or both x and y.",
    });
  }
  const badPoint = [x, y].some(
    (n) => n !== undefined && !(n >= 0 && Number.isFinite(n)),
  );
  if ((id ?? text ?? "").length > maxText || badPoint) {
    return Promise.resolve({
      verdict: "failed",
      reason: `An id or text is at most ${maxText} characters; x and y are numbers, 0 or more.`,
    });
  }
  const target: Target =
    id !== undefined
      ? { id }
      : text !== undefined
        ? { text }
        : { x: x ?? 0, y: y ?? 0 };
  return act("tap", options, (b, where, bin) => b.tap(where, bin, target));
}

export function typeText(
  options: RunRef & { text: string },
): Promise<InputResult> {
  const { text } = options;
  if (text.length === 0 || text.length > maxText) {
    return Promise.resolve({
      verdict: "failed",
      reason: `Give 1 to ${maxText} characters to type.`,
    });
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
