import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  buildSidecar,
  capturePaths,
  checkCaptureMachine,
  darkAppTheme,
  fixtureWorkspaces,
  parseCaptureArgs,
  parseCaptureManifest,
  parseSidecar,
  planCapture,
  readRecordings,
  type RecordingInfo,
} from './capture.ts';

const ROOT = join('E:', 'repo');

test('capture arguments name a tutorial and the Quay exe; the port, speed and tool have defaults', () => {
  const args = parseCaptureArgs(['hello-a2a', '--exe', 'C:\\Quay\\quay.exe'], ROOT);
  assert.equal(args.tutorial.slug, 'hello-a2a');
  assert.equal(args.exe, 'C:\\Quay\\quay.exe');
  assert.equal(args.tool, join(ROOT, 'tools', 'record-replay', 'target', 'release', 'quay-record-replay.exe'));
  assert.equal(args.port, 9333);
  assert.equal(args.fast, 10);
  assert.equal(args.byHand, false);

  const custom = parseCaptureArgs(['first-swarm', '--exe', 'q.exe', '--tool', 't.exe', '--port', '9444', '--fast', '2.5', '--by-hand'], ROOT);
  assert.deepEqual([custom.tool, custom.port, custom.fast, custom.byHand], ['t.exe', 9444, 2.5, true]);
});

test('capture arguments are rejected when they are missing, unknown or out of range', () => {
  const bad: [string[], RegExp][] = [
    [[], /tutorial/],
    [['no-such-tutorial', '--exe', 'q.exe'], /no-such-tutorial/],
    [['hello-a2a'], /--exe/],
    [['hello-a2a', '--exe', ''], /--exe/],
    [['hello-a2a', '--exe', 'q.exe', '--port', '80'], /--port/],
    [['hello-a2a', '--exe', 'q.exe', '--port', '9333.5'], /--port/],
    [['hello-a2a', '--exe', 'q.exe', '--port', 'abc'], /--port/],
    [['hello-a2a', '--exe', 'q.exe', '--fast', 'NaN'], /--fast/],
    [['hello-a2a', '--exe', 'q.exe', '--fast', '0'], /--fast/],
    [['hello-a2a', '--exe', 'q.exe', '--fast', '1000'], /--fast/],
    [['hello-a2a', '--exe', 'q.exe', '--frobnicate'], /frobnicate/],
    [['hello-a2a', 'first-swarm', '--exe', 'q.exe'], /one tutorial/],
  ];
  for (const [argv, message] of bad) assert.throws(() => parseCaptureArgs(argv, ROOT), message, argv.join(' '));
});

test("a tutorial's capture files: recordings and manifest beside the tool, stills beside its page, sidecar in its examples folder", () => {
  const { tutorial } = parseCaptureArgs(['hello-a2a', '--exe', 'q.exe'], ROOT);
  const paths = capturePaths(ROOT, tutorial);
  assert.equal(paths.recordings, join(ROOT, 'tools', 'record-replay', 'recordings', 'hello-a2a'));
  assert.equal(paths.manifest, join(ROOT, 'tools', 'record-replay', 'recordings', 'hello-a2a', 'capture.json'));
  assert.equal(paths.claudeConfig, join(ROOT, 'tools', 'record-replay', 'recordings', 'hello-a2a', 'claude-config'));
  assert.equal(paths.stills, join(ROOT, 'docs', 'tutorials', 'a2a', 'hello-a2a'));
  assert.equal(paths.sidecar, join(ROOT, 'examples', 'tutorials', 'hello-a2a', 'sidecar.json'));
  assert.equal(paths.starter, join(ROOT, 'examples', 'tutorials', 'hello-a2a', 'starter'));
});

const manifest = (body: object) => JSON.stringify({ tutorial: 'hello-a2a', ...body });

