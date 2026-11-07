import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readJobs } from "./jobstore.js";
import { type LoggedProcess, startLogged } from "./process.js";
import type { LaunchResult, LogsResult } from "./result.js";
import { resolveRun } from "./run.js";
import { runTool } from "./tool.js";

// A tagged line is any log message with `[EMD:<tag>]` in it. The app writes it
// with console.log (or NSLog); the simulator keeps it in its unified log at
// Info level, so `log stream` needs --info to see it.
const taggedLine = /\[EMD:([A-Za-z0-9_.-]+)\]\s?(.*)$/s;
export const tagPattern = /^[A-Za-z0-9_.-]{1,40}$/;
const executable = /^[A-Za-z0-9_. -]+$/;
const defaultLimit = 50;
const maxLimit = 500;

export type TaggedLine = { time: string; tag: string; message: string };

export type LogsOptions = {
  // The launch job whose device, app and start time define the run.
  jobId: string;
  // Only lines with this tag.
  tag?: string;
  limit?: number;
};

// Only this app's process: `log` itself logs its own arguments, and those
// contain the tag marker, so a message filter alone would match its own run.
export function predicateFor(exe: string): string {
  if (!executable.test(exe)) throw new Error(`unexpected executable "${exe}"`);
  return `processImagePath ENDSWITH "/${exe}" AND eventMessage CONTAINS "[EMD:"`;
}

function isoTime(stamp: string): string {
  const parsed = new Date(
    stamp.replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"),
  );
  return Number.isNaN(parsed.getTime()) ? stamp : parsed.toISOString();
}

// Tagged lines from `log stream --style ndjson` output, oldest first.
export function parseTagged(ndjson: string, tag?: string): TaggedLine[] {
  const lines: TaggedLine[] = [];
  for (const raw of ndjson.split("\n")) {
    let entry: { timestamp?: unknown; eventMessage?: unknown };
    try {
      entry = JSON.parse(raw);
    } catch {
      continue;
    }
    if (typeof entry.eventMessage !== "string") continue;
    const match = entry.eventMessage.match(taggedLine);
    if (!match?.[1] || (tag && match[1] !== tag)) continue;
    lines.push({
      time: isoTime(String(entry.timestamp ?? "")),
      tag: match[1],
      message: match[2] ?? "",
    });
  }
  return lines;
}

async function appExecutable(device: string, appId: string): Promise<string> {
  const { stdout } = await runTool(
    "simctl get_app_container",
    "xcrun",
    ["simctl", "get_app_container", device, appId],
    60,
  );
  const { stdout: name } = await runTool(
    "plutil",
    "plutil",
    [
      "-extract",
      "CFBundleExecutable",
      "raw",
      "-o",
      "-",
      `${stdout.trim()}/Info.plist`,
    ],
    30,
  );
  return name.trim();
}

const capturePath = (logDir: string) => join(logDir, "app.ndjson");

// Info lines live only in the simulator's memory buffers and are purged as
// they fill, so reading them after the fact can miss lines the app wrote
// earlier in the run. The stream starts before the app does and writes to the
// run's folder; `logs`, `check` and `evidence` read that file.
export async function startCapture(
  device: string,
  appId: string,
  logDir: string,
): Promise<LoggedProcess> {
  const exe = await appExecutable(device, appId);
  return startLogged(
    `xcrun simctl spawn ${device} log stream --info --style ndjson --predicate '${predicateFor(exe)}'`,
    { cwd: logDir, logPath: capturePath(logDir) },
  );
}

// A run lasts until the next launch in the same worktree, not until the app
// exits: Maestro's launchApp restarts the app, so its pid changes mid-run. The
// pid is checked before it is signalled, as the recorded one may belong to
// something else now.
export async function stopCaptures(root: string): Promise<void> {
  for (const job of readJobs()) {
    const result =
      job.kind === "launch" ? (job.result as LaunchResult) : undefined;
    const pid = result?.logStream?.pid;
    if (result?.root !== root || !pid) continue;
    try {
      const { stdout } = await runTool(
        "ps",
        "ps",
        ["-o", "command=", "-p", `${pid}`],
        60,
      );
      if (stdout.includes("log stream")) process.kill(-pid, "SIGTERM");
    } catch {}
  }
}

// Every tagged line of a run, oldest first. `logs` windows them for display.
export async function allLines(
  options: Omit<LogsOptions, "limit">,
): Promise<LogsResult> {
  const failed = (reason: string): LogsResult => ({
    verdict: "failed",
    reason,
  });

  if (options.tag !== undefined && !tagPattern.test(options.tag)) {
    return failed("A tag has letters, digits, dot, dash and underscore only.");
  }

  const resolved = resolveRun(options);
  if ("reason" in resolved) return failed(resolved.reason);
  const { since, logDir } = resolved.run;
  const file = capturePath(logDir);
  if (!existsSync(file)) return failed("This run has no captured log.");
  const lines = parseTagged(readFileSync(file, "utf8"), options.tag);
  return {
    verdict: "ok",
    since: since.toISOString(),
    total: lines.length,
    lines,
  };
}

export async function logs(options: LogsOptions): Promise<LogsResult> {
  const limit = options.limit ?? defaultLimit;
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    return {
      verdict: "failed",
      reason: `limit must be a whole number from 1 to ${maxLimit}.`,
    };
  }
  const all = await allLines(options);
  return all.lines ? { ...all, lines: all.lines.slice(-limit) } : all;
}
