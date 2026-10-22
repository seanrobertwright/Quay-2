import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarkdownRenderer, disposeMdItInstance, type MarkdownOptions } from 'vitepress';
import {
  checkTutorialFolder,
  parseReleaseVersion,
  registerStepCardContainers,
  STEP_CARD_RULES,
  stepCardsPlugin,
} from '../../docs/.vitepress/step-cards.ts';
import { playUnlessReduced } from '../../docs/.vitepress/theme/step-card-clip.ts';

// VitePress keeps one markdown-it instance until it is disposed, so each renderer here disposes it first.
async function renderer(config: MarkdownOptions['config']) {
  disposeMdItInstance();
  return createMarkdownRenderer('docs', { config });
}

const md = await renderer(registerStepCardContainers);
const examples = new URL('../../docs/_examples/', import.meta.url);
const example = await readFile(new URL('step-cards.md', examples), 'utf8');
const exampleFiles = await readdir(examples);
const stills = ['01-starter-installed.webp', '02-two-agents.webp', '03-reply.webp', '04-asker-quotes.webp'];

function checkFolder(files: string[]) {
  return checkTutorialFolder(md.parse(example, {}), files);
}

/** Writes the example page into a new folder beside the given files, as a tutorial's folder would hold it. */
async function tutorialFolder(files: string[]) {
  const folder = await mkdtemp(join(tmpdir(), 'step-card-media-'));
  await writeFile(join(folder, 'index.md'), example);
  for (const file of files) await writeFile(join(folder, file), '');
  return join(folder, 'index.md');
}

test("the example page's folder holds every image it names and nothing else", () => {
  assert.deepEqual(checkFolder(exampleFiles), []);
});

test('a You should see naming an image the folder lacks breaks image-exists', () => {
  assert.deepEqual(checkFolder(['step-cards.md', ...stills.filter((still) => still !== '02-two-agents.webp')]), [
    { rule: 'image-exists', step: 2, title: 'Open two Claude Code agents', files: ['02-two-agents.webp'] },
  ]);
});

test('an image in the folder that no step card names breaks orphan-image', () => {
  assert.deepEqual(checkFolder([...stills, '02-old-name.webp', 'diagram.png', 'notes.txt']), [
    { rule: 'orphan-image', step: null, title: null, files: ['02-old-name.webp'] },
    { rule: 'orphan-image', step: null, title: null, files: ['diagram.png'] },
  ]);
});

test('a clip with no still of the same name beside it breaks clip-still', () => {
  assert.deepEqual(checkFolder([...stills, '05-ghost.mp4']), [
    { rule: 'clip-still', step: null, title: null, files: ['05-ghost.mp4'] },
  ]);
});

test('two clips in one tutorial break one-clip', () => {
  assert.deepEqual(checkFolder([...stills, '02-two-agents.mp4', '03-reply.mp4']), [
    { rule: 'one-clip', step: null, title: null, files: ['02-two-agents.mp4', '03-reply.mp4'] },
  ]);
});

test('a still with a clip of the same name beside it renders as the clip, with the still as its poster', async () => {
  const path = await tutorialFolder([...stills, '03-reply.mp4']);
  const html = md.render(example, { path });
  const caption = "The message moves into Mission Control's trail, then answerer replies 144.";
  assert.ok(
    html.includes(
      '<figure class="step-card__shot step-card__shot--clip">' +
        `<video v-step-card-clip class="step-card__clip" src="./03-reply.mp4" poster="./03-reply.webp" aria-label="${caption}" muted loop playsinline controls preload="metadata"></video>` +
        `<figcaption aria-hidden="true">${caption}</figcaption></figure>\n`,
    ),
    html,
  );
  assert.equal(html.match(/<video/g)?.length, 1);
  assert.match(html, /<img src="\.\/02-two-agents\.webp"/);
});

test('without a page path, a still renders as a still', () => {
  assert.doesNotMatch(md.render(example, {}), /<video/);
});

test('the site build fails a page whose folder breaks an image or clip rule, naming the step and the file', async () => {
  const render = await renderer(stepCardsPlugin({ release: null, sidecars: tmpdir(), docs: tmpdir() }));
  const path = await tutorialFolder([...stills.slice(1), '05-ghost.mp4']);
  assert.throws(() => render.render(example, { path, relativePath: 'tutorials/swarm/example/index.md' }), {
    message:
      'tutorials/swarm/example/index.md breaks the step-card rules:\n' +
      `  step 1 "Get the starter project", 01-starter-installed.webp: the image a You should see names is in the tutorial's folder (image-exists)\n` +
      '  05-ghost.mp4: a clip "NN-<what>.mp4" sits beside its still "NN-<what>.webp" (clip-still)',
  });
});

