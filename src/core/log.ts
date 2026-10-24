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
