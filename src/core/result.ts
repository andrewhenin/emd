import { z } from "zod";
import { packageManagers, platforms, stackIds } from "./adapter.js";

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
  // Full build and server logs live here; read them only when needed.
  logDir: z.string().optional(),
  seconds: z.number().optional(),
});

export type LaunchResult = z.infer<typeof launchResultSchema>;

// What a caller sees of a job: enough to know where it is, small enough to
// poll. `result` appears once the job has finished.
export const jobViewSchema = z.object({
  jobId: z.string(),
  kind: z.literal("launch"),
  status: z.enum(["queued", "running", "succeeded", "failed"]),
  // What the job is doing now, while it runs.
  step: z.string().optional(),
  // Since the job started (since it was created while still queued).
  seconds: z.number(),
  result: launchResultSchema.optional(),
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
