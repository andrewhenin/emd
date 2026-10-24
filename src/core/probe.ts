import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { StackId } from "./adapter.js";

// Cheap file probe that decides which adapter to load. No adapter code runs here.
export async function probeStack(dir: string): Promise<StackId | undefined> {
  let pkg: { dependencies?: object; devDependencies?: object };
  try {
    pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
  } catch {
    return undefined;
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  return "expo" in deps ? "expo" : undefined;
}
