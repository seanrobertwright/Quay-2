import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nextUp, publishedTutorials, TUTORIALS, tutorialsSidebar } from '../../docs/.vitepress/tutorials.ts';

/** A throwaway docs folder holding a page for each of `pages`, given as `<series>/<slug>`. */
function docsWith(...pages: string[]): string {
  const docs = mkdtempSync(join(tmpdir(), 'tutorials-'));
  for (const page of pages) {
    mkdirSync(join(docs, 'tutorials', page), { recursive: true });
    writeFileSync(join(docs, 'tutorials', page, 'index.md'), '# page\n');
  }
  test.after(() => rmSync(docs, { recursive: true, force: true }));
  return docs;
}

test('only tutorials whose pages exist are published, in series order', () => {
  const docs = docsWith('a2a/hello-a2a', 'swarm/tdd-swarm-kata', 'swarm/first-swarm');
  assert.deepEqual(
    publishedTutorials(docs).map((tutorial) => `${tutorial.series}/${tutorial.slug}`),
    ['swarm/first-swarm', 'swarm/tdd-swarm-kata', 'a2a/hello-a2a'],
  );
});

test('a folder without an index.md is not a published page', () => {
  const docs = docsWith();
  mkdirSync(join(docs, 'tutorials', 'swarm', 'first-swarm'), { recursive: true });
  assert.deepEqual(publishedTutorials(docs), []);
});

test('the catalogue holds the twenty slugs settled for the two series', () => {
  assert.deepEqual(
    TUTORIALS.map((tutorial) => `${tutorial.series} ${tutorial.number} ${tutorial.slug}`),
    [
      'swarm 1 first-swarm', 'swarm 2 tdd-swarm-kata', 'swarm 3 full-stack-pair', 'swarm 4 custom-swarm',
      'swarm 5 bug-hunt', 'swarm 6 red-team-blue-team', 'swarm 7 js-to-typescript', 'swarm 8 tri-agent-council',
      'swarm 9 polyglot-trio', 'swarm 10 parallel-worktrees',
      'a2a 1 hello-a2a', 'a2a 2 contract-first-handoff', 'a2a 3 tdd-relay', 'a2a 4 review-gate',
      'a2a 5 fan-out-fan-in', 'a2a 6 fire-then-poll', 'a2a 7 broadcast', 'a2a 8 mission-control',
      'a2a 9 docs-that-cant-lie', 'a2a 10 second-opinion-codex',
    ],
  );
});

test('the sidebar lists the landing page, then each series with its published tutorials numbered', () => {
  const docs = docsWith('swarm/first-swarm', 'swarm/custom-swarm', 'a2a/hello-a2a');
  assert.deepEqual(tutorialsSidebar(publishedTutorials(docs)), [
    { text: 'Tutorials', link: '/tutorials/' },
    {
      text: 'Swarm',
      items: [
        { text: '1. Your first swarm', link: '/tutorials/swarm/first-swarm/' },
        { text: '4. Build and save a custom swarm', link: '/tutorials/swarm/custom-swarm/' },
      ],
    },
    { text: 'A2A', items: [{ text: '1. Hello, A2A', link: '/tutorials/a2a/hello-a2a/' }] },
  ]);
});

test('a series with no published tutorial is left out of the sidebar', () => {
  const docs = docsWith('a2a/broadcast');
  assert.deepEqual(tutorialsSidebar(publishedTutorials(docs)), [
    { text: 'Tutorials', link: '/tutorials/' },
    { text: 'A2A', items: [{ text: '7. Broadcast coordination', link: '/tutorials/a2a/broadcast/' }] },
  ]);
});

test("a Next up card points at the first published tutorial after its own, across the series, or at none", () => {
  const docs = docsWith('swarm/first-swarm', 'swarm/full-stack-pair', 'a2a/hello-a2a', 'a2a/second-opinion-codex');
  const published = publishedTutorials(docs);
  const after = (slug: string) => nextUp(TUTORIALS.find((tutorial) => tutorial.slug === slug)!, published)?.slug ?? null;
  assert.equal(after('first-swarm'), 'full-stack-pair', 'Swarm 2 is unpublished, so Swarm 3 is next');
  assert.equal(after('full-stack-pair'), 'hello-a2a', 'Swarm 10 leads on to A2A 1');
  assert.equal(after('hello-a2a'), 'second-opinion-codex');
  assert.equal(after('second-opinion-codex'), null, 'A2A 10 always leads back to the landing page');
  assert.equal(nextUp(TUTORIALS[0], publishedTutorials(docsWith('swarm/first-swarm'))), null, 'nothing after it is published');
});