test('a capture manifest gives each marker its shots, waits, masks, pins and annotations', () => {
  const parsed = parseCaptureManifest(
    manifest({
      steps: [
        { marker: '01-get-the-starter' },
        {
          marker: '02-two-agents',
          actions: [{ click: 'text=New terminal' }, { press: 'Enter', in: '.xterm >> nth=0' }],
          waitFor: ['text=Ready'],
          timeout: 300,
          realTime: true,
          shots: [
            {
              pane: '.xterm >> nth=1',
              mask: ['.elapsed'],
              pin: [{ selector: '.trail-time', text: '4s' }],
              annotations: [{ target: '.xterm >> nth=1', label: '1  The reply' }],
            },
            { name: '02-two-agents-rail' },
          ],
        },
      ],
    }),
    'hello-a2a',
  );
  assert.equal(parsed.project, 'C:\\tutorials\\hello-a2a', 'the neutral project path by default');
  assert.deepEqual(parsed.steps[0], {
    marker: '01-get-the-starter',
    actions: [],
    waitFor: [],
    timeout: 120,
    realTime: false,
    shots: [{ name: '01-get-the-starter', pane: null, mask: [], pins: [], annotations: [] }],
  });
  assert.deepEqual(parsed.steps[1], {
    marker: '02-two-agents',
    actions: [
      { kind: 'click', selector: 'text=New terminal' },
      { kind: 'press', key: 'Enter', selector: '.xterm >> nth=0' },
    ],
    waitFor: ['text=Ready'],
    timeout: 300,
    realTime: true,
    shots: [
      {
        name: '02-two-agents',
        pane: '.xterm >> nth=1',
        mask: ['.elapsed'],
        pins: [{ selector: '.trail-time', text: '4s' }],
        annotations: [{ target: '.xterm >> nth=1', label: '1  The reply' }],
      },
      { name: '02-two-agents-rail', pane: null, mask: [], pins: [], annotations: [] },
    ],
  });
});

test('a capture manifest that does not fit the format is rejected with where it went wrong', () => {
  const bad: [string, RegExp][] = [
    ['not json', /JSON/],
    [manifest({ steps: [] }), /steps/],
    [JSON.stringify({ tutorial: 'first-swarm', steps: [{ marker: '01-a' }] }), /tutorial.*hello-a2a/],
    [manifest({ steps: [{ marker: '1-a' }] }), /steps\[0\]\.marker/],
    [manifest({ steps: [{ marker: '01-A' }] }), /steps\[0\]\.marker/],
    [manifest({ steps: [{ marker: '02-b' }, { marker: '01-a' }] }), /steps\[1\]\.marker.*after/],
    [manifest({ steps: [{ marker: '01-a' }, { marker: '01-b' }] }), /steps\[1\]\.marker.*after/],
    [manifest({ steps: [{ marker: '01-a', shots: [{ name: '02-a' }] }] }), /steps\[0\]\.shots\[0\]\.name.*01/],
    [manifest({ steps: [{ marker: '01-a', shots: [{}, {}] }] }), /01-a.*twice/],
    [manifest({ steps: [{ marker: '01-a', timeout: 0 }] }), /steps\[0\]\.timeout/],
    [manifest({ steps: [{ marker: '01-a', timeout: 'NaN' }] }), /steps\[0\]\.timeout/],
    [manifest({ steps: [{ marker: '01-a', waitFor: [''] }] }), /steps\[0\]\.waitFor\[0\]/],
    [manifest({ steps: [{ marker: '01-a', actions: [{ click: 'x', press: 'Enter' }] }] }), /steps\[0\]\.actions\[0\]/],
    [manifest({ steps: [{ marker: '01-a', actions: [{ press: 'Enter' }] }] }), /steps\[0\]\.actions\[0\]\.in/],
    [manifest({ steps: [{ marker: '01-a', actions: [{ hover: 'x' }] }] }), /steps\[0\]\.actions\[0\]/],
    [manifest({ steps: [{ marker: '01-a', shots: [{ pin: [{ selector: '.xterm-rows', text: 'x' }] }] }] }), /agent output/],
    [manifest({ steps: [{ marker: '01-a', shots: [{ annotations: [{ label: 'x' }] }] }] }), /annotations\[0\]\.target/],
    [manifest({ steps: [{ marker: '01-a', shots: [{ zoom: 2 }] }] }), /zoom/],
    [manifest({ steps: [{ marker: '01-a' }], extra: 1 }), /extra/],
    [manifest({ project: 'C:\\Users\\someone\\demo', steps: [{ marker: '01-a' }] }), /project.*user/],
    [manifest({ project: 'demo', steps: [{ marker: '01-a' }] }), /project/],
  ];
  for (const [text, message] of bad) assert.throws(() => parseCaptureManifest(text, 'hello-a2a'), message, text);
});

/** Writes recording `name` into `dir`: its cast header and events, and an empty HTTP log. */
function writeRecording(dir: string, name: string, header: object, events: [number, string, string][]) {
  const cast = [JSON.stringify({ version: 2, width: 100, height: 30, ...header }), ...events.map((e) => JSON.stringify(e))].join('\n');
  writeFileSync(join(dir, `${name}.cast.gz`), gzipSync(`${cast}\n`));
  writeFileSync(join(dir, `${name}.http.jsonl.gz`), gzipSync(''));
}

