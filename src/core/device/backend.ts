import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { sdkTool } from "../emulator.js";
import { firstLine } from "../log.js";
import { axeDir } from "./axe.js";
import type { UiNode } from "./screen.js";

// Decision 0004: device actions go through backends, and core picks the best
// one that is available on this machine, falling back to the next. Tap, type
// and swipe joined reading the screen in decision 0009.

export const backendIds = ["axe", "maestro", "adb"] as const;
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

// A tool that can act on a simulator or emulator: read its screen, tap, type
// and swipe.
export interface DeviceBackend {
  id: BackendId;
  // `seconds`, when given, replaces the backend's own limit for the call.
  readScreen(device: string, bin: string, seconds?: number): Promise<UiNode[]>;
  tap(where: Where, bin: string, target: Target): Promise<void>;
  type(
    where: Where,
    bin: string,
    text: string,
    seconds?: number,
  ): Promise<void>;
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

// Seconds left until `until` (a Date.now() time), for one backend's call. When
// none are left, it throws, so no backend starts after a caller's deadline.
export function secondsTo(until: number): number {
  const seconds = (until - Date.now()) / 1000;
  if (seconds <= 0) throw new Error("no time left");
  return seconds;
}

// A screen read, and which backend produced it.
export type ScreenRead = Omit<Acted<UiNode[]>, "value"> & { nodes: UiNode[] };

// How many times a backend reads before an empty tree moves the read on to
// the next backend. AXe can read nothing for a moment: right after a
// relaunch, and once as the keyboard came up, where Maestro's read then took
// 31.7 s and used up `type`'s 40 s (#94, e2e run 44673258008).
const emptyReads = 3;

export async function readScreen(
  device: string,
  env: Environment,
  backends: Pick<DeviceBackend, "id" | "readScreen">[],
  // A Date.now() time that no backend's read may pass.
  until?: number,
  pauseMs = 1000,
): Promise<ScreenRead> {
  const { value, ...rest } = await firstWorking(
    "read the screen",
    env,
    backends,
    async (backend, bin) => {
      for (let read = 1; ; read++) {
        const nodes = await backend.readScreen(
          device,
          bin,
          until === undefined ? undefined : secondsTo(until),
        );
        // Every good read includes the app's root node, so none means the
        // read failed.
        if (nodes.length > 0) return nodes;
        if (
          read >= emptyReads ||
          (until !== undefined && Date.now() + pauseMs >= until)
        ) {
          throw new Error("returned an empty tree");
        }
        await new Promise((resolve) => setTimeout(resolve, pauseMs));
      }
    },
  );
  return { nodes: value, ...rest };
}

// Reads the screen again until a read gives nodes or `limitSeconds` pass.
// Returns the seconds it took, and the last problem (in one short sentence)
// when time ran out. When every read so far gave an empty tree, not an error,
// `whenEmpty.act` runs once after `whenEmpty.afterSeconds` (the first sign of
// the shape that application accessibility fixes).
export async function untilReadable(
  read: () => Promise<UiNode[]>,
  limitSeconds: number,
  whenEmpty?: { afterSeconds: number; act: () => Promise<void> },
  pauseMs = 1000,
): Promise<{ waited: number; error?: string }> {
  const start = Date.now();
  const elapsed = () => Date.now() - start;
  const short = (text: string) =>
    text
      .replace(/^Error: /, "")
      .split(/[.\n]/)[0]
      ?.slice(0, 80) ?? "";
  let error = "returned an empty tree";
  let onlyEmpty = true;
  let acted = false;
  for (;;) {
    try {
      if ((await read()).length > 0) {
        return { waited: Math.round(elapsed() / 100) / 10 };
      }
    } catch (failure) {
      onlyEmpty = false;
      error = short(firstLine(failure));
    }
    if (
      whenEmpty &&
      !acted &&
      onlyEmpty &&
      elapsed() >= whenEmpty.afterSeconds * 1000
    ) {
      acted = true;
      await whenEmpty.act().catch(() => {});
    }
    if (elapsed() >= limitSeconds * 1000) {
      return { waited: Math.round(elapsed() / 100) / 10, error };
    }
    await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }
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

// The adb that starts EMD's emulators (the SDK's), so two adb versions never
// restart each other's server.
function sdkAdb(): string | undefined {
  const adb = sdkTool("adb");
  if (!isAbsolute(adb)) return findExecutable(adb, []);
  try {
    accessSync(adb, constants.X_OK);
    return adb;
  } catch {
    return undefined;
  }
}

export async function detectEnvironment(): Promise<Environment> {
  return {
    axe: findExecutable("axe", [axeDir()]),
    maestro: findExecutable("maestro", [join(homedir(), ".maestro", "bin")]),
    adb: sdkAdb(),
  };
}
