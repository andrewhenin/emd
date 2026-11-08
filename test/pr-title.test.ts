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
  // Real Dependabot titles: one per title shape.
  "chore(deps): Bump the github-actions group with 5 updates",
  "chore(deps-dev): Bump @commitlint/cli from 19.8.1 to 21.2.4",
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
  // Only Dependabot's exact title shapes skip the rules.
  "chore: Bump x",
  "chore(deps): Add x",
  "chore(deps): Bump stuff",
])("rejects the title %s", (title) => {
  expect(lint(title).status).not.toBe(0);
});
