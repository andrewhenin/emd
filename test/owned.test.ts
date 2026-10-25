import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { pickPort } from "../src/core/isolate.ts";
import { confirm, reserve, worktreeKey } from "../src/core/owned.ts";
import { makeDir } from "./helpers.ts";

// The ownership ledger (decision 0006) on a real temp state dir.
beforeEach(() => {
  process.env.EMD_STATE_DIR = makeDir();
});

test("worktrees allocating at the same moment get different ports", async () => {
  const roots = Array.from({ length: 6 }, (_, i) => `/work/app-${i}`);
  const ports = await Promise.all(
    roots.map((root) => reserve(root, "port", pickPort)),
  );
  expect(new Set(ports.map((entry) => entry.id)).size).toBe(roots.length);
  expect(ports.every((entry) => entry.state === "creating")).toBe(true);
});

test("a worktree gets the same entry back, and a confirm keeps it owned", async () => {
  const first = await reserve("/work/app", "port", pickPort);
  await confirm("/work/app", "port");
  const again = await reserve("/work/app", "port", () => "never");
  expect(again).toEqual({ ...first, state: "owned" });
});

test("a port something else listens on is skipped", async () => {
  const busy = await pickPort(new Set());
  const server = createServer();
  await new Promise<void>((resolve) =>
    server.listen(Number(busy), () => resolve()),
  );
  try {
    expect(Number(await pickPort(new Set()))).toBeGreaterThan(Number(busy));
  } finally {
    server.close();
  }
});

test("an unreadable ledger is an error, never an empty one", async () => {
  const dir = join(process.env.EMD_STATE_DIR ?? "", "owned");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${worktreeKey("/work/app")}.json`), "{broken");
  await expect(reserve("/work/app", "port", pickPort)).rejects.toThrow(
    /unreadable/,
  );
  await expect(reserve("/work/other", "port", pickPort)).rejects.toThrow(
    /unreadable/,
  );
});

test("a lock nobody refreshes is taken over", async () => {
  const dir = join(process.env.EMD_STATE_DIR ?? "", "owned");
  mkdirSync(dir, { recursive: true });
  mkdirSync(`${dir}.lock`);
  const old = new Date(Date.now() - 60_000);
  utimesSync(`${dir}.lock`, old, old);
  const entry = await reserve("/work/app", "port", pickPort);
  expect(entry.state).toBe("creating");
});
