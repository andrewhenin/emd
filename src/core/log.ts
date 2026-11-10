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

// The first few lines of a build or server log that say what went wrong:
// located compile errors first, then other error lines. Falls back to the last
// lines when nothing looks like an error.
export function firstErrors(log: string, max = 5): string[] {
  const lines = stripAnsi(log)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

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

  const found = [...new Set([...compile, ...other])].map((l) =>
    l.slice(0, maxLine),
  );
  return (
    found.length > 0 ? found : lines.slice(-max).map((l) => l.slice(0, maxLine))
  ).slice(0, max);
}

// The fix, when a build log shows a known cause whose own message points the
// wrong way. Expo CLI before SDK 56 looks for Simulator.app, which Xcode 27
// removed (https://expo.dev/blog/xcode-27-device-hub-expo-device-hub).
export function knownFix(log: string): string | undefined {
  if (stripAnsi(log).includes("Can't determine id of Simulator app")) {
    return "The build failed: this Expo SDK looks for Simulator.app, which Xcode 27 removed. Select Xcode 26 with `xcode-select`, or upgrade the app to Expo SDK 56 or later.";
  }
  return undefined;
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
