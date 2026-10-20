import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkStarters, type Command, type CommandResult } from "./starters.ts";

// Writes a tutorials folder, `{ "<slug>/starter/package.json": "..." }`, into a fresh temp dir.
// A path given `undefined` is left out.
function tutorials(files: Record<string, string | undefined>): string {
  const root = mkdtempSync(join(tmpdir(), "starters-ci-test-"));
  for (const [path, content] of Object.entries(files)) {
    if (content === undefined) continue;
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
// reporter arguments the checker adds, and records every command it was given. A list answers
// successive runs of the same command line in turn. Command lines not in `script` succeed with no
// output.
function fakeRunner(script: Record<string, Scripted | Scripted[]> = {}) {
  const calls: Command[] = [];
  const run = (command: Command): CommandResult => {
    const runsBefore = calls.filter((call) => label(call) === label(command)).length;
    calls.push(command);
    const outputFile = command.argv.find((arg) => arg.startsWith("--outputFile="))?.slice("--outputFile=".length);
    const answer = script[label(command)];
    const scripted = (Array.isArray(answer) ? answer[runsBefore] : answer) ?? {};
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
function oneStarter(slug: string, state: unknown, extra: Record<string, string | undefined> = {}): string {
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

const a2a9 = {
  typecheck: { expect: "pass" },
  tests: { expect: "pass" },
  scripts: [
    {
      name: "check:readme",
      expect: "fail",
      exitCode: 1,
      outputIncludes: ["FAIL sample 1", "0 of 1 samples ran as written"],
      producesFiles: [".readme-samples/report.md"],
    },
  ],
};

test("named scripts expected to fail while npm test and typecheck stay green: the docs' premise passes (A2A 9)", () => {
  const dir = oneStarter("docs-that-cant-lie", a2a9);
  const runner = fakeRunner({
    "npm test": { vitest: { passed: 5 } },
    "npm run check:readme": {
      exitCode: 1,
      output: "FAIL sample 1\n0 of 1 samples ran as written\n",
      writes: { ".readme-samples/report.md": "# Report" },
    },
  });
  assert.deepEqual(checkStarters({ tutorialsDir: dir, run: runner.run, log: quiet }).failures, []);
  assert.ok(runner.labels().includes("npm run check:readme"));
});

test("named scripts expected to fail: another exit code, missing output or no report fails the starter (A2A 9)", () => {
  const dir = oneStarter("docs-that-cant-lie", a2a9);
  const runner = fakeRunner({
    "npm test": { vitest: { passed: 5 } },
    "npm run check:readme": { exitCode: 2, output: "FAIL sample 1\n" },
  });
  assert.deepEqual(checkStarters({ tutorialsDir: dir, run: runner.run, log: quiet }).failures, [
    "docs-that-cant-lie: npm run check:readme: expected exit 1, got 2",
    'docs-that-cant-lie: npm run check:readme: output lacks "0 of 1 samples ran as written"',
    "docs-that-cant-lie: npm run check:readme: expected it to leave .readme-samples/report.md, which is missing",
  ]);
});

test("a per-starter environment reaches every command, the bench included (A2A 6, BENCH_TIME_MS=500)", () => {
  const dir = oneStarter("fire-then-poll", {
    env: { BENCH_TIME_MS: "500" },
    typecheck: { expect: "pass" },
    tests: { expect: "pass", passed: 6 },
    scripts: [{ name: "bench", expect: "pass" }],
  });
  const runner = fakeRunner({ "npm test": { vitest: { passed: 6 } } });
  assert.deepEqual(checkStarters({ tutorialsDir: dir, run: runner.run, log: quiet }).failures, []);
  assert.deepEqual(
    runner.calls.map((call) => [label(call), call.env]),
    [
      ["npm ci", { BENCH_TIME_MS: "500" }],
      ["npx --no tsc --noEmit", { BENCH_TIME_MS: "500" }],
      ["npm test", { BENCH_TIME_MS: "500" }],
      ["npm run bench", { BENCH_TIME_MS: "500" }],
    ],
  );
});

const a2a7 = {
  typecheck: { expect: "pass" },
  tests: { expect: "pass" },
  patch: { file: "patches/late-change.patch", failingTests: ["pads cents under ten with a zero"] },
};
const latePatch = { "broadcast/starter/patches/late-change.patch": "--- a/src/price.ts\n+++ b/src/price.ts\n" };

test("ships green, and the named patch breaks exactly the named test (A2A 7)", () => {
  const dir = oneStarter("broadcast", a2a7, latePatch);
  const runner = fakeRunner({
    "npm test": [
      { vitest: { passed: ["pads cents under ten with a zero", "formats whole euros"] } },
      { vitest: { passed: ["formats whole euros"], failed: ["pads cents under ten with a zero"] } },
    ],
  });
  assert.deepEqual(checkStarters({ tutorialsDir: dir, run: runner.run, log: quiet }).failures, []);
  assert.deepEqual(runner.labels(), [
    "npm ci",
    "npx --no tsc --noEmit",
    "npm test",
    "git apply patches/late-change.patch",
    "npm test",
  ]);
});

test("ships green with a patch: a patch that breaks another test too fails the starter (A2A 7)", () => {
  const dir = oneStarter("broadcast", a2a7, latePatch);
  const runner = fakeRunner({
    "npm test": [
      { vitest: { passed: ["pads cents under ten with a zero", "formats whole euros"] } },
      { vitest: { failed: ["pads cents under ten with a zero", "formats whole euros"] } },
    ],
  });
  assert.deepEqual(checkStarters({ tutorialsDir: dir, run: runner.run, log: quiet }).failures, [
    'broadcast: after patches/late-change.patch: expected exactly "pads cents under ten with a zero" to fail, got "pads cents under ten with a zero", "formats whole euros"',
  ]);
});

test("ships green with a patch: a patch that no longer applies fails the starter (A2A 7)", () => {
  const dir = oneStarter("broadcast", a2a7, latePatch);
  const runner = fakeRunner({
    "npm test": { vitest: { passed: 2 } },
    "git apply patches/late-change.patch": { exitCode: 1, output: "error: patch failed: src/price.ts:3" },
  });
  assert.deepEqual(checkStarters({ tutorialsDir: dir, run: runner.run, log: quiet }).failures, [
    "broadcast: git apply patches/late-change.patch exited 1\nerror: patch failed: src/price.ts:3",
  ]);
});

const swarm6 = {
  typecheck: { expect: "pass" },
  tests: { expect: "pass", passed: 8 },
  checkSuite: { script: "check", expect: "fail", failed: 6, total: 6 },
  files: { present: [".env.example"], absent: [".env"], linesAbsent: { ".gitignore": [".env"] } },
};
const swarm6Files = {
  "red-team-blue-team/starter/.env.example": "NOTES_DB=data/notes.db\n",
  "red-team-blue-team/starter/.gitignore": "node_modules/\ndata/*.db\n",
  "red-team-blue-team/check/holes.test.ts": "// six tests",
};

test("Swarm 6: its red check run and its .env.example pass", () => {
  const dir = oneStarter("red-team-blue-team", swarm6, swarm6Files);
  const runner = fakeRunner({
    "npm test": { vitest: { passed: 8 } },
    "npm run check": { vitest: { failed: 6 } },
  });
  assert.deepEqual(checkStarters({ tutorialsDir: dir, run: runner.run, log: quiet }).failures, []);
  assert.ok(runner.labels().includes("npm run check"));
});

test("Swarm 6: a closed hole, a missing .env.example, a shipped .env or a .env ignore line fails the starter", () => {
  const dir = oneStarter("red-team-blue-team", swarm6, {
    ...swarm6Files,
    "red-team-blue-team/starter/.env.example": undefined,
    "red-team-blue-team/starter/.env": "NOTES_DB=data/notes.db\n",
    "red-team-blue-team/starter/.gitignore": "node_modules/\r\n.env\r\n",
  });
  const runner = fakeRunner({
    "npm test": { vitest: { passed: 8 } },
    "npm run check": { vitest: { failed: 5, passed: 1 } },
  });
  assert.deepEqual(checkStarters({ tutorialsDir: dir, run: runner.run, log: quiet }).failures, [
    "red-team-blue-team: files: .env.example is missing",
    "red-team-blue-team: files: .env is present and must not be",
    'red-team-blue-team: files: .gitignore has the line ".env" and must not',
    "red-team-blue-team: check suite: expected 6 of 6 failing, got 5 of 6",
  ]);
});
