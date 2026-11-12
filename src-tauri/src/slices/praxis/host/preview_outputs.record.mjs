// Records preview_outputs.fixture.json: what the real `praxis` CLI prints for
// `praxis preview FILE --template`, the host's authoring preview of a workflow template draft
// (#596), run as a subprocess against the simulated host its own tests start, so the fake `praxis`
// replays records the CLI itself wrote. Run with Node 24 or later against an AI-WS-SDK checkout
// that has `praxis preview` (AI-WS-SDK#690 or later):
//
//   node preview_outputs.record.mjs <checkout> <commit> preview_outputs.fixture.json
//
// The drafts are the ones the SDK's own engine/test/praxis-preview.test.ts previews.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { caseRecorder, recorderArgs, writeFixture } from './record_support.mjs';

const { commit, outFile, from } = recorderArgs('preview_outputs.record.mjs');
const { simulatedHost } = await from('engine/test/fixtures/praxis-host.ts');
const { plan } = await from('engine/test/fixtures/bound-coding.ts');

// `simulatedHost` takes a node:test context only to close the host afterwards.
const closers = [];
const t = { after: (fn) => closers.push(fn) };
const host = await simulatedHost(t, { templates: null });

const scratch = mkdtempSync(join(tmpdir(), 'praxis-preview-record-'));
mkdirSync(join(scratch, 'drafts'));
/** A draft saved in the scratch folder, as Quay hands `praxis` the draft in the template form. */
const saved = (name, draft) => {
  const path = join(scratch, 'drafts', name);
  writeFileSync(path, JSON.stringify(draft));
  return path;
};

// A workflow template is a coding plan without the identities a run supplies.
const { workOrderId: _workOrderId, runId: _runId, ...template } = plan({ workOrderId: 'drafted', runId: 'drafted-run' });
const { maxAttempts: _maxAttempts, ...incomplete } = template;

const cases = [];
const record = caseRecorder(cases, host.praxis, host.state);
const previewArgs = (file) => ['preview', file, '--template', '--format', 'aiws-authoring-preview/1'];
await record('preview: a template a run can be created from', previewArgs(saved('template.json', template)));
// The host answers a draft with an authoring error too: exit 1, with the record and its diagnostics.
await record('preview: a template with an authoring error', previewArgs(saved('incomplete.json', incomplete)));
// A draft the schema accepts and the host's readiness refuses: its agent isn't one the host has.
await record('preview: a valid template no run can be created from', previewArgs(saved('unready.json', { ...template, agent: 'no-such-agent' })));
// A file that carries a run's identities is refused as a template, a field at a time.
await record('preview: a template that carries identities', previewArgs(saved('identified.json', { ...template, workOrderId: 'drafted', runId: 'drafted-run' })));
for (const close of closers.reverse()) await close();

writeFixture(outFile, { script: 'preview_outputs.record.mjs', commit, scratch, stand: 'praxis-preview-record', cases });
