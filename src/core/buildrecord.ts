import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { plistValue } from "./tool.js";

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

// The one `.app` an earlier Debug build left in DerivedData (launch builds
// Debug). Undefined when there is none or more than one.
export function builtApp(derivedData: string): string | undefined {
  const dir = join(derivedData, "Build/Products/Debug-iphonesimulator");
  try {
    const apps = readdirSync(dir).filter((name) => name.endsWith(".app"));
    return apps.length === 1 ? join(dir, apps[0] ?? "") : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

// The APK in an Android build's output folder and its app ID. The Android Gradle
// plugin writes both to output-metadata.json next to the APK, after build types
// and flavors changed the ID, so no SDK tool has to read the APK.
export function builtApk(dir: string): { apk: string; appId: string } {
  const path = join(dir, "output-metadata.json");
  const metadata = JSON.parse(readFileSync(path, "utf8")) as {
    applicationId?: string;
    elements?: { outputFile?: string }[];
  };
  const files = (metadata.elements ?? []).flatMap((e) =>
    e.outputFile ? [e.outputFile] : [],
  );
  const [file] = files;
  if (!metadata.applicationId || !file || files.length > 1) {
    throw new Error(
      `${path} must name one APK and its applicationId; it names ${files.length} APKs.`,
    );
  }
  return { apk: join(dir, file), appId: metadata.applicationId };
}

// The built app's own ID (CFBundleIdentifier), whatever set it: the app config,
// build settings or an xcconfig file.
export async function builtAppId(
  derivedData: string,
): Promise<string | undefined> {
  const app = builtApp(derivedData);
  if (!app) return undefined;
  return (
    (await plistValue(join(app, "Info.plist"), "CFBundleIdentifier").catch(
      () => "",
    )) || undefined
  );
}
