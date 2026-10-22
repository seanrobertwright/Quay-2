import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarkdownRenderer, disposeMdItInstance } from 'vitepress';
import { readStepCardRecord, registerStepCardContainers } from '../../docs/.vitepress/step-cards.ts';
import { parseRecord, parseTutorialDrafts, publication, testRunsPlugin, type TestRun } from './publish.ts';
import { runFingerprint, runSection } from './test-runs.ts';

const examplePage = await readFile('docs/_examples/step-cards.md', 'utf8');
const PLACEHOLDER = 'scripts/capture/placeholder.webp';
const plainMd = await createMarkdownRenderer('docs', { config: registerStepCardContainers });
const record = readStepCardRecord(plainMd.parse(examplePage, {}), examplePage);

interface Filled {
  date?: string;
  result?: string;
  fingerprint?: string;
  failedAt?: string;
  issue?: string;
  clis?: string[];
  agents?: string[];
  total?: string;
}

/** A run section as `pnpm docs:test-run` writes it, with the maintainer's values filled in. */
function run({
  date = '2026-10-21',
  result = 'pass',
  fingerprint = 'aaaaaaaaaaaaaaaa',
  failedAt = 'none',
  issue = 'none',
  clis = ['| Claude Code | 2.1.306 | claude-opus-5-5 |'],
  agents = ['| asker | Claude Code | 12 | 20,100 |', '| answerer | Claude Code | 10 | 27,212 |'],
  total = '| **Total** | | 23 | 47,312 |',
}: Filled = {}): string {
  return runSection(record, { date, fingerprint })
    .replace('_pass or fail_', result)
    .replace('_the step a failed run stopped at, or none_', failedAt)
    .replace('_the issue a failed run is tracked in, or none_', issue)
    .replace('_version, from its release installer_', '0.3.0')
    .replace('| _name_ | _version_ | _model_ |', clis.join('\n'))
    .replace('| _pane label_ | _CLI_ | _minutes_ | _count, or not reported_ |', agents.join('\n'))
    .replace('| **Total** | | _minutes_ | _count_ |', total);
}

const recordOf = (...sections: string[]) => `# Test runs: Swarm 1: Step-card example\n\nOne section per test run.\n\n${sections.join('\n')}`;

/** Parses a record that should hold no problems. */
function runsOf(...sections: string[]): TestRun[] {
  const { runs, problems } = parseRecord(recordOf(...sections));
  assert.deepEqual(problems, []);
  return runs;
}

const FAILED = {
  result: 'fail',
  failedAt: '3',
  issue: '[#212](https://github.com/seanrobertwright/Quay-2/issues/212)',
  agents: ['| asker | Claude Code | 9 | not reported |'],
  total: '| **Total** | | 9 | not reported |',
};

test('a record reads as its finished runs, newest first, with what the build needs from each', () => {
  const runs = runsOf(
    run({ date: '2026-10-22', ...FAILED, clis: ['| Claude Code | 2.1.310 | claude-opus-5-5 |', '| Codex | 0.163.0 | gpt-5.5 |'] }),
    run({ date: '2026-10-21' }),
  );
  assert.deepEqual(runs, [
    {
      date: '2026-10-22',
      result: 'fail',
      fingerprint: 'aaaaaaaaaaaaaaaa',
      failedAt: 3,
      issue: { label: '#212', url: 'https://github.com/seanrobertwright/Quay-2/issues/212' },
      clis: [
        { name: 'Claude Code', version: '2.1.310' },
        { name: 'Codex', version: '0.163.0' },
      ],
      minutes: null,
      agents: [],
    },
    {
      date: '2026-10-21',
      result: 'pass',
      fingerprint: 'aaaaaaaaaaaaaaaa',
      failedAt: null,
      issue: null,
      clis: [{ name: 'Claude Code', version: '2.1.306' }],
      minutes: 23,
      agents: [
        { cli: 'Claude Code', tokens: 20100 },
        { cli: 'Claude Code', tokens: 27212 },
      ],
    },
  ]);
});

