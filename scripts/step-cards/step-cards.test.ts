import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMarkdownRenderer } from 'vitepress';
import { checkStepCards, registerStepCardContainers } from '../../docs/.vitepress/step-cards.ts';

const md = await createMarkdownRenderer('docs', { config: registerStepCardContainers });

async function parse(path: string) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  return md.parse(source, {});
}

test('the example page follows every rule', async () => {
  assert.deepEqual(checkStepCards(await parse('../../docs/_examples/step-cards.md')), []);
});

test('a step with neither Do nor Paste breaks do-or-paste', async () => {
  assert.deepEqual(checkStepCards(await parse('fixtures/do-or-paste.md')), [
    { rule: 'do-or-paste', step: 2, title: 'Look at the rail' },
  ]);
});

test('a step with no You should see breaks see-required', async () => {
  assert.deepEqual(checkStepCards(await parse('fixtures/see-required.md')), [
    { rule: 'see-required', step: 1, title: 'Get the starter project' },
  ]);
});

test("a last step with no You're done when breaks done-required", async () => {
  assert.deepEqual(checkStepCards(await parse('fixtures/done-required.md')), [
    { rule: 'done-required', step: 2, title: 'Check it worked' },
  ]);
});

test("You're done when on any step but the last breaks done-last-only", async () => {
  assert.deepEqual(checkStepCards(await parse('fixtures/done-last-only.md')), [
    { rule: 'done-last-only', step: 1, title: 'Get the starter project' },
  ]);
});

test('Must match without May differ breaks must-may-pair', async () => {
  assert.deepEqual(checkStepCards(await parse('fixtures/must-may-pair.md')), [
    { rule: 'must-may-pair', step: 1, title: 'Get the starter project' },
  ]);
});

test('a Paste step with no Must match and May differ breaks must-may-agent-output', async () => {
  assert.deepEqual(checkStepCards(await parse('fixtures/must-may-agent-output.md')), [
    { rule: 'must-may-agent-output', step: 2, title: 'Ask the agent' },
  ]);
});

test('a Paste slot holding anything but one single-line prompt breaks paste-one-prompt', async () => {
  assert.deepEqual(checkStepCards(await parse('fixtures/paste-one-prompt.md')), [
    { rule: 'paste-one-prompt', step: 2, title: 'Paste two prompts' },
    { rule: 'paste-one-prompt', step: 3, title: 'Paste a prompt over two lines' },
    { rule: 'paste-one-prompt', step: 4, title: 'Paste prose instead of a prompt' },
  ]);
});

test('a Paste slot that names no pane or field breaks paste-target', async () => {
  assert.deepEqual(checkStepCards(await parse('fixtures/paste-target.md')), [
    { rule: 'paste-target', step: 2, title: 'Paste without saying where' },
  ]);
});

test('an If not that names no symptom breaks ifnot-symptom', async () => {
  assert.deepEqual(checkStepCards(await parse('fixtures/ifnot-symptom.md')), [
    { rule: 'ifnot-symptom', step: 1, title: 'Get the starter project' },
  ]);
});

test('a slot outside a step, or inside another slot, breaks slot-in-step', async () => {
  assert.deepEqual(checkStepCards(await parse('fixtures/slot-in-step.md')), [
    { rule: 'slot-in-step', step: null, title: null },
    { rule: 'slot-in-step', step: 1, title: 'Get the starter project' },
  ]);
});

test('slots out of order, or a slot twice, break slot-order', async () => {
  assert.deepEqual(checkStepCards(await parse('fixtures/slot-order.md')), [
    { rule: 'slot-order', step: 1, title: 'Get the starter project' },
    { rule: 'slot-order', step: 2, title: 'Run the tests' },
  ]);
});

test('a step that does not open with its numbered heading breaks step-heading', async () => {
  assert.deepEqual(checkStepCards(await parse('fixtures/step-heading.md')), [
    { rule: 'step-heading', step: 2, title: 'Run the tests' },
    { rule: 'step-heading', step: 3, title: null },
    { rule: 'step-heading', step: 4, title: 'Check it worked' },
  ]);
});

test('a title not shaped <Series> <n>: <Title> breaks page-title', async () => {
  assert.deepEqual(checkStepCards(await parse('fixtures/page-title.md')), [
    { rule: 'page-title', step: null, title: null },
  ]);
});

test('a step 1 other than Get the starter project breaks first-step', async () => {
  assert.deepEqual(checkStepCards(await parse('fixtures/first-step.md')), [
    { rule: 'first-step', step: 1, title: 'Open the project' },
  ]);
});

test('a troubleshooting section breaks no-troubleshooting', async () => {
  assert.deepEqual(checkStepCards(await parse('fixtures/no-troubleshooting.md')), [
    { rule: 'no-troubleshooting', step: null, title: null },
  ]);
});
