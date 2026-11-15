import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Decision 0012. Posts the `merge-gate` commit status on a PR's head commit:
// success only when the PR may merge without a person. Usage, with
// GITHUB_TOKEN and GITHUB_REPOSITORY set: merge-gate.ts <pr number>
// It reads the GitHub API only and never runs the PR's code.

export type GateInput = {
  draft: boolean;
  author: string;
  headRef: string;
  labels: string[];
  body: string;
  changedLines: number;
  files: string[];
  // Workflow runs and check runs on the head commit.
  runs: {
    name: string;
    status: string;
    conclusion: string | null;
    createdAt: string;
  }[];
  checks: { name: string; conclusion: string | null; startedAt: string }[];
  // When `mentor:ready` was last added, if ever.
  readyAt?: string;
  e2ePaths: RegExp;
};

const ready = "mentor:ready";
const maxChangedLines = 400;
// Files that change how EMD is governed, released or tested in CI.
const needsPerson =
  /^(\.github\/|docs\/decisions\/|scripts\/merge-gate\.ts$|(package|package-lock|release-please-config)\.json$|\.release-please-manifest\.json$|(AGENTS|CLAUDE|SECURITY)\.md$|docs\/vision\.md$|LICENSE$|NOTICE$)/;

const newest = <T>(items: T[], at: (item: T) => string): T | undefined =>
  [...items].sort((a, b) => at(b).localeCompare(at(a)))[0];

// The text under a `## <heading>` line, without HTML comments; undefined if
// the heading is missing.
function section(body: string, heading: string): string | undefined {
  // Repeat until nothing changes, so nested markers can't leave a comment.
  let text = body;
  for (let prev = ""; prev !== text; ) {
    prev = text;
    text = text.replace(/<!--[\s\S]*?-->/g, "");
  }
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(
    (line) => line.trim().toLowerCase() === `## ${heading.toLowerCase()}`,
  );
  if (start < 0) return undefined;
  const end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join("\n")
    .trim();
}

// An empty section fails: an untouched template must not pass.
const saysNone = (text: string | undefined) =>
  text !== undefined && /^none\.?$/i.test(text);

// The first rule the PR fails, or undefined when it may merge.
export function evaluate(pr: GateInput): string | undefined {
  for (const name of ["check", "pr-title"]) {
    const run = newest(
      pr.checks.filter((c) => c.name === name),
      (c) => c.startedAt,
    );
    if (run?.conclusion !== "success") return `${name} has not passed`;
  }

  if (pr.files.some((file) => pr.e2ePaths.test(file))) {
    // A label event's run is skipped; it says nothing about the code.
    const e2e = newest(
      pr.runs.filter((r) => r.name === "e2e" && r.conclusion !== "skipped"),
      (r) => r.createdAt,
    );
    if (e2e?.status !== "completed" || e2e.conclusion !== "success") {
      return "e2e has not passed on this commit";
    }
  }

  const pushedAt = pr.runs.map((r) => r.createdAt).sort()[0];
  if (!pr.labels.includes(ready) || !pr.readyAt || !pushedAt) {
    return `no ${ready} label`;
  }
  if (pr.readyAt <= pushedAt) return `${ready} is older than the last push`;

  if (!saysNone(section(pr.body, "Needs you"))) {
    return '"Needs you" is not "none"';
  }
  if (!saysNone(section(pr.body, "Weakened checks"))) {
    return '"Weakened checks" is not "none"';
  }

  if (pr.draft) return "draft";
  if (
    pr.author === "github-actions[bot]" ||
    pr.headRef.startsWith("release-please--")
  ) {
    return "release PR";
  }
  for (const label of ["agent:blocked", "do-not-merge"]) {
    if (pr.labels.includes(label)) return `label ${label}`;
  }

  const file = pr.files.find((f) => needsPerson.test(f));
  if (file) return `${file} needs a person`;
  if (pr.changedLines > maxChangedLines) {
    return `${pr.changedLines} changed lines (max ${maxChangedLines})`;
  }
  return undefined;
}

type Pr = {
  draft: boolean;
  user: { login: string };
  head: { ref: string; sha: string };
  labels: { name: string }[];
  body: string | null;
  additions: number;
  deletions: number;
};
type Run = {
  name: string;
  status: string;
  conclusion: string | null;
  created_at: string;
};
type Check = { name: string; conclusion: string | null; started_at: string };
type Event = { event: string; label?: { name: string }; created_at: string };

async function main(number: string) {
  const repo = process.env.GITHUB_REPOSITORY;
  const api = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(
      `https://api.github.com/repos/${repo}${path}`,
      {
        ...init,
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        },
      },
    );
    if (!response.ok) throw new Error(`${response.status} on ${path}`);
    return (await response.json()) as T;
  };
  // Every page of a list; `key` names the list in an object answer.
  const pages = async <T>(path: string, key?: string): Promise<T[]> => {
    const all: T[] = [];
    for (let page = 1; ; page++) {
      const data = await api<T[] | Record<string, T[]>>(
        `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
      );
      const items = (key && !Array.isArray(data) ? data[key] : data) as T[];
      all.push(...items);
      if (items.length < 100) return all;
    }
  };

  const pr = await api<Pr>(`/pulls/${number}`);
  const sha: string = pr.head.sha;
  let failed: string | undefined;
  try {
    const [files, runs, checks, events] = await Promise.all([
      pages<{ filename: string; previous_filename?: string }>(
        `/pulls/${number}/files`,
      ),
      pages<Run>(`/actions/runs?head_sha=${sha}`, "workflow_runs"),
      pages<Check>(`/commits/${sha}/check-runs`, "check_runs"),
      pages<Event>(`/issues/${number}/events`),
    ]);
    failed = evaluate({
      draft: pr.draft,
      author: pr.user.login,
      headRef: pr.head.ref,
      labels: pr.labels.map((l) => l.name),
      body: pr.body ?? "",
      changedLines: pr.additions + pr.deletions,
      // A rename counts under both names, so nothing leaves a protected path.
      files: files.flatMap((f) => [
        f.filename,
        f.previous_filename ?? f.filename,
      ]),
      runs: runs.map((r) => ({
        name: r.name,
        status: r.status,
        conclusion: r.conclusion,
        createdAt: r.created_at,
      })),
      checks: checks.map((c) => ({
        name: c.name,
        conclusion: c.conclusion,
        startedAt: c.started_at,
      })),
      readyAt: newest(
        events.filter((e) => e.event === "labeled" && e.label?.name === ready),
        (e) => e.created_at,
      )?.created_at,
      e2ePaths: new RegExp(
        readFileSync(".github/e2e-paths.txt", "utf8").trim(),
      ),
    });
  } catch (error) {
    failed = `gate error: ${error instanceof Error ? error.message : error}`;
  }
  await api(`/statuses/${sha}`, {
    method: "POST",
    body: JSON.stringify({
      state: failed ? "failure" : "success",
      context: "merge-gate",
      description: (failed ?? "may merge without a person").slice(0, 140),
    }),
  });
  console.log(`#${number} ${sha.slice(0, 7)}: ${failed ?? "success"}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  for (const number of process.argv.slice(2)) await main(number);
}
