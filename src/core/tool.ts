import { spawn } from "node:child_process";

// Runs an outside tool and resolves with its stdout. It runs in its own process
// group, so when `seconds` pass the whole group dies, including anything the
// tool started (xcrun does not pass a signal on to the tool it runs). A timeout
// rejects with "<step> timed out after Ns" so a verdict can name the step.
export function runTool(
  step: string,
  file: string,
  args: string[],
  seconds: number,
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
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
    }, seconds * 1000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`${step} timed out after ${seconds}s`));
      else if (code === 0) resolve({ stdout });
      else reject(new Error(`${step} failed (exit ${code}): ${stderr.trim()}`));
    });
  });
}
