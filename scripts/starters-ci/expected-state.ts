// The expected state of one starter, read from examples/tutorials/<slug>/expected-state.json.
// README.md beside this file documents every field.

export type TestsState =
  | { expect: "pass"; passed?: number; todo?: number }
  | { expect: "fail"; failed: number; total?: number };
export type TypecheckState = { expect: "pass" } | { expect: "fail"; lineStartsWith: string };
/** How the check suite runs: an npm script, or Vitest with these arguments. */
export type CheckSuiteState = ({ script: string; vitest?: never } | { vitest: string[]; script?: never }) & TestsState;
/** A named npm script and how it must end: its exit, text its output holds, files it leaves. */
export type ScriptState = {
  name: string;
  outputIncludes?: string[];
  producesFiles?: string[];
} & ({ expect: "pass" } | { expect: "fail"; exitCode?: number });
/** Paths in the starter that must be there or not, and lines a file must not hold. */
export type FilesState = { present?: string[]; absent?: string[]; linesAbsent?: Record<string, string[]> };
/** A patch the learner applies late in the tutorial, and exactly the tests it must break. */
export type PatchState = { file: string; failingTests: string[] };
export type ExpectedState = {
  env?: Record<string, string>;
  typecheck: TypecheckState;
  tests: TestsState;
  scripts?: ScriptState[];
  checkSuite?: CheckSuiteState;
  patch?: PatchState;
  files?: FilesState;
};

/** A field of an expected state that is missing, unknown or malformed. */
export class ExpectedStateError extends Error {
  constructor(field: string, problem: string) {
    super(field === "" ? problem : `${field}: ${problem}`);
  }
}

type Json = Record<string, unknown>;

/** Parses an expected state strictly: an unknown field, a missing count or a bad value throws. */
export function parseExpectedState(value: unknown): ExpectedState {
  const state = object(value, "");
  allowOnly(state, "", ["env", "typecheck", "tests", "scripts", "checkSuite", "patch", "files"]);
  const tests = parseTests(required(state, "tests", ""), "tests", []);
  const parsed: ExpectedState = {
    typecheck: parseTypecheck(required(state, "typecheck", "")),
    tests,
  };
  if (state.env !== undefined) parsed.env = parseEnv(state.env);
  if (state.scripts !== undefined) {
    parsed.scripts = array(state.scripts, "scripts").map((script, i) => parseScript(script, `scripts[${i}]`));
  }
  if (state.checkSuite !== undefined) parsed.checkSuite = parseCheckSuite(state.checkSuite);
  if (state.patch !== undefined) {
    if (tests.expect !== "pass") {
      throw new ExpectedStateError("patch", 'needs tests.expect "pass"; the patch breaks a starter that ships green');
    }
    parsed.patch = parsePatch(state.patch);
  }
  if (state.files !== undefined) parsed.files = parseFiles(state.files);
  return parsed;
}

function parseTypecheck(value: unknown): TypecheckState {
  const typecheck = object(value, "typecheck");
  const expect = outcome(typecheck, "typecheck");
  if (expect === "pass") {
    allowOnly(typecheck, "typecheck", ["expect"]);
    return { expect };
  }
  allowOnly(typecheck, "typecheck", ["expect", "lineStartsWith"]);
  if (typecheck.lineStartsWith === undefined) {
    throw new ExpectedStateError("typecheck.lineStartsWith", 'required when typecheck.expect is "fail"');
  }
  return { expect, lineStartsWith: text(typecheck.lineStartsWith, "typecheck.lineStartsWith") };
}

/** Parses a tests outcome; `extra` names the fields the caller handles itself. */
function parseTests(value: unknown, field: string, extra: string[]): TestsState {
  const tests = object(value, field);
  const expect = outcome(tests, field);
  if (expect === "pass") {
    allowOnly(tests, field, ["expect", "passed", "todo", ...extra]);
    const state: TestsState = { expect };
    if (tests.passed !== undefined) state.passed = count(tests.passed, `${field}.passed`);
    if (tests.todo !== undefined) state.todo = count(tests.todo, `${field}.todo`);
    return state;
  }
  allowOnly(tests, field, ["expect", "failed", "total", ...extra]);
  if (tests.failed === undefined) {
    throw new ExpectedStateError(`${field}.failed`, `required when ${field}.expect is "fail"`);
  }
  const state: TestsState = { expect, failed: count(tests.failed, `${field}.failed`) };
  if (tests.total !== undefined) {
    state.total = count(tests.total, `${field}.total`);
    if (state.failed > state.total) {
      throw new ExpectedStateError(`${field}.failed`, `${state.failed} is more than ${field}.total ${state.total}`);
    }
  }
  return state;
}

function parseCheckSuite(value: unknown): CheckSuiteState {
  const suite = object(value, "checkSuite");
  if ((suite.script === undefined) === (suite.vitest === undefined)) {
    throw new ExpectedStateError("checkSuite", "give exactly one of script or vitest");
  }
  if (suite.script !== undefined) {
    const tests = parseTests(suite, "checkSuite", ["script"]);
    return { ...tests, script: scriptName(suite.script, "checkSuite.script") };
  }
  const tests = parseTests(suite, "checkSuite", ["vitest"]);
  const args = array(suite.vitest, "checkSuite.vitest").map((arg, i) => argument(arg, `checkSuite.vitest[${i}]`));
  return { ...tests, vitest: args };
}