test("a tutorial's recordings say which CLI made each, when, at which version, and the markers each reaches", () => {
  const dir = mkdtempSync(join(tmpdir(), 'capture-recordings-'));
  writeRecording(dir, 'claude-1', { timestamp: 1_792_000_000, cli_version: '2.1.0 (Claude Code)' }, [
    [0.1, 'o', 'hello'],
    [1.0, 'm', '02-two-agents'],
    [2.0, 'm', '03-reply'],
  ]);
  // A terminal that starts after a marker marks it at its start; it never shows that step.
  writeRecording(dir, 'claude-2', { timestamp: 1_792_000_030, cli_version: '2.1.0 (Claude Code)' }, [
    [0, 'm', '02-two-agents'],
    [0.2, 'o', 'hi'],
    [1.0, 'm', '03-reply'],
  ]);
  writeRecording(dir, 'codex-1', {}, [[0.1, 'o', 'codex']]);
  writeFileSync(join(dir, 'capture.json'), '{}');

  assert.deepEqual(readRecordings(dir), [
    { name: 'claude-1', cli: 'claude', startedAt: 1_792_000_000_000, cliVersion: '2.1.0 (Claude Code)', markers: ['02-two-agents', '03-reply'], startMarker: null },
    { name: 'claude-2', cli: 'claude', startedAt: 1_792_000_030_000, cliVersion: '2.1.0 (Claude Code)', markers: ['02-two-agents', '03-reply'], startMarker: '02-two-agents' },
    { name: 'codex-1', cli: 'codex', startedAt: null, cliVersion: null, markers: [], startMarker: null },
  ]);
});

test('a recordings folder with no recordings, or a recording that is not one, is rejected', () => {
  const empty = mkdtempSync(join(tmpdir(), 'capture-empty-'));
  assert.throws(() => readRecordings(empty), /no recordings/);
  const broken = mkdtempSync(join(tmpdir(), 'capture-broken-'));
  writeFileSync(join(broken, 'claude-1.cast.gz'), gzipSync('{"version":1}\n'));
  assert.throws(() => readRecordings(broken), /claude-1.*asciicast v2/);
  const badName = mkdtempSync(join(tmpdir(), 'capture-bad-name-'));
  writeRecording(badName, 'Claude 1', {}, []);
  assert.throws(() => readRecordings(badName), /Claude 1/);
});

const recording = (name: string, markers: string[], startMarker: string | null = null): RecordingInfo => ({
  name,
  cli: name.replace(/-\d+$/, ''),
  startedAt: 1_792_000_000_000,
  cliVersion: '1.0.0',
  markers,
  startMarker,
});

test('each shot waits for every replay that reaches its marker, except one that only starts there', () => {
  const parsed = parseCaptureManifest(manifest({ steps: [{ marker: '01-starter' }, { marker: '02-two-agents' }, { marker: '03-reply' }] }), 'hello-a2a');
  const plan = planCapture(parsed, [
    recording('claude-1', ['02-two-agents', '03-reply']),
    recording('claude-2', ['02-two-agents', '03-reply'], '02-two-agents'),
  ]);
  assert.deepEqual(
    plan.map(({ step, waitFor }) => [step.marker, waitFor]),
    [
      ['01-starter', []],
      ['02-two-agents', ['claude-1']],
      ['03-reply', ['claude-1', 'claude-2']],
    ],
  );
});

test('a marker in a recording that the manifest takes no shot at is an error', () => {
  const parsed = parseCaptureManifest(manifest({ steps: [{ marker: '01-starter' }] }), 'hello-a2a');
  assert.throws(() => planCapture(parsed, [recording('claude-1', ['01-starter', '02-two-agents'])]), /claude-1.*02-two-agents.*capture\.json/);
});

test('the sidecar records the Quay version captured, the recording date and each CLI version from the run', () => {
  const sidecar = buildSidecar({
    tutorial: 'hello-a2a',
    quayVersion: '0.3.0',
    capturedOn: '2026-10-21',
    recordings: [
      // Late in the UTC day, so a local date would differ on most machines east of UTC.
      { ...recording('claude-1', []), startedAt: Date.UTC(2026, 9, 19, 23, 30), cliVersion: '2.1.0 (Claude Code)' },
      { ...recording('claude-2', []), startedAt: Date.UTC(2026, 9, 19, 23, 50), cliVersion: '2.1.0 (Claude Code)' },
      { ...recording('codex-1', []), startedAt: Date.UTC(2026, 9, 19, 23, 40), cliVersion: 'codex-cli 0.50.0' },
    ],
  });
  assert.deepEqual(sidecar, {
    tutorial: 'hello-a2a',
    quayVersion: '0.3.0',
    capturedOn: '2026-10-21',
    recordedOn: '2026-10-19',
    cliVersions: { claude: '2.1.0 (Claude Code)', codex: 'codex-cli 0.50.0' },
  });
  assert.deepEqual(parseSidecar(`${JSON.stringify(sidecar, null, 2)}\n`, 'hello-a2a'), sidecar);
});

