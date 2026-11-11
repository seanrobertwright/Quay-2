// Records trigger_outputs.fixture.json: what the real `praxis` CLI prints for each graph trigger
// command Quay runs (#474), run as a subprocess against the simulated host its own tests start,
// so the fake `praxis` replays records, refusals and exit codes the CLI itself wrote. Run with
// Node 24 or later against an AI-WS-SDK checkout that has `praxis triggers` (#662 or later) and
// whose TypeScript SDK is built (`npm ci`, then `npm run build:sdk`), which the simulated host
// loads to serve the graph workflow the triggers start:
//
//   node trigger_outputs.record.mjs <checkout> <commit> trigger_outputs.fixture.json
//
// The owner's decisions, which no `praxis` command makes, are made through the host's storage
// by the SDK's own test fixture, engine/test/fixtures/graph-owner.ts.
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { caseRecorder, recorderArgs, writeFixture } from './record_support.mjs';

const { commit, outFile, from } = recorderArgs('trigger_outputs.record.mjs');
const { simulatedHost } = await from('engine/test/fixtures/praxis-host.ts');
const { admitEventSource, admitGraphWorkflow, admitTrigger } = await from('engine/test/fixtures/graph-owner.ts');
const { canonicalDigest } = await from('engine/src/canonical-json.ts');
const { eventSourceSecretHash } = await from('engine/src/event-sources.ts');
const { errorRecord } = await from('engine/src/praxis-error.ts');
const { PraxisFailure } = await from('engine/src/praxis-failure.ts');

// `simulatedHost` takes a node:test context only to close the host afterwards.
const closers = [];
const t = { after: (fn) => closers.push(fn) };
const { example, praxis, state } = await simulatedHost(t, { templates: {} });
const runner = example.host.service.runner;
const workflow = 'release-review';
await admitGraphWorkflow(example, workflow);
const hostNow = Date.parse(await runner.coordinator.now());

const minute = 60_000, later = '4102444800000';
/** A SCHEDULED trigger of `release-review` named `id`, every minute from the host's now, with `more` over it. */
const scheduled = (id, more = {}) => ({
  id, revision: '1', kind: 'SCHEDULED', source: 'praxis', eventType: 'schedule.tick', contractId: 'release', action: 'START_RUN', enabled: true, notBefore: '0', expiresAt: later,
  maxAgeMs: String(60 * minute), maxConcurrent: '5', rateLimit: '100', rateWindowMs: String(60 * minute), maxDepth: '0',
  schedule: { startMs: String(hostNow), intervalMs: String(minute), catchUp: 'ALL', maxCatchUp: '3' }, ...more,
});
/** An EVENT trigger of `release-review` named `id` for `source`'s push events, with `more` over it. */
const onPush = (id, source, more = {}) => { const { schedule: _schedule, ...rest } = scheduled(id, { kind: 'EVENT', source, eventType: 'push', ...more }); return rest; };

const scratch = mkdtempSync(join(tmpdir(), 'praxis-trigger-record-'));
let dirs = 0;
/** Saves `trigger` as `<id>.json` in a fresh folder, as Quay saves it, and answers its path. */
const file = (trigger) => {
  const dir = join(scratch, `trigger-${++dirs}`);
  mkdirSync(dir);
  const path = join(dir, `${trigger.id}.json`);
  writeFileSync(path, JSON.stringify(trigger));
  return path;
};
/** The operands of `triggers check` and `submit` for `trigger`, as Quay gives them. */
const sent = (trigger, target = workflow) => [trigger.id, '--workflow', target, '--trigger', file(trigger)];

/** Submits the event source `name` declaring `push`, and the owner admits it; answers its secret. */
async function eventSource(name) {
  const now = await runner.coordinator.now(), secret = randomUUID();
  await runner.storage.call('eventSourceSubmit', { namespace: 'local', principalId: 'owner', requestId: randomUUID(), requestDigest: canonicalDigest({ source: name }), actor: { kind: 'HUMAN', principalId: 'owner' }, name, baseRevision: null,
    source: { eventTypes: [{ type: 'push' }] }, sourceDigest: `sha256:${'0'.repeat(64)}`, now });
  await admitEventSource(example, name, 1, secret);
  return secret;
}
/** Sends one push event from `source` as the relay holding `secret` would. */
async function push(source, secret, id) {
  const occurredAt = new Date(Date.parse(await runner.coordinator.now()) - 1000).toISOString();
  await example.host.service.graphEventSubmit({ kind: 'EVENT_SOURCE', name: source, secretHash: eventSourceSecretHash(secret) }, { profile: 'aiws-graph-event/1', id, type: 'push', occurredAt, data: { ref: 'main' } });
}

