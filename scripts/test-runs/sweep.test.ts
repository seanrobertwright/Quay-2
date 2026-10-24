import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { daysBetweenDateStamps } from '../../src/lib/dates.ts';
import { parseSweepArgs, sweep, sweepIssue } from './sweep.ts';

/** A finished run section, with only the lines the record reader needs. */
function section(date: string, result: 'pass' | 'fail' | '_pass or fail_' = 'pass'): string {
  const lines = [`## ${date}`, '', `- **Result:** ${result}`, '- **Run fingerprint:** `aaaaaaaaaaaaaaaa`'];
  if (result === 'fail') {
    lines.push('- **Failed at:** 3', '- **Tracking issue:** #212', '', '### Agent CLIs', '', '| CLI | Version | Default model |', '| --- | --- | --- |', '| Claude Code | 2.1.310 | claude-opus-5-5 |');
  } else if (result === 'pass') {
    lines.push('', '### Time and Tokens', '', '| Agent | CLI | Minutes | Tokens |', '| --- | --- | --- | --- |', '| asker | Claude Code | 12 | 20,100 |', '| **Total** | | 12 | 20,100 |');
  }
  return `${lines.join('\n')}\n`;
}

const SIDECAR = {
  tutorial: 'first-swarm',
  quayVersion: '0.3.0',
  capturedOn: '2026-06-02',
  recordedOn: '2026-06-01',
  cliVersions: { claude: '2.1.0 (Claude Code)', codex: 'codex-cli 0.163.0' },
};

/** A repository with a page for each of `pages` (`<series>/<slug>`) and the given record and sidecar files. */
function repo({ pages, records = {}, sidecars = {} }: { pages: string[]; records?: Record<string, string>; sidecars?: Record<string, string> }): string {
  const root = mkdtempSync(join(tmpdir(), 'sweep-'));
  after(() => rmSync(root, { recursive: true, force: true }));
  for (const page of pages) {
    mkdirSync(join(root, 'docs', 'tutorials', page), { recursive: true });
    writeFileSync(join(root, 'docs', 'tutorials', page, 'index.md'), '# A tutorial\n');
  }
  const write = (slug: string, file: string, text: string) => {
    mkdirSync(join(root, 'examples', 'tutorials', slug), { recursive: true });
    writeFileSync(join(root, 'examples', 'tutorials', slug, file), text);
  };
  for (const [slug, text] of Object.entries(records)) write(slug, 'test-runs.md', `# Test runs\n\n${text}`);
  for (const [slug, text] of Object.entries(sidecars)) write(slug, 'sidecar.json', text);
  return root;
}

test('days between two dates count calendar days, across month ends and leap days', () => {
  assert.equal(daysBetweenDateStamps('2026-10-21', '2026-10-21'), 0);
  assert.equal(daysBetweenDateStamps('2026-07-23', '2026-10-21'), 90);
  assert.equal(daysBetweenDateStamps('2028-02-28', '2028-03-01'), 2);
  assert.equal(daysBetweenDateStamps('2026-10-22', '2026-10-21'), -1);
  assert.throws(() => daysBetweenDateStamps('2026-02-30', '2026-10-21'), /2026-02-30/);
});

test('a published tutorial is due when its latest passing run is more than 90 days old', () => {
  const root = repo({
    pages: ['swarm/first-swarm', 'swarm/tdd-swarm-kata', 'a2a/hello-a2a'],
    records: {
      // 91 days before 2026-10-21; the newer failed run doesn't count.
      'first-swarm': section('2026-10-01', 'fail') + section('2026-07-22') + section('2026-07-20'),
      // Exactly 90 days.
      'tdd-swarm-kata': section('2026-07-23'),
      // A run in progress is not a passing run.
      'hello-a2a': section('2026-10-20', '_pass or fail_') + section('2026-01-05'),
    },
    sidecars: { 'first-swarm': JSON.stringify(SIDECAR) },
  });
  const { due, problems } = sweep({ root, today: '2026-10-21' });
  assert.deepEqual(problems, []);
  assert.deepEqual(
    due.map(({ tutorial, lastPass, age, sidecar }) => [tutorial.slug, lastPass, age, sidecar?.quayVersion ?? null]),
    [
      ['first-swarm', '2026-07-22', 91, '0.3.0'],
      ['hello-a2a', '2026-01-05', 289, null],
    ],
  );
});

