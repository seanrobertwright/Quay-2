import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = join(import.meta.dirname, "check-starters.ts");

function checkStarters(...args: string[]) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  return { status: result.status, output: result.stdout + result.stderr };
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "starters-ci-cli-"));
  test.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("exits 0 when there are no starters yet", () => {
  const result = checkStarters("--tutorials", join(tempDir(), "examples", "tutorials"));
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /No starters/);
});

test("exits 1 and names a starter that has no expected-state entry", () => {
  const dir = tempDir();
  mkdirSync(join(dir, "first-swarm", "starter"), { recursive: true });
  writeFileSync(join(dir, "first-swarm", "starter", "package.json"), "{}");
  const result = checkStarters("--tutorials", dir);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /first-swarm: no expected-state\.json beside starter\//);
});

test("exits 2 on an argument it doesn't know", () => {
  const result = checkStarters("--tutorial", "examples/tutorials");
  assert.equal(result.status, 2, result.output);
  assert.match(result.output, /Unknown option '--tutorial'/);
});
