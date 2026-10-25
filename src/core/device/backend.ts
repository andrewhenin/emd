import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { UiNode } from "./screen.js";

// Decision 0004: device actions go through backends, and core picks the best
// one that is available on this machine, falling back to the next.

export type BackendId = "axe" | "maestro";

// A tool that can act on a simulator. Reading the screen is the only action so
// far; tapping joins it with the step runner.
export interface DeviceBackend {
  id: BackendId;
  readScreen(device: string): Promise<UiNode[]>;
}

// What this machine has.
export type Environment = {
  installed: Record<BackendId, boolean>;
};

type Fallback = { backend: BackendId; reason: string };

// A screen read, and which backend produced it. `fellBack` lists the backends
// that were tried or skipped first, and why; it is absent when the first
// choice did the work.
export type ScreenRead = {
  nodes: UiNode[];
  backend: BackendId;
  fellBack?: Fallback[];
};

// Best first.
const preference: BackendId[] = ["axe", "maestro"];

// Why a backend cannot run here, or undefined when it can.
export function unavailableReason(
  id: BackendId,
  env: Environment,
): string | undefined {
  return env.installed[id] ? undefined : `${id} is not installed`;
}

const firstLine = (error: unknown) => String(error).split("\n")[0] ?? "";

// Tries the backends in order of preference, skipping any that cannot run here
// and moving on from any that fails, and says which one answered.
export async function readScreen(
  device: string,
  env: Environment,
  backends: DeviceBackend[],
): Promise<ScreenRead> {
  const fellBack: Fallback[] = [];
  for (const id of preference) {
    const unavailable = unavailableReason(id, env);
    if (unavailable) {
      fellBack.push({ backend: id, reason: unavailable });
      continue;
    }
    try {
      const backend = backends.find((b) => b.id === id);
      if (!backend) throw new Error("no such backend");
      const nodes = await backend.readScreen(device);
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

function findExecutable(name: string, extraDirs: string[]): boolean {
  const dirs = [
    ...(process.env.PATH ?? "").split(delimiter),
    ...extraDirs,
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  return dirs.some((dir) => {
    try {
      accessSync(join(dir, name), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

export async function detectEnvironment(): Promise<Environment> {
  return {
    installed: {
      axe: findExecutable("axe", []),
      maestro: findExecutable("maestro", [join(homedir(), ".maestro", "bin")]),
    },
  };
}
