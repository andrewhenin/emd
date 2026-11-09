import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { firstLine } from "../log.js";
import type { UiNode } from "./screen.js";

// Decision 0004: device actions go through backends, and core picks the best
// one that is available on this machine, falling back to the next.

export const backendIds = ["axe", "maestro"] as const;
export type BackendId = (typeof backendIds)[number];

// A tool that can act on a simulator. Reading the screen is the only action so
// far; tapping joins it with the step runner.
export interface DeviceBackend {
  id: BackendId;
  readScreen(device: string, bin: string): Promise<UiNode[]>;
}

// Where each installed backend's executable was found; absent when not installed.
export type Environment = Partial<Record<BackendId, string>>;

type Fallback = { backend: BackendId; reason: string };

// A screen read, and which backend produced it. `fellBack` lists the backends
// that were tried or skipped first, and why; it is absent when the first
// choice did the work.
export type ScreenRead = {
  nodes: UiNode[];
  backend: BackendId;
  fellBack?: Fallback[];
};

// Tries the backends in the order given (best first), skipping any that cannot run here
// and moving on from any that fails, and says which one answered.
export async function readScreen(
  device: string,
  env: Environment,
  backends: DeviceBackend[],
): Promise<ScreenRead> {
  const fellBack: Fallback[] = [];
  for (const { id, readScreen: read } of backends) {
    const bin = env[id];
    if (!bin) {
      fellBack.push({ backend: id, reason: `${id} is not installed` });
      continue;
    }
    try {
      const nodes = await read(device, bin);
      // Every good read includes the app's root node, so none means the read
      // failed (AXe sometimes reads nothing right after a relaunch).
      if (nodes.length === 0) throw new Error("returned an empty tree");
      return {
        nodes,
        backend: id,
        ...(fellBack.length > 0 ? { fellBack } : {}),
      };
    } catch (error) {
      fellBack.push({ backend: id, reason: firstLine(error) });
    }
  }
  throw new Error(
    `no backend could read the screen (${fellBack.map((f) => `${f.backend}: ${f.reason}`).join("; ")})`,
  );
}

// Reads the screen until a read works or `limit` seconds pass, and says how
// long that took. `error` is the last failure when the time ran out.
export async function untilReadable(
  device: string,
  env: Environment,
  backends: DeviceBackend[],
  limit: number,
): Promise<{ waited: number; error?: string }> {
  const start = Date.now();
  const waited = () => Math.round((Date.now() - start) / 1000);
  for (;;) {
    try {
      await readScreen(device, env, backends);
      return { waited: waited() };
    } catch (error) {
      if (Date.now() - start >= limit * 1000) {
        return { waited: waited(), error: firstLine(error) };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
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

export async function detectEnvironment(): Promise<Environment> {
  return {
    axe: findExecutable("axe", []),
    maestro: findExecutable("maestro", [join(homedir(), ".maestro", "bin")]),
  };
}
