import { createRequire } from "node:module";
import { join } from "node:path";
import { type Platform, runTool, type StackAdapter } from "../../core/index.js";

type ExpoConfig = {
  platforms?: unknown;
  ios?: { bundleIdentifier?: unknown };
  android?: { package?: unknown };
};

// The config as Expo resolves it (app.json, app.config.js or app.config.ts),
// from the project's installed Expo CLI. Node's resolution finds a hoisted
// install and never downloads one, as `npx expo` would.
async function readExpoConfig(dir: string): Promise<ExpoConfig> {
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
    return JSON.parse(stdout) ?? {};
  } catch {
    return {};
  }
}

const isPlatform = (value: unknown): value is Platform =>
  value === "ios" || value === "android";

const nonEmpty = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

const adapter: StackAdapter = {
  id: "expo",
  async detect(dir, project) {
    const config = await readExpoConfig(dir);
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

    const expo = `${project.exec} expo`;
    const run: Partial<Record<Platform, string>> = {};
    for (const platform of platforms) run[platform] = `${expo} run:${platform}`;

    return {
      stack: "expo",
      platforms,
      appIds,
      commands: { run, server: `${expo} start` },
    };
  },
  launchPlan(project, { platform, deviceId, port }) {
    if (platform !== "ios") return undefined;
    const expo = `${project.exec} expo`;
    return {
      server: `${expo} start --port ${port}`,
      build: `${expo} run:ios --device ${deviceId} --no-bundler`,
    };
  },
};

export default adapter;
