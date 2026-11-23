import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, statSync } from "node:fs";
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

// Resolves with the exit code; "idle" when the log has not grown for
// idleSeconds, so the process looks hung; or "timeout" after totalSeconds. A
// process that still writes its log is not stopped for being slow (decision 0014).
export async function untilExitOrIdle(
  exited: Promise<number>,
  logPath: string,
  idleSeconds: number,
  totalSeconds: number,
): Promise<number | "idle" | "timeout"> {
  const started = Date.now();
  let size = -1;
  let grew = started;
  let timer: NodeJS.Timeout | undefined;
  const stopped = new Promise<"idle" | "timeout">((resolve) => {
    timer = setInterval(
      () => {
        const now = Date.now();
        const current = statSync(logPath, { throwIfNoEntry: false })?.size;
        if (current !== size) {
          size = current ?? -1;
          grew = now;
        }
        if (now - started >= totalSeconds * 1000) resolve("timeout");
        else if (now - grew >= idleSeconds * 1000) resolve("idle");
      },
      Math.min(1000, idleSeconds * 250),
    );
  });
  try {
    return await Promise.race([exited, stopped]);
  } finally {
    clearInterval(timer);
  }
}
