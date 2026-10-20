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
