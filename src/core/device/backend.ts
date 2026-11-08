import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { firstLine } from "../log.js";
import type { UiNode } from "./screen.js";
import type { Step } from "./step.js";

// Decision 0004: device actions go through backends, and core picks the best
// one that is available on this machine, falling back to the next. Decision
// 0008: an action that changes the app falls back only when it did not act.

export const backendIds = ["axe", "maestro"] as const;
export type BackendId = (typeof backendIds)[number];

// The app a step acts on.
export type App = { device: string; appId: string };

// A tool that can act on a simulator: read the screen, and run a step.
export interface DeviceBackend {
  id: BackendId;
  readScreen(device: string, bin: string): Promise<UiNode[]>;
  // Throws DidNotAct only when the tool's own error proves it did not act.
  act(step: Step, app: App, bin: string): Promise<void>;
}

// An action's error that proves the device was not touched, so the next
// backend may try.
export class DidNotAct extends Error {}

// Where each installed backend's executable was found; absent when not installed.
export type Environment = Partial<Record<BackendId, string>>;

type Fallback = { backend: BackendId; reason: string };

// `fellBack` lists the backends that were tried or skipped first, and why; it
// is absent when the first choice did the work.
type Outcome<T> =
  | { value: T; backend: BackendId; fellBack?: Fallback[] }
  | { error: string; backend?: BackendId; fellBack?: Fallback[] };

// Tries the backends in the order given (best first), skipping any that cannot
// run here. A failed call passes to the next backend only if `mayFallBack`
// says so; otherwise that backend's error is the outcome.
async function firstThatWorks<T>(
  env: Environment,
  backends: DeviceBackend[],
  call: (backend: DeviceBackend, bin: string) => Promise<T>,
  mayFallBack: (error: unknown) => boolean,
): Promise<Outcome<T>> {
  const fellBack: Fallback[] = [];
  const passedOver = () => (fellBack.length > 0 ? { fellBack } : {});
  for (const backend of backends) {
    const bin = env[backend.id];
    if (!bin) {
      fellBack.push({
        backend: backend.id,
        reason: `${backend.id} is not installed`,
      });
      continue;
    }
    try {
      const value = await call(backend, bin);
      return { value, backend: backend.id, ...passedOver() };
    } catch (error) {
      if (!mayFallBack(error)) {
        return {
          error: firstLine(error),
          backend: backend.id,
          ...passedOver(),
        };
      }
      fellBack.push({ backend: backend.id, reason: firstLine(error) });
    }
  }
  return {
    error: fellBack.map((f) => `${f.backend}: ${f.reason}`).join("; "),
    ...passedOver(),
  };
}

// A screen read, and which backend produced it.
export type ScreenRead = {
  nodes: UiNode[];
  backend: BackendId;
  fellBack?: Fallback[];
};

// A read is safe to repeat, so it moves on from any backend that fails.
export async function readScreen(
  device: string,
  env: Environment,
  backends: DeviceBackend[],
): Promise<ScreenRead> {
  const read = await firstThatWorks(
    env,
    backends,
    async (backend, bin) => {
      const nodes = await backend.readScreen(device, bin);
      // Every good read includes the app's root node, so none means the read
      // failed (AXe sometimes reads nothing right after a relaunch).
      if (nodes.length === 0) throw new Error("returned an empty tree");
      return nodes;
    },
    () => true,
  );
  if ("error" in read) {
    throw new Error(`no backend could read the screen (${read.error})`);
  }
  const { value: nodes, ...rest } = read;
  return { nodes, ...rest };
}

// A step, and which backend ran it or failed at it. `error` is set when no
// backend ran it.
export type Act = {
  backend?: BackendId;
  fellBack?: Fallback[];
  error?: string;
};

// A tap, typing or scroll is not safe to repeat (decision 0008): it passes to
// the next backend only when this one is not installed or proves it did not act.
export async function act(
  step: Step,
  app: App,
  env: Environment,
  backends: DeviceBackend[],
): Promise<Act> {
  const done = await firstThatWorks(
    env,
    backends,
    (backend, bin) => backend.act(step, app, bin),
    (error) => error instanceof DidNotAct,
  );
  if ("value" in done) {
    const { value, ...ran } = done;
    return ran;
  }
  return done.backend
    ? done
    : { ...done, error: `no backend could run the step (${done.error})` };
}

function findExecutable(name: string, extraDirs: string[]): string | undefined {
  const dirs = [
    ...(process.env.PATH ?? "").split(delimiter),
    ...extraDirs,
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  for (const dir of dirs) {
    const path = join(dir, name);
    try {
      accessSync(path, constants.X_OK);
      return path;
    } catch {}
  }
  return undefined;
}

export async function detectEnvironment(): Promise<Environment> {
  return {
    axe: findExecutable("axe", []),
    maestro: findExecutable("maestro", [join(homedir(), ".maestro", "bin")]),
  };
}
