import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

/** One process the checker starts. `env` holds only the starter's own variables. */
export type Command = { argv: string[]; cwd: string; env: Record<string, string> };
/** What a finished process left behind: its exit code and its stdout and stderr together. */
export type CommandResult = { exitCode: number; output: string };
export type Runner = (command: Command) => CommandResult;

export type CheckOptions = {
  /** The folder holding one `<slug>/` per tutorial, normally `examples/tutorials`. */
  tutorialsDir: string;
  run: Runner;
  log?: (line: string) => void;
};

/** The starters checked, by slug, and every way one of them missed its expected state. */
export type CheckReport = { starters: string[]; failures: string[] };

type TestsState = { expect: "pass"; passed?: number; todo?: number } | { expect: "fail"; failed: number; total?: number };
type TypecheckState = { expect: "pass" } | { expect: "fail"; lineStartsWith: string };
/** How the check suite runs: an npm script, or Vitest with these arguments. */
type CheckSuiteState = ({ script: string } | { vitest: string[] }) & TestsState;
/** A named npm script and how it must end: its exit, text its output holds, files it leaves. */
type ScriptState = {
  name: string;
  outputIncludes?: string[];
  producesFiles?: string[];
} & ({ expect: "pass" } | { expect: "fail"; exitCode?: number });
/** Paths in the starter that must be there or not, and lines a file must not hold. */
type FilesState = { present?: string[]; absent?: string[]; linesAbsent?: Record<string, string[]> };
/** A patch the learner applies late in the tutorial, and exactly the tests it must break. */
type PatchState = { file: string; failingTests: string[] };
type ExpectedState = {
  env?: Record<string, string>;
  typecheck: TypecheckState;
  tests: TestsState;
  scripts?: ScriptState[];
  checkSuite?: CheckSuiteState;
  patch?: PatchState;
  files?: FilesState;
};

const EXPECTED_STATE_FILE = "expected-state.json";

