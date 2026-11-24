const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g");
const errorLine = /\berror\b|CommandError|BUILD FAILED|\bfatal\b/i;
// Summary counts such as "1 error(s), and 2 warning(s)" are not findings.
const summary = /\b\d+ error\(s\)/i;
// Expo prints a compile error as a "❌  (file:line:col)" line, then a source
// snippet whose caret line holds the message.
const located = /^❌\s*\((.+)\)$/;
const caretMessage = /^\|\s*\^\s*(.+)$/;
const snippetReach = 8;
const maxLine = 200;

export const firstLine = (error: unknown): string =>
  String(error).split("\n")[0] ?? "";

export const stripAnsi = (text: string): string => text.replace(ansi, "");

const logLines = (log: string): string[] =>
  stripAnsi(log)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

// A log's last lines, as they are.
export const lastLines = (log: string, max = 5): string[] =>
  logLines(log)
    .slice(-max)
    .map((l) => l.slice(0, maxLine));

// The first few lines of a build or server log that say what went wrong:
// located compile errors first, then other error lines. None when nothing
// looks like an error.
export function errorLines(log: string, max = 5): string[] {
  const lines = logLines(log);

  const compile = lines.flatMap((line, i) => {
    const place = line.match(located)?.[1];
    if (!place) return [];
    const message = lines
      .slice(i + 1, i + 1 + snippetReach)
      .map((next) => next.replace(/^>?\s*\d*\s*/, "").trim())
      .map((next) => next.match(caretMessage)?.[1])
      .find(Boolean);
    return [message ? `${place}: ${message}` : place];
  });
  const other = lines.filter((l) => errorLine.test(l) && !summary.test(l));

  return [...new Set([...compile, ...other])]
    .map((l) => l.slice(0, maxLine))
    .slice(0, max);
}

// Error lines, or the last lines when nothing looks like an error.
export function firstErrors(log: string, max = 5): string[] {
  const found = errorLines(log, max);
  return found.length > 0 ? found : lastLines(log, max);
}

export type Fix = { do: string; safe: boolean };

// The cause and its fix, when a build log shows a known one (#285).
const knownCauses: { line: string; reason: string; fix: Fix }[] = [
  // Expo CLI before SDK 56 looks for Simulator.app, which Xcode 27 removed
  // (https://expo.dev/blog/xcode-27-device-hub-expo-device-hub).
  {
    line: "Can't determine id of Simulator app",
    reason:
      "The build failed: this Expo SDK looks for Simulator.app, which Xcode 27 removed.",
    fix: {
      do: "Select Xcode 26 with `xcode-select`, or upgrade the app to Expo SDK 56 or later.",
      safe: false,
    },
  },
  // Expo's module scan has a 5 s limit; a loaded machine passes it. Expo's own
  // message: "Build again to retry the scan" (run 45292340576).
  {
    line: "Scanning for @ExpoModule classes didn't complete",
    reason: "The build failed: Expo's module scan timed out.",
    fix: { do: "Launch again: a new build retries the scan.", safe: true },
  },
];

export function knownCause(
  log: string,
): { reason: string; fix: Fix } | undefined {
  const text = stripAnsi(log);
  const found = knownCauses.find(({ line }) => text.includes(line));
  return found && { reason: found.reason, fix: found.fix };
}

// True when `expo run:ios` compiled and installed the app and failed only in
// its own open step: the build succeeded, the "Opening on" line (printed after
// the install returned) is there, and the first error is `xcrun simctl openurl`.
export function onlyOpenFailed(log: string): boolean {
  const text = stripAnsi(log);
  return (
    text.includes("\u203a Build Succeeded") &&
    /^\u203a Opening on /m.test(text) &&
    /^Error: xcrun simctl openurl /m.test(text) &&
    text.indexOf("\nError: ") === text.indexOf("\nError: xcrun simctl openurl ")
  );
}

// xcodebuild's own timing (-showBuildTimingSummary, #208): its total and its
// slowest steps. The summary lists "Name (N tasks) | S seconds" lines. With
// -ShowBuildOperationDuration the build ends with "** BUILD SUCCEEDED ** [S sec]"
// (or FAILED); without it, the line has no total.
export type BuildTiming = {
  seconds?: number;
  slowest: { step: string; tasks: number; seconds: number }[];
};

const timingLine = /^(.+?) \((\d+) tasks?\) \| ([\d.]+) seconds?$/;
const buildEnd = /\*\* BUILD (?:SUCCEEDED|FAILED) \*\* \[([\d.]+) sec\]/;

export function buildTiming(log: string, top = 5): BuildTiming | undefined {
  const lines = stripAnsi(log)
    .split("\n")
    .map((line) => line.trim());
  const steps = lines.flatMap((line) => {
    const m = line.match(timingLine);
    return m
      ? [{ step: m[1] ?? "", tasks: Number(m[2]), seconds: Number(m[3]) }]
      : [];
  });
  const total = lines
    .map((line) => line.match(buildEnd)?.[1])
    .findLast(Boolean);
  if (steps.length === 0 && total === undefined) return undefined;
  return {
    ...(total !== undefined && { seconds: Number(total) }),
    slowest: steps.sort((a, b) => b.seconds - a.seconds).slice(0, top),
  };
}
