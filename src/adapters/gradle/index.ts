import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { StackAdapter } from "../../core/index.js";

// The Android Gradle plugin's application plugin, by id or by a version
// catalog alias such as libs.plugins.android.application.
const appPlugin = /com\.android\.application|plugins\.android\.application/;
const buildFiles = ["build.gradle.kts", "build.gradle"];

// Folders that hold outputs or packages, never a module of the app.
const notModules = new Set(["build", "node_modules"]);

// The subfolders whose build file applies the app plugin.
async function appModules(dir: string): Promise<string[]> {
  const subs = (await readdir(dir, { withFileTypes: true }))
    .filter(
      (e) =>
        e.isDirectory() && !e.name.startsWith(".") && !notModules.has(e.name),
    )
    .map((e) => e.name);
  const found: string[] = [];
  for (const module of subs) {
    for (const file of buildFiles) {
      const text = await readFile(join(dir, module, file), "utf8").catch(
        () => "",
      );
      if (appPlugin.test(text)) {
        found.push(module);
        break;
      }
    }
  }
  return found;
}

const adapter: StackAdapter = {
  id: "gradle",
  // A Gradle build with no Android app module is not a mobile app.
  async detect(dir) {
    const modules = await appModules(dir);
    if (modules.length === 0) return undefined;
    // No app ID: build types and flavors change it, so launch will read it
    // from the built APK.
    return {
      stack: "gradle",
      platforms: ["android"],
      appIds: {},
      problem: "EMD detects native Android apps but does not launch them yet.",
      notes: [`Android app module: ${modules.join(", ")}.`],
    };
  },
  launchPlan: async () => undefined,
};

export default adapter;
