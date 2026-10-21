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

test('an at-a-glance strip without Time, Tokens, Agents and Level tiles, in that order, breaks glance', async () => {
  assert.deepEqual(checkStepCards(await parse('fixtures/glance.md')), [{ rule: 'glance', step: null, title: null }]);
});

test('a Level other than Starter, Intermediate or Advanced breaks glance-level', async () => {
  assert.deepEqual(checkStepCards(await parse('fixtures/glance-level.md')), [
    { rule: 'glance-level', step: null, title: null },
  ]);
});

test("a page with no You'll learn line before step 1 breaks you-will-learn", async () => {
  assert.deepEqual(checkStepCards(await parse('fixtures/you-will-learn.md')), [
    { rule: 'you-will-learn', step: null, title: null },
  ]);
});

test('a Before you start that is not a heading and one list breaks before-you-start', async () => {
  assert.deepEqual(checkStepCards(await parse('fixtures/before-you-start.md')), [
    { rule: 'before-you-start', step: null, title: null },
  ]);
});

test('a Next up card that does not open with one link breaks next-up', async () => {
  assert.deepEqual(checkStepCards(await parse('fixtures/next-up.md')), [{ rule: 'next-up', step: null, title: null }]);
});

test('page parts out of place break their own rule', () => {
  const page = md.parse(
    [
      '# Swarm 1: Out of place',
      '::: step',
      '## 1. Get the starter project',
      '::: do',
      'Unzip it.',
      ':::',
      '::: see',
      'The rail.',
      ':::',
      '::: done',
      'It worked.',
      ':::',
      ':::',
      "**You'll learn:** too late.",
      '::: glance',
      '- **Time** ~5 min',
      '- **Tokens** ~5k',
      '- **Agents** 1 × Claude',
      '- **Level** Starter',
      ':::',
      '::: before',
      '## Before you start',
      '- Quay 2 is installed.',
      ':::',
    ].join('\n'),
    {},
  );
  assert.deepEqual(
    checkStepCards(page).map((violation) => violation.rule),
    ['glance', 'you-will-learn', 'before-you-start', 'next-up'],
  );
});

test('the page parts render as the glance strip, the Before you start checklist and the Next up card', () => {
  const html = md.render(
    [
      '::: glance',
      '- **Time** ~5 min',
      '- **Level** Starter',
      ':::',
      '::: before',
      '## Before you start',
      '- **Quay 2** is installed.',
      '- Claude Code is signed in.',
      ':::',
      '::: next',
      '[Swarm 2: TDD Swarm kata](/tutorials/swarm/tdd-swarm-kata/)',
      ':::',
    ].join('\n'),
    {},
  );
  assert.match(html, /^<div class="tutorial-glance">\n<ul>\n<li><strong>Time<\/strong> ~5 min<\/li>/);
  assert.match(
    html,
    /<div class="tutorial-checklist">\n<h2 id="before-you-start" tabindex="-1">Before you start .*?<\/h2>\n<ul>\n<li><label><input type="checkbox"> <span><strong>Quay 2<\/strong> is installed.<\/span><\/label><\/li>\n<li><label><input type="checkbox"> <span>Claude Code is signed in.<\/span><\/label><\/li>\n<\/ul>\n<\/div>/,
  );
  assert.match(
    html,
    /<nav class="tutorial-next" aria-label="Next up"><p class="tutorial-next__label">Next up<\/p>\n<p><a href="\/tutorials\/swarm\/tdd-swarm-kata\/">Swarm 2: TDD Swarm kata<\/a><\/p>\n<\/nav>/,
  );
});

test('each container renders as its labelled part of a step card', () => {
  const html = md.render(
    [
      '::: step',
      '## 1. Get the starter project',
      '::: do',
      'Unzip it.',
      ':::',
      '::: paste Mission Control',
      '```text',
      'Say hello.',
      '```',
      ':::',
      '::: see',
      'The rail.',
      ':::',
      '::: must',
      'A greeting.',
      ':::',
      '::: may',
      'The wording.',
      ':::',
      '::: ifnot `asker` has no quay tools',
      'Launch it again.',
      ':::',
      ':::',
      '::: step',
      '## 2. Check it worked',
      '::: paste `asker`',
      '```text',
      'Say hello.',
      '```',
      ':::',
      '::: done',
      'Every test passes.',
      ':::',
      ':::',
    ].join('\n'),
    {},
  );
  const labels = [...html.matchAll(/<p class="step-card__label">(.*?)<\/p>/g)].map((match) => match[1]);
  assert.deepEqual(labels, [
    'Do',
    'Paste into Mission Control',
    'You should see',
    'Must match',
    'May differ',
    'Paste into <code>asker</code>',
    'You’re done when',
  ]);
  assert.match(html, /<details class="details custom-block step-card__ifnot"><summary>If not: <code>asker<\/code> has no quay tools<\/summary>\n<p>Launch it again.<\/p>\n<\/details>/);
  assert.deepEqual(
    [...html.matchAll(/<section class="([^"]*)">/g)].map((match) => match[1]),
    ['step-card', 'step-card step-card--last'],
  );
  assert.match(html, /<div class="step-card__slot step-card__slot--paste"><p class="step-card__label">Paste into Mission Control<\/p>\n<div class="language-text/);
});
