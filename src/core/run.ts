import { readJob } from "./jobstore.js";
import type { LaunchResult } from "./result.js";

const deviceId = /^[0-9A-F]{8}(-[0-9A-F]{4}){3}-[0-9A-F]{12}$/i;
const appIdPattern = /^[A-Za-z0-9.-]+$/;

// A run is one app on one simulator, from the time it started. Name it by the
// launch job that started it, or give the device, app and start time directly.
export type RunRef = {
  jobId?: string;
  device?: string;
  appId?: string;
  since?: string;
};

export type Run = {
  device: string;
  appId: string;
  since: Date;
  // From the launch job, when there is one.
  root?: string;
  logDir?: string;
};

export function resolveRun(ref: RunRef): { run: Run } | { reason: string } {
  let { device, appId, since } = ref;
  let root: string | undefined;
  let logDir: string | undefined;
  if (ref.jobId) {
    const job = readJob(ref.jobId);
    if (!job) return { reason: `No job with id "${ref.jobId}".` };
    if (job.kind === "launch") {
      const result = job.result as LaunchResult | undefined;
      device ??= result?.device?.id;
      appId ??= result?.appId;
      root = result?.root;
      logDir = result?.logDir;
    }
    since ??= job.startedAt;
  }
  if (!device || !appId) {
    return {
      reason: ref.jobId
        ? "That job has not launched an app (yet)."
        : "Give a jobId, or a device and an appId.",
    };
  }
  if (!since) return { reason: "Give since (an ISO time), or a jobId." };
  const start = new Date(since);
  if (Number.isNaN(start.getTime())) {
    return { reason: "since must be an ISO time, e.g. 2026-10-24T14:00:00Z." };
  }
  if (!deviceId.test(device) || !appIdPattern.test(appId)) {
    return { reason: "That device or app ID does not look right." };
  }
  return { run: { device, appId, since: start, root, logDir } };
}
