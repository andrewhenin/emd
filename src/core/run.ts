import type { Platform } from "./adapter.js";
import { readJob } from "./jobstore.js";
import type { LaunchResult } from "./result.js";

// A run is one app on one simulator or emulator, from the time its launch job
// started.
export type RunRef = { jobId: string };

export type Run = {
  platform: Platform;
  device: string;
  appId: string;
  since: Date;
  root: string;
  logDir: string;
};

export function resolveRun({
  jobId,
}: RunRef): { run: Run } | { reason: string } {
  const job = readJob(jobId);
  if (!job) return { reason: `No job with id "${jobId}".` };
  const result =
    job.kind === "launch"
      ? (job.result as LaunchResult | undefined)
      : undefined;
  // Only a launched app has all of these; a failed launch stops short of appId.
  if (!result?.device || !result.appId || !result.logDir || !job.startedAt) {
    return { reason: "That job has not launched an app (yet)." };
  }
  return {
    run: {
      // Launches before Android support carry no platform.
      platform: result.platform ?? "ios",
      device: result.device.id,
      appId: result.appId,
      since: new Date(job.startedAt),
      root: result.root,
      logDir: result.logDir,
    },
  };
}
