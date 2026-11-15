import { spawnSync } from "node:child_process";
import lint from "@commitlint/lint";
import load from "@commitlint/load";
import { beforeAll, expect, test } from "vitest";

// CI runs `npm run check:pr-title` on a PR title. These tests check the same
// rules in process: one process per title was too slow on a busy machine
// (#188). One test below still runs the real command.
type Options = NonNullable<Parameters<typeof lint>[2]>;
let config: Awaited<ReturnType<typeof load>>;
beforeAll(async () => {
  config = await load();
});

const valid = async (title: string) =>
  (
    await lint(title, config.rules, {
      parserOpts: config.parserPreset?.parserOpts as Options["parserOpts"],
      plugins: config.plugins,
      ignores: config.ignores,
      defaultIgnores: config.defaultIgnores,
    })
  ).valid;

test.each([
  "feat: add detect",
  "fix(core): handle a missing directory",
  "docs: log iOS smoke-test findings",
  "chore!: drop the emd-mcp bin",
  // Real Dependabot titles: a group, a group across directories, one package.
  "chore(deps): Bump the github-actions group with 5 updates",
  "chore(deps-dev): Bump @commitlint/cli from 19.8.1 to 21.2.4",
  "chore(deps-dev): Bump the development-dependencies group across 1 directory with 2 updates",
])("accepts the title %s", async (title) => {
  expect(await valid(title)).toBe(true);
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
])("rejects the title %s", async (title) => {
  expect(await valid(title)).toBe(false);
});

test("the command CI runs accepts a good title and rejects a bad one", () => {
  const run = (title: string) =>
    spawnSync("npm", ["run", "--silent", "check:pr-title"], {
      input: `${title}\n`,
      encoding: "utf8",
    }).status;
  expect(run("feat: add detect")).toBe(0);
  expect(run("Add detect")).not.toBe(0);
}, 30_000);