test('a published tutorial with no passing run is due; a tutorial with no page is not swept', () => {
  const root = repo({
    pages: ['swarm/first-swarm'],
    records: { 'tdd-swarm-kata': section('2025-01-01') },
  });
  const { due, problems } = sweep({ root, today: '2026-10-21' });
  assert.deepEqual(problems, []);
  assert.deepEqual(due.map(({ tutorial, lastPass, age }) => [tutorial.slug, lastPass, age]), [['first-swarm', null, null]]);
});

test("a record the build would reject, or a sidecar manifest that can't be read, is a problem", () => {
  const root = repo({
    pages: ['swarm/first-swarm', 'swarm/tdd-swarm-kata', 'a2a/hello-a2a', 'a2a/tdd-relay'],
    records: {
      'first-swarm': section('2026-01-01').replace('- **Result:** pass', '- **Result:** passed'),
      'tdd-swarm-kata': section('2026-01-01'),
      'hello-a2a': section('2026-01-01'),
      'tdd-relay': section('2026-01-01'),
    },
    sidecars: {
      'tdd-swarm-kata': '{ "quayVersion": ',
      'hello-a2a': JSON.stringify({ ...SIDECAR, tutorial: 'hello-a2a', recordedOn: 'June' }),
      'tdd-relay': JSON.stringify(SIDECAR),
    },
  });
  const { problems } = sweep({ root, today: '2026-10-21' });
  assert.equal(problems.length, 4);
  assert.match(problems[0], /^examples\/tutorials\/first-swarm\/test-runs\.md: 2026-01-01: Result is pass or fail$/);
  assert.match(problems[1], /^examples\/tutorials\/tdd-swarm-kata\/sidecar\.json: .*JSON/);
  assert.match(problems[2], /^examples\/tutorials\/hello-a2a\/sidecar\.json: recordedOn/);
  assert.match(problems[3], /^examples\/tutorials\/tdd-relay\/sidecar\.json: .*first-swarm/);
});

test('the issue lists each due tutorial with its last passing run and what its recordings were made with', () => {
  const root = repo({
    pages: ['swarm/first-swarm', 'a2a/hello-a2a'],
    records: { 'first-swarm': section('2026-07-22') },
    sidecars: { 'first-swarm': JSON.stringify({ ...SIDECAR, cliVersions: { claude: '2.1.0 | beta' } }) },
  });
  const body = sweepIssue(sweep({ root, today: '2026-10-21' }).due, '2026-10-21');
  assert.match(body, /^The sweep on 2026-10-21 found 2 tutorials due a re-run: a latest passing test run more than 90 days old, or no passing run\.$/m);
  assert.match(body, /The last three columns come from each tutorial's sidecar manifest/);
  assert.match(body, /\| Swarm 1: Your first swarm \| \[2026-07-22\]\(https:\/\/github\.com\/seanrobertwright\/Quay-2\/blob\/master\/examples\/tutorials\/first-swarm\/test-runs\.md\) \| 91 \| 0\.3\.0 \| 2026-06-01 \| claude 2\.1\.0 \\\| beta \|/);
  assert.match(body, /\| A2A 1: Hello, A2A \| none \| — \| — \| — \| — \|/);
  assert.match(body, /^- \[ \] Swarm 1: Your first swarm \(`first-swarm`\)$/m);
  assert.match(body, /^- \[ \] A2A 1: Hello, A2A \(`hello-a2a`\)$/m);
  assert.match(body, /starter dependencies/i);
});

test('sweep arguments: --today defaults to the given today, and bad values are refused', () => {
  assert.deepEqual(parseSweepArgs(['--out', 'sweep.md'], () => '2026-10-21'), { out: 'sweep.md', today: '2026-10-21' });
  assert.deepEqual(parseSweepArgs(['--out', 'sweep.md', '--today', '2027-01-01'], () => '2026-10-21'), { out: 'sweep.md', today: '2027-01-01' });
  assert.throws(() => parseSweepArgs([], () => '2026-10-21'), /--out/);
  assert.throws(() => parseSweepArgs(['--out', ''], () => '2026-10-21'), /--out/);
  assert.throws(() => parseSweepArgs(['--out', 'a.md', '--today', '2026-13-01'], () => '2026-10-21'), /--today/);
  assert.throws(() => parseSweepArgs(['--out', 'a.md', '--days', '3'], () => '2026-10-21'), /usage/);
});
