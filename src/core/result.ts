import { z } from "zod";
import { packageManagers, platforms, stackIds } from "./adapter.js";
import { backendIds } from "./device/backend.js";

const perPlatform = z.object({
  ios: z.string().optional(),
  android: z.string().optional(),
});

// One schema for the result: the CLI prints it, the MCP tool declares it.
export const detectResultSchema = z.object({
  verdict: z.enum(["detected", "none"]),
  root: z.string(),
  stack: z.enum(stackIds).optional(),
  platforms: z.array(z.enum(platforms)).optional(),
  appIds: perPlatform.optional(),
  commands: z.object({ run: perPlatform, server: z.string() }).optional(),
  packageManager: z.enum(packageManagers).optional(),
  maestroFlows: z.array(z.string()).optional(),
  notes: z.array(z.string()).optional(),
});

export type DetectResult = z.infer<typeof detectResultSchema>;

export const launchResultSchema = z.object({
  verdict: z.enum(["launched", "failed", "unsupported"]),
  root: z.string(),
  // Why it failed or is unsupported, in one line.
  reason: z.string().optional(),
  // First relevant error lines from the build or server log.
  errors: z.array(z.string()).optional(),
  device: z.object({ id: z.string(), name: z.string() }).optional(),
  appId: z.string().optional(),
  appPid: z.number().optional(),
  // The dev server left running for the app.
  metro: z.object({ pid: z.number(), port: z.number() }).optional(),
  // This worktree's own build folder, and what it and its simulator weigh.
  derivedData: z.string().optional(),
  diskMB: z
    .object({ derivedData: z.number(), simulator: z.number() })
    .optional(),
  // Full build and server logs live here; read them only when needed.
  logDir: z.string().optional(),
  seconds: z.number().optional(),
});

export type LaunchResult = z.infer<typeof launchResultSchema>;

// The verdict comes only from log events and UI elements. The agent's own
// reading of a screenshot is recorded next to it as a second opinion and never
// changes the verdict.
export const checkResultSchema = z.object({
  // passed: every expectation met. failed: one was not, and a retry is allowed.
  // stopped: the retry limit is reached, so stop and report. error: the check
  // could not run (no app, no simulator); it does not count as an attempt.
  verdict: z.enum(["passed", "failed", "stopped", "error"]),
  reason: z.string().optional(),
  // Failed checks so far for this check name, and how many are allowed.
  attempt: z.number().optional(),
  retryLimit: z.number().optional(),
  logs: z
    .array(
      z.object({
        tag: z.string(),
        message: z.string().optional(),
        found: z.boolean(),
      }),
    )
    .optional(),
  elements: z
    .array(
      z.object({
        id: z.string().optional(),
        text: z.string().optional(),
        found: z.boolean(),
      }),
    )
    .optional(),
  // Which backend read the screen (decision 0004), and the backends it passed
  // over first, each with why. Absent when no element was checked.
  backend: z.enum(backendIds).optional(),
  fellBack: z
    .array(z.object({ backend: z.enum(backendIds), reason: z.string() }))
    .optional(),
  secondOpinion: z
    .object({
      // A screenshot of the screen as it was checked.
      screenshot: z.string().optional(),
      // The agent's reading of that screenshot, when it gave one.
      agent: z.enum(["pass", "fail"]).optional(),
      // Whether that reading matches the verdict.
      agrees: z.boolean().optional(),
    })
    .optional(),
});

export type CheckResult = z.infer<typeof checkResultSchema>;

export const evidenceResultSchema = z.object({
  verdict: z.enum(["written", "failed"]),
  // Why it failed, in one line.
  reason: z.string().optional(),
  // The bundle folder, and what each file in it is.
  dir: z.string().optional(),
  layout: z.record(z.string(), z.string()).optional(),
  // How much went in. Checks are only those that ran.
  checks: z.number().optional(),
  logLines: z.number().optional(),
  screenshots: z.number().optional(),
  flows: z.number().optional(),
});

export type EvidenceResult = z.infer<typeof evidenceResultSchema>;

// What a caller sees of a job: enough to know where it is, small enough to
// poll. `result` appears once the job has finished.
export const jobViewSchema = z.object({
  jobId: z.string(),
  kind: z.enum(["launch", "check"]),
  status: z.enum(["queued", "running", "succeeded", "failed"]),
  // What the job is doing now, while it runs.
  step: z.string().optional(),
  // Since the job started (since it was created while still queued).
  seconds: z.number(),
  // A launch result or a check result, by `kind`.
  result: z.union([launchResultSchema, checkResultSchema]).optional(),
});

export type JobView = z.infer<typeof jobViewSchema>;

export const logsResultSchema = z.object({
  verdict: z.enum(["ok", "failed"]),
  // Why it failed, in one line.
  reason: z.string().optional(),
  // Start of the window the lines come from (ISO).
  since: z.string().optional(),
  // How many tagged lines matched; `lines` holds only the most recent ones.
  total: z.number().optional(),
  lines: z
    .array(z.object({ time: z.string(), tag: z.string(), message: z.string() }))
    .optional(),
});

export type LogsResult = z.infer<typeof logsResultSchema>;
