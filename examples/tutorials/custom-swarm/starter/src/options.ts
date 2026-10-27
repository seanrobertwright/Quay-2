// The options src/cli.ts declares to parseArgs. test/readme.test.ts reads them from here too.

import type { ParseArgsOptionsConfig } from "node:util";

export const OPTIONS = {
  lines: { type: "boolean", short: "l" },
  words: { type: "boolean", short: "w" },
  chars: { type: "boolean", short: "c" },
  json: { type: "boolean", short: "j" },
  help: { type: "boolean", short: "h" },
} as const satisfies ParseArgsOptionsConfig;
