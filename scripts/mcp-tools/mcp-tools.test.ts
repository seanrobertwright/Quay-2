import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { REFERENCE_PAGE, TOOL_LIST, parseToolList, parseToolReference, referenceProblems } from './mcp-tools.ts';

const toolList = JSON.stringify([
  {
    name: 'send',
    description: 'Send a message.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string' },
        wait: { type: 'boolean' },
        paths: { type: 'array', items: { type: 'string' } },
      },
      required: ['target'],
    },
  },
  { name: 'list', description: 'List the peers.', inputSchema: { type: 'object', properties: {} } },
]);

const page = [
  '# Bus',
  '',
  '### How a target is matched',
  '',
  '- **Parameters**: not a tool, so never read.',
  '',
  '### `send`',
  '',
  'Sends a message.',
  '',
  '- **Parameters**:',
  '  - `target` (string, required): Who to send to.',
  '  - `wait` (boolean, optional, default: `true`): Whether to wait.',
  '  - `paths` (array of strings, optional): Paths.',
  '- **Response**: text.',
  '',
  '### `list`',
  '',
  '- **Parameters**: none.',
  '',
  '## Recipes',
].join('\n');

test('the tool list gives each tool its parameters, with type and whether it is required', () => {
  assert.deepEqual(parseToolList(toolList), [
    {
      name: 'send',
      parameters: [
        { name: 'target', type: 'string', required: true },
        { name: 'wait', type: 'boolean', required: false },
        { name: 'paths', type: 'array of strings', required: false },
      ],
    },
    { name: 'list', parameters: [] },
  ]);
});

test('the reference reads only headings that are a tool name, and their parameter lists', () => {
  assert.deepEqual(parseToolReference(page), [
    {
      name: 'send',
      parameters: [
        { name: 'target', type: 'string', required: true },
        { name: 'wait', type: 'boolean', required: false },
        { name: 'paths', type: 'array of strings', required: false },
      ],
    },
    { name: 'list', parameters: [] },
  ]);
});

test('a reference that matches the tool list has no problems', () => {
  assert.deepEqual(referenceProblems(parseToolList(toolList), parseToolReference(page)), []);
});

test('a tool missing from the reference, or one the server lacks, is a problem', () => {
  const reference = parseToolReference(page.replace('### `list`', '### `lists`'));
  assert.deepEqual(referenceProblems(parseToolList(toolList), reference), [
    '`list` is on the MCP server but has no `### `list`` section',
    '`lists` has a section but is not on the MCP server',
  ]);
});

test('a parameter renamed, retyped, or marked required wrongly is a problem', () => {
  const drifted = page
    .replace('`target` (string, required)', '`target_id` (string, required)')
    .replace('`wait` (boolean, optional', '`wait` (string, required');
  assert.deepEqual(referenceProblems(parseToolList(toolList), parseToolReference(drifted)), [
    '`send`: parameter `target` is missing from the reference',
    '`send`: parameter `wait` is boolean, optional, but the reference says string, required',
    '`send`: parameter `target_id` is not in the tool\'s schema',
  ]);
});

test('a tool with two sections is a problem', () => {
  const twice = `${page}\n\n### \`list\`\n\n- **Parameters**: none.\n`;
  assert.deepEqual(referenceProblems(parseToolList(toolList), parseToolReference(twice)), [
    '`list` has 2 sections; give it one',
  ]);
});

test('a tool section with no Parameters line is a problem, not a tool without parameters', () => {
  const reference = parseToolReference(page.replace('- **Parameters**: none.', 'Lists the peers.'));
  assert.deepEqual(referenceProblems(parseToolList(toolList), reference), [
    '`list`: the section has no `- **Parameters**:` line',
  ]);
});

test('a parameter line the reference cannot read is a problem', () => {
  const reference = parseToolReference(page.replace('`wait` (boolean, optional, default: `true`)', '`wait`, a boolean'));
  assert.deepEqual(referenceProblems(parseToolList(toolList), reference), [
    '`send`: cannot read the parameter line "  - `wait`, a boolean: Whether to wait."; write it as "- `name` (type, required|optional): ..."',
    '`send`: parameter `wait` is missing from the reference',
  ]);
});

test('headings and parameter lines inside a code fence are never read', () => {
  const fenced = page.replace(
    'Sends a message.',
    ['Sends a message.', '', '```powershell', '# run this first', '### `send`', '```'].join('\n'),
  );
  assert.deepEqual(referenceProblems(parseToolList(toolList), parseToolReference(fenced)), []);
});

test('a nested list under a parameter is part of its description', () => {
  const nested = page.replace(
    '  - `wait` (boolean, optional, default: `true`): Whether to wait.',
    ['  - `wait` (boolean, optional, default: `true`): Whether to wait.', '    - `true`: waits.', '    - `false`: returns at once.'].join('\n'),
  );
  assert.deepEqual(referenceProblems(parseToolList(toolList), parseToolReference(nested)), []);
});

test('a parameter documented twice is a problem', () => {
  const twice = page.replace(
    '  - `wait` (boolean, optional, default: `true`): Whether to wait.',
    '  - `wait` (boolean, optional): Whether to wait.\n  - `wait` (string, required): Stale.',
  );
  assert.deepEqual(referenceProblems(parseToolList(toolList), parseToolReference(twice)), [
    '`send`: parameter `wait` is documented 2 times; give it one line',
  ]);
});

test('a second Parameters line in one section is a problem', () => {
  const second = page.replace('- **Response**: text.', '- **Parameters**: none.');
  assert.deepEqual(referenceProblems(parseToolList(toolList), parseToolReference(second)), [
    '`send`: the section has more than one `- **Parameters**:` line; give it one',
  ]);
});

test('the A2A page documents every tool Quay\'s MCP server lists, parameter for parameter', async () => {
  const tools = parseToolList(await readFile(TOOL_LIST, 'utf8'));
  const reference = parseToolReference(await readFile(REFERENCE_PAGE, 'utf8'));
  assert.deepEqual(referenceProblems(tools, reference), []);
});
