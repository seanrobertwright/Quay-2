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
type ExpectedState = { typecheck: TypecheckState; tests: TestsState; checkSuite?: CheckSuiteState };

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
  const work = mkdtempSync(join(tmpdir(), `starter-${basename(tutorialDir)}-`));
  try {
    cpSync(join(tutorialDir, "starter"), work, {
      recursive: true,
      filter: (source) => basename(source) !== "node_modules",
    });
    const exec = (argv: string[]) => run({ argv, cwd: work, env: {} });
    const install = exec(["npm", "ci"]);
    if (install.exitCode !== 0) return [`npm ci exited ${install.exitCode}`];
    const failures: string[] = [];
    const typecheck = exec(["npx", "--no", "tsc", "--noEmit"]);
    failures.push(...compareTypecheck(state.typecheck, typecheck));
    const reportFile = join(work, ".starters-ci-tests.json");
    const tests = exec(["npm", "test", "--", ...vitestReporterArgs(reportFile)]);
    failures.push(...compareTests("tests", state.tests, tests, reportFile));

    if (state.checkSuite !== undefined) {
      // The learner unzips the check suite into the project so check/ sits beside src/.
      cpSync(join(tutorialDir, "check"), join(work, "check"), { recursive: true });
      const checkReportFile = join(work, ".starters-ci-check.json");
      const command =
        "script" in state.checkSuite
          ? ["npm", "run", state.checkSuite.script, "--"]
          : ["npx", "--no", "vitest", ...state.checkSuite.vitest];
      const check = exec([...command, ...vitestReporterArgs(checkReportFile)]);
      failures.push(...compareTests("check suite", state.checkSuite, check, checkReportFile));
    }
    return failures;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function vitestReporterArgs(reportFile: string): string[] {
  return ["--reporter=default", "--reporter=json", `--outputFile=${reportFile}`];
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

type TestCounts ={ failed: number; passed: number; todo: number; total: number };

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
    testResults: { assertionResults: { status: string }[] }[];
  };
  const statuses = report.testResults.flatMap((file) => file.assertionResults.map((test) => test.status));
  const count = (status: string) => statuses.filter((s) => s === status).length;
  return { failed: count("failed"), passed: count("passed"), todo: count("todo"), total: statuses.length };
}

function outputTail(output: string): string {
  const tail = output.trimEnd().split(/\r?\n/).slice(-20).join("\n");
  return tail ? `\n${tail}` : "";
}
