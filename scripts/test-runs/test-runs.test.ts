import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarkdownRenderer } from 'vitepress';
import siteConfig from '../../docs/.vitepress/config.mts';
import { readStepCardRecord } from '../../docs/.vitepress/step-cards.ts';
import { addRunSection, newTestRun, parseTestRunArgs, runFingerprint, runSection } from './test-runs.ts';

// As new-run.ts reads it: the build's placeholder gate would refuse a draft page.
const config = await siteConfig({ command: 'serve', mode: 'production' });
const md = await createMarkdownRenderer('docs', config.markdown);
const examplePage = await readFile('docs/_examples/step-cards.md', 'utf8');

test('a page\'s step cards give the title, prerequisites, Must match items, If nots and done items a run checks', () => {
  const record = readStepCardRecord(md.parse(examplePage, {}), examplePage);
  assert.equal(record.title, 'Swarm 1: Step-card example');
  assert.deepEqual(record.before, [
    '**Quay 2** is installed ([Installation & Setup](/guide/installation)).',
    '**Claude Code** is signed in. `claude --version`',
    'You are using the **starter project**, because agents run in Skip mode and edit files without asking.',
  ]);
  assert.deepEqual(
    record.steps.map(({ number, title, must, ifnots }) => ({ number, title, must, ifnots })),
    [
      { number: 1, title: 'Get the starter project', must: ['`git commit` prints `Starter` as the message.'], ifnots: ['node or npm is not recognised'] },
      { number: 2, title: 'Open two Claude Code agents', must: [], ifnots: [] },
      {
        number: 3,
        title: 'Send `answerer` a message from Mission Control',
        must: ['The trail shows `You → answerer`.', '`answerer` replies `144`.'],
        ifnots: ['the message never reaches answerer', 'answerer asks for permission'],
      },
      { number: 4, title: 'Check it worked', must: ['`asker` quotes `144`.'], ifnots: [] },
    ],
  );
  assert.deepEqual(record.done, [
    'Mission Control\'s trail shows the message to `answerer` and its reply.',
    '`asker`\'s pane quotes a reply of `144`.',
  ]);
});

test('a page\'s Do and Paste slots are read as written, with each Paste slot\'s target', () => {
  const record = readStepCardRecord(md.parse(examplePage, {}), examplePage);
  assert.deepEqual(
    record.actions.map(({ step, slot, info }) => ({ step, slot, info })),
    [
      { step: 1, slot: 'do', info: '' },
      { step: 1, slot: 'paste', info: 'PowerShell pane' },
      { step: 2, slot: 'do', info: '' },
      { step: 3, slot: 'paste', info: 'Mission Control' },
      { step: 4, slot: 'paste', info: '`asker`' },
    ],
  );
  assert.equal(
    record.actions[1].source,
    '```text\ngit init -b main; git add -A; git commit -m Starter; npm install\n```',
  );
});

function recordOf(page: string) {
  return readStepCardRecord(md.parse(page, {}), page);
}

/** A git repo holding one tutorial folder, with a starter and a check suite. */
function tutorialRepo(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), 'test-runs-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: root });
  const tutorialDir = join(root, 'examples', 'tutorials', 'step-cards');
  mkdirSync(join(tutorialDir, 'starter', 'src'), { recursive: true });
  mkdirSync(join(tutorialDir, 'check'));
  writeFileSync(join(tutorialDir, 'starter', 'package.json'), '{ "name": "starter" }\n');
  writeFileSync(join(tutorialDir, 'starter', 'src', 'index.ts'), 'export const answer = 144;\n');
  writeFileSync(join(tutorialDir, 'starter', '.gitignore'), 'node_modules\n');
  writeFileSync(join(tutorialDir, 'check', 'answer.test.ts'), 'test("answer", () => {});\n');
  return root;
}

test('the run fingerprint changes with the Do and Paste slots, the starter and the check suite', (t) => {
  const root = tutorialRepo(t);
  const tutorialDir = join(root, 'examples', 'tutorials', 'step-cards');
  const fingerprint = (page = examplePage) => runFingerprint(recordOf(page).actions, tutorialDir);
  const first = fingerprint();
  assert.match(first, /^[0-9a-f]{16}$/);
  assert.equal(fingerprint(), first);

  assert.notEqual(fingerprint(examplePage.replace('label it `asker`', 'label it `questioner`')), first, 'a Do slot');
  assert.notEqual(fingerprint(examplePage.replace('What is 12 times 12?', 'What is 12 x 12?')), first, 'a Paste prompt');
  assert.notEqual(fingerprint(examplePage.replace('::: paste Mission Control', '::: paste `answerer`')), first, 'a Paste target');

  writeFileSync(join(tutorialDir, 'starter', 'src', 'index.ts'), 'export const answer = 145;\n');
  const changedStarter = fingerprint();
  assert.notEqual(changedStarter, first, 'a starter file');
  writeFileSync(join(tutorialDir, 'check', 'more.test.ts'), 'test("more", () => {});\n');
  assert.notEqual(fingerprint(), changedStarter, 'a check file');
});

