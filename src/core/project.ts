import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type PackageManager,
  type ProjectInfo,
  packageManagers,
} from "./adapter.js";

const exec: Record<PackageManager, string> = {
  npm: "npx",
  yarn: "yarn",
  pnpm: "pnpm exec",
  bun: "bunx",
};

const lockfiles: [string, PackageManager][] = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

const notesFiles = ["AGENTS.md", "CLAUDE.md", "docs/decisions"];
const maxFlows = 10;

async function packageManagerOf(root: string): Promise<PackageManager> {
  try {
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    const declared = String(pkg.packageManager ?? "").split("@")[0];
    const match = packageManagers.find((pm) => pm === declared);
    if (match) return match;
  } catch {}
  return lockfiles.find(([file]) => existsSync(join(root, file)))?.[1] ?? "npm";
}

async function maestroFlowsOf(root: string): Promise<string[]> {
  try {
    const names = await readdir(join(root, ".maestro"));
    return names
      .filter((name) => /\.ya?ml$/.test(name))
      .sort()
      .slice(0, maxFlows)
      .map((name) => `.maestro/${name}`);
  } catch {
    return [];
  }
}

export type ProjectFacts = ProjectInfo & {
  maestroFlows: string[];
  notes: string[];
};

// Stack-independent facts. Cheap file checks only; good enough, not complete.
export async function inspectProject(root: string): Promise<ProjectFacts> {
  const packageManager = await packageManagerOf(root);
  return {
    packageManager,
    exec: exec[packageManager],
    maestroFlows: await maestroFlowsOf(root),
    notes: notesFiles.filter((file) => existsSync(join(root, file))),
  };
}
