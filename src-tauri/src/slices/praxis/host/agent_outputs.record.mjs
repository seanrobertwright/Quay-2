// Records agent_outputs.fixture.json: what the real `praxis` CLI prints for `praxis agents`, the
// host's agent picker (#482), run as a subprocess against the simulated host its own tests start,
// so the fake `praxis` replays records the CLI itself wrote. Run with Node 24 or later against an
// AI-WS-SDK checkout that has `praxis agents` (AI-WS-SDK#687 or later):
//
//   node agent_outputs.record.mjs <checkout> <commit> agent_outputs.fixture.json
//
// The host with a catalog is the one the SDK's own engine/test/praxis-agents.test.ts starts.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { caseRecorder, recorderArgs, writeFixture } from './record_support.mjs';

const { commit, outFile, from } = recorderArgs('agent_outputs.record.mjs');
const { simulatedHost } = await from('engine/test/fixtures/praxis-host.ts');
const { catalogEntry, hostAdapterManifest, recordingAdapter, verifiedSnapshot } = await from('engine/test/fixtures/agent-catalog-host.ts');
const { harnessOf } = await from('engine/test/fixtures/harness.ts');
const { manifestDigest } = await from('engine/src/capability-readiness.ts');

// `simulatedHost` takes a node:test context only to close the host afterwards.
const closers = [];
const t = { after: (fn) => closers.push(fn) };

// A catalog of three agents that use no model, in this order: one that can be bound; one the host
// observes with another implementation than the catalog pins, which can't be bound; and one whose
// reviewed adapter isn't installed, which only readiness for a plan refuses, so it can be bound here.
const ready = 'ready-coder', changed = 'changed-coder', unadapted = 'unadapted-coder';
const manifests = [ready, changed, unadapted].map((id) => hostAdapterManifest(id));
const observed = (m) => (m.agentId === changed ? { ...structuredClone(m), implementationDigest: 'd'.repeat(64) } : m);
const agents = Object.fromEntries(manifests.map((m) => [m.agentId, {
  harness: harnessOf(m),
  inspect: async () => verifiedSnapshot(observed(m)),
  adapter: recordingAdapter(m.agentId === unadapted ? '0'.repeat(64) : manifestDigest(m), [], m.agentId),
}]));
const withCatalog = await simulatedHost(t, { templates: null, host: { agents, agentCatalog: { profile: 'aiws-agent-catalog/1', entries: manifests.map((m) => catalogEntry(m)) } } });
const noCatalog = await simulatedHost(t, { templates: null });

const cases = [];
const record = caseRecorder(cases, withCatalog.praxis, withCatalog.state);
const agentsArgs = ['agents', '--format', 'aiws-agent-picker/1'];
await record('agents: a catalog', agentsArgs);
await record('agents: no catalog', agentsArgs, noCatalog.praxis, noCatalog.state);
for (const close of closers.reverse()) await close();

// No file is given to `praxis agents`, so the scratch folder only names the stand-in.
const scratch = mkdtempSync(join(tmpdir(), 'praxis-agent-record-'));
writeFixture(outFile, { script: 'agent_outputs.record.mjs', commit, scratch, stand: 'praxis-agent-record', cases });