test('the run fingerprint leaves out wording, captions, If not text, ignored files and line endings', (t) => {
  const root = tutorialRepo(t);
  const tutorialDir = join(root, 'examples', 'tutorials', 'step-cards');
  const fingerprint = (page = examplePage) => runFingerprint(recordOf(page).actions, tutorialDir);
  const first = fingerprint();

  assert.equal(fingerprint(examplePage.replace('Two agents pass one message', 'Two agents swap one message')), first, 'intro wording');
  assert.equal(fingerprint(examplePage.replace('`asker` quotes the reply.', '`asker` repeats the reply.')), first, 'a You should see caption');
  assert.equal(fingerprint(examplePage.replace('- `asker` quotes `144`.', '- `asker` says `144`.')), first, 'a Must match item');
  assert.equal(fingerprint(examplePage.replace('Wait until its badge reads Idle', 'Wait for Idle')), first, 'If not text');
  assert.equal(fingerprint(examplePage.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n')), first, 'CRLF line endings');

  writeFileSync(join(tutorialDir, 'starter', '.gitattributes'), '* text=auto eol=lf\n');
  const normalised = fingerprint();
  writeFileSync(join(tutorialDir, 'starter', 'src', 'index.ts'), 'export const answer = 144;\r\n');
  assert.equal(fingerprint(), normalised, 'a starter file checked out with CRLF');

  mkdirSync(join(tutorialDir, 'starter', 'node_modules'));
  writeFileSync(join(tutorialDir, 'starter', 'node_modules', 'dep.js'), 'module.exports = 1;\n');
  assert.equal(fingerprint(), normalised, 'an ignored file');
});

const EXAMPLE_SECTION = `## 2026-10-21

- **Result:** _pass or fail_
- **Run fingerprint:** \`0123456789abcdef\`
- **Failed at:** _the step a failed run stopped at, or none_
- **Tracking issue:** _the issue a failed run is tracked in, or none_
- **Quay:** _version, from its release installer_

### Agent CLIs

| CLI | Version | Default model |
| --- | --- | --- |
| _name_ | _version_ | _model_ |

### Time and Tokens

| Agent | CLI | Minutes | Tokens |
| --- | --- | --- | --- |
| _pane label_ | _CLI_ | _minutes_ | _count, or not reported_ |
| **Total** | | _minutes_ | _count_ |

### Before you start

- [ ] Every agent CLI and tool the run used is on this list:
  - **Quay 2** is installed ([Installation & Setup](/guide/installation)).
  - **Claude Code** is signed in. \`claude --version\`
  - You are using the **starter project**, because agents run in Skip mode and edit files without asking.
- **Used but not listed:** _none_

### Steps

#### 1. Get the starter project

- [ ] \`git commit\` prints \`Starter\` as the message.
- **If not, node or npm is not recognised:** _not used, fix worked, or fix failed_

#### 3. Send \`answerer\` a message from Mission Control

- [ ] The trail shows \`You → answerer\`.
- [ ] \`answerer\` replies \`144\`.
- **If not, the message never reaches answerer:** _not used, fix worked, or fix failed_
- **If not, answerer asks for permission:** _not used, fix worked, or fix failed_

#### 4. Check it worked

- [ ] \`asker\` quotes \`144\`.

### You're done when

- [ ] Mission Control's trail shows the message to \`answerer\` and its reply.
- [ ] \`asker\`'s pane quotes a reply of \`144\`.

### Fresh-eyes findings

- _step, quoted line and finding: fixed, or dismissed with a reason; none if the read found nothing_

### Off-page knowledge

- _none_

### Differed from the screenshots

- _none_
`;

test('a run section has a box for each Must match and done item, a line for each If not, and the prerequisites', () => {
  const section = runSection(recordOf(examplePage), { date: '2026-10-21', fingerprint: '0123456789abcdef' });
  assert.equal(section, EXAMPLE_SECTION);
});

const sectionFor = (date: string) => `## ${date}\n\n- **Result:** _pass or fail_\n`;

test('a new record opens with the page title and a line on how it is kept, then the run', () => {
  const record = addRunSection(null, { title: 'Swarm 1: Step-card example', slug: 'step-cards', date: '2026-10-21', section: sectionFor('2026-10-21') });
  assert.equal(
    record,
    '# Test runs: Swarm 1: Step-card example\n\n' +
      'One section per test run, newest first. `pnpm docs:test-run step-cards` adds each run\'s section from the ' +
      'page\'s step cards. How to set up the test account and do a run is in `scripts/test-runs/README.md`.\n\n' +
      '## 2026-10-21\n\n- **Result:** _pass or fail_\n',
  );
});

test('a run goes in date order, newest first, above any run from the same day', () => {
  const add = (existing: string, date: string) => addRunSection(existing, { title: 'T', slug: 's', date, section: sectionFor(date) });
  const dates = (record: string) => [...record.matchAll(/^## (\S+)/gm)].map((match) => match[1]);
  const start = addRunSection(null, { title: 'T', slug: 's', date: '2026-10-01', section: sectionFor('2026-10-01') });
  const later = add(start, '2026-10-21');
  assert.deepEqual(dates(later), ['2026-10-21', '2026-10-01']);
  assert.deepEqual(dates(add(later, '2026-10-10')), ['2026-10-21', '2026-10-10', '2026-10-01']);
  assert.deepEqual(dates(add(later, '2026-09-30')), ['2026-10-21', '2026-10-01', '2026-09-30']);
  const sameDay = add(later, '2026-10-21').replace('## 2026-10-21', '## top');
  assert.deepEqual(dates(sameDay), ['top', '2026-10-21', '2026-10-01']);
  assert.ok(later.startsWith('# Test runs: T\n\n'));
});

test('a new test run writes the record beside the starter, from the page under docs/tutorials', async (t) => {
  const root = tutorialRepo(t);
  const pageDir = join(root, 'docs', 'tutorials', 'swarm', 'step-cards');
  mkdirSync(pageDir, { recursive: true });
  writeFileSync(join(pageDir, 'index.md'), examplePage);
  const tutorialDir = join(root, 'examples', 'tutorials', 'step-cards');
  const fingerprint = runFingerprint(recordOf(examplePage).actions, tutorialDir);

  const { file } = newTestRun({ root, slug: 'step-cards', date: '2026-10-21', md });
  assert.equal(file, join(tutorialDir, 'test-runs.md'));
  const written = await readFile(file, 'utf8');
  assert.ok(written.startsWith('# Test runs: Swarm 1: Step-card example\n\n'));
  assert.ok(written.endsWith(EXAMPLE_SECTION.replace('0123456789abcdef', fingerprint)));

  newTestRun({ root, slug: 'step-cards', date: '2026-10-22', md });
  assert.deepEqual([...(await readFile(file, 'utf8')).matchAll(/^## (\S+)/gm)].map((match) => match[1]), ['2026-10-22', '2026-10-21']);
});

test('a new test run names what is missing when a slug has no page or no starter', (t) => {
  const root = tutorialRepo(t);
  assert.throws(() => newTestRun({ root, slug: 'step-cards', date: '2026-10-21', md }), {
    message: 'no tutorial page for step-cards: expected docs/tutorials/<series>/step-cards/index.md',
  });
  const pageDir = join(root, 'docs', 'tutorials', 'a2a', 'no-starter');
  mkdirSync(pageDir, { recursive: true });
  writeFileSync(join(pageDir, 'index.md'), examplePage);
  assert.throws(() => newTestRun({ root, slug: 'no-starter', date: '2026-10-21', md }), /examples\/tutorials\/no-starter has no starter\/ folder/);
});

test('the command takes one slug and an optional date, and rejects anything else', () => {
  assert.deepEqual(parseTestRunArgs(['step-cards'], () => '2026-10-21'), { slug: 'step-cards', date: '2026-10-21' });
  assert.deepEqual(parseTestRunArgs(['step-cards', '--date', '2026-02-28'], () => '2026-10-21'), { slug: 'step-cards', date: '2026-02-28' });
  const usage = /usage: pnpm docs:test-run <slug> \[--date YYYY-MM-DD\]/;
  assert.throws(() => parseTestRunArgs([], () => ''), usage);
  assert.throws(() => parseTestRunArgs(['a', 'b'], () => ''), usage);
  assert.throws(() => parseTestRunArgs(['step-cards', '--dat', '2026-10-21'], () => ''), usage);
  assert.throws(() => parseTestRunArgs(['Step_Cards'], () => ''), /slug "Step_Cards" must be lowercase letters and digits/);
  assert.throws(() => parseTestRunArgs(['step-cards', '--date', '2026-02-30'], () => ''), /--date "2026-02-30" is not a date written YYYY-MM-DD/);
  assert.throws(() => parseTestRunArgs(['step-cards', '--date', '21/10/2026'], () => ''), /--date "21\/10\/2026" is not a date/);
});
