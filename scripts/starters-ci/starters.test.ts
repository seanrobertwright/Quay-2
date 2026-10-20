import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkStarters, type Command, type CommandResult } from "./starters.ts";

// Writes a tutorials folder, `{ "<slug>/starter/package.json": "..." }`, into a fresh temp dir.
function tutorials(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "starters-ci-test-"));
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  test.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

const quiet = () => {};

// One Vitest run as its JSON reporter (the Jest-compatible format) writes it. A number stands
// for that many unnamed tests.
type VitestRun = { passed?: number | string[]; failed?: number | string[]; todo?: number | string[] };

function vitestReport(run: VitestRun): string {
  const names = (value: number | string[] | undefined, status: string) =>
    typeof value === "number" ? Array.from({ length: value }, (_, i) => `${status} test ${i + 1}`) : (value ?? []);
  const assertionResults = [
    ...names(run.passed, "passed").map((title) => ({ title, status: "passed" })),
    ...names(run.failed, "failed").map((title) => ({ title, status: "failed" })),
    ...names(run.todo, "todo").map((title) => ({ title, status: "todo" })),
  ].map((result) => ({ ...result, ancestorTitles: ["suite"], fullName: `suite ${result.title}` }));
  const count = (status: string) => assertionResults.filter((result) => result.status === status).length;
  return JSON.stringify({
    numTotalTests: assertionResults.length,
    numPassedTests: count("passed"),
    numFailedTests: count("failed"),
    numTodoTests: count("todo"),
    numPendingTests: 0,
    success: count("failed") === 0,
    testResults: [{ name: "test/main.test.ts", status: count("failed") ? "failed" : "passed", assertionResults }],
  });
}

// What the fake process does for one command line. A Vitest command writes `vitest` as its JSON
// report and exits 1 when a test failed, as Vitest does.
type Scripted = { exitCode?: number; output?: string; vitest?: VitestRun; writes?: Record<string, string> };

// A runner that answers each command line from `script`, keyed by the command line without the
// reporter arguments the checker adds, and records every command it was given. Command lines not
// in `script` succeed with no output.
function fakeRunner(script: Record<string, Scripted> = {}) {
  const calls: Command[] = [];
  const run = (command: Command): CommandResult => {
    calls.push(command);
    const outputFile = command.argv.find((arg) => arg.startsWith("--outputFile="))?.slice("--outputFile=".length);
    const scripted = script[label(command)] ?? {};
    for (const [path, content] of Object.entries(scripted.writes ?? {})) {
      mkdirSync(dirname(join(command.cwd, path)), { recursive: true });
      writeFileSync(join(command.cwd, path), content);
    }
    if (outputFile !== undefined) {
      assert.ok(scripted.vitest, `no Vitest run scripted for "${label(command)}"`);
      writeFileSync(outputFile, vitestReport(scripted.vitest));
      const failed = scripted.vitest.failed;
      const anyFailed = typeof failed === "number" ? failed > 0 : (failed ?? []).length > 0;
      return { exitCode: scripted.exitCode ?? (anyFailed ? 1 : 0), output: scripted.output ?? "" };
    }
    return { exitCode: scripted.exitCode ?? 0, output: scripted.output ?? "" };
  };
  return { run, calls, labels: () => calls.map(label) };
}

function label(command: Command): string {
  const argv = command.argv.filter((arg) => !arg.startsWith("--reporter=") && !arg.startsWith("--outputFile="));
  if (argv.at(-1) === "--") argv.pop();
  return argv.join(" ");
}

const exactPackage = JSON.stringify({ name: "starter", devDependencies: { vitest: "4.1.5", typescript: "6.0.3" } });

test("passes with no starters when the tutorials folder does not exist", () => {
  const report = checkStarters({
    tutorialsDir: join(tmpdir(), "starters-ci-no-such-folder"),
    run: () => assert.fail("no command should run"),
    log: quiet,
  });
  assert.deepEqual(report, { starters: [], failures: [] });
});

test("fails a starter that has no expected-state entry, before running anything", () => {
  const report = checkStarters({
    tutorialsDir: tutorials({ "first-swarm/starter/package.json": "{}" }),
    run: () => assert.fail("no command should run"),
    log: quiet,
  });
  assert.deepEqual(report.failures, [
    "first-swarm: no expected-state.json beside starter/; every starter needs an expected-state entry",
  ]);
});

test("tests green: a skeleton whose one todo counts as green passes (Swarm 2)", () => {
  const dir = tutorials({
    "tdd-swarm-kata/starter/package.json": exactPackage,
    "tdd-swarm-kata/expected-state.json": JSON.stringify({
      typecheck: { expect: "pass" },
      tests: { expect: "pass", todo: 1 },
    }),
  });
  const runner = fakeRunner({ "npm test": { vitest: { todo: 1 } } });
  const report = checkStarters({ tutorialsDir: dir, run: runner.run, log: quiet });
  assert.deepEqual(report, { starters: ["tdd-swarm-kata"], failures: [] });
  assert.deepEqual(runner.labels(), ["npm ci", "npx --no tsc --noEmit", "npm test"]);
  for (const call of runner.calls) assert.ok(!call.cwd.startsWith(dir), "commands run in a copy of the starter");
});

