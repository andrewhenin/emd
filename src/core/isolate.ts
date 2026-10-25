import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { worktreeKey } from "./owned.js";
import { homeDir } from "./state.js";

const run = promisify(execFile);
const firstPort = 8081;

const free = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, () => server.close(() => resolve(true)));
  });

// The first port from 8081 that no worktree holds and nothing listens on.
export async function pickPort(taken: Set<string>): Promise<string> {
  for (let port = firstPort; port < firstPort + 1000; port++) {
    if (!taken.has(String(port)) && (await free(port))) return String(port);
  }
  throw new Error("No free Metro port.");
}

// The component after DerivedData is there because Expo finds the built app by
// matching `/Developer/Xcode/DerivedData/<name>/Build/Products/`.
export const derivedDataPath = (root: string): string =>
  join(
    homeDir(),
    "derived",
    worktreeKey(root),
    "Developer/Xcode/DerivedData",
    basename(root),
  );

// Expo's build has no DerivedData option, so a directory placed first on PATH
// holds an xcodebuild that adds it. Returns that directory.
export function xcodebuildShim(root: string, derivedData: string): string {
  const dir = join(homeDir(), "bin", worktreeKey(root));
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "xcodebuild");
  const quoted = `'${derivedData.replaceAll("'", "'\\''")}'`;
  writeFileSync(
    path,
    `#!/bin/sh\nexec /usr/bin/xcodebuild -derivedDataPath ${quoted} "$@"\n`,
    { mode: 0o755 },
  );
  return dir;
}

// Disk use of a folder in MB; absent counts as 0.
export async function diskMB(path: string): Promise<number> {
  try {
    const { stdout } = await run("du", ["-sk", path]);
    return Math.round(Number(stdout.split("\t")[0]) / 1024);
  } catch {
    return 0;
  }
}
