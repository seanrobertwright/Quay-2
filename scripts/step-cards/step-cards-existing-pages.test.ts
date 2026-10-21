import { test } from 'node:test';
import assert from 'node:assert/strict';
import { glob, readFile } from 'node:fs/promises';
import { createMarkdownRenderer, disposeMdItInstance } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';
import siteConfig from '../../docs/.vitepress/config.mts';

const config = await siteConfig({ command: 'build', mode: 'production' });

async function renderSite(markdown: typeof config.markdown) {
  const md = await createMarkdownRenderer('docs', markdown);
  const pages = new Map<string, string>();
  for await (const relativePath of glob('**/*.md', { cwd: 'docs', exclude: ['_examples/**'] })) {
    pages.set(relativePath, md.render(await readFile(`docs/${relativePath}`, 'utf8'), { relativePath }));
  }
  disposeMdItInstance();
  return pages;
}

test('existing docs pages render exactly as they did before the step cards', async () => {
  // Before the step cards, the site's only markdown setup was the one withMermaid adds.
  const before = await renderSite(withMermaid({}).markdown);
  const after = await renderSite(config.markdown);
  assert.ok(before.size > 0);
  assert.deepEqual(after, before);
});