test('a run section still being filled in is left out of the record, and an unfilled record has no runs', () => {
  const unfilled = runSection(record, { date: '2026-10-23', fingerprint: 'aaaaaaaaaaaaaaaa' });
  assert.deepEqual(runsOf(unfilled), []);
  assert.deepEqual(runsOf(unfilled, run()).map((each) => each.date), ['2026-10-21']);
});

test('a tracking issue may be a link, a bare issue URL or #<n> for this repository', () => {
  const issueOf = (issue: string) => runsOf(run({ ...FAILED, issue }))[0].issue;
  assert.deepEqual(issueOf('#7'), { label: '#7', url: 'https://github.com/seanrobertwright/Quay-2/issues/7' });
  assert.deepEqual(issueOf('https://github.com/openai/codex/issues/9001'), { label: 'openai/codex#9001', url: 'https://github.com/openai/codex/issues/9001' });
});

test('the build rejects a failed run with no issue link, and any run it cannot read', () => {
  const { problems } = parseRecord(
    recordOf(
      run({ date: '2026-10-26', ...FAILED, issue: 'none' }),
      run({ date: '2026-10-25', ...FAILED, failedAt: 'the reply', clis: ['| _name_ | _version_ | _model_ |'] }),
      run({ date: '2026-10-24', result: 'passed' }),
      run({ date: '2026-10-23', fingerprint: 'not-a-fingerprint' }),
      run({ date: '2026-10-22', total: '| **Total** | | 23 | 47,000 |' }),
      run({ date: '2026-10-21', agents: ['| asker | Claude Code | 12 | lots |'], total: '| **Total** | | _minutes_ | 0 |' }),
    ),
  );
  assert.deepEqual(problems, [
    '2026-10-26: a failed run links the issue that tracks it under Tracking issue, as #123 or https://github.com/<owner>/<repo>/issues/123',
    '2026-10-25: a failed run names the step it stopped at under Failed at, starting with the step number',
    '2026-10-25: a failed run lists each CLI it used with its version under Agent CLIs',
    '2026-10-24: Result is pass or fail',
    '2026-10-23: Run fingerprint is the 16 hex digits pnpm docs:test-run wrote',
    "2026-10-22: the Total row's tokens, 47000, are not the sum of the agents' tokens, 47312",
    '2026-10-21: each agent has a row under Time and Tokens with its CLI and its tokens: a count, such as 48,213, or "not reported"',
    "2026-10-21: the Total row's minutes are the run's minutes from step 1 to the last done item",
  ]);
});

test('a tutorial passes the gate with two passing runs for its current fingerprint, and only those count', () => {
  const runs = runsOf(
    run({ date: '2026-10-24', fingerprint: 'bbbbbbbbbbbbbbbb' }),
    run({ date: '2026-10-23', ...FAILED }),
    run({ date: '2026-10-22' }),
    run({ date: '2026-10-21' }),
  );
  assert.deepEqual(publication(runs, 'aaaaaaaaaaaaaaaa').passing.map((each) => each.date), ['2026-10-22', '2026-10-21']);
  assert.deepEqual(publication(runs, 'bbbbbbbbbbbbbbbb').passing.map((each) => each.date), ['2026-10-24']);
  assert.deepEqual(publication(runs, null).passing, []);
});

test('Time is the slowest passing run, rounded up to the next 5 minutes', () => {
  const timeOf = (...totals: string[]) =>
    publication(runsOf(...totals.map((minutes) => run({ total: `| **Total** | | ${minutes} | 47,312 |` }))), 'aaaaaaaaaaaaaaaa').time;
  assert.equal(timeOf('23', '19'), 'about 25 min');
  assert.equal(timeOf('25'), 'about 25 min');
  assert.equal(timeOf('40.5', '12'), 'about 45 min');
  assert.equal(timeOf('3'), 'about 5 min');
});

