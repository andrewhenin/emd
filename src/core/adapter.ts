export const stackIds = ["expo"] as const;
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
  commands: {
    // Build, install and launch on a simulator or emulator.
    run: Partial<Record<Platform, string>>;
    // Start the dev server on its own.
    server: string;
  };
};

export interface StackAdapter {
  id: StackId;
  detect(
    projectDir: string,
    project: ProjectInfo,
  ): Promise<StackDetection | undefined>;
}
