// Records graph_outputs.fixture.json: what the real `praxis` CLI prints for each graph command
// Quay runs (#460), run as a subprocess against the simulated host its own tests start, so the
// fake `praxis` replays records, refusals and exit codes the CLI itself wrote. Run with Node 24
// or later against an AI-WS-SDK checkout with its dependencies installed:
//
//   node graph_outputs.record.mjs <checkout> <commit> graph_outputs.fixture.json
//
// Each case keeps the arguments Quay gives (without `--json` and `--state`, which the runner
// adds), the exit code, the stdout record and the stderr. Temporary and home folders in the output
// are replaced by neutral stand-ins, and the bundle files keep only their names.
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The record is written to a file, since node:test, which the host fixtures load, prints its
// summary on stdout as the process exits.
const [checkout, commit, outFile] = process.argv.slice(2);
if (!checkout || !commit || !outFile) throw new Error('Usage: node graph_outputs.record.mjs <checkout> <commit> <out-file>');
const from = (path) => import(pathToFileURL(join(checkout, path)).href);
const { simulatedHost } = await from('engine/test/fixtures/praxis-host.ts');
const { bundle, bundleArguments, bundleDigestOf } = await from('engine/examples/graph-bundle.ts');
const { canonicalDigest } = await from('engine/src/canonical-json.ts');
const { graphReviewDigest } = await from('engine/src/graph-workflows.ts');
const { errorRecord } = await from('engine/src/praxis-error.ts');
const { PraxisFailure } = await from('engine/src/praxis-failure.ts');

// `simulatedHost` takes a node:test context only to close the host afterwards.
const closers = [];
const t = { after: (fn) => closers.push(fn) };
const { example, praxis, state } = await simulatedHost(t, { templates: {} });

/** Stores and admits `b` as `name` through the host's storage, as engine/test/praxis-graph-runs.test.ts does. */
async function admit(name, b) {
  const runner = example.host.service.runner;
  const now = await runner.coordinator.now();
  const bundleDigest = bundleDigestOf(b);
  const submitted = await runner.storage.call('graphWorkflowSubmit', {
    namespace: 'local', principalId: 'owner', requestId: randomUUID(), requestDigest: canonicalDigest({ requestId: 'submit-' + randomUUID() }),
    actor: { kind: 'HUMAN', principalId: 'owner' }, name, baseRevision: null, bundle: b, bundleDigest, now,
  });
  const reviewDigest = graphReviewDigest(name, submitted.revision, bundleDigest, []);
  const challenge = await runner.storage.call('graphWorkflowChallenge', {
    namespace: 'local', principalId: 'owner', sessionId: 'session-record', name, revision: submitted.revision, reviewDigest,
    decision: 'ADMIT', sessionExpiresAtMs: Date.now() + 120000, epoch: runner.coordinator.epoch,
  });
  await runner.storage.call('graphWorkflowAdmit', {
    namespace: 'local', principalId: 'owner', actor: { kind: 'HUMAN' }, sessionId: 'session-record', requestId: randomUUID(),
    requestDigest: canonicalDigest({ requestId: 'admit-' + randomUUID(), decision: 'ADMIT' }), name, revision: submitted.revision, reviewDigest,
    challengeId: challenge.challengeId, epoch: runner.coordinator.epoch,
  });
}

/** A bundle whose AGENT node runs the local agent the simulated host offers, so its runs are READY. */
function runnable() {
  const b = bundle();
  b.binding.nodes.build.commands = [[process.execPath, '--version']];
  b.binding.nodes.build.requirements = [];
  b.binding.nodes.build.exposure = { kind: 'NOT_APPLICABLE', justification: 'The local agent uses no model.' };
  return b;
}

const scratch = mkdtempSync(join(tmpdir(), 'praxis-graph-record-'));
let dirs = 0;
const files = (b) => {
  const dir = join(scratch, `bundle-${++dirs}`);
  mkdirSync(dir);
  return bundleArguments(dir, b);
};

const cases = [];
/** Runs `praxis <args> --json --state <state>` through `run` and records it under `name`. */
async function record(name, args, run = praxis, stateDir = state) {
  const r = await run(...args, '--json', '--state', stateDir);
  let stdout = null;
  if (r.stdout.trim()) stdout = JSON.parse(r.stdout);
  cases.push({ name, args, exit: r.code, stdout, stderr: r.stderr });
  return stdout;
}

