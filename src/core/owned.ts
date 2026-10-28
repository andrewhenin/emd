import { createHash } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { lock } from "proper-lockfile";
import { homeDir } from "./state.js";

// The ownership ledger (decision 0006): one file per worktree listing every
// resource EMD created for it. An entry is written as "creating" before the
// resource exists and stays until a cleanup succeeds. A ledger that cannot be
// read throws, so unknown is never taken for absent.
export type Kind = "simulator" | "derivedData" | "port";
export type Entry = { kind: Kind; id: string; state: "creating" | "owned" };
type Ledger = { root: string; resources: Entry[] };

const ownedDir = () => join(homeDir(), "owned");

export function worktreeKey(root: string): string {
  let real = root;
  try {
    real = realpathSync(root);
  } catch {}
  return createHash("sha1").update(real).digest("hex").slice(0, 12);
}

const ledgerFile = (root: string) =>
  join(ownedDir(), `${worktreeKey(root)}.json`);

function readLedger(path: string): Ledger | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Ledger;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`Ownership ledger ${path} is unreadable: ${error}`);
  }
}

function readAll(): Ledger[] {
  let names: string[];
  try {
    names = readdirSync(ownedDir());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(
      `Ownership directory ${ownedDir()} is unreadable: ${error}`,
    );
  }
  return names
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => readLedger(join(ownedDir(), name)) ?? []);
}

function write(root: string, ledger: Ledger): void {
  const path = ledgerFile(root);
  writeFileSync(`${path}.tmp`, JSON.stringify(ledger));
  renameSync(`${path}.tmp`, path);
}

// One lock for the whole machine, so two launches cannot pick the same port.
// proper-lockfile refreshes it while held and takes over one nobody refreshes.
async function locked<T>(fn: () => Promise<T> | T): Promise<T> {
  mkdirSync(ownedDir(), { recursive: true });
  const release = await lock(ownedDir(), {
    retries: { retries: 200, minTimeout: 25, maxTimeout: 100 },
  });
  try {
    return await fn();
  } finally {
    await release();
  }
}

// The worktree's resource of this kind, recorded as "creating" before it
// exists. A second call returns the same entry. `pick` chooses a new id and
// sees the ids every worktree already holds for the kind.
export const reserve = (
  root: string,
  kind: Kind,
  pick: (taken: Set<string>) => Promise<string> | string,
): Promise<Entry> =>
  locked(async () => {
    const all = readAll();
    const mine = readLedger(ledgerFile(root)) ?? { root, resources: [] };
    const existing = mine.resources.find((entry) => entry.kind === kind);
    if (existing) return existing;
    const taken = new Set(
      all.flatMap((ledger) =>
        ledger.resources.filter((e) => e.kind === kind).map((e) => e.id),
      ),
    );
    const entry: Entry = { kind, id: await pick(taken), state: "creating" };
    mine.resources.push(entry);
    write(root, mine);
    return entry;
  });

// The resource now exists. `id` replaces the reserved one when only the
// resource could say it (a simulator's UDID).
export function confirm(root: string, kind: Kind, id?: string): void {
  const ledger = readLedger(ledgerFile(root));
  const entry = ledger?.resources.find((e) => e.kind === kind);
  if (!ledger || !entry) throw new Error(`No ${kind} reserved for ${root}.`);
  entry.state = "owned";
  if (id) entry.id = id;
  write(root, ledger);
}
