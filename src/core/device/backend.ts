import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { firstLine } from "../log.js";
import { axeDir } from "./axe.js";
import type { UiNode } from "./screen.js";

// Decision 0004: device actions go through backends, and core picks the best
// one that is available on this machine, falling back to the next. Tap, type
// and swipe joined reading the screen in decision 0009.

export const backendIds = ["axe", "maestro"] as const;
export type BackendId = (typeof backendIds)[number];

// What to act on: an element by testID or by visible text or label, or a point.
export type Target =
  | { id: string }
  | { text: string }
  | { x: number; y: number };

// The way the finger moves: "up" shows what is further down.
export const directions = ["up", "down", "left", "right"] as const;
export type Direction = (typeof directions)[number];

// The app a gesture goes to. Maestro's flows name the app; AXe only the device.
export type Where = { device: string; appId: string };

// A tool that can act on a simulator: read its screen, tap, type and swipe.
export interface DeviceBackend {
  id: BackendId;
  readScreen(device: string, bin: string): Promise<UiNode[]>;
  tap(where: Where, bin: string, target: Target): Promise<void>;
  type(where: Where, bin: string, text: string): Promise<void>;
  swipe(where: Where, bin: string, direction: Direction): Promise<void>;
}

// Where each installed backend's executable was found; absent when not installed.
export type Environment = Partial<Record<BackendId, string>>;

type Fallback = { backend: BackendId; reason: string };

// An action's outcome, and which backend produced it. `fellBack` lists the
// backends that were tried or skipped first, and why; it is absent when the
// first choice did the work.
export type Acted<T> = { value: T; backend: BackendId; fellBack?: Fallback[] };

// Tries the backends in the order given (best first), skipping any that cannot
// run here and moving on from any that fails, and says which one answered.
export async function firstWorking<B extends { id: BackendId }, T>(
  what: string,
  env: Environment,
  backends: B[],
  act: (backend: B, bin: string) => Promise<T>,
): Promise<Acted<T>> {
  const fellBack: Fallback[] = [];
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
      const value = await act(backend, bin);
      return {
        value,
        backend: backend.id,
        ...(fellBack.length > 0 ? { fellBack } : {}),
      };
    } catch (error) {
      fellBack.push({ backend: backend.id, reason: firstLine(error) });
    }
  }
  throw new Error(
    `no backend could ${what} (${fellBack.map((f) => `${f.backend}: ${f.reason}`).join("; ")})`,
  );
}

// A screen read, and which backend produced it.
export type ScreenRead = Omit<Acted<UiNode[]>, "value"> & { nodes: UiNode[] };

export async function readScreen(
  device: string,
  env: Environment,
  backends: Pick<DeviceBackend, "id" | "readScreen">[],
): Promise<ScreenRead> {
  const { value, ...rest } = await firstWorking(
    "read the screen",
    env,
    backends,
    async (backend, bin) => {
      const nodes = await backend.readScreen(device, bin);
      // Every good read includes the app's root node, so none means the read
      // failed (AXe sometimes reads nothing right after a relaunch).
      if (nodes.length === 0) throw new Error("returned an empty tree");
      return nodes;
    },
  );
  return { nodes: value, ...rest };
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
    axe: findExecutable("axe", [axeDir()]),
    maestro: findExecutable("maestro", [join(homedir(), ".maestro", "bin")]),
  };
}