// A tutorials folder holding one starter, `slug`, with `state` as its expected state.
function oneStarter(slug: string, state: unknown, extra: Record<string, string> = {}): string {
  return tutorials({
    [`${slug}/starter/package.json`]: exactPackage,
    [`${slug}/expected-state.json`]: JSON.stringify(state),
    ...extra,
  });
}

test("tests red with a count: a starter failing exactly that many passes (Swarm 1, 5 failing)", () => {
  const dir = oneStarter("first-swarm", { typecheck: { expect: "pass" }, tests: { expect: "fail", failed: 5 } });
  const runner = fakeRunner({ "npm test": { vitest: { failed: 5 } } });
  assert.deepEqual(checkStarters({ tutorialsDir: dir, run: runner.run, log: quiet }).failures, []);
});

test("tests red with a count: a different count fails the starter (Swarm 3, 7 of 8 failing)", () => {
  const dir = oneStarter("full-stack-pair", {
    typecheck: { expect: "pass" },
    tests: { expect: "fail", failed: 7, total: 8 },
  });
  const runner = fakeRunner({ "npm test": { vitest: { failed: 6, passed: 2 } } });
  assert.deepEqual(checkStarters({ tutorialsDir: dir, run: runner.run, log: quiet }).failures, [
    "full-stack-pair: tests: expected 7 of 8 failing, got 6 of 8",
  ]);
});

test("tests green: a starter with a failing test fails", () => {
  const dir = oneStarter("hello-a2a", { typecheck: { expect: "pass" }, tests: { expect: "pass", passed: 3 } });
  const runner = fakeRunner({ "npm test": { vitest: { passed: 2, failed: 1 } } });
  assert.deepEqual(checkStarters({ tutorialsDir: dir, run: runner.run, log: quiet }).failures, [
    "hello-a2a: tests: expected green with 3 passed, got 1 failing, 2 passed, 0 todo",
  ]);
});

const swarm7 = {
  typecheck: { expect: "fail", lineStartsWith: "Found 24 errors" },
  tests: { expect: "pass", passed: 12 },
};

test("typecheck red with an exact line plus a test count: the planted errors pass (Swarm 7)", () => {
  const dir = oneStarter("js-to-typescript", swarm7);
  const runner = fakeRunner({
    "npx --no tsc --noEmit": { exitCode: 2, output: "src/a.ts(1,1): error TS7006\r\n\r\nFound 24 errors in 6 files.\r\n" },
    "npm test": { vitest: { passed: 12 } },
  });
  assert.deepEqual(checkStarters({ tutorialsDir: dir, run: runner.run, log: quiet }).failures, []);
});

test("typecheck red with an exact line: another error count fails the starter (Swarm 7)", () => {
  const dir = oneStarter("js-to-typescript", swarm7);
  const runner = fakeRunner({
    "npx --no tsc --noEmit": { exitCode: 2, output: "Found 240 errors in 6 files.\n" },
    "npm test": { vitest: { passed: 12 } },
  });
  assert.deepEqual(checkStarters({ tutorialsDir: dir, run: runner.run, log: quiet }).failures, [
    'js-to-typescript: typecheck: expected tsc --noEmit to fail with a line starting "Found 24 errors", it exited 2 without one\nFound 240 errors in 6 files.',
  ]);
});

test("typecheck red: a clean type check fails the starter (Swarm 7)", () => {
  const dir = oneStarter("js-to-typescript", swarm7);
  const runner = fakeRunner({ "npm test": { vitest: { passed: 12 } } });
  assert.deepEqual(checkStarters({ tutorialsDir: dir, run: runner.run, log: quiet }).failures, [
    'js-to-typescript: typecheck: expected tsc --noEmit to fail with a line starting "Found 24 errors", it exited 0',
  ]);
});

const swarm5 = {
  typecheck: { expect: "pass" },
  tests: { expect: "pass", passed: 7 },
  checkSuite: { vitest: ["run", "check"], expect: "fail", failed: 4, total: 6 },
};

test("check suite failing against the starter: it runs from check/ beside src/ after npm test (Swarm 5, 4 of 6)", () => {
  const dir = oneStarter("bug-hunt", swarm5, { "bug-hunt/check/cart.check.test.ts": "// six tests" });
  const runner = fakeRunner({
    "npm test": { vitest: { passed: 7 } },
    "npx --no vitest run check": { vitest: { failed: 4, passed: 2 } },
  });
  const checkPresent: Record<string, boolean> = {};
  const run = (command: Command) => {
    checkPresent[label(command)] = existsSync(join(command.cwd, "check", "cart.check.test.ts"));
    return runner.run(command);
  };
  assert.deepEqual(checkStarters({ tutorialsDir: dir, run, log: quiet }).failures, []);
  assert.deepEqual(checkPresent, {
    "npm ci": false,
    "npx --no tsc --noEmit": false,
    "npm test": false,
    "npx --no vitest run check": true,
  });
});

test("check suite failing against the starter: a green check run fails the starter (Swarm 5)", () => {
  const dir = oneStarter("bug-hunt", swarm5, { "bug-hunt/check/cart.check.test.ts": "// six tests" });
  const runner = fakeRunner({
    "npm test": { vitest: { passed: 7 } },
    "npx --no vitest run check": { vitest: { passed: 6 } },
  });
  assert.deepEqual(checkStarters({ tutorialsDir: dir, run: runner.run, log: quiet }).failures, [
    "bug-hunt: check suite: expected 4 of 6 failing, got 0 of 6",
  ]);
});
