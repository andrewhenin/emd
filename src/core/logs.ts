import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { LogsResult } from "./result.js";
import { resolveRun } from "./run.js";
import { runTool } from "./tool.js";

const run = promisify(execFile);

// A tagged line is any log message with `[EMD:<tag>]` in it. The app writes it
// with console.log (or NSLog); the simulator keeps it in its unified log at
// Info level, so `log show` needs --info to see it.
const taggedLine = /\[EMD:([A-Za-z0-9_.-]+)\]\s?(.*)$/s;
const tagPattern = /^[A-Za-z0-9_.-]{1,40}$/;
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

// `log show --start` reads local time as "YYYY-MM-DD HH:MM:SS".
export function localStamp(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

// Only this app's process: `log` itself logs its own arguments, and those
// contain the tag marker, so a message filter alone would match its own run.
export function predicateFor(exe: string, tag?: string): string {
  if (!executable.test(exe)) throw new Error(`unexpected executable "${exe}"`);
  if (tag !== undefined && !tagPattern.test(tag)) {
    throw new Error(`unexpected tag "${tag}"`);
  }
  const marker = tag ? `[EMD:${tag}]` : "[EMD:";
  return `processImagePath ENDSWITH "/${exe}" AND eventMessage CONTAINS "${marker}"`;
}

function isoTime(stamp: string): string {
  const parsed = new Date(
    stamp.replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"),
  );
  return Number.isNaN(parsed.getTime()) ? stamp : parsed.toISOString();
}

// Tagged lines from `log show --style ndjson`, oldest first.
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
  const { device, appId, since: start } = resolved.run;
  if (process.platform !== "darwin") {
    return failed("iOS simulator logs need macOS.");
  }

  try {
    const exe = await appExecutable(device, appId);
    const { stdout } = await run(
      "xcrun",
      [
        "simctl",
        "spawn",
        device,
        "log",
        "show",
        "--start",
        localStamp(start),
        "--info",
        "--debug",
        "--style",
        "ndjson",
        "--predicate",
        predicateFor(exe, options.tag),
      ],
      { maxBuffer: 64 * 1024 * 1024, timeout: 120_000 },
    );
    const lines = parseTagged(stdout, options.tag);
    return {
      verdict: "ok",
      since: start.toISOString(),
      total: lines.length,
      lines,
    };
  } catch (error) {
    return failed(
      `Could not read the simulator log: ${String(error).split("\n")[0]}`,
    );
  }
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
