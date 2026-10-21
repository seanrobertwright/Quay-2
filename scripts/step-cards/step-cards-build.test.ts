import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createMarkdownRenderer } from 'vitepress';
import siteConfig from '../../docs/.vitepress/config.mts';

const fixtures = new URL('fixtures/', import.meta.url);
const config = await siteConfig({ command: 'build', mode: 'production' });
const md = await createMarkdownRenderer('docs', config.markdown);

async function render(path: URL, relativePath: string) {
  return md.render(await readFile(path, 'utf8'), { relativePath });
}

test('the site build rejects a page that breaks a slot rule, naming the file, the step and the rule', async () => {
  await assert.rejects(render(new URL('do-or-paste.md', fixtures), 'tutorials/swarm/fixture/index.md'), {
    message:
      'tutorials/swarm/fixture/index.md breaks the step-card rules:\n' +
      '  step 2 "Look at the rail": every step has Do, Paste, or both (do-or-paste)',
  });
});

test('the site build rejects every failing fixture for the rule it is named after', async () => {
  const names = (await readdir(fixtures)).filter((name) => name.endsWith('.md'));
  assert.ok(names.length > 0);
  for (const name of names) {
    const rule = basename(name, '.md');
    await assert.rejects(render(new URL(name, fixtures), name), new RegExp(`\\(${rule}\\)$`, 'm'), name);
  }
});
