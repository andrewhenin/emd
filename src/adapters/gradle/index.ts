import { access, readdir, readFile } from "node:fs/promises";
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
  launches: ["android"],
  // A Gradle build with no Android app module is not a mobile app.
  async detect(dir) {
    const modules = await appModules(dir);
    if (modules.length === 0) return undefined;
    // No app ID: build types and flavors change it, so launch reads it after
    // the build.
    return {
      stack: "gradle",
      platforms: ["android"],
      appIds: {},
      notes: [`Android app module: ${modules.join(", ")}.`],
    };
  },
  // The Gradle wrapper builds the debug APK of the one app module.
  async launchPlan(_project, { dir, platform }) {
    if (platform !== "android") return undefined;
    const modules = await appModules(dir);
    if (modules.length > 1) {
      return `This project has several Android app modules: ${modules.join(", ")}. EMD launches a project with one.`;
    }
    const [module] = modules;
    if (!module) return undefined;
    if (
      !(await access(join(dir, "gradlew")).then(
        () => true,
        () => false,
      ))
    ) {
      return "This project has no Gradle wrapper (gradlew). Add one with `gradle wrapper`.";
    }
    return {
      build: `./gradlew --console=plain :${module}:assembleDebug`,
      output: join(module, "build", "outputs", "apk", "debug"),
    };
  },
};

export default adapter;
