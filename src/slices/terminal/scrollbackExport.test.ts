import { test } from "node:test";
import assert from "node:assert/strict";
import { scrollbackFileName } from "./scrollbackExport.ts";

// The file name reads the process's zone, so these tests fix it.
test("an evening export west of UTC is named for the local day, not the UTC one", () => {
  process.env.TZ = "America/New_York";
  // 20:00 on the 26th in New York is 01:00 on the 27th in UTC.
  const ms = Date.UTC(2026, 10, 27, 1, 0);
  assert.equal(scrollbackFileName("build", ms), "build-2026-11-26.log");
});

test("the terminal name keeps only letters, digits, dashes and underscores", () => {
  process.env.TZ = "America/New_York";
  assert.equal(scrollbackFileName("my shell/2.x", Date.UTC(2026, 10, 15, 12, 0)), "my_shell_2_x-2026-11-15.log");
});
