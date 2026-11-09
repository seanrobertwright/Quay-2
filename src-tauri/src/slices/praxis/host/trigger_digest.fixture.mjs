// Makes trigger_digest.fixture.json: one saved graph trigger file, the graph workflow its target
// file names, and the digest the AI-WS-SDK engine gives each of two revisions of it, computed by
// the engine's own code, not a copy of it. Run with Node 24 or later against an AI-WS-SDK
// checkout with its dependencies installed:
//
//   node trigger_digest.fixture.mjs <checkout> <commit> > trigger_digest.fixture.json
//
// The digest is what `triggers show` reports on each revision. The host stores the submitted
// record with `revision` set to the revision it became, in decimal, so each revision of the same
// file has its own digest (engine/src/graph-trigger-repository.ts, `submit`).
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const [checkout, commit] = process.argv.slice(2);
if (!checkout || !commit) throw new Error('Usage: node trigger_digest.fixture.mjs <checkout> <commit>');
const from = (path) => import(pathToFileURL(join(checkout, path)).href);
const { graphTriggerDigest } = await from('engine/src/graph-triggers.ts');

const workflow = 'release-review';
// The file's own `revision` is one the host replaces, so the digests can only agree by replacing it.
const trigger = {
  id: 'nightly', revision: '7', kind: 'SCHEDULED', source: 'praxis', eventType: 'schedule.tick', contractId: 'release', action: 'START_RUN', enabled: true,
  notBefore: '0', expiresAt: '4102444800000', maxAgeMs: '3600000', maxConcurrent: '5', rateLimit: '100', rateWindowMs: '3600000', maxDepth: '0',
  schedule: { startMs: '1700000000000', intervalMs: '60000', catchUp: 'ALL', maxCatchUp: '3' },
  filter: { field: 'note', equals: 'café, naïve, 日本語 and 🚀' },
};
// The keys reversed and indented, so the digest can only agree through the canonical form.
const file = JSON.stringify(Object.fromEntries(Object.entries(trigger).reverse()), null, 2) + '\n';
const digests = Object.fromEntries([1, 2].map((revision) => [revision, graphTriggerDigest(workflow, { ...trigger, revision: String(revision) })]));
console.log(JSON.stringify({
  provenance: `graphTriggerDigest from engine/src/graph-triggers.ts of seanrobertwright/AI-WS-SDK at ${commit}, run by trigger_digest.fixture.mjs on Node ${process.versions.node}.`,
  workflow,
  trigger: { id: trigger.id, file },
  digests,
}, null, 2));
