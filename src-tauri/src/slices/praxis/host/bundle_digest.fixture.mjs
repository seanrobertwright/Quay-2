// Makes bundle_digest.fixture.json: the files of one graph workflow bundle, and the bundleDigest
// the AI-WS-SDK engine gives them, computed by the engine's own code, not a copy of it. Run with
// Node 24 or later against an AI-WS-SDK checkout with its dependencies installed:
//
//   node bundle_digest.fixture.mjs <checkout> <commit> > bundle_digest.fixture.json
//
// `bundleDigest` is what `graphs show` reports on each revision (GRAPH-WORKFLOWS.md, "Bundle
// digest"). The bundle is engine/examples/graph-bundle.ts's, with a second grant whose id sorts
// first, listed second, so the digest can only agree through the engine's grant order.
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const [checkout, commit] = process.argv.slice(2);
if (!checkout || !commit) throw new Error('Usage: node bundle_digest.fixture.mjs <checkout> <commit>');
const from = (path) => import(pathToFileURL(join(checkout, path)).href);
const { bundle } = await from('engine/examples/graph-bundle.ts');
const { bundleDigest } = await from('engine/src/graph-workflows.ts');

const b = bundle();
b.contract.criteria = ['review: café, naïve, 日本語 and 🚀'];
b.grants.push({ ...b.grants[0], id: 'a-grant-sorted-first' });
// The keys reversed and indented, so the digest can only agree through the canonical form.
const file = (value) => JSON.stringify(Object.fromEntries(Object.entries(value).reverse()), null, 2) + '\n';
console.log(JSON.stringify({
  provenance: `bundleDigest from engine/src/graph-workflows.ts of seanrobertwright/AI-WS-SDK at ${commit}, run by bundle_digest.fixture.mjs on Node ${process.versions.node}.`,
  graph: { id: b.graph.id, file: file(b.graph) },
  binding: { id: b.binding.graphBindingId, file: file(b.binding) },
  contract: { id: b.contract.id, file: file(b.contract) },
  // In the order the contract's bindings file lists them.
  grants: b.grants.map((g) => ({ id: g.id, file: file(g) })),
  bundleDigest: bundleDigest(b),
}, null, 2));