export function checkStarters(options: CheckOptions): CheckReport {
  const log = options.log ?? console.log;
  if (!existsSync(options.tutorialsDir)) {
    log(`No starters: ${options.tutorialsDir} does not exist.`);
    return { starters: [], failures: [] };
  }
  const slugs = readdirSync(options.tutorialsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const failures: string[] = [];
  const states = new Map<string, ExpectedState>();
  for (const slug of slugs) {
    const tutorialDir = join(options.tutorialsDir, slug);
    const stateFile = join(tutorialDir, EXPECTED_STATE_FILE);
    if (!existsSync(stateFile)) {
      failures.push(`${slug}: no ${EXPECTED_STATE_FILE} beside starter/; every starter needs an expected-state entry`);
      continue;
    }
    states.set(slug, JSON.parse(readFileSync(stateFile, "utf8")) as ExpectedState);
  }
  if (failures.length > 0) return { starters: slugs, failures };

  for (const [slug, state] of states) {
    for (const failure of checkStarter(join(options.tutorialsDir, slug), state, options.run)) {
      failures.push(`${slug}: ${failure}`);
    }
  }
  return { starters: slugs, failures };
}

/** Runs one starter in a throwaway copy and returns how it missed its expected state. */
function checkStarter(tutorialDir: string, state: ExpectedState, run: Runner): string[] {
  // The project is the learner's copy of the starter; Vitest's reports go beside it, not in it.
  const root = mkdtempSync(join(tmpdir(), `starter-${basename(tutorialDir)}-`));
  const work = join(root, "project");
  const report = (name: string) => join(root, `${name}.json`);
  try {
    cpSync(join(tutorialDir, "starter"), work, {
      recursive: true,
      filter: (source) => basename(source) !== "node_modules",
    });
    const inProject = (argv: string[]) => run({ argv, cwd: work, env: state.env ?? {} });
    // Files are checked as the learner receives them, before anything runs.
    const failures = state.files === undefined ? [] : compareFiles(state.files, work);
    const install = inProject(["npm", "ci"]);
    if (install.exitCode !== 0) {
      failures.push(`npm ci exited ${install.exitCode}${outputTail(install.output)}`);
      return failures;
    }
    const typecheck = inProject(["npx", "--no", "tsc", "--noEmit"]);
    failures.push(...compareTypecheck(state.typecheck, typecheck));
    const tests = inProject(["npm", "test", "--", ...vitestReporterArgs(report("tests"))]);
    failures.push(...compareTests("tests", state.tests, tests, report("tests")));

    for (const script of state.scripts ?? []) {
      const result = inProject(["npm", "run", script.name]);
      failures.push(...compareScript(script, result, work));
    }

    if (state.checkSuite !== undefined) {
      // The learner unzips the check suite into the project so check/ sits beside src/.
      cpSync(join(tutorialDir, "check"), join(work, "check"), { recursive: true });
      const command =
        "script" in state.checkSuite
          ? ["npm", "run", state.checkSuite.script, "--"]
          : ["npx", "--no", "vitest", ...state.checkSuite.vitest];
      const check = inProject([...command, ...vitestReporterArgs(report("check"))]);
      failures.push(...compareTests("check suite", state.checkSuite, check, report("check")));
    }

    if (state.patch !== undefined) {
      // Last, because it changes the project: the learner's late commit in the tutorial.
      const apply = inProject(["git", "apply", state.patch.file]);
      if (apply.exitCode !== 0) {
        failures.push(`git apply ${state.patch.file} exited ${apply.exitCode}${outputTail(apply.output)}`);
        return failures;
      }
      const patched = inProject(["npm", "test", "--", ...vitestReporterArgs(report("patched"))]);
      failures.push(...comparePatchedTests(state.patch, patched, report("patched")));
    }
    return failures;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function comparePatchedTests(expected: PatchState, result: CommandResult, reportFile: string): string[] {
  const name = `after ${expected.file}`;
  const counts = readVitestReport(reportFile);
  if (counts === undefined) {
    return [`${name}: Vitest wrote no JSON report (exit ${result.exitCode})${outputTail(result.output)}`];
  }
  const named = (test: FailedTest) => expected.failingTests.some((n) => n === test.title || n === test.fullName);
  const exact =
    counts.failedTests.every(named) &&
    expected.failingTests.every((n) => counts.failedTests.some((test) => n === test.title || n === test.fullName));
  if (exact) return [];
  const quote = (names: string[]) => (names.length > 0 ? names.map((n) => `"${n}"`).join(", ") : "none");
  return [
    `${name}: expected exactly ${quote(expected.failingTests)} to fail, got ${quote(counts.failedTests.map((test) => test.title))}`,
  ];
}

function vitestReporterArgs(reportFile: string): string[] {
  return ["--reporter=default", "--reporter=json", `--outputFile=${reportFile}`];
}

function compareFiles(expected: FilesState, work: string): string[] {
  const failures: string[] = [];
  for (const path of expected.present ?? []) {
    if (!existsSync(join(work, path))) failures.push(`files: ${path} is missing`);
  }
  for (const path of expected.absent ?? []) {
    if (existsSync(join(work, path))) failures.push(`files: ${path} is present and must not be`);
  }
  for (const [path, forbidden] of Object.entries(expected.linesAbsent ?? {})) {
    if (!existsSync(join(work, path))) continue;
    const lines = readFileSync(join(work, path), "utf8").split(/\r?\n/).map((line) => line.trim());
    for (const line of forbidden) {
      if (lines.includes(line)) failures.push(`files: ${path} has the line "${line}" and must not`);
    }
  }
  return failures;
}

function compareScript(expected: ScriptState, result: CommandResult, work: string): string[] {
  const name = `npm run ${expected.name}`;
  const failures: string[] = [];
  if (expected.expect === "pass" && result.exitCode !== 0) {
    failures.push(`${name}: expected exit 0, got ${result.exitCode}${outputTail(result.output)}`);
  }
  if (expected.expect === "fail") {
    if (expected.exitCode !== undefined && result.exitCode !== expected.exitCode) {
      failures.push(`${name}: expected exit ${expected.exitCode}, got ${result.exitCode}`);
    } else if (result.exitCode === 0) {
      failures.push(`${name}: expected it to fail, it exited 0`);
    }
  }
  for (const text of expected.outputIncludes ?? []) {
    if (!result.output.includes(text)) failures.push(`${name}: output lacks "${text}"`);
  }
  for (const path of expected.producesFiles ?? []) {
    if (!existsSync(join(work, path))) failures.push(`${name}: expected it to leave ${path}, which is missing`);
  }
  return failures;
}

function compareTypecheck(expected: TypecheckState, result: CommandResult): string[] {
  if (expected.expect === "pass") {
    if (result.exitCode === 0) return [];
    return [`typecheck: expected tsc --noEmit to pass, it exited ${result.exitCode}${outputTail(result.output)}`];
  }
  const want = `expected tsc --noEmit to fail with a line starting "${expected.lineStartsWith}"`;
  if (result.exitCode === 0) return [`typecheck: ${want}, it exited 0`];
  const lines = result.output.split(/\r?\n/);
  if (lines.some((line) => line.startsWith(expected.lineStartsWith))) return [];
  return [`typecheck: ${want}, it exited ${result.exitCode} without one${outputTail(result.output)}`];
}

type FailedTest = { title: string; fullName: string };
type TestCounts = { failed: number; passed: number; todo: number; total: number; failedTests: FailedTest[] };

/** Compares one Vitest run, through the JSON report it wrote, with the state it should be in. */
function compareTests(name: string, expected: TestsState, result: CommandResult, reportFile: string): string[] {
  const counts = readVitestReport(reportFile);
  if (counts === undefined) {
    return [`${name}: Vitest wrote no JSON report (exit ${result.exitCode})${outputTail(result.output)}`];
  }
  const got = `${counts.failed} failing, ${counts.passed} passed, ${counts.todo} todo`;
  if (expected.expect === "pass") {
    const want = [
      expected.passed === undefined ? "" : `${expected.passed} passed`,
      expected.todo === undefined ? "" : `${expected.todo} todo`,
    ].filter(Boolean);
    const green =
      result.exitCode === 0 &&
      counts.failed === 0 &&
      (expected.passed === undefined || counts.passed === expected.passed) &&
      (expected.todo === undefined || counts.todo === expected.todo);
    if (green) return [];
    const wanted = want.length > 0 ? ` with ${want.join(", ")}` : "";
    // Vitest can exit non-zero with no failing test, when a test file fails to load.
    const exit = result.exitCode !== 0 && counts.failed === 0 ? `, but Vitest exited ${result.exitCode}` : "";
    return [`${name}: expected green${wanted}, got ${got}${exit}`];
  }
  const matches = counts.failed === expected.failed && (expected.total === undefined || counts.total === expected.total);
  if (matches) return [];
  const of = expected.total === undefined ? "" : ` of ${expected.total}`;
  return [`${name}: expected ${expected.failed}${of} failing, got ${counts.failed} of ${counts.total}`];
}

function readVitestReport(reportFile: string): TestCounts | undefined {
  if (!existsSync(reportFile)) return undefined;
  const report = JSON.parse(readFileSync(reportFile, "utf8")) as {
    testResults: { assertionResults: { status: string; title: string; fullName: string }[] }[];
  };
  const tests = report.testResults.flatMap((file) => file.assertionResults);
  const count = (status: string) => tests.filter((test) => test.status === status).length;
  return {
    failed: count("failed"),
    passed: count("passed"),
    todo: count("todo"),
    total: tests.length,
    failedTests: tests
      .filter((test) => test.status === "failed")
      .map((test) => ({ title: test.title, fullName: test.fullName })),
  };
}

function outputTail(output: string): string {
  const tail = output.trimEnd().split(/\r?\n/).slice(-20).join("\n");
  return tail ? `\n${tail}` : "";
}
