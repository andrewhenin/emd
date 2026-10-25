import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createJob, runJob } from "../src/core/jobs.ts";

export function makeDir(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "emd-test-"));
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return dir;
}

// An Expo project; `files` add to or override the default package.json.
export const expoProject = (files: Record<string, string> = {}) =>
  makeDir({
    "package.json": JSON.stringify({ dependencies: { expo: "~58.0.0" } }),
    ...files,
  });

export const appJson = (expo: object) => JSON.stringify({ expo });

export const device = "829564DA-13EC-4DE7-95B0-1E3EFF6FE713";

// A finished launch job in the state dir, so there is a run to check.
export async function launchedJob(
  state: string,
  root = "/work/app",
): Promise<string> {
  const job = createJob("launch", { dir: root });
  await runJob(job.id, {
    launch: async () => ({
      verdict: "launched",
      root,
      appId: "com.emd.sandbox",
      device: { id: device, name: "iPhone 17" },
      logDir: join(state, "runs", job.id),
    }),
    check: async () => ({ verdict: "error" }),
  });
  return job.id;
}
