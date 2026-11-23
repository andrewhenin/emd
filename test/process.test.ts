import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { errorLines, firstErrors, lastLines } from "../src/core/log.ts";
import { startLogged, untilExitOrIdle } from "../src/core/process.ts";
import { makeDir } from "./helpers.ts";

const logged = (command: string) => {
  const dir = makeDir();
  const logPath = join(dir, "logs", "out.log");
  return { process: startLogged(command, { cwd: dir, logPath }), logPath };
};

test("captures output in a log file and reports the exit code", async () => {
  const { process, logPath } = logged(
    `node -e "console.log('hello'); console.error('world')"`,
  );
  expect(await process.exited).toBe(0);
  const log = readFileSync(logPath, "utf8");
  expect(log).toContain("hello");
  expect(log).toContain("world");
});

test("a failing command exits non-zero and its error lines are found", async () => {
  const { process, logPath } = logged(
    `node -e "console.error('› building'); console.error('error: boom'); process.exit(3)"`,
  );
  expect(await process.exited).toBe(3);
  expect(firstErrors(readFileSync(logPath, "utf8"))).toEqual(["error: boom"]);
});

test("kill stops a long-running process, including its children", async () => {
  const { process } = logged(`sh -c "sleep 60 & wait"`);
  expect(process.pid).toBeGreaterThan(0);
  process.kill();
  expect(await process.exited).toBe(-1);
});

// #178: a build stops on a hang, not on slow progress.
test("a process that keeps writing its log runs past the idle limit", async () => {
  const { process, logPath } = logged(
    `for i in 1 2 3 4 5 6 7 8; do echo "compiling $i"; sleep 0.5; done`,
  );
  expect(await untilExitOrIdle(process.exited, logPath, 2, 30)).toBe(0);
});

test("a process whose log stops growing is reported idle, then killed", async () => {
  const { process, logPath } = logged(`echo start; sleep 30`);
  expect(await untilExitOrIdle(process.exited, logPath, 2, 30)).toBe("idle");
  process.kill();
  expect(await process.exited).toBe(-1);
});

test("a process that still writes stops at the total limit", async () => {
  const { process, logPath } = logged(
    `while true; do echo tick; sleep 0.2; done`,
  );
  expect(await untilExitOrIdle(process.exited, logPath, 2, 3)).toBe("timeout");
  process.kill();
});

test("progress lines are last lines, not error lines", () => {
  const log = "› Compiling a\n› Compiling b";
  expect(errorLines(log)).toEqual([]);
  expect(lastLines(log)).toEqual(["› Compiling a", "› Compiling b"]);
  expect(firstErrors(log)).toEqual(lastLines(log));
});