test('a sidecar is read back only when every field is as buildSidecar writes it', () => {
  const good = { tutorial: 'hello-a2a', quayVersion: '0.3.0', capturedOn: '2026-10-21', recordedOn: '2026-10-19', cliVersions: { claude: '2.1.0' } };
  const bad: [unknown, RegExp][] = [
    [{ ...good, tutorial: 'first-swarm' }, /tutorial.*hello-a2a/],
    [{ ...good, quayVersion: 'v0.3.0' }, /quayVersion/],
    [{ ...good, capturedOn: '10/21/2026' }, /capturedOn/],
    [{ ...good, recordedOn: undefined }, /recordedOn/],
    [{ ...good, cliVersions: ['2.1.0'] }, /cliVersions/],
    [{ ...good, cliVersions: { claude: 2 } }, /cliVersions\.claude/],
    [[good], /object/],
  ];
  for (const [value, message] of bad) assert.throws(() => parseSidecar(JSON.stringify(value), 'hello-a2a'), message);
  assert.throws(() => parseSidecar('{ "tutorial": ', 'hello-a2a'), /JSON/);
});

test('a sidecar is not written from recordings that do not say when or with which CLI version they were made', () => {
  const base = { tutorial: 'hello-a2a', quayVersion: '0.3.0', capturedOn: '2026-10-21' };
  assert.throws(() => buildSidecar({ ...base, quayVersion: 'dev', recordings: [recording('claude-1', [])] }), /Quay version/);
  assert.throws(() => buildSidecar({ ...base, recordings: [{ ...recording('claude-1', []), startedAt: null }] }), /claude-1.*when/);
  assert.throws(() => buildSidecar({ ...base, recordings: [{ ...recording('claude-1', []), cliVersion: null }] }), /claude-1.*version/);
  assert.throws(
    () => buildSidecar({ ...base, recordings: [recording('claude-1', []), { ...recording('claude-2', []), cliVersion: '9.9.9' }] }),
    /claude.*1\.0\.0.*9\.9\.9/,
  );
});

test("the fixture workspace puts the fake CLIs first on the project's PATH and points them at the replay", () => {
  const workspaces = fixtureWorkspaces({
    project: 'C:\\tutorials\\hello-a2a',
    fakeCli: 'C:\\work\\fake-cli',
    systemRoot: 'C:\\Windows',
    replayDir: 'E:\\repo\\tools\\record-replay\\recordings\\hello-a2a',
    replayState: 'C:\\work\\replay-state',
  });
  assert.deepEqual(workspaces, {
    active_project: 'C:\\tutorials\\hello-a2a',
    projects: [
      {
        path: 'C:\\tutorials\\hello-a2a',
        name: 'hello-a2a',
        env_vars: {
          PATH: 'C:\\work\\fake-cli;C:\\Windows\\system32;C:\\Windows',
          QUAY_REPLAY_DIR: 'E:\\repo\\tools\\record-replay\\recordings\\hello-a2a',
          QUAY_REPLAY_STATE: 'C:\\work\\replay-state',
          // The test account sets QUAY_RECORD_DIR for every terminal; a replay must not record.
          QUAY_RECORD_DIR: '',
        },
      },
    ],
  });
});

test('the capture machine must be pinned: 200% scaling, a 1280 px window, Cascadia Code and the dark theme', () => {
  const pinned = { devicePixelRatio: 2, innerWidth: 1280, cascadiaCode: true, darkAppTheme: true };
  assert.deepEqual(checkCaptureMachine(pinned), []);
  const problems = checkCaptureMachine({ devicePixelRatio: 2.5, innerWidth: 1024, cascadiaCode: false, darkAppTheme: false });
  assert.equal(problems.length, 4);
  assert.match(problems[0], /200%.*2\.5/);
  assert.match(problems[1], /1280.*1024/);
  assert.match(problems[2], /Cascadia Code/);
  assert.match(problems[3], /dark/);
  assert.match(checkCaptureMachine({ ...pinned, darkAppTheme: null })[0], /theme/);
});

test("the Windows app theme is read from the registry's AppsUseLightTheme, since the webview's prefers-color-scheme does not follow it", () => {
  const query = (value: string) =>
    `\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize\r\n    AppsUseLightTheme    REG_DWORD    ${value}\r\n\r\n`;
  assert.equal(darkAppTheme(query('0x0')), true);
  assert.equal(darkAppTheme(query('0x1')), false);
  assert.equal(darkAppTheme(''), null);
  assert.equal(darkAppTheme(query('banana')), null);
});
