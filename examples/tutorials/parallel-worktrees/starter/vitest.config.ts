import { configDefaults, defineConfig } from "vitest/config";

// Quay puts each git worktree in .worktrees/<branch> inside the project. Leave them out, so the
// project's own test run never runs an experiment's tests too.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, ".worktrees/**"],
  },
});
