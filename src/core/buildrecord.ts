import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// What the last successful build of a worktree was made from. It sits in the
// worktree's DerivedData, next to the build it describes, so it goes when the
// build goes. The ownership ledger holds only what gc removes (#129).
export type BuildRecord = { fingerprint: string; port: number };

const file = (derivedData: string) => join(derivedData, "emd-build.json");

export function readBuildRecord(derivedData: string): BuildRecord | undefined {
  try {
    const record = JSON.parse(readFileSync(file(derivedData), "utf8"));
    return typeof record?.fingerprint === "string" &&
      typeof record?.port === "number"
      ? record
      : undefined;
  } catch {
    return undefined;
  }
}

export function writeBuildRecord(
  derivedData: string,
  record: BuildRecord,
): void {
  writeFileSync(file(derivedData), JSON.stringify(record));
}

// Why the build must run; undefined when the installed build can be reused.
// A debug build bakes in the dev server port, so a new port needs a new build.
export function whyBuild(
  record: BuildRecord | undefined,
  now: BuildRecord,
  installed: boolean,
): string | undefined {
  if (!record) return "no earlier build";
  if (record.fingerprint !== now.fingerprint) return "fingerprint changed";
  if (record.port !== now.port) return "port changed";
  if (!installed) return "app not installed";
  return undefined;
}

// The newest simulator `.app` an earlier build left in DerivedData, or
// undefined when there is none.
export function builtApp(derivedData: string): string | undefined {
  const products = join(derivedData, "Build/Products");
  const apps: { path: string; time: number }[] = [];
  try {
    for (const dir of readdirSync(products)) {
      if (!dir.endsWith("-iphonesimulator")) continue;
      for (const name of readdirSync(join(products, dir))) {
        if (!name.endsWith(".app")) continue;
        const path = join(products, dir, name);
        apps.push({ path, time: statSync(path).mtimeMs });
      }
    }
  } catch {}
  return apps.sort((a, b) => b.time - a.time)[0]?.path;
}
