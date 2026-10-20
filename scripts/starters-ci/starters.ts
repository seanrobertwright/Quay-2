import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  ExpectedStateError,
  parseExpectedState,
  type ExpectedState,
  type FilesState,
  type PatchState,
  type ScriptState,
  type TestsState,
  type TypecheckState,
} from "./expected-state.ts";

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
    const checked = checkTutorialFolder(join(options.tutorialsDir, slug));
    if (checked.state !== undefined) states.set(slug, checked.state);
    failures.push(...checked.failures.map((failure) => `${slug}: ${failure}`));
  }
  // Nothing runs until every starter's files are in order, so a bad entry fails in seconds.
  if (failures.length > 0) return { starters: slugs, failures };

  for (const [slug, state] of states) {
    for (const failure of checkStarter(join(options.tutorialsDir, slug), state, options.run)) {
      failures.push(`${slug}: ${failure}`);
    }
  }
  return { starters: slugs, failures };
}

/**
 * Checks one tutorial folder without running anything: its expected state parses, agrees with
 * the files beside it, and its starter pins exact versions.
 */
function checkTutorialFolder(tutorialDir: string): { state?: ExpectedState; failures: string[] } {
  const slug = basename(tutorialDir);
  const starterDir = join(tutorialDir, "starter");
  if (!existsSync(starterDir)) return { failures: ["no starter/ folder; every tutorial folder holds one"] };
  const stateFile = join(tutorialDir, EXPECTED_STATE_FILE);
  if (!existsSync(stateFile)) {
    return { failures: [`no ${EXPECTED_STATE_FILE} beside starter/; every starter needs an expected-state entry`] };
  }
  let state: ExpectedState;
  try {
    state = readExpectedState(stateFile);
  } catch (error) {
    return { failures: [`${EXPECTED_STATE_FILE}: ${(error as Error).message}`] };
  }
  const packageFile = join(starterDir, "package.json");
  if (!existsSync(packageFile)) return { failures: ["starter/package.json is missing"] };
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(packageFile, "utf8")) as Record<string, unknown>;
  } catch (error) {
    return { failures: [`starter/package.json is not valid JSON (${(error as Error).message})`] };
  }

  const failures = checkExactVersions(manifest);
  const hasCheckFolder = existsSync(join(tutorialDir, "check"));
  if (state.checkSuite !== undefined && !hasCheckFolder) failures.push(`checkSuite: ${slug}/check/ is missing`);
  if (state.checkSuite === undefined && hasCheckFolder) {
    failures.push(`check/: ${slug}/check/ exists but ${EXPECTED_STATE_FILE} has no checkSuite`);
  }
  if (state.patch !== undefined && !existsSync(join(starterDir, state.patch.file))) {
    failures.push(`patch.file: starter/${state.patch.file} is missing`);
  }
  const scripts = (manifest.scripts ?? {}) as Record<string, unknown>;
  const requiredScripts = [
    ...(state.scripts ?? []).map((script, i) => [`scripts[${i}].name`, script.name]),
    ...(state.checkSuite?.script !== undefined ? [["checkSuite.script", state.checkSuite.script]] : []),
  ];
  for (const [field, name] of requiredScripts) {
    if (typeof scripts[name] !== "string") failures.push(`${field}: starter/package.json has no "${name}" script`);
  }
  return { state, failures };
}

function readExpectedState(stateFile: string): ExpectedState {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(stateFile, "utf8"));
  } catch (error) {
    throw new ExpectedStateError("", `not valid JSON (${(error as Error).message})`);
  }
  return parseExpectedState(json);
}

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
// An exact semver version: no ^, ~, x, *, comparator, range, tag or URL.
const EXACT_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

/** Every dependency in the starter's package.json that names a range instead of one version. */
function checkExactVersions(manifest: Record<string, unknown>): string[] {
  const failures: string[] = [];
  for (const field of DEPENDENCY_FIELDS) {
    const dependencies = (manifest[field] ?? {}) as Record<string, unknown>;
    for (const [name, version] of Object.entries(dependencies)) {
      if (typeof version !== "string" || !EXACT_VERSION.test(version)) {
        failures.push(`package.json: ${field}.${name} is ${JSON.stringify(version)}; starters pin exact versions`);
      }
    }
  }
  return failures;
}

