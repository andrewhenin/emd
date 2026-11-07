import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { diskMB } from "./isolate.js";
import { firstLine } from "./log.js";
import { type KeyedLedger, listLedgers, removeLedger } from "./owned.js";
import {
  listSimulators,
  removeSimulator,
  type Simulator,
} from "./simulator.js";
import { homeDir } from "./state.js";
import { runTool } from "./tool.js";

export type GcResult = {
  verdict: "dry-run" | "applied" | "failed";
  reason?: string;
  // One per ledger whose worktree root no longer exists.
  entries: {
    key: string;
    root: string;
    simulator?: string;
    derivedData?: string;
    // DerivedData and bin folders by `du`; simulator clones share blocks, so
    // their size is left out and the real gain is `freedMB`.
    mb: number;
    status: "stale" | "removed" | "skipped" | "failed";
    reason?: string;
  }[];
  // `emd-*` simulators no ledger mentions. Listed, never touched.
  unreferencedSimulators: { id: string; name: string }[];
  totalMB: number;
  // Free disk after minus before, by `df`. Only when something was removed.
  freedMB?: number;
};

type Entry = GcResult["entries"][number];

// True when the folder is gone. Any other error means unknown, which is never
// taken for gone (decision 0006).
function rootGone(root: string): boolean {
  try {
    statSync(root);
    return false;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return true;
    throw error;
  }
}

// `derived/<key>` may hold only the chain down to the ledger's DerivedData
// folder (Developer/Xcode/DerivedData/<app>), and nothing beside it.
function holdsOnly(dir: string, chain: string[]): boolean {
  if (!existsSync(dir)) return true;
  let current = dir;
  for (const part of chain) {
    const names = readdirSync(current);
    if (names.length !== 1 || names[0] !== part) return false;
    current = join(current, part);
  }
  return chain.length > 0 || readdirSync(dir).length === 0;
}

// Why this entry must not be removed, or undefined.
function problem(
  ledger: KeyedLedger,
  simulator: Simulator | undefined,
): string | undefined {
  const { key } = ledger;
  if (simulator && simulator.name !== `emd-${key}`) {
    return `simulator ${simulator.id} is named "${simulator.name}", not emd-${key}`;
  }
  const dir = join(homeDir(), "derived", key);
  const derived = ledger.resources.find((r) => r.kind === "derivedData")?.id;
  const chain = derived ? relative(dir, derived).split(sep) : [];
  if (chain[0] === ".." || !holdsOnly(dir, chain)) {
    return `${dir} holds more than the ledger's DerivedData folder`;
  }
}

// Free disk in MB at `path`, by `df`.
async function freeMB(path: string): Promise<number> {
  const { stdout } = await runTool("df", "df", ["-k", path], 60);
  return Number(stdout.trim().split("\n")[1]?.split(/\s+/)[3]) / 1024;
}

// CLI only, no MCP tool: it deletes things, so a person runs it on purpose.
// Removes what EMD made for worktrees that no longer exist (decision 0006).
// Without `apply` it only reports. The ledger file goes last, and only when
// every step before it worked, so a failure is retried on the next run.
export async function gc(options: { apply?: boolean } = {}): Promise<GcResult> {
  const result = (rest: Partial<GcResult>): GcResult => ({
    verdict: options.apply ? "applied" : "dry-run",
    entries: [],
    unreferencedSimulators: [],
    totalMB: 0,
    ...rest,
  });
  let ledgers: KeyedLedger[];
  let simulators: Simulator[];
  try {
    ledgers = listLedgers();
    simulators = await listSimulators().catch((error) => {
      // No simctl is fine when there is nothing to remove.
      if (ledgers.length === 0) return [];
      throw error;
    });
  } catch (error) {
    return result({ verdict: "failed", reason: firstLine(error) });
  }

  const mentioned = new Set(
    ledgers.flatMap((l) => [
      `emd-${l.key}`,
      ...l.resources.filter((r) => r.kind === "simulator").map((r) => r.id),
    ]),
  );
  const unreferencedSimulators = simulators
    .filter((s) => s.name.startsWith("emd-"))
    .filter((s) => !mentioned.has(s.id) && !mentioned.has(s.name))
    .map(({ id, name }) => ({ id, name }));

  const entries: { entry: Entry; ledger: KeyedLedger; sim?: Simulator }[] = [];
  for (const ledger of ledgers) {
    const base = { key: ledger.key, root: ledger.root };
    try {
      if (!rootGone(ledger.root)) continue;
    } catch (error) {
      entries.push({
        entry: {
          ...base,
          mb: 0,
          status: "skipped",
          reason: `cannot tell if the root exists: ${firstLine(error)}`,
        },
        ledger,
      });
      continue;
    }
    const wanted = ledger.resources.find((r) => r.kind === "simulator")?.id;
    const sim = simulators.find((s) => s.id === wanted || s.name === wanted);
    const derivedData = ledger.resources.find(
      (r) => r.kind === "derivedData",
    )?.id;
    const reason = problem(ledger, sim);
    entries.push({
      entry: {
        ...base,
        ...(sim && { simulator: sim.id }),
        ...(derivedData && { derivedData }),
        mb:
          (await diskMB(join(homeDir(), "derived", ledger.key))) +
          (await diskMB(join(homeDir(), "bin", ledger.key))),
        status: reason ? "skipped" : "stale",
        ...(reason && { reason }),
      },
      ledger,
      sim,
    });
  }

  const totalMB = entries.reduce((sum, e) => sum + e.entry.mb, 0);
  const done = () => entries.map((e) => e.entry);
  if (!options.apply) {
    return result({
      entries: done(),
      unreferencedSimulators,
      totalMB,
    });
  }

  if (!entries.some((e) => e.entry.status === "stale")) {
    return result({ entries: done(), unreferencedSimulators, totalMB });
  }
  const before = await freeMB(homeDir()).catch(() => undefined);
  for (const { entry, ledger, sim } of entries) {
    if (entry.status !== "stale") continue;
    try {
      if (sim) await removeSimulator(sim);
      rmSync(join(homeDir(), "derived", ledger.key), {
        recursive: true,
        force: true,
      });
      rmSync(join(homeDir(), "bin", ledger.key), {
        recursive: true,
        force: true,
      });
      // The failed-check count is keyed like the ledger; a new worktree at the
      // same path must not inherit a used-up retry budget.
      rmSync(join(homeDir(), "checks", `${ledger.key}.json`), { force: true });
      removeLedger(ledger.key);
      entry.status = "removed";
    } catch (error) {
      entry.status = "failed";
      entry.reason = firstLine(error);
    }
  }
  const after = await freeMB(homeDir()).catch(() => undefined);
  return result({
    entries: done(),
    unreferencedSimulators,
    totalMB,
    ...(before !== undefined &&
      after !== undefined && { freedMB: Math.round(after - before) }),
  });
}