test('Tokens is the highest passing total, rounded up to two significant figures', () => {
  const tokensOf = (...counts: number[]) =>
    publication(
      runsOf(...counts.map((count) => run({ agents: [`| asker | Claude Code | 9 | ${count} |`], total: `| **Total** | | 9 | ${count} |` }))),
      'aaaaaaaaaaaaaaaa',
    ).tokens;
  assert.equal(tokensOf(47312, 30000), 'about 48k');
  assert.equal(tokensOf(48000), 'about 48k');
  assert.equal(tokensOf(9512), 'about 9.6k');
  assert.equal(tokensOf(135005), 'about 140k');
  assert.equal(tokensOf(1234567), 'about 1.3M');
  assert.equal(tokensOf(950), 'about 950');
  assert.equal(tokensOf(99500), 'about 100k');
});

test('the Tokens tile sums the agents that report tokens and names the CLIs that do not', () => {
  const runs = runsOf(
    run({
      clis: ['| Claude | 2.1.306 | opus |', '| Codex | 0.163.0 | gpt-5.5 |', '| Antigravity | 1.4.4 | gemini |'],
      agents: ['| planner | Antigravity | 4 | not reported |', '| builder | Claude | 12 | 30,100 |', '| reviewer | Codex | 6 | 17,000 |'],
      total: '| **Total** | | 23 | 47,100 |',
    }),
  );
  assert.equal(publication(runs, 'aaaaaaaaaaaaaaaa').tokens, 'about 48k (Claude, Codex; Antigravity not counted)');
  const none = runsOf(run({ agents: ['| planner | Antigravity | 4 | not reported |'], total: '| **Total** | | 23 | not reported |' }));
  assert.equal(publication(none, 'aaaaaaaaaaaaaaaa').tokens, 'not counted (Antigravity)');
});

test('the Tokens tile names the CLIs counted in the run whose total it shows', () => {
  const runs = runsOf(
    run({ date: '2026-10-22', agents: ['| builder | Claude | 9 | 30,000 |', '| reviewer | Codex | 6 | not reported |'], total: '| **Total** | | 9 | 30,000 |' }),
    run({ date: '2026-10-21', agents: ['| builder | Claude | 9 | 30,000 |', '| reviewer | Codex | 6 | 17,000 |'], total: '| **Total** | | 9 | 47,000 |' }),
  );
  assert.equal(publication(runs, 'aaaaaaaaaaaaaaaa').tokens, 'about 47k');
});

test('with no passing run for the current fingerprint, the tiles say nothing has been measured', () => {
  const { time, tokens } = publication([], 'aaaaaaaaaaaaaaaa');
  assert.equal(time, 'not measured yet');
  assert.equal(tokens, 'not measured yet');
});

test('the newest failed run is announced until a newer passing run clears it', () => {
  const noticeOf = (fingerprint: string, ...sections: string[]) => publication(runsOf(...sections), fingerprint).notice?.date ?? null;
  const failed = run({ date: '2026-10-22', ...FAILED });
  assert.equal(noticeOf('aaaaaaaaaaaaaaaa', failed, run({ date: '2026-10-21' })), '2026-10-22');
  assert.equal(noticeOf('aaaaaaaaaaaaaaaa', run({ date: '2026-10-23' }), failed), null, 'one passing run when the fingerprint is unchanged');
  const changed = (date: string) => run({ date, fingerprint: 'bbbbbbbbbbbbbbbb' });
  assert.equal(noticeOf('bbbbbbbbbbbbbbbb', changed('2026-10-23'), failed), '2026-10-22', 'two when the page changed');
  assert.equal(noticeOf('bbbbbbbbbbbbbbbb', changed('2026-10-24'), changed('2026-10-23'), failed), null);
  assert.equal(noticeOf('aaaaaaaaaaaaaaaa', run({ date: '2026-10-23', fingerprint: 'bbbbbbbbbbbbbbbb' }), failed), '2026-10-22', 'a pass for another fingerprint');
});

