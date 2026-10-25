import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import type { UiNode } from "./screen.js";

const run = promisify(execFile);

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
  xcodeMajor?: number;
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
const axeMinXcode = 27;

// Why a backend cannot run here, or undefined when it can.
export function unavailableReason(
  id: BackendId,
  env: Environment,
): string | undefined {
  if (id === "axe") {
    if (env.xcodeMajor === undefined || env.xcodeMajor < axeMinXcode) {
      return `Xcode ${env.xcodeMajor ?? "not found"}; AXe needs ${axeMinXcode} or newer`;
    }
    return env.installed.axe ? undefined : "axe is not installed";
  }
  return env.installed.maestro ? undefined : "maestro is not installed";
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

async function xcodeMajor(): Promise<number | undefined> {
  try {
    const { stdout } = await run("xcodebuild", ["-version"]);
    const major = stdout.match(/^Xcode (\d+)/m)?.[1];
    return major ? Number(major) : undefined;
  } catch {
    return undefined;
  }
}

export async function detectEnvironment(): Promise<Environment> {
  return {
    xcodeMajor: await xcodeMajor(),
    installed: {
      axe: findExecutable("axe", []),
      maestro: findExecutable("maestro", [join(homedir(), ".maestro", "bin")]),
    },
  };
}
