import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { firstErrors } from "../src/core/log.ts";
import { startLogged } from "../src/core/process.ts";
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