test('QUAY_TUTORIAL_DRAFT names the tutorials built as drafts, by slug', () => {
  assert.deepEqual(parseTutorialDrafts(undefined), new Set());
  assert.deepEqual(parseTutorialDrafts(''), new Set());
  assert.deepEqual(parseTutorialDrafts('first-swarm, hello-a2a'), new Set(['first-swarm', 'hello-a2a']));
  assert.throws(() => parseTutorialDrafts('first-swarm,no-such-tutorial'), /QUAY_TUTORIAL_DRAFT names no-such-tutorial, which is not a tutorial slug/);
});

/** A git repo holding the example page as the tutorial `step-cards`, with a starter, and a renderer for it. */
async function site(t: TestContext, { gate, drafts = [] }: { gate: boolean; drafts?: string[] }) {
  const root = mkdtempSync(join(tmpdir(), 'publish-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: root });
  const tutorialDir = join(root, 'step-cards');
  mkdirSync(join(tutorialDir, 'starter'), { recursive: true });
  writeFileSync(join(tutorialDir, 'starter', 'package.json'), '{ "name": "starter" }\n');
  // VitePress keeps one renderer per process; drop it so this one gets its own plugins.
  disposeMdItInstance();
  const md = await createMarkdownRenderer('docs', {
    config: (md) => {
      registerStepCardContainers(md);
      testRunsPlugin({ gate, drafts: new Set(drafts), examples: root, placeholder: PLACEHOLDER })(md);
    },
  });
  return {
    fingerprint: runFingerprint(record.actions, tutorialDir),
    writeRecord: (...sections: string[]) => writeFileSync(join(tutorialDir, 'test-runs.md'), recordOf(...sections)),
    render: (relativePath = 'tutorials/swarm/step-cards/index.md', path?: string) => md.render(examplePage, { relativePath, path }),
  };
}

test('the build fails for a tutorial without two passing runs for its current fingerprint, naming what is missing', async (t) => {
  const { fingerprint, writeRecord, render } = await site(t, { gate: true });
  assert.throws(
    () => render(),
    {
      message:
        'tutorials/swarm/step-cards/index.md cannot be published:\n' +
        `  it has 0 passing test runs for its run fingerprint ${fingerprint}, and needs 2. Record them in examples/tutorials/step-cards/test-runs.md ` +
        '(see scripts/test-runs/README.md), or set QUAY_TUTORIAL_DRAFT=step-cards to build it as a draft',
    },
  );
  writeRecord(run({ fingerprint }), run({ fingerprint: 'aaaaaaaaaaaaaaaa' }));
  assert.throws(() => render(), /it has 1 passing test run for its run fingerprint/);
  writeRecord(run({ fingerprint }), run({ fingerprint }));
  assert.doesNotThrow(() => render());
});

test('a draft, a page served by docs:dev and a page outside tutorials/ build without passing runs', async (t) => {
  const draft = await site(t, { gate: true, drafts: ['step-cards'] });
  assert.match(draft.render(), /<li><strong>Time<\/strong> not measured yet<\/li>\n<li><strong>Tokens<\/strong> not measured yet<\/li>/);
  const dev = await site(t, { gate: false });
  assert.doesNotThrow(() => dev.render());
  const gated = await site(t, { gate: true });
  assert.match(gated.render('_examples/step-cards.md'), /<strong>Time<\/strong> not measured yet/);
});

test('the build rejects a failed run with no issue link, even in a draft', async (t) => {
  const { fingerprint, writeRecord, render } = await site(t, { gate: true, drafts: ['step-cards'] });
  writeRecord(run({ fingerprint, ...FAILED, issue: 'none' }));
  assert.throws(() => render(), {
    message:
      'tutorials/swarm/step-cards/index.md cannot be published:\n' +
      '  examples/tutorials/step-cards/test-runs.md, 2026-10-21: a failed run links the issue that tracks it under Tracking issue, as #123 or https://github.com/<owner>/<repo>/issues/123',
  });
});

test('the page shows the generated tiles, and a failed run as a notice under its title', async (t) => {
  const { fingerprint, writeRecord, render } = await site(t, { gate: true });
  writeRecord(
    run({ date: '2026-10-23', fingerprint, ...FAILED, clis: ['| Claude Code | 2.1.310 | claude-opus-5-5 |', '| Codex | 0.163.0 | gpt-5.5 |'] }),
    run({ date: '2026-10-22', fingerprint }),
    run({ date: '2026-10-21', fingerprint, total: '| **Total** | | 31 | 47,312 |' }),
  );
  const html = render();
  assert.match(html, /<li><strong>Time<\/strong> about 35 min<\/li>\n<li><strong>Tokens<\/strong> about 48k<\/li>/);
  assert.match(
    html,
    new RegExp(
      '^<h1 id="swarm-1-step-card-example" tabindex="-1">.*?</h1>\n' +
        '<div class="warning custom-block tutorial-failed-run"><p class="custom-block-title">This tutorial failed its latest test run</p>\n' +
        '<p>On 2026-10-23 a test run stopped at step 3, “Send <code>answerer</code> a message from Mission Control”, with Claude Code 2.1.310 and Codex 0.163.0. ' +
        'The page may not work as written until it is fixed. The fix is tracked in ' +
        '<a href="https://github.com/seanrobertwright/Quay-2/issues/212" target="_blank" rel="noreferrer">#212</a>.</p>\n</div>\n',
    ),
  );
  writeRecord(run({ date: '2026-10-24', fingerprint }), run({ date: '2026-10-23', fingerprint, ...FAILED }), run({ date: '2026-10-22', fingerprint }));
  assert.doesNotMatch(render(), /tutorial-failed-run/);
});

test('the build fails a published tutorial whose folder still holds a placeholder screenshot, naming each one', async (t) => {
  const { fingerprint, writeRecord, render } = await site(t, { gate: true });
  writeRecord(run({ fingerprint }), run({ fingerprint }));
  const folder = mkdtempSync(join(tmpdir(), 'publish-page-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  copyFileSync(PLACEHOLDER, join(folder, '02-two-agents.webp'));
  copyFileSync(PLACEHOLDER, join(folder, '01-starter-installed.webp'));
  writeFileSync(join(folder, '03-reply.webp'), 'a captured still');
  const page = join(folder, 'index.md');
  const hint = 'Capture the real ones with pnpm docs:capture (see scripts/capture/README.md), or set QUAY_TUTORIAL_DRAFT=step-cards to build it as a draft';
  const refusal = (stills: string) => ({ message: `tutorials/swarm/step-cards/index.md cannot be published:\n  ${stills} still the placeholder screenshot. ${hint}` });
  assert.throws(() => render(undefined, page), refusal('01-starter-installed.webp, 02-two-agents.webp are'));
  writeFileSync(join(folder, '01-starter-installed.webp'), 'a captured still');
  assert.throws(() => render(undefined, page), refusal('02-two-agents.webp is'));
  writeFileSync(join(folder, '02-two-agents.webp'), 'a captured still');
  assert.doesNotThrow(() => render(undefined, page));
});

test('a draft and a page served by docs:dev build with placeholder screenshots', async (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'publish-page-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  copyFileSync(PLACEHOLDER, join(folder, '01-starter-installed.webp'));
  const page = join(folder, 'index.md');
  const draft = await site(t, { gate: true, drafts: ['step-cards'] });
  assert.doesNotThrow(() => draft.render(undefined, page));
  const dev = await site(t, { gate: false });
  assert.doesNotThrow(() => dev.render(undefined, page));
});
