import { axeBackend } from "./device/axe.js";
import {
  type DeviceBackend,
  type Direction,
  detectEnvironment,
  directions,
  firstWorking,
  readScreen,
  type Target,
  type Where,
} from "./device/backend.js";
import { maestroBackend } from "./device/maestro.js";
import type { UiNode } from "./device/screen.js";
import { typeUntilShown } from "./device/typing.js";
import { firstLine } from "./log.js";
import type { InputResult } from "./result.js";
import { type RunRef, resolveRun } from "./run.js";

// Taps, typing and swipes on a launched app (decision 0009). Each acts once
// and says which backend did it; whether the app reacted is for `check`.

const backends = [axeBackend, maestroBackend];

type Gesture = (
  backend: DeviceBackend,
  where: Where,
  bin: string,
) => Promise<void>;

type Act = {
  // Sends one gesture through the first backend that works.
  send(gesture: Gesture): Promise<void>;
  read(): Promise<UiNode[]>;
};

// Runs `run` against the launched app. `run` returns extra result fields, or
// a `reason` when it failed.
async function act(
  what: string,
  { jobId }: RunRef,
  run: (io: Act) => Promise<Partial<InputResult>>,
): Promise<InputResult> {
  const resolved = resolveRun({ jobId });
  if ("reason" in resolved)
    return { verdict: "failed", reason: resolved.reason };
  const { device, appId } = resolved.run;
  let first: Pick<InputResult, "backend" | "fellBack"> = {};
  try {
    const env = await detectEnvironment();
    const extra = await run({
      send: async (gesture) => {
        const { backend, fellBack } = await firstWorking(
          what,
          env,
          backends,
          (b, bin) => gesture(b, { device, appId }, bin),
        );
        if (!first.backend) {
          first = { backend, ...(fellBack ? { fellBack } : {}) };
        }
      },
      read: () => readScreen(device, env, backends).then((r) => r.nodes),
    });
    return { verdict: extra.reason ? "failed" : "ok", ...first, ...extra };
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
  const done = act("tap", options, ({ send }) =>
    send((b, where, bin) => b.tap(where, bin, target)).then(() => ({})),
  );
  if ("x" in target) return done;
  // The backends wait for an element: AXe up to 10 s, Maestro its own limit.
  return done.then((result) => ({
    ...result,
    seconds: Math.round((Date.now() - started) / 100) / 10,
  }));
}

export function typeText(
  options: RunRef & { text: string },
): Promise<InputResult> {
  const { text } = options;
  if (text.length === 0) {
    return Promise.resolve({ verdict: "failed", reason: "Give text to type." });
  }
  // `ok` means the text shows on screen (issue 163, decision 0013). Tap and
  // swipe cannot say that.
  return act("type", options, async ({ send, read }) => {
    const typed = await typeUntilShown(
      {
        type: (part) => send((b, where, bin) => b.type(where, bin, part)),
        read,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      },
      text,
    );
    return {
      seconds: typed.seconds,
      ...(typed.retyped ? { retyped: typed.retyped } : {}),
      ...(typed.verdict === "failed" ? { reason: typed.reason } : {}),
      ...(typed.verdict === "secure"
        ? {
            note: "Secure field: bullets grew by the text length; the text itself cannot be read.",
          }
        : {}),
    };
  });
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
  return act("swipe", options, ({ send }) =>
    send((b, where, bin) => b.swipe(where, bin, direction)).then(() => ({})),
  );
}
