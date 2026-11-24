export const stackIds = ["expo", "xcode", "gradle"] as const;
export const platforms = ["ios", "android"] as const;
export const packageManagers = ["npm", "yarn", "pnpm", "bun"] as const;

export type StackId = (typeof stackIds)[number];
export type Platform = (typeof platforms)[number];
export type PackageManager = (typeof packageManagers)[number];

// What the core already knows about the project when it asks an adapter.
export type ProjectInfo = {
  packageManager: PackageManager;
  // Runs a locally installed binary: `npx`, `yarn`, `pnpm exec` or `bunx`.
  exec: string;
};

export type StackDetection = {
  stack: StackId;
  platforms: Platform[];
  appIds: Partial<Record<Platform, string>>;
  // Why `launch` cannot go on; it stops on it before building.
  problem?: string;
  // What an agent should know about this app, in one line each.
  notes?: string[];
  // None for a stack with no dev server or run command of its own.
  commands?: {
    // Build, install and launch on a simulator or emulator.
    run: Partial<Record<Platform, string>>;
    // Start the dev server on its own.
    server: string;
  };
};

// How to get an app onto one device. With a dev server: a long-lived server,
// and a build that installs and launches without starting its own server (that
// one would die with the build process). Without one: a build only, and core
// installs the built app. `output`: the folder, relative to the project, where
// an Android build writes its APK.
export type LaunchPlan = { server?: string; build: string; output?: string };

export interface StackAdapter {
  id: StackId;
  // The platforms EMD launches this stack on.
  launches: Platform[];
  detect(
    projectDir: string,
    project: ProjectInfo,
  ): Promise<StackDetection | undefined>;
  // A string says why this project cannot launch as it is.
  launchPlan(
    project: ProjectInfo,
    request: {
      dir: string;
      platform: Platform;
      deviceId: string;
      port: number;
      // Android: the device's CPU ABI, so a debug build compiles native code
      // for it alone.
      abi?: string;
    },
  ): Promise<LaunchPlan | string | undefined>;
  // A hash of everything that needs a new native build when it changes. Throws
  // when it cannot be computed. A stack without one builds on every launch.
  fingerprint?(projectDir: string, platform: Platform): Promise<string>;
}