/** Runs one starter in a throwaway copy and returns how it missed its expected state. */
function checkStarter(tutorialDir: string, state: ExpectedState, run: Runner): string[] {
  // The project is the learner's copy of the starter; Vitest's reports go beside it, not in it.
  const root = mkdtempSync(join(tmpdir(), `starter-${basename(tutorialDir)}-`));
  const work = join(root, "project");
  try {
    cpSync(join(tutorialDir, "starter"), work, {
      recursive: true,
      filter: (source) => basename(source) !== "node_modules",
    });
    const inProject = (argv: string[]) => run({ argv, cwd: work, env: state.env ?? {} });
    const runVitest = (argv: string[], reportName: string): VitestRun => {
      const reportFile = join(root, `${reportName}.json`);
      const result = inProject([...argv, "--reporter=default", "--reporter=json", `--outputFile=${reportFile}`]);
      return { result, counts: readVitestReport(reportFile) };
    };
    // Files are checked as the learner receives them, before anything runs.
    const failures = state.files === undefined ? [] : compareFiles(state.files, work);
    const install = inProject(["npm", "ci"]);
    if (install.exitCode !== 0) {
      failures.push(`npm ci exited ${install.exitCode}${outputTail(install.output)}`);
      return failures;
    }
    // tsc prints its "Found N errors" summary only when pretty, and a CI log is not a terminal.
    const typecheck = inProject(["npx", "--no", "--", "tsc", "--noEmit", "--pretty"]);
    failures.push(...compareTypecheck(state.typecheck, typecheck));
    failures.push(...compareTests("tests", state.tests, runVitest(["npm", "test", "--"], "tests")));

    for (const script of state.scripts ?? []) {
      const result = inProject(["npm", "run", script.name]);
      failures.push(...compareScript(script, result, work));
    }

    if (state.checkSuite !== undefined) {
      // The learner unzips the check suite into the project so check/ sits beside src/.
      cpSync(join(tutorialDir, "check"), join(work, "check"), { recursive: true });
      const command =
        state.checkSuite.script !== undefined
          ? ["npm", "run", state.checkSuite.script, "--"]
          : ["npx", "--no", "--", "vitest", ...state.checkSuite.vitest];
      failures.push(...compareTests("check suite", state.checkSuite, runVitest(command, "check")));
    }

    if (state.patch !== undefined) {
      // Last, because it changes the project: the learner's late commit in the tutorial. The
      // check suite comes out first so the patched npm test runs the same tests the first did.
      rmSync(join(work, "check"), { recursive: true, force: true });
      const apply = inProject(["git", "apply", state.patch.file]);
      if (apply.exitCode !== 0) {
        failures.push(`git apply ${state.patch.file} exited ${apply.exitCode}${outputTail(apply.output)}`);
        return failures;
      }
      failures.push(...comparePatchedTests(state.patch, runVitest(["npm", "test", "--"], "patched")));
    }
    return failures;
  } finally {
    // Windows can hold a file a moment after the process that opened it exits.
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
}

function comparePatchedTests(expected: PatchState, run: VitestRun): string[] {
  const name = `after ${expected.file}`;
  if (run.counts === undefined) return [noReport(name, run.result)];
  const { failedTests } = run.counts;
  const exact =
    failedTests.every((test) => expected.failingTests.some((n) => matchesName(test, n))) &&
    expected.failingTests.every((n) => failedTests.some((test) => matchesName(test, n)));
  if (exact) return [];
  const listNames = (names: string[]) => (names.length > 0 ? names.map((n) => `"${n}"`).join(", ") : "none");
  return [
    `${name}: expected exactly ${listNames(expected.failingTests)} to fail, got ${listNames(failedTests.map((test) => test.title))}`,
  ];
}

/** A test is named by its own title or by its full name, describe blocks included. */
function matchesName(test: FailedTest, name: string): boolean {
  return name === test.title || name === test.fullName;
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
  const lines = stripColours(result.output).split(/\r?\n/);
  if (lines.some((line) => line.startsWith(expected.lineStartsWith))) return [];
  return [`typecheck: ${want}, it exited ${result.exitCode} without one${outputTail(result.output)}`];
}

type FailedTest = { title: string; fullName: string };
type TestCounts = { failed: number; passed: number; todo: number; total: number; failedTests: FailedTest[] };
/** One Vitest run: how the process ended and, when Vitest wrote its JSON report, what it counted. */
type VitestRun = { result: CommandResult; counts?: TestCounts };

function noReport(name: string, result: CommandResult): string {
  return `${name}: Vitest wrote no JSON report (exit ${result.exitCode})${outputTail(result.output)}`;
}

/** Compares one Vitest run, through the JSON report it wrote, with the state it should be in. */
function compareTests(name: string, expected: TestsState, run: VitestRun): string[] {
  const { result, counts } = run;
  if (counts === undefined) return [noReport(name, result)];
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
  const tail = stripColours(output).trimEnd().split(/\r?\n/).slice(-20).join("\n");
  return tail ? `\n${tail}` : "";
}

// ANSI SGR sequences, the colours tsc --pretty writes even when its output is not a terminal.
const COLOUR = new RegExp(`${String.fromCharCode(27)}\[[0-9;]*m`, "g");

function stripColours(output: string): string {
  return output.replace(COLOUR, "");
}
