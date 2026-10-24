import { test } from 'node:test';
import assert from 'node:assert/strict';
import { glob, readFile } from 'node:fs/promises';
import { createMarkdownRenderer, disposeMdItInstance } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';
import siteConfig from '../../docs/.vitepress/config.mts';
import { registerStepCardContainers, usesStepCards } from '../../docs/.vitepress/step-cards.ts';
import { tutorialSlugOf } from '../../docs/.vitepress/tutorials.ts';

const config = await siteConfig({ command: 'build', mode: 'production' });

async function readSite() {
  const pages = new Map<string, string>();
  for await (const relativePath of glob('**/*.md', { cwd: 'docs', exclude: ['_examples/**'] })) {
    pages.set(relativePath, await readFile(`docs/${relativePath}`, 'utf8'));
  }
  return pages;
}

/**
 * The pages that use the step-card containers: the tutorial pages, which the step-card and
 * test-run checks hold to their rules. A draft would also fail the placeholder gate here.
 */
async function stepCardPages(pages: Map<string, string>) {
  const md = await createMarkdownRenderer('docs', { config: registerStepCardContainers });
  const found = [...pages].filter(([, src]) => usesStepCards(md.parse(src, {}))).map(([relativePath]) => relativePath);
  disposeMdItInstance();
  return found;
}

async function renderPages(markdown: typeof config.markdown, pages: Map<string, string>) {
  const md = await createMarkdownRenderer('docs', markdown);
  const rendered = new Map<string, string>();
  for (const [relativePath, src] of pages) rendered.set(relativePath, md.render(src, { relativePath }));
  disposeMdItInstance();
  return rendered;
}

test('docs pages without step cards render exactly as they did before the step cards', async () => {
  const site = await readSite();
  const tutorials = await stepCardPages(site);
  const strays = tutorials.filter((relativePath) => tutorialSlugOf(relativePath) === null);
  assert.deepEqual(strays, [], 'only tutorial pages use the step cards');
  const pages = new Map([...site].filter(([relativePath]) => !tutorials.includes(relativePath)));
  // Before the step cards, the site's only markdown setup was the one withMermaid adds.
  const before = await renderPages(withMermaid({}).markdown, pages);
  const after = await renderPages(config.markdown, pages);
  assert.ok(before.size > 0);
  assert.deepEqual(after, before);
});
