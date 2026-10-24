import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";

export type LoggedProcess = {
  pid: number;
  // Resolves with the exit code, or -1 when it was killed by a signal.
  exited: Promise<number>;
  kill: () => void;
};

// Runs a shell command in its own process group with stdout and stderr in a
// log file, so it can outlive this process (a dev server) and be stopped whole.
export function startLogged(
  command: string,
  options: { cwd: string; logPath: string; env?: NodeJS.ProcessEnv },
): LoggedProcess {
  mkdirSync(dirname(options.logPath), { recursive: true });
  const log = openSync(options.logPath, "a");
  const child = spawn("sh", ["-c", command], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    detached: true,
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  child.unref();
  const exited = new Promise<number>((resolve) => {
    child.on("exit", (code) => resolve(code ?? -1));
    child.on("error", () => resolve(-1));
  });
  const pid = child.pid ?? -1;
  return {
    pid,
    exited,
    kill: () => {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {}
    },
  };
}
