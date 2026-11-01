// Makes template_digest.fixture.json: one workflow template file, and the templateDigest the
// AI-WS-SDK engine gives it, computed by the engine's own code, not a copy of it. Run with
// Node 24 or later against an AI-WS-SDK checkout at the commit Quay vendors (src-tauri/vendor/aiws/SOURCE):
//
//   node template_digest.fixture.mjs <checkout> <commit> > template_digest.fixture.json
//
// `workflows show` reports `review.digest` from `reviewWorkflowTemplate` as `templateDigest`
// (`WorkflowCatalog` in engine/src/workflow-templates.ts).
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const [checkout, commit] = process.argv.slice(2);
const from = (path) => import(pathToFileURL(join(checkout, path)).href);
const { reviewWorkflowTemplate } = await from('engine/src/workflow-templates.ts');
const { template } = await from('engine/test/fixtures/workflow-template.ts');

const node = (script) => ['/usr/bin/node', script];
const content = template({
  description: 'Review the code: café, naïve, 日本語, a \t tab, "quotes" and 🚀',
  implementation: node('review.js'),
  validation: node('check.js'),
  correction: node('fix.js'),
  outputPaths: ['review.txt'],
});
// The keys reversed and indented, so the digest can only agree through the canonical form.
const file = JSON.stringify(Object.fromEntries(Object.entries(content).reverse()), null, 2) + '\n';
const review = reviewWorkflowTemplate('review-code', Buffer.from(file));
if (!review.valid) throw new Error(`The fixture template isn't valid: ${JSON.stringify(review.diagnostics)}`);
console.log(JSON.stringify({
  provenance: `templateDigest from reviewWorkflowTemplate in engine/src/workflow-templates.ts of seanrobertwright/AI-WS-SDK at ${commit}, run by template_digest.fixture.mjs on Node ${process.versions.node}.`,
  name: review.name,
  file,
  templateDigest: review.digest,
}, null, 2));
