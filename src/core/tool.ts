import { spawn } from "node:child_process";

// Runs an outside tool and resolves with its stdout. It runs in its own process
// group, so when `seconds` pass the whole group dies, including anything the
// tool started (xcrun does not pass a signal on to the tool it runs). Its pipes
// close then too, so a child that left the group cannot hold the call open. A
// timeout rejects with "<step> timed out after Ns" so a verdict can name the
// step. Every rejection after the tool ran carries the stdout it printed.
export function runTool(
  step: string,
  file: string,
  args: string[],
  seconds: number,
  options: { env?: Record<string, string> } = {},
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      ...(options.env && { env: { ...process.env, ...options.env } }),
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    // Decode as a stream: a character split between two reads stays whole.
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        // The group may already be dead.
      }
      child.stdout.destroy();
      child.stderr.destroy();
    }, seconds * 1000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const fail = (message: string) =>
        reject(Object.assign(new Error(message), { stdout }));
      if (timedOut) fail(`${step} timed out after ${seconds}s`);
      else if (code === 0) resolve({ stdout });
      else fail(`${step} failed (exit ${code}): ${stderr.trim()}`);
    });
  });
}
