import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, ".claude/worktrees/**"],
    // Tests start the CLI (a node process). On a busy machine one test took up to 11.6 s.
    testTimeout: 25_000,
    hookTimeout: 25_000,
  },
});
