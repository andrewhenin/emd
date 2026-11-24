import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { type Platform, runTool, type StackAdapter } from "../../core/index.js";

type ExpoConfig = {
  platforms?: unknown;
  bundleIdentifier?: unknown;
  ios?: { bundleIdentifier?: unknown };
  android?: { package?: unknown };
};

// The config as Expo resolves it (app.json, app.config.js or app.config.ts),
// from the project's installed Expo CLI. Node's resolution finds a hoisted
// install and never downloads one, as `npx expo` would.
async function readExpoConfig(
  dir: string,
): Promise<{ config: ExpoConfig; error?: string }> {
  try {
    const cli = createRequire(join(dir, "package.json")).resolve(
      "expo/bin/cli",
    );
    const { stdout } = await runTool(
      "expo config",
      process.execPath,
      [cli, "config", dir, "--json"],
      60,
    );
    return { config: JSON.parse(stdout) ?? {} };
  } catch (error) {
    const line =
      String(error)
        .split("\n")[0]
        ?.replace(/^Error: /, "") ?? "";
    return { config: {}, error: line.slice(0, 200) };
  }
}

// Expo's own fingerprint, from the project's installed Expo (never downloaded).
async function expoFingerprint(
  dir: string,
  platform: Platform,
): Promise<string> {
  const fromExpo = createRequire(
    createRequire(join(dir, "package.json")).resolve("expo/bin/cli"),
  );
  const { createFingerprintAsync } = fromExpo("@expo/fingerprint");
  const { hash } = await createFingerprintAsync(dir, {
    platforms: [platform],
  });
  return hash;
}

const isPlatform = (value: unknown): value is Platform =>
  value === "ios" || value === "android";

const nonEmpty = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

const adapter: StackAdapter = {
  id: "expo",
  launches: ["ios"],
  async detect(dir, project) {
    const { config, error } = await readExpoConfig(dir);
    const declared = Array.isArray(config.platforms)
      ? [...new Set(config.platforms.filter(isPlatform))]
      : [];
    const platforms: Platform[] =
      declared.length > 0 ? declared : ["ios", "android"];

    const appIds: Partial<Record<Platform, string>> = {};
    const ios = nonEmpty(config.ios?.bundleIdentifier);
    const android = nonEmpty(config.android?.package);
    if (ios && platforms.includes("ios")) appIds.ios = ios;
    if (android && platforms.includes("android")) appIds.android = android;

    // Expo sets the ID only when it generates ios/, so with ios/ and no ID
    // the build would run for minutes and still find none.
    const noId = platforms.includes("ios") && !appIds.ios && !error;
    const hasIos = existsSync(join(dir, "ios"));
    const atLaunch =
      "At launch, Expo's build sets ios.bundleIdentifier in the app config.";
    const notes: string[] = [];
    if (noId && !hasIos) {
      notes.push(
        typeof config.bundleIdentifier === "string"
          ? `bundleIdentifier is set directly under expo; Expo reads ios.bundleIdentifier, so the app has no iOS app ID. ${atLaunch}`
          : `The app has no iOS app ID. ${atLaunch}`,
      );
    }

    const expo = `${project.exec} expo`;
    const run: Partial<Record<Platform, string>> = {};
    for (const platform of platforms) run[platform] = `${expo} run:${platform}`;

    return {
      stack: "expo",
      platforms,
      appIds,
      ...(error && {
        problem: `The app config could not be read: ${error}. Install the app's dependencies.`,
      }),
      ...(noId &&
        hasIos && {
          problem:
            "The app has an ios/ folder and no ios.bundleIdentifier in the app config. Expo sets the ID only when it creates ios/. Set ios.bundleIdentifier in the app config.",
        }),
      ...(notes.length > 0 && { notes }),
      commands: { run, server: `${expo} start` },
    };
  },
  async launchPlan(project, { platform, deviceId, port }) {
    if (platform !== "ios") return undefined;
    const expo = `${project.exec} expo`;
    return {
      server: `${expo} start --port ${port}`,
      build: `${expo} run:ios --device ${deviceId} --no-bundler`,
    };
  },
  fingerprint: expoFingerprint,
};

export default adapter;
