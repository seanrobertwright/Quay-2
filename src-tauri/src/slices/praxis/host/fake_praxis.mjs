// A stand-in for the `praxis` CLI in Quay's tests (#446). A test lays it out as a checkout's
// `engine/src/praxis.mjs`, next to a `scenario.json` that says what to replay:
//
//   { "stdout": <record or text>, "stderr": "praxis: …", "exit": 1,
//     "delayMs": 500, "stdoutBytes": 9437184, "child": true, "profile": true }
//
// Each run appends its arguments to `calls.log` beside it. With `child`, it first starts a Node
// process that sleeps for two minutes and writes that process's id to `child.pid`, so a test can
// check a timeout kills the whole tree. With `profile`, it acts as `praxis run` does with the CLI
// profile (#361): before its delay it saves a pending creation, with a fresh request id, in
// `profile.json` beside it, unless one is pending already, which it resumes; it clears the
// pending creation when it prints, and its record carries the pending creation's request id.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scenario = JSON.parse(readFileSync(join(here, 'scenario.json'), 'utf8'));
appendFileSync(join(here, 'calls.log'), JSON.stringify(process.argv.slice(2)) + '\n');

if (scenario.child) {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore' });
  writeFileSync(join(here, 'child.pid'), String(child.pid));
}
let pending = null;
if (scenario.profile) {
  const profilePath = join(here, 'profile.json');
  const profile = existsSync(profilePath) ? JSON.parse(readFileSync(profilePath, 'utf8')) : { pending: null };
  pending = profile.pending ?? { requestId: randomUUID() };
  writeFileSync(profilePath, JSON.stringify({ pending }));
}
if (scenario.delayMs) await new Promise((resolve) => setTimeout(resolve, scenario.delayMs));
if (scenario.stdoutBytes) process.stdout.write('x'.repeat(scenario.stdoutBytes));
if (pending) writeFileSync(join(here, 'profile.json'), JSON.stringify({ pending: null }));
if (scenario.stdout !== undefined) {
  const stdout = pending && typeof scenario.stdout === 'object' ? { ...scenario.stdout, requestId: pending.requestId } : scenario.stdout;
  process.stdout.write(typeof stdout === 'string' ? stdout : JSON.stringify(stdout, null, 2) + '\n');
}
if (scenario.stderr) process.stderr.write(scenario.stderr);
process.exitCode = scenario.exit ?? 0;
