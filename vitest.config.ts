import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, ".claude/worktrees/**"],
    // Most tests start the CLI, a node process, which is slow on a busy machine (#191).
    testTimeout: 25_000,
  },
});
