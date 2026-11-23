import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { StackId } from "./adapter.js";

// Tools that generate or replace the Xcode project. The xcode adapter names
// the one it finds as the reason launch stops.
export const xcodeGenerators: [file: RegExp, tool: string][] = [
  [/^Project\.swift$/, "Tuist"],
  [/^project\.yml$/, "XcodeGen"],
  [/^(MODULE\.bazel|WORKSPACE(\.bazel)?)$/, "Bazel"],
];

const xcodeProject = /\.(xcworkspace|xcodeproj)$/;

// Cheap file probe that decides which adapter to load. No adapter code runs here.
// Expo comes first: its ios/ and android/ folders hold Xcode and Gradle files
// that do not make the app native. Native markers count only in the root folder.
export async function probeStack(dir: string): Promise<StackId | undefined> {
  try {
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    if ("expo" in { ...pkg.dependencies, ...pkg.devDependencies }) {
      return "expo";
    }
  } catch {}
  const names = await readdir(dir).catch(() => []);
  const marker = (n: string) =>
    xcodeProject.test(n) || xcodeGenerators.some(([file]) => file.test(n));
  if (names.some(marker)) return "xcode";
  return names.some((n) => gradleSettings.test(n)) ? "gradle" : undefined;
}

const gradleSettings = /^settings\.gradle(\.kts)?$/;
