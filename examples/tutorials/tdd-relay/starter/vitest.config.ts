// npm test runs only test/, so the check suite unzipped into check/ never joins it.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
});
