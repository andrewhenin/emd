import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { StackId } from "./adapter.js";

// Cheap file probe that decides which adapter to load. No adapter code runs here.
// Expo and React Native come first: their ios/ folder holds Xcode files that do
// not make the app native iOS. Xcode markers count only in the root folder.
export async function probeStack(dir: string): Promise<StackId | undefined> {
  try {
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if ("expo" in deps) return "expo";
    if ("react-native" in deps) return undefined;
  } catch {}
  return (await readdir(dir).catch(() => [])).some(isXcodeMarker)
    ? "xcode"
    : undefined;
}

// An Xcode workspace or project, or a tool that builds one: Tuist, XcodeGen, Bazel.
const xcodeMarker =
  /\.(xcworkspace|xcodeproj)$|^(Project\.swift|project\.yml|MODULE\.bazel|WORKSPACE(\.bazel)?)$/;
const isXcodeMarker = (name: string) => xcodeMarker.test(name);
