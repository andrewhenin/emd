import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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

async function packageManagerIn(
  dir: string,
): Promise<PackageManager | undefined> {
  try {
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    const declared = String(pkg.packageManager ?? "").split("@")[0];
    const match = packageManagers.find((pm) => pm === declared);
    if (match) return match;
  } catch {}
  return lockfiles.find(([file]) => existsSync(join(dir, file)))?.[1];
}

// The folders above `root` up to its git root. None outside a git repo, so a
// stray lockfile in a home folder is never read.
function parentsToGitRoot(root: string): string[] {
  const parents: string[] = [];
  for (let dir = root; !existsSync(join(dir, ".git")); ) {
    const parent = dirname(dir);
    if (parent === dir) return [];
    parents.push(parent);
    dir = parent;
  }
  return parents;
}

// The app folder first, then its parents: in a workspace the lockfile and the
// packageManager field are at the workspace root.
async function packageManagerOf(root: string): Promise<PackageManager> {
  for (const dir of [root, ...parentsToGitRoot(root)]) {
    const found = await packageManagerIn(dir);
    if (found) return found;
  }
  return "npm";
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
