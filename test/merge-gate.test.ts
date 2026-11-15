import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { evaluate, type GateInput } from "../scripts/merge-gate.ts";

const pushed = "2026-11-15T10:00:00Z";
const later = "2026-11-15T10:30:00Z";
const latest = "2026-11-15T11:00:00Z";

// A PR that may merge: every test below breaks one rule.
const pr = (change: Partial<GateInput> = {}): GateInput => ({
  draft: false,
  author: "andrewhenin",
  headRef: "fix/thing",
  labels: ["mentor:ready"],
  body: "## Needs you\n\nnone\n\n## Weakened checks\n\n<!-- hint -->\nnone\n",
  changedLines: 120,
  files: ["src/core/launch.ts"],
  runs: [
    {
      name: "CI",
      status: "completed",
      conclusion: "success",
      createdAt: pushed,
    },
    {
      name: "e2e",
      status: "completed",
      conclusion: "success",
      createdAt: pushed,
    },
  ],
  checks: [
    { name: "check", conclusion: "success", startedAt: pushed },
    { name: "pr-title", conclusion: "success", startedAt: pushed },
  ],
  readyAt: later,
  e2ePaths: new RegExp(readFileSync(".github/e2e-paths.txt", "utf8").trim()),
  ...change,
});

test("a PR that meets every rule may merge", () => {
  expect(evaluate(pr())).toBeUndefined();
});

test("check and pr-title must pass; the newest run counts", () => {
  expect(evaluate(pr({ checks: [] }))).toBe("check has not passed");
  const checks = pr().checks.concat({
    name: "pr-title",
    conclusion: "failure",
    startedAt: later,
  });
  expect(evaluate(pr({ checks }))).toBe("pr-title has not passed");
});

test("e2e must pass on this commit when the PR touches an e2e path", () => {
  const e2e = "e2e has not passed on this commit";
  const ci = pr().runs.slice(0, 1);
  const run = (
    status: string,
    conclusion: string | null,
    createdAt = later,
  ) => ({
    name: "e2e",
    status,
    conclusion,
    createdAt,
  });
  expect(evaluate(pr({ runs: ci }))).toBe(e2e);
  expect(evaluate(pr({ runs: [...ci, run("in_progress", null)] }))).toBe(e2e);
  expect(evaluate(pr({ runs: [...ci, run("completed", "cancelled")] }))).toBe(
    e2e,
  );
  // A label event's skipped run neither passes nor hides a failure.
  expect(evaluate(pr({ runs: [...ci, run("completed", "skipped")] }))).toBe(
    e2e,
  );
  const failedThenSkipped = [
    ...ci,
    run("completed", "failure"),
    run("completed", "skipped", latest),
  ];
  expect(evaluate(pr({ runs: failedThenSkipped }))).toBe(e2e);
  // No e2e path changed: no e2e run needed.
  expect(
    evaluate(pr({ runs: ci, files: ["test/jobs.test.ts"] })),
  ).toBeUndefined();
});

test("mentor:ready must be newer than the last push", () => {
  expect(evaluate(pr({ labels: [] }))).toBe("no mentor:ready label");
  expect(evaluate(pr({ readyAt: undefined }))).toBe("no mentor:ready label");
  expect(evaluate(pr({ readyAt: pushed }))).toBe(
    "mentor:ready is older than the last push",
  );
});

test('"Needs you" and "Weakened checks" must say none', () => {
  const body = (needs: string, weakened = "none") =>
    `## Needs you\n\n${needs}\n\n## Weakened checks\n\n${weakened}\n`;
  expect(evaluate(pr({ body: body("") }))).toBeUndefined();
  expect(evaluate(pr({ body: body("- Merge gate: check e2e") }))).toBe(
    '"Needs you" is not "none"',
  );
  expect(evaluate(pr({ body: "## Weakened checks\n\nnone" }))).toBe(
    '"Needs you" is not "none"',
  );
  expect(evaluate(pr({ body: body("none", "skipped one test") }))).toBe(
    '"Weakened checks" is not "none"',
  );
});

test("drafts, release PRs and blocking labels wait for a person", () => {
  expect(evaluate(pr({ draft: true }))).toBe("draft");
  expect(evaluate(pr({ author: "github-actions[bot]" }))).toBe("release PR");
  expect(evaluate(pr({ headRef: "release-please--branches--main" }))).toBe(
    "release PR",
  );
  expect(evaluate(pr({ labels: ["mentor:ready", "do-not-merge"] }))).toBe(
    "label do-not-merge",
  );
});

test("governance files and large PRs wait for a person", () => {
  for (const file of [
    ".github/workflows/ci.yml",
    "scripts/merge-gate.ts",
    "docs/decisions/0012-merge-gate.md",
    "AGENTS.md",
    "LICENSE",
  ]) {
    const files = ["test/jobs.test.ts", file];
    expect(evaluate(pr({ files }))).toBe(`${file} needs a person`);
  }
  expect(evaluate(pr({ changedLines: 401 }))).toBe(
    "401 changed lines (max 400)",
  );
});