test('a release version is a version number, with or without a leading v', () => {
  assert.equal(parseReleaseVersion(undefined), null);
  assert.equal(parseReleaseVersion('0.3.0'), '0.3.0');
  assert.equal(parseReleaseVersion('v0.3.0'), '0.3.0');
  assert.equal(parseReleaseVersion('1.0.0-beta.2'), '1.0.0-beta.2');
  for (const bad of ['', ' ', 'latest', '0.3', 'v', '0.3.0 ']) {
    assert.throws(() => parseReleaseVersion(bad), /QUAY_RELEASE_VERSION/, JSON.stringify(bad));
  }
});

test("in the release flow, a tutorial builds only when its sidecar records the release's Quay version", async () => {
  const sidecars = await mkdtemp(join(tmpdir(), 'step-card-sidecars-'));
  const sidecar = async (slug: string, body: string) => {
    await mkdir(join(sidecars, slug));
    await writeFile(join(sidecars, slug, 'sidecar.json'), body);
  };
  await sidecar('current', JSON.stringify({ quayVersion: '0.3.0', recorded: '2026-10-01' }));
  await sidecar('stale', JSON.stringify({ quayVersion: '0.2.0' }));
  await sidecar('with-v', JSON.stringify({ quayVersion: 'v0.3.0' }));
  await sidecar('malformed', '{ quayVersion: 0.3.0 }');
  await sidecar('no-version', JSON.stringify({ recorded: '2026-10-01' }));

  const path = await tutorialFolder(stills);
  const render = (renderer: typeof md, slug: string) => () =>
    renderer.render(example, { path, relativePath: `tutorials/a2a/${slug}/index.md` });

  const release = await renderer(stepCardsPlugin({ release: '0.3.0', sidecars, docs: tmpdir() }));

  assert.doesNotThrow(render(release, 'current'));
  assert.doesNotThrow(render(release, 'with-v'));
  for (const slug of ['stale', 'malformed', 'no-version', 'missing']) {
    assert.throws(render(release, slug), {
      message:
        `tutorials/a2a/${slug}/index.md breaks the step-card rules:\n` +
        `  examples/tutorials/${slug}/sidecar.json: in the release flow, the tutorial's sidecar manifest records the Quay version being released as "quayVersion" (release-sidecar)`,
    }, slug);
  }
  const ordinary = await renderer(stepCardsPlugin({ release: null, sidecars, docs: tmpdir() }));
  assert.doesNotThrow(render(ordinary, 'stale'));
  assert.doesNotThrow(render(ordinary, 'missing'));
});

test('in the release flow, a step-card page outside tutorials/<series>/<slug>/ has no sidecar and fails', async () => {
  const release = await renderer(stepCardsPlugin({ release: '0.3.0', sidecars: tmpdir(), docs: tmpdir() }));
  const path = await tutorialFolder(stills);
  assert.throws(() => release.render(example, { path, relativePath: 'guide/example.md' }), /\(release-sidecar\)$/m);
});

test('a clip plays muted unless the reader asks for reduced motion, which pauses it on its poster', async () => {
  const calls: string[] = [];
  const clip = {
    muted: false,
    play: () => {
      calls.push('play');
      return Promise.reject(new Error('autoplay blocked'));
    },
    pause: () => calls.push('pause'),
  };
  playUnlessReduced(clip, false);
  assert.equal(clip.muted, true);
  playUnlessReduced(clip, true);
  assert.deepEqual(calls, ['play', 'pause']);
  // A browser that blocks autoplay rejects play(); the poster stays and the controls start it.
  await new Promise((resolve) => setImmediate(resolve));
});

test("a tutorial's Next up card must link to the next published tutorial, or to the landing page when none is", async () => {
  // The example page's card links to Swarm 2, /tutorials/swarm/tdd-swarm-kata/.
  const docs = await mkdtemp(join(tmpdir(), 'step-card-docs-'));
  const publish = async (page: string) => {
    await mkdir(join(docs, 'tutorials', page), { recursive: true });
    await writeFile(join(docs, 'tutorials', page, 'index.md'), '');
  };
  const path = await tutorialFolder(stills);
  const render = await renderer(stepCardsPlugin({ release: null, sidecars: tmpdir(), docs }));
  const asSwarm1 = () => render.render(example, { path, relativePath: 'tutorials/swarm/first-swarm/index.md' });

  await publish('swarm/first-swarm');
  assert.throws(asSwarm1, {
    message:
      'tutorials/swarm/first-swarm/index.md breaks the step-card rules:\n' +
      `  docs/tutorials/index.md: ${STEP_CARD_RULES['next-up-target']} (next-up-target)`,
  });
  await publish('swarm/tdd-swarm-kata');
  assert.doesNotThrow(asSwarm1);
  assert.doesNotThrow(() => render.render(example, { path, relativePath: 'tutorials/swarm/example/index.md' }), 'not a tutorial slug');
});
