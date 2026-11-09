import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { probeStack } from "./probe.js";

// At a workspace root (pnpm-workspace.yaml, or a `workspaces` field in
// package.json), the workspace packages that EMD can detect, as paths relative
// to the root. Reads only the workspace's package globs, never node_modules.
// No package manager command: each lists packages its own way, needs its own
// install, and EMD cannot pin the user's version (decision 0008).

const maxApps = 20;
const deepest = 4;

function workspaceGlobs(root: string): string[] {
  try {
    const yaml = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
    return pnpmGlobs(yaml);
  } catch {}
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const list = Array.isArray(pkg.workspaces)
      ? pkg.workspaces
      : pkg.workspaces?.packages;
    return Array.isArray(list)
      ? list.filter((glob): glob is string => typeof glob === "string")
      : [];
  } catch {
    return [];
  }
}

// The `packages:` list, as a block (`- apps/*` lines) or inline (`[a, b]`).
function pnpmGlobs(yaml: string): string[] {
  const unquote = (item: string) =>
    item
      .replace(/#.*$/, "")
      .trim()
      .replace(/^["']|["']$/g, "");
  const lines = yaml.split("\n");
  const start = lines.findIndex((line) => /^packages:/.test(line));
  if (start < 0) return [];
  const inline = lines[start]?.match(/^packages:\s*\[(.*)\]/);
  if (inline?.[1]) return inline[1].split(",").map(unquote).filter(Boolean);
  const globs: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const item = line.match(/^\s+-\s*(.+)$/)?.[1];
    if (item) globs.push(unquote(item));
  }
  return globs.filter(Boolean);
}

const subfolders = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name !== "node_modules" &&
          !entry.name.startsWith("."),
      )
      .map((entry) => join(dir, entry.name));
  } catch {
    return [];
  }
};

const below = (dir: string, depth: number): string[] =>
  depth === 0
    ? []
    : subfolders(dir).flatMap((sub) => [sub, ...below(sub, depth - 1)]);

// Folders that match one glob: literal parts, `*` within a part, and `**`.
function expand(root: string, glob: string): string[] {
  let dirs = [root];
  for (const part of glob.replace(/^\.\//, "").split("/").filter(Boolean)) {
    if (part === "node_modules") return [];
    if (part === "**") {
      dirs = dirs.flatMap((dir) => [dir, ...below(dir, deepest)]);
    } else if (part.includes("*")) {
      const pattern = new RegExp(
        `^${part
          .split("*")
          .map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
          .join("[^/]*")}$`,
      );
      dirs = dirs.flatMap((dir) =>
        subfolders(dir).filter((sub) => pattern.test(relative(dir, sub))),
      );
    } else {
      dirs = dirs
        .map((dir) => join(dir, part))
        .filter((dir) => existsSync(dir));
    }
  }
  return dirs;
}

export async function workspaceApps(root: string): Promise<string[]> {
  const globs = workspaceGlobs(root);
  const excluded = new Set(
    globs
      .filter((glob) => glob.startsWith("!"))
      .flatMap((glob) => expand(root, glob.slice(1))),
  );
  const packages = new Set(
    globs
      .filter((glob) => !glob.startsWith("!"))
      .flatMap((glob) => expand(root, glob))
      .filter((dir) => dir !== root && !excluded.has(dir)),
  );
  const apps: string[] = [];
  for (const dir of [...packages].sort()) {
    if (await probeStack(dir)) apps.push(relative(root, dir));
    if (apps.length === maxApps) break;
  }
  return apps;
}
