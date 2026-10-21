import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { syncTutorialTables } from './sync.ts';

const BLOCK = '<!-- tutorials:start -->\nanything\n<!-- tutorials:end -->';

/** A throwaway repo with `files` written into it, given as path → contents. */
function repoWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'tutorials-sync-'));
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  test.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function read(root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

test('writing fills the landing page with site links and the README with GitHub Pages links', () => {
  const root = repoWith({
    'README.md': `## 🎓 Tutorials\n\n${BLOCK}\n`,
    'docs/tutorials/index.md': `# Tutorials\n\n${BLOCK}\n`,
    'docs/tutorials/swarm/first-swarm/index.md': '# Swarm 1: Your first swarm\n',
    'docs/tutorials/a2a/broadcast/index.md': '# A2A 7: Broadcast coordination\n',
  });

  assert.deepEqual(syncTutorialTables({ root, write: true }), { stale: ['docs/tutorials/index.md', 'README.md'], problems: [] });
  assert.deepEqual(syncTutorialTables({ root, write: false }), { stale: [], problems: [] });

  assert.equal(
    read(root, 'docs/tutorials/index.md'),
    `# Tutorials

<!-- tutorials:start -->
## Swarm

| # | Tutorial | What you'll do |
| --- | --- | --- |
| 1 | [Your first swarm](/tutorials/swarm/first-swarm/) | Launch Dev & Watcher and watch a Claude Code agent build a tip calculator while its tests go green. |

## A2A

| # | Tutorial | What you'll do |
| --- | --- | --- |
| 7 | [Broadcast coordination](/tutorials/a2a/broadcast/) | Have a release captain broadcast a code freeze, hold it through a failed release and lift it when the release passes. |
<!-- tutorials:end -->
`,
  );
  assert.equal(
    read(root, 'README.md'),
    `## 🎓 Tutorials

<!-- tutorials:start -->
### Swarm

| # | Tutorial | What you'll do |
| --- | --- | --- |
| 1 | [Your first swarm](https://seanrobertwright.github.io/Quay-2/tutorials/swarm/first-swarm/) | Launch Dev & Watcher and watch a Claude Code agent build a tip calculator while its tests go green. |

### A2A

| # | Tutorial | What you'll do |
| --- | --- | --- |
| 7 | [Broadcast coordination](https://seanrobertwright.github.io/Quay-2/tutorials/a2a/broadcast/) | Have a release captain broadcast a code freeze, hold it through a failed release and lift it when the release passes. |
<!-- tutorials:end -->
`,
  );
});

test('checking reports stale tables without touching the file', () => {
  const root = repoWith({
    'README.md': `${BLOCK}\n`,
    'docs/tutorials/index.md': `${BLOCK}\n`,
    'docs/tutorials/a2a/hello-a2a/index.md': '# A2A 1: Hello, A2A\n',
  });
  assert.deepEqual(syncTutorialTables({ root, write: false }), { stale: ['docs/tutorials/index.md', 'README.md'], problems: [] });
  assert.equal(read(root, 'README.md'), `${BLOCK}\n`);
});

test('a CRLF file keeps its line endings and stays in sync', () => {
  const crlf = (text: string) => text.replaceAll('\n', '\r\n');
  const root = repoWith({
    'README.md': crlf(`# Quay\n\n${BLOCK}\n\n## License\n`),
    'docs/tutorials/index.md': `${BLOCK}\n`,
    'docs/tutorials/a2a/hello-a2a/index.md': '# A2A 1: Hello, A2A\n',
  });
  syncTutorialTables({ root, write: true });
  const readme = read(root, 'README.md');
  assert.ok(readme.includes('[Hello, A2A]'));
  assert.equal(readme.replaceAll('\r\n', '').includes('\n'), false);
  assert.deepEqual(syncTutorialTables({ root, write: false }), { stale: [], problems: [] });
});

test('a file without exactly one pair of markers is a problem, and is left alone', () => {
  const root = repoWith({
    'README.md': '# Quay\n',
    'docs/tutorials/index.md': `${BLOCK}\n${BLOCK}\n`,
  });
  assert.deepEqual(syncTutorialTables({ root, write: true }), {
    stale: [],
    problems: [
      'docs/tutorials/index.md: needs one "<!-- tutorials:start -->" line followed by one "<!-- tutorials:end -->" line',
      'README.md: needs one "<!-- tutorials:start -->" line followed by one "<!-- tutorials:end -->" line',
    ],
  });
  assert.equal(read(root, 'README.md'), '# Quay\n');
});

test('a published page whose title disagrees with the catalogue is a problem', () => {
  const root = repoWith({
    'README.md': `${BLOCK}\n`,
    'docs/tutorials/index.md': `${BLOCK}\n`,
    'docs/tutorials/swarm/bug-hunt/index.md': '---\noutline: deep\n---\n\n# Swarm 5: Bug hunting\n',
    'docs/tutorials/swarm/polyglot-trio/index.md': 'No title here.\n',
  });
  assert.deepEqual(syncTutorialTables({ root, write: false }).problems, [
    'docs/tutorials/swarm/bug-hunt/index.md: its title is "Swarm 5: Bug hunting", but the tutorials list in docs/.vitepress/tutorials.ts calls it "Swarm 5: Bug Hunt"',
    'docs/tutorials/swarm/polyglot-trio/index.md: its title is missing, but the tutorials list in docs/.vitepress/tutorials.ts calls it "Swarm 9: Polyglot Trio"',
  ]);
});

test("a comment in a page's frontmatter is not its title", () => {
  const root = repoWith({
    'README.md': `${BLOCK}\n`,
    'docs/tutorials/index.md': `${BLOCK}\n`,
    'docs/tutorials/swarm/bug-hunt/index.md': '---\r\n# set by the capture script\r\noutline: deep\r\n---\r\n\r\n# Swarm 5: Bug Hunt\r\n',
  });
  assert.deepEqual(syncTutorialTables({ root, write: false }).problems, []);
});

test('with nothing published, the tables say so', () => {
  const root = repoWith({ 'README.md': `${BLOCK}\n`, 'docs/tutorials/index.md': `${BLOCK}\n` });
  syncTutorialTables({ root, write: true });
  assert.equal(
    read(root, 'README.md'),
    '<!-- tutorials:start -->\nThe first tutorials are on their way.\n<!-- tutorials:end -->\n',
  );
});

test("the repo's landing page and README list exactly the published tutorials", () => {
  assert.deepEqual(syncTutorialTables({ root: join(import.meta.dirname, '..', '..'), write: false }), { stale: [], problems: [] });
});