const cases = [];
const record = caseRecorder(cases, praxis, state);
const show = (name) => ['triggers', 'show', name, '--format', 'aiws-graph-trigger/1'];
const firesOf = (name, ...before) => ['triggers', 'fires', name, '--limit', '20', ...before, '--format', 'aiws-graph-trigger-fires/1'];

// A candidate, read and withdrawn.
const nightly = scheduled('nightly');
await record('triggers check: valid', ['triggers', 'check', ...sent(nightly)]);
await record('triggers check: faults, exit 9', ['triggers', 'check', ...sent(onPush('nightly', 'nowhere'))]);
await record('triggers check: target not on host', ['triggers', 'check', ...sent(nightly, 'nothing-here')]);
await record('triggers submit: a candidate', ['triggers', 'submit', ...sent(nightly)]);
await record('triggers submit: faults, exit 9', ['triggers', 'submit', ...sent(scheduled('nightly', { maxDepth: '1' }))]);
await record('triggers submit: target not on host', ['triggers', 'submit', ...sent(nightly, 'nothing-here')]);
await record('triggers show: a candidate', show('nightly'));
await record('triggers show: not submitted', show('nothing-here'));
await record('triggers list', ['triggers', 'list', '--limit', '100', '--format', 'aiws-graph-triggers/1']);
await record('triggers withdraw: a pending candidate', ['triggers', 'withdraw', 'nightly', '1']);
await record('triggers withdraw: not pending', ['triggers', 'withdraw', 'nightly', '1']);

// An EVENT trigger, admitted, with fires: the first push admits a run, which waits for approval
// and so holds the next.
const secret = await eventSource('github');
const onGithub = onPush('on-push', 'github');
await record('triggers submit: an event trigger', ['triggers', 'submit', ...sent(onGithub)]);
await admitTrigger(example, 'on-push', 1);
await record('triggers show: admitted and enabled', show('on-push'));
await record('triggers submit: a second candidate', ['triggers', 'submit', ...sent({ ...onGithub, rateLimit: '50' }), '--base', '1']);
await record('triggers show: older revisions', ['triggers', 'show', 'on-push', '--before', '2', '--limit', '20', '--format', 'aiws-graph-trigger-revisions/1']);
for (const id of ['evt-1', 'evt-2', 'evt-3']) await push('github', secret, id);
const page = await record('triggers fires', firesOf('on-push'));
await record('triggers fires: older', firesOf('on-push', '--before', String(page.fires[0].fireId)));
await record('triggers fires: not submitted', firesOf('nothing-here'));

// A trigger admitted but blocked: it isn't valid until a later time.
await record('triggers submit: not yet valid', ['triggers', 'submit', ...sent(scheduled('later', { notBefore: later, expiresAt: String(BigInt(later) + 1000n) }))]);
await admitTrigger(example, 'later', 1);
await record('triggers show: admitted but blocked', show('later'));
await record('triggers fires: none', firesOf('later'));

// Disabled, then retired.
await record('triggers disable', ['triggers', 'disable', 'on-push']);
await record('triggers show: admitted but disabled', show('on-push'));
// The review page of the admitted revision, where the owner enables a disabled trigger.
await record('triggers show: a revision', ['triggers', 'show', 'on-push', '--revision', '1', '--format', 'aiws-graph-trigger-revision/1']);
await record('triggers retire', ['triggers', 'retire', 'on-push']);
await record('triggers show: retired', show('on-push'));
await record('triggers disable: retired', ['triggers', 'disable', 'on-push']);
await record('triggers retire: already retired', ['triggers', 'retire', 'on-push']);
for (const close of closers.reverse()) await close();

// A simulated host's send can't be left unconfirmed, so this is made by the engine's own
// errorRecord from the message engine/src/praxis-client.ts writes, as runPraxis prints it.
const requestId = '3f2c8a1e-5b7d-4e9a-8c6f-0d1e2a3b4c5d';
const message = `The host did not confirm the request, so its outcome is unknown. Run the same command with --request-id ${requestId} to resend it.`;
const failure = new PraxisFailure(1, message, false, { code: 'OUTCOME_UNKNOWN', requestId, simulated: true });
cases.push({ name: 'triggers retire: outcome unknown (made)', args: ['triggers', 'retire', 'on-push', '--request-id', requestId], exit: failure.exitCode, stdout: errorRecord(failure), stderr: `praxis: ${message}\n` });

writeFixture(outFile, { script: 'trigger_outputs.record.mjs', commit, scratch, stand: 'praxis-trigger-record', cases });
