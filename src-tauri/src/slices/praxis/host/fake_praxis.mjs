// A stand-in for the `praxis` CLI in Quay's tests (#446). A test lays it out as a checkout's
// `engine/src/praxis.mjs`, next to a `scenario.json` that says what to replay:
//
//   { "stdout": <record or text>, "stderr": "praxis: …", "exit": 1,
//     "delayMs": 500, "stdoutBytes": 9437184, "child": true }
//
// Each run appends its arguments to `calls.log` beside it. With `child`, it first starts a Node
// process that sleeps for two minutes and writes that process's id to `child.pid`, so a test can
// check a timeout kills the whole tree.
import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scenario = JSON.parse(readFileSync(join(here, 'scenario.json'), 'utf8'));
appendFileSync(join(here, 'calls.log'), JSON.stringify(process.argv.slice(2)) + '\n');

if (scenario.child) {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore' });
  writeFileSync(join(here, 'child.pid'), String(child.pid));
}
if (scenario.delayMs) await new Promise((resolve) => setTimeout(resolve, scenario.delayMs));
if (scenario.stdoutBytes) process.stdout.write('x'.repeat(scenario.stdoutBytes));
if (scenario.stdout !== undefined) {
  process.stdout.write(typeof scenario.stdout === 'string' ? scenario.stdout : JSON.stringify(scenario.stdout, null, 2) + '\n');
}
if (scenario.stderr) process.stderr.write(scenario.stderr);
process.exitCode = scenario.exit ?? 0;
