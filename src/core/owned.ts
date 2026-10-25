import { createHash } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { homeDir } from "./state.js";

// The ownership ledger (decision 0006): one file per worktree listing every
// resource EMD created for it. An entry is written as "creating" before the
// resource exists and stays until a cleanup succeeds. A ledger that cannot be
// read throws, so unknown is never taken for absent.
export type Kind = "simulator" | "derivedData" | "port";
export type Entry = { kind: Kind; id: string; state: "creating" | "owned" };
type Ledger = { root: string; resources: Entry[] };

const ownedDir = () => join(homeDir(), "owned");
const lockWaitMs = 10_000;

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
  } catch {
    return [];
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The lock file holds its owner's PID. A lock whose owner is no longer running
// is taken over; one that is empty (being written) or whose owner lives is not.
function holderGone(lock: string): boolean {
  try {
    const pid = Number.parseInt(readFileSync(lock, "utf8"), 10);
    if (!Number.isInteger(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

// One lock for the whole machine, so two launches cannot pick the same port.
async function locked<T>(fn: () => Promise<T> | T): Promise<T> {
  mkdirSync(ownedDir(), { recursive: true });
  const lock = join(ownedDir(), ".lock");
  for (let waited = 0; ; waited += 25) {
    try {
      const fd = openSync(lock, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (holderGone(lock)) rmSync(lock, { force: true });
      if (waited > lockWaitMs) throw new Error("The ownership lock is stuck.");
      await sleep(25);
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(lock, { force: true });
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
