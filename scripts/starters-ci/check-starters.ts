// Checks every tutorial's starter project against its expected state. The starters CI workflow
// runs it; README.md beside this file says how to run it locally.
//
//   node scripts/starters-ci/check-starters.ts [--tutorials <dir>]
//
// Exits 0 when every starter is in its expected state (or there are none), 1 when one is not,
// and 2 on a bad argument.

import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { checkStarters, type Command, type CommandResult } from "./starters.ts";

const COMMAND_TIMEOUT_MS = 20 * 60 * 1000;

function main(): number {
  let tutorialsDir: string;
  try {
    const { values } = parseArgs({ options: { tutorials: { type: "string" } }, strict: true, allowPositionals: false });
    if (values.tutorials === "") throw new Error("--tutorials needs a folder");
    tutorialsDir = resolve(values.tutorials ?? join(import.meta.dirname, "..", "..", "examples", "tutorials"));
  } catch (error) {
    console.error(`check-starters: ${(error as Error).message}`);
    console.error("usage: node scripts/starters-ci/check-starters.ts [--tutorials <dir>]");
    return 2;
  }

  const report = checkStarters({ tutorialsDir, run: runInShell });
  if (report.failures.length > 0) {
    console.log(`\n${report.failures.length} problem(s) across ${report.starters.length} starter(s):`);
    for (const failure of report.failures) console.log(`  ${failure.replaceAll("\n", "\n    ")}`);
    return 1;
  }
  console.log(`\nEvery starter is in its expected state (${report.starters.length} checked).`);
  return 0;
}

/**
 * Runs a command through the shell, which npm and npx need on Windows, where they are .cmd files.
 * The expected-state parser keeps script names, arguments and paths to shell-safe characters;
 * the checker's own temp paths are quoted here.
 */
function runInShell(command: Command): CommandResult {
  const line = command.argv.map(quote).join(" ");
  console.log(`\n> ${line}`);
  const result = spawnSync(line, {
    cwd: command.cwd,
    env: { ...process.env, ...command.env },
    shell: true,
    encoding: "utf8",
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  process.stdout.write(output);
  if (result.error !== undefined || result.status === null) {
    const why = result.error?.message ?? `killed by ${result.signal}`;
    return { exitCode: -1, output: `${output}\n${why}` };
  }
  return { exitCode: result.status, output };
}

function quote(arg: string): string {
  if (/^[A-Za-z0-9_@+=:,./\\-]+$/.test(arg)) return arg;
  if (/["%!$`]/.test(arg)) throw new Error(`refusing to pass ${JSON.stringify(arg)} through the shell`);
  return `"${arg}"`;
}

process.exitCode = main();
