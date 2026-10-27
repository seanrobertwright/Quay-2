// The check suite's own config, since the project's runs only test/. From the project folder:
// npx vitest run --config check/vitest.config.ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL("..", import.meta.url)),
  test: { include: ["check/**/*.check.test.ts"] },
});
