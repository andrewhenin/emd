import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";

// The same command CI runs on a PR title: `npm run check:pr-title`.
const lint = (title: string) =>
  spawnSync("npm", ["run", "--silent", "check:pr-title"], {
    input: `${title}\n`,
    encoding: "utf8",
  });

test.each([
  "feat: add detect",
  "fix(core): handle a missing directory",
  "docs: log iOS smoke-test findings",
  "chore!: drop the emd-mcp bin",
])("accepts the title %s", (title) => {
  expect(lint(title).status).toBe(0);
});

test.each([
  "Add detect",
  "Feature: add detect",
  "feat add detect",
  "feat:",
  "FEAT: add detect",
  "feat: Add detect.",
])("rejects the title %s", (title) => {
  expect(lint(title).status).not.toBe(0);
});
