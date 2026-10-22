import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeConfigProblems, claudeProjectFolder, scrubTranscript } from './claude-config.ts';

const RUN_START = Date.UTC(2026, 9, 21, 19, 0, 0);

/** An assistant response line as Claude Code writes it, with everything a scrub must drop. */
const response = (timestamp: string, id = 'msg_01') =>
  JSON.stringify({
    parentUuid: 'p-1',
    cwd: 'C:\\tutorials\\first-swarm',
    sessionId: 's-1',
    version: '2.1.306',
    gitBranch: 'main',
    type: 'assistant',
    requestId: 'req_01',
    timestamp,
    uuid: 'u-1',
    message: {
      id,
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [{ type: 'text', text: 'I implemented src/tip.ts.' }],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 4,
        cache_creation_input_tokens: 2048,
        cache_read_input_tokens: 15000,
        output_tokens: 312,
        cache_creation: { ephemeral_5m_input_tokens: 2048, ephemeral_1h_input_tokens: 0 },
        server_tool_use: { web_search_requests: 0 },
        service_tier: 'standard',
      },
    },
  });

test("a project's transcripts live in a folder named for its path, with every other character a hyphen", () => {
  assert.equal(claudeProjectFolder('C:\\tutorials\\first-swarm'), 'C--tutorials-first-swarm');
});

test("a scrubbed transcript keeps only the recorded run's responses, cut down to what Quay prices", () => {
  const transcript = [
    JSON.stringify({ type: 'user', timestamp: '2026-10-21T19:01:00.000Z', message: { role: 'user', content: 'Implement src/tip.ts' } }),
    response('2026-10-21T18:59:59.999Z', 'msg_earlier_run'),
    response('2026-10-21T19:02:00.000Z'),
    'not json',
    JSON.stringify({ type: 'summary', summary: 'Tip calculator' }),
  ].join('\n');
  assert.equal(
    scrubTranscript(transcript, RUN_START),
    JSON.stringify({
      type: 'assistant',
      requestId: 'req_01',
      sessionId: 's-1',
      timestamp: '2026-10-21T19:02:00.000Z',
      message: {
        id: 'msg_01',
        model: 'claude-opus-5-5',
        usage: {
          input_tokens: 4,
          output_tokens: 312,
          cache_read_input_tokens: 15000,
          cache_creation_input_tokens: 2048,
          cache_creation: { ephemeral_5m_input_tokens: 2048, ephemeral_1h_input_tokens: 0 },
        },
      },
    }) + '\n',
  );
  assert.equal(scrubTranscript(response('2026-10-21T18:00:00Z'), RUN_START), '', 'nothing from before the run');
});

test('a fixture Claude config holds only scrubbed transcripts under projects/', () => {
  const scrubbed = scrubTranscript(response('2026-10-21T19:02:00Z'), RUN_START);
  assert.deepEqual(claudeConfigProblems(new Map([['projects/C--tutorials-first-swarm/s-1.jsonl', scrubbed]])), []);
  assert.deepEqual(
    claudeConfigProblems(
      new Map([
        ['.credentials.json', '{"claudeAiOauth":{}}'],
        ['projects/C--tutorials-first-swarm/s-1.jsonl', `${scrubbed}${response('2026-10-21T19:03:00Z')}\n`],
        ['settings.json', '{}'],
      ]),
    ),
    [
      '.credentials.json is not a transcript under projects/; a fixture Claude config holds nothing else',
      'projects/C--tutorials-first-swarm/s-1.jsonl line 2 holds more than a scrubbed response\'s token counts',
      'settings.json is not a transcript under projects/; a fixture Claude config holds nothing else',
    ],
  );
});
