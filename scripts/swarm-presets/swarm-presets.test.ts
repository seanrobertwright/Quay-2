import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { SwarmPreset } from '../../src/slices/orchestrator/swarmTypes.ts';
import { BUILTIN_SWARM_PRESETS } from '../../src/slices/orchestrator/swarmTypes.ts';
import { GENERATED_FILES, presetPageSection, readmeBullets, replaceGeneratedRegion } from './swarm-presets.ts';

const pair: SwarmPreset = {
  id: 'review-pair',
  title: 'Review Pair',
  description: 'A builder beside a reviewer.',
  layout: 'split-horizontal',
  agents: [
    { role: 'Builder', name: 'builder', run_kind: 'claude', custom_flags: '--model claude-sonnet-5-5', role_prompt: 'You are the Builder.\nYou own src/.' },
    { role: 'Test Shell', name: 'tests', run_kind: 'powershell' },
  ],
};

test('the feature page section numbers each preset and lists its layout and each agent in its pane', () => {
  assert.equal(
    presetPageSection([pair]).join('\n'),
    [
      '### 1. Review Pair',
      '',
      'A builder beside a reviewer.',
      '',
      '- **Layout**: Side-by-side split.',
      '- **`builder`** (Claude Code, `--model claude-sonnet-5-5`, left): Builder.',
      '- **`tests`** (PowerShell, right): Test Shell.',
      '',
      '::: details Role prompts',
      '',
      '**`builder`**',
      '',
      '```text',
      'You are the Builder.',
      'You own src/.',
      '```',
      '',
      ':::',
    ].join('\n'),
  );
});

test('a preset with no role prompts gets no role prompts block', () => {
  const shells: SwarmPreset = { ...pair, agents: [pair.agents[1]] };
  assert.ok(!presetPageSection([shells]).includes('::: details Role prompts'));
});

test('the README bullets name each preset with its agents and description', () => {
  assert.deepEqual(readmeBullets([pair]), ['- *Review Pair* (`builder`, `tests`): A builder beside a reviewer.']);
});

test('text from the presets is escaped, and a role prompt holding a fence gets a longer one', () => {
  const tricky: SwarmPreset = {
    ...pair,
    title: 'A*B <C> {{ d }}',
    agents: [{ ...pair.agents[0], role_prompt: 'Reply with:\n```\nDONE\n```' }],
  };
  const section = presetPageSection([tricky]);
  assert.equal(section[0], '### 1. A\\*B &lt;C&gt; &#123;&#123; d &#125;&#125;');
  assert.ok(section.includes('````text'));
  assert.equal(readmeBullets([tricky])[0].startsWith('- *A\\*B &lt;C&gt; &#123;&#123; d &#125;&#125;*'), true);
});

const page = (body: string) =>
  ['# Title', '  <!-- BEGIN GENERATED: presets. Do not edit. -->', body, '  <!-- END GENERATED: presets -->', 'After'].join('\r\n');

test('a generated region is replaced at the begin marker\'s indent, keeping the file\'s line endings', () => {
  assert.equal(
    replaceGeneratedRegion(page('  stale'), 'presets', ['- one', '', '- two']),
    ['# Title', '  <!-- BEGIN GENERATED: presets. Do not edit. -->', '  - one', '', '  - two', '  <!-- END GENERATED: presets -->', 'After'].join('\r\n'),
  );
});

test('a file without exactly one pair of markers for the region is refused', () => {
  assert.throws(() => replaceGeneratedRegion('# Title\n', 'presets', []), /presets/);
  assert.throws(() => replaceGeneratedRegion(page('x').replace('BEGIN', 'START'), 'presets', []), /presets/);
  assert.throws(() => replaceGeneratedRegion(page('x') + '\r\n' + page('y'), 'presets', []), /presets/);
  const reversed = '<!-- END GENERATED: presets -->\n<!-- BEGIN GENERATED: presets -->\n';
  assert.throws(() => replaceGeneratedRegion(reversed, 'presets', []), /presets/);
});

test('a region\'s markers are not mistaken for those of a region whose name starts with it', () => {
  const other = '<!-- BEGIN GENERATED: presets-extra -->\nkeep\n<!-- END GENERATED: presets-extra -->\n';
  assert.throws(() => replaceGeneratedRegion(other, 'presets', []), /presets/);
  assert.equal(replaceGeneratedRegion(other + page('x').replaceAll('\r\n', '\n'), 'presets', []).startsWith(other), true);
});

test('the feature page lists every built-in preset, in order, with every agent name', () => {
  const section = presetPageSection(BUILTIN_SWARM_PRESETS).join('\n');
  const headings = section.split('\n').filter((line) => line.startsWith('### '));
  assert.deepEqual(headings, BUILTIN_SWARM_PRESETS.map((preset, i) => `### ${i + 1}. ${preset.title}`));
  for (const agent of BUILTIN_SWARM_PRESETS.flatMap((preset) => preset.agents)) {
    assert.ok(section.includes(`**\`${agent.name}\`**`), agent.name);
  }
});

test('the committed README and feature page hold the lists the presets generate', async () => {
  for (const file of GENERATED_FILES) {
    const text = await readFile(file.path, 'utf8');
    assert.equal(file.regenerate(text), text, `${file.path} is stale: run pnpm docs:presets`);
  }
});

// A word with a slash in it (src/, test/cli.test.ts), or a bare file name ending .md, .ts or .json.
const PATH_LIKE = /[\w.-]*\/(?:[\w/-]|\.\w)*|\b[\w-]+\.(?:md|ts|json)\b/g;

test('the Tri-Agent Council role prompts name only the files both of its starters hold', () => {
  // Why only these three: see the comment above tri-agent-council in BUILTIN_SWARM_PRESETS.
  const shared = ['AGENTS.md', 'PLAN.md', 'SPEC.md'];
  const council = BUILTIN_SWARM_PRESETS.find((preset) => preset.id === 'tri-agent-council');
  assert.ok(council);
  for (const agent of council.agents) {
    const paths = agent.role_prompt?.match(PATH_LIKE) ?? [];
    assert.deepEqual(paths.filter((path) => !shared.includes(path)), [], agent.name);
  }
});