const name = 'release-review';
const valid = bundle();
await record('graphs check: valid', ['graphs', 'check', name, ...files(valid)]);
const faulty = bundle();
faulty.contract.deadline = '1';
await record('graphs check: faults, exit 9', ['graphs', 'check', name, ...files(faulty)]);
await record('graphs submit: a candidate', ['graphs', 'submit', name, ...files(valid)]);
await record('graphs submit: faults, exit 9', ['graphs', 'submit', name, ...files(faulty)]);
await record('graphs submit: a second candidate', ['graphs', 'submit', name, ...files(valid), '--base', '1']);
await record('graphs list', ['graphs', 'list', '--limit', '100', '--format', 'aiws-graph-workflows/1']);
await record('graphs show', ['graphs', 'show', name, '--format', 'aiws-graph-workflow/1']);
await record('graphs show: older revisions', ['graphs', 'show', name, '--before', '2', '--limit', '20', '--format', 'aiws-graph-workflow-revisions/1']);
await record('graphs show: not submitted', ['graphs', 'show', 'nothing-here', '--format', 'aiws-graph-workflow/1']);
await record('graphs withdraw: a pending candidate', ['graphs', 'withdraw', name, '1']);
await record('graphs withdraw: not pending', ['graphs', 'withdraw', name, '1']);
await record('run: no admitted revision', ['run', name]);

const admitted = 'nightly-build';
await admit(admitted, runnable());
const created = await record('run: created', ['run', admitted]);
await record('run: blocked by a run awaiting approval, exit 7', ['run', admitted]);
await record('runs', ['runs', admitted, '--limit', '20', '--format', 'aiws-graph-runs/1']);
await record('runs: not submitted', ['runs', 'nothing-here', '--limit', '20', '--format', 'aiws-graph-runs/1']);
await record('status: awaiting approval', ['status', created.workOrderId, '--format', 'aiws-graph-operator-view/1']);
await record('status: no such run', ['status', 'wo-nothing-here', '--format', 'aiws-graph-operator-view/1']);

await record('usage: unknown graphs command, exit 2', ['graphs', 'lsit']);
const noHost = join(scratch, 'no-host');
mkdirSync(noHost);
await record('no host set up', ['graphs', 'list', '--limit', '100', '--format', 'aiws-graph-workflows/1'], praxis, noHost);
// The host stops but its installation stays, so praxis finds the host and can't reach it.
await example.host.close();
await record('host down', ['graphs', 'list', '--limit', '100', '--format', 'aiws-graph-workflows/1']);
for (const close of closers.reverse()) await close();

// A simulated host's session can't be missing or refused, a send can't be left unconfirmed and
// it serves every format, so these are made by the engine's own errorRecord from the messages
// engine/src/praxis-client.ts, praxis-graphs.ts and praxis-format.ts write, as runPraxis prints them.
const installation = 'C:\\Users\\me\\AppData\\Local\\Praxis\\installation';
const requestId = '3f2c8a1e-5b7d-4e9a-8c6f-0d1e2a3b4c5d';
for (const [name, message, detail, exit = 1] of [
  ['graphs submit: outcome unknown (made)', `The host did not confirm the request, so its outcome is unknown. Run the same command with --request-id ${requestId} to resend it.`, { code: 'OUTCOME_UNKNOWN', requestId, simulated: true }],
  ['format not served (made)', 'The host does not serve aiws-graph-workflows/1: it serves aiws-graph-workflows/2. Upgrade the host or this client.', { code: 'FORMAT_NOT_SERVED', requestedFormat: 'aiws-graph-workflows/1', servedFormats: ['aiws-graph-workflows/2'], simulated: true }, 8],
  ['not signed in (made)', `There is no CLI session for this host in C:\\Users\\me\\AppData\\Local\\Praxis\\cli. Run praxis login --state ${installation}.`, { code: 'AUTHENTICATION' }],
  ['session refused (made)', `The host did not accept the CLI session (UNAUTHENTICATED). Run praxis login --state ${installation}.`, { code: 'AUTHENTICATION', hostCode: 'UNAUTHENTICATED' }],
]) {
  const failure = new PraxisFailure(exit, message, false, detail);
  cases.push({ name, args: ['graphs', 'list', '--limit', '100', '--format', 'aiws-graph-workflows/1'], exit: failure.exitCode, stdout: errorRecord(failure), stderr: `praxis: ${message}\n` });
}

// The bundle files' folders, then every temporary and home folder, out of every string kept.
const stands = [[scratch, 'C:\\Temp\\praxis-graph-record'], [tmpdir(), 'C:\\Temp'], [homedir(), 'C:\\Users\\me']];
const neutral = (value) => {
  if (typeof value === 'string') return stands.reduce((text, [path, stand]) => text.split(path).join(stand), value);
  if (Array.isArray(value)) return value.map(neutral);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, neutral(v)]));
  return value;
};
const kept = cases.map((c) => ({ ...c, args: c.args.map((a) => (a.startsWith(scratch) ? a.slice(scratch.length + 1).split(/[\\/]/).slice(1).join('/') : a)) }));
writeFileSync(outFile, JSON.stringify(neutral({
  provenance: `Recorded by graph_outputs.record.mjs from praxis in seanrobertwright/AI-WS-SDK at ${commit}, run against its simulated host on Node ${process.versions.node}.`,
  cases: kept,
}), null, 2) + '\n');