function parseScript(value: unknown, field: string): ScriptState {
  const script = object(value, field);
  allowOnly(script, field, ["name", "expect", "exitCode", "outputIncludes", "producesFiles"]);
  const name = scriptName(required(script, "name", field), `${field}.name`);
  const expect = outcome(script, field);
  const common: { name: string; outputIncludes?: string[]; producesFiles?: string[] } = { name };
  if (script.outputIncludes !== undefined) {
    common.outputIncludes = array(script.outputIncludes, `${field}.outputIncludes`).map((item, i) =>
      text(item, `${field}.outputIncludes[${i}]`),
    );
  }
  if (script.producesFiles !== undefined) common.producesFiles = paths(script.producesFiles, `${field}.producesFiles`);
  if (expect === "pass") {
    if (script.exitCode !== undefined) {
      throw new ExpectedStateError(`${field}.exitCode`, `only allowed when ${field}.expect is "fail"`);
    }
    return { ...common, expect };
  }
  if (script.exitCode === undefined) return { ...common, expect };
  const exitCode = count(script.exitCode, `${field}.exitCode`);
  if (exitCode === 0) throw new ExpectedStateError(`${field}.exitCode`, "must not be 0 for a script expected to fail");
  return { ...common, expect, exitCode };
}

function parsePatch(value: unknown): PatchState {
  const patch = object(value, "patch");
  allowOnly(patch, "patch", ["file", "failingTests"]);
  const file = path(required(patch, "file", "patch"), "patch.file");
  const failingTests = array(required(patch, "failingTests", "patch"), "patch.failingTests").map((name, i) =>
    text(name, `patch.failingTests[${i}]`),
  );
  if (failingTests.length === 0) throw new ExpectedStateError("patch.failingTests", "must name at least one test");
  return { file, failingTests };
}

function parseFiles(value: unknown): FilesState {
  const files = object(value, "files");
  allowOnly(files, "files", ["present", "absent", "linesAbsent"]);
  const state: FilesState = {};
  if (files.present !== undefined) state.present = paths(files.present, "files.present");
  if (files.absent !== undefined) state.absent = paths(files.absent, "files.absent");
  if (files.linesAbsent !== undefined) {
    const linesAbsent: Record<string, string[]> = {};
    for (const [file, lines] of Object.entries(object(files.linesAbsent, "files.linesAbsent"))) {
      const field = `files.linesAbsent.${file}`;
      path(file, field);
      linesAbsent[file] = array(lines, field).map((line, i) => text(line, `${field}[${i}]`));
    }
    state.linesAbsent = linesAbsent;
  }
  return state;
}

function parseEnv(value: unknown): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, setting] of Object.entries(object(value, "env"))) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new ExpectedStateError(`env.${name}`, "must be an environment variable name");
    }
    if (typeof setting !== "string") {
      throw new ExpectedStateError(`env.${name}`, `must be a string, got ${JSON.stringify(setting)}`);
    }
    env[name] = setting;
  }
  return env;
}

function object(value: unknown, field: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ExpectedStateError(field, "must be a JSON object");
  }
  return value as Json;
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new ExpectedStateError(field, `must be a list, got ${JSON.stringify(value)}`);
  return value;
}

function allowOnly(value: Json, field: string, known: string[]): void {
  for (const key of Object.keys(value)) {
    if (!known.includes(key)) throw new ExpectedStateError(field === "" ? key : `${field}.${key}`, "unknown field");
  }
}

function required(value: Json, key: string, field: string): unknown {
  const name = field === "" ? key : `${field}.${key}`;
  if (!Object.hasOwn(value, key)) throw new ExpectedStateError(name, "required");
  return value[key];
}

function outcome(value: Json, field: string): "pass" | "fail" {
  if (value.expect === "pass" || value.expect === "fail") return value.expect;
  throw new ExpectedStateError(`${field}.expect`, `must be "pass" or "fail", got ${JSON.stringify(value.expect)}`);
}

function count(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  throw new ExpectedStateError(field, `must be a whole number, got ${JSON.stringify(value)}`);
}

function text(value: unknown, field: string): string {
  if (typeof value === "string" && value !== "") return value;
  throw new ExpectedStateError(field, `must be a non-empty string, got ${JSON.stringify(value)}`);
}

// npm script names and Vitest arguments reach a shell, so they keep to characters a shell leaves alone.
function scriptName(value: unknown, field: string): string {
  if (typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(value)) return value;
  throw new ExpectedStateError(field, `must be an npm script name, got ${JSON.stringify(value)}`);
}

function argument(value: unknown, field: string): string {
  if (typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:._/=-]*$|^--?[A-Za-z][A-Za-z0-9.-]*(=[A-Za-z0-9:._/-]+)?$/.test(value)) {
    return value;
  }
  throw new ExpectedStateError(field, `must be a plain Vitest argument, got ${JSON.stringify(value)}`);
}

function paths(value: unknown, field: string): string[] {
  return array(value, field).map((item, i) => path(item, `${field}[${i}]`));
}

/** A forward-slash path inside the starter: relative, with no `..` and no shell-special characters. */
function path(value: unknown, field: string): string {
  if (
    typeof value === "string" &&
    /^[A-Za-z0-9._-][A-Za-z0-9._/-]*$/.test(value) &&
    !value.split("/").some((part) => part === ".." || part === "")
  ) {
    return value;
  }
  throw new ExpectedStateError(field, `must be a relative path inside the starter, got ${JSON.stringify(value)}`);
}
