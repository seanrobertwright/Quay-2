import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMarkdownRenderer, disposeMdItInstance } from 'vitepress';
import siteConfig from '../../docs/.vitepress/config.mts';
import type { Finding } from './fresh-eyes.ts';
import { checkFindings, extractPage, formatFindings, imageSource, parseReaderOutput, readerArgs, readerEnv, readerMessage } from './fresh-eyes.ts';

// The shell VitePress builds around a page's content, cut down to what the extraction relies on.
function builtPage(content: string): string {
  return (
    '<!DOCTYPE html><html><head><title>Swarm 1 | Quay 2</title><script>var x = "<div class=\\"vp-doc\\">";</script></head><body>' +
    '<div id="app"><header class="VPNav"><a href="/Quay-2/">Quay 2</a></header>' +
    '<div class="content-container"><!--[--><!--]--><main class="main"><div style="position:relative;" class="vp-doc _Quay-2_tutorials_swarm_hello_" data-v-1>' +
    `<div>${content}</div></div></main><footer class="VPDocFooter">Edit this page</footer></div></div></body></html>`
  );
}

const anchor = (id: string) => `<a class="header-anchor" href="#${id}" aria-label="Permalink to &quot;${id}&quot;">&#8203;</a>`;

const helloPage = builtPage(
  `<h1 id="t" tabindex="-1">Swarm 1: Hello ${anchor('t')}</h1>` +
    '<p>Two agents &amp; one message.</p>' +
    '<div class="tutorial-glance"><ul><li><strong>Time</strong> ~10 min</li><li><strong>Level</strong> Starter</li></ul></div>' +
    `<div class="tutorial-checklist"><h2 id="b" tabindex="-1">Before you start ${anchor('b')}</h2>` +
    '<ul><li><label><input type="checkbox"> <span><strong>Quay 2</strong> is installed (<a href="/Quay-2/guide/installation">Installation &amp; Setup</a>).</span></label></li></ul></div>' +
    `<section class="step-card"><h2 id="s1" tabindex="-1">1. Get the starter project ${anchor('s1')}</h2>` +
    '<div class="step-card__slot step-card__slot--do"><p class="step-card__label">Do</p>' +
    '<ol><li>Press <code>Ctrl+B N</code>.</li><li>Click <strong>Start   Terminal</strong>.</li></ol></div>' +
    '<div class="step-card__slot step-card__slot--paste"><p class="step-card__label">Paste into PowerShell pane</p>' +
    '<div class="language-text vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">text</span>' +
    '<pre class="shiki vp-code" tabindex="0"><code><span class="line"><span>git commit -m Starter; npm install &lt;x&gt;</span></span></code></pre></div></div>' +
    '<div class="step-card__slot step-card__slot--see"><p class="step-card__label">You should see</p>' +
    '<figure class="step-card__shot"><img src="/Quay-2/assets/01-pane.Ab12.webp" alt="A pane &amp; its prompt."><figcaption aria-hidden="true">A pane &amp; its prompt.</figcaption></figure></div>' +
    '<details class="details custom-block step-card__ifnot"><summary>If not: npm is not recognised</summary><p>Install Node 24.</p></details>' +
    '</section>' +
    `<section class="step-card step-card--last"><h2 id="s2" tabindex="-1">2. Check it worked ${anchor('s2')}</h2>` +
    '<div class="step-card__slot step-card__slot--do"><p class="step-card__label">Do</p><ol><li>Look at <code>asker</code>.</li></ol></div>' +
    '<div class="step-card__slot step-card__slot--see"><p class="step-card__label">You should see</p>' +
    '<figure class="step-card__shot step-card__shot--clip"><video class="step-card__clip" src="/Quay-2/assets/02-reply.Cd34.mp4" poster="data:image/webp;base64,UklGRg==" aria-label="The reply arrives." muted loop playsinline controls preload="metadata"></video>' +
    '<figcaption aria-hidden="true">The reply arrives.</figcaption></figure></div>' +
    '<div class="step-card__slot step-card__slot--done"><p class="step-card__label">You’re done when</p><ul><li>✅ <code>asker</code> quotes <code>144</code>.</li></ul></div>' +
    '</section>' +
    '<nav class="tutorial-next" aria-label="Next up"><p class="tutorial-next__label">Next up</p><p><a href="/Quay-2/tutorials/swarm/two/">Swarm 2: Two</a></p></nav>',
);

test('the page text is the content as a reader sees it, in markdown, without the site around it', () => {
  assert.equal(
    extractPage(helloPage).text,
    [
      '# Swarm 1: Hello',
      '',
      'Two agents & one message.',
      '',
      '- **Time** ~10 min',
      '- **Level** Starter',
      '',
      '## Before you start',
      '',
      '- [ ] **Quay 2** is installed ([Installation & Setup](/Quay-2/guide/installation)).',
      '',
      '## 1. Get the starter project',
      '',
      'Do',
      '',
      '1. Press `Ctrl+B N`.',
      '2. Click **Start Terminal**.',
      '',
      'Paste into PowerShell pane',
      '',
      '```',
      'git commit -m Starter; npm install <x>',
      '```',
      '',
      'You should see',
      '',
      '[Image 1: a screenshot. Alt text: "A pane & its prompt."]',
      '',
      '▸ If not: npm is not recognised',
      '',
      'Install Node 24.',
      '',
      '## 2. Check it worked',
      '',
      'Do',
      '',
      '1. Look at `asker`.',
      '',
      'You should see',
      '',
      '[Image 2: a video clip, shown to you as its still. Alt text: "The reply arrives."]',
      '',
      'You’re done when',
      '',
      '- ✅ `asker` quotes `144`.',
      '',
      'Next up',
      '',
      '[Swarm 2: Two](/Quay-2/tutorials/swarm/two/)',
    ].join('\n'),
  );
});

test('each step is numbered and titled from its heading, and holds only its own text', () => {
  const { steps } = extractPage(helloPage);
  assert.deepEqual(
    steps.map(({ number, title }) => ({ number, title })),
    [
      { number: 1, title: 'Get the starter project' },
      { number: 2, title: 'Check it worked' },
    ],
  );
  assert.ok(steps[0].text.startsWith('## 1. Get the starter project\n'));
  assert.ok(steps[0].text.endsWith('Install Node 24.'));
  assert.ok(!steps[1].text.includes('Next up'));
});

test('each screenshot and clip is listed in page order with its step, its alt text and the still to show', () => {
  assert.deepEqual(extractPage(helloPage).images, [
    { n: 1, kind: 'screenshot', step: 1, alt: 'A pane & its prompt.', src: '/Quay-2/assets/01-pane.Ab12.webp' },
    { n: 2, kind: 'clip', step: 2, alt: 'The reply arrives.', src: 'data:image/webp;base64,UklGRg==' },
  ]);
});

test('nested lists indent under their item, and an image outside a step has no step', () => {
  const page = extractPage(
    builtPage(
      '<h1>A2A 1: Nest</h1><ul><li>Open <em>Settings</em>.<ul><li>Pick <strong>Bus</strong>.</li></ul></li></ul>' +
        '<p><img src="/Quay-2/logo.svg" alt="The logo"></p>',
    ),
  );
  assert.equal(page.text, ['# A2A 1: Nest', '', '- Open *Settings*.', '  - Pick **Bus**.', '', '[Image 1: a screenshot. Alt text: "The logo"]'].join('\n'));
  assert.deepEqual(page.images, [{ n: 1, kind: 'screenshot', step: null, alt: 'The logo', src: '/Quay-2/logo.svg' }]);
  assert.deepEqual(page.steps, []);
});

test('a page with no VitePress doc content is refused, not read as empty', () => {
  assert.throws(() => extractPage('<html><body><p>Hi</p></body></html>'), /no \.vp-doc content/);
});

test('the step-card example page, rendered by the site, gives every step with its screenshot or clip', async () => {
  const config = await siteConfig({ command: 'build', mode: 'production' });
  const md = await createMarkdownRenderer('docs', config.markdown);
  const relativePath = '_examples/step-cards.md';
  const content = md.render(await readFile(`docs/${relativePath}`, 'utf8'), { relativePath, path: `docs/${relativePath}` });
  disposeMdItInstance();

  const page = extractPage(builtPage(content));
  assert.ok(page.text.startsWith('# Swarm 1: Step-card example\n'));
  assert.deepEqual(
    page.steps.map((step) => step.title),
    ['Get the starter project', 'Open two Claude Code agents', 'Send `answerer` a message from Mission Control', 'Check it worked'],
  );
  assert.deepEqual(
    page.images.map(({ kind, step }) => ({ kind, step })),
    [
      { kind: 'screenshot', step: 1 },
      { kind: 'screenshot', step: 2 },
      { kind: 'clip', step: 3 },
      { kind: 'screenshot', step: 4 },
    ],
  );
  assert.match(page.steps[2].text, /^## 3\. Send `answerer` a message from Mission Control\n/);
  assert.match(page.steps[0].text, /\n▸ If not: node or npm is not recognised\n/);
  assert.match(page.text, /\n- \[ \] \*\*Claude Code\*\* is signed in\. `claude --version`\n/);
});

test('an image is shown from a data URI, from a file under the site base, or not at all, with the reason', () => {
  assert.deepEqual(imageSource('data:image/webp;base64,UklGRg==', '/Quay-2/'), { kind: 'data', mediaType: 'image/webp', data: 'UklGRg==' });
  assert.deepEqual(imageSource('/Quay-2/assets/01-pane.Ab12.PNG', '/Quay-2/'), { kind: 'file', mediaType: 'image/png', path: 'assets/01-pane.Ab12.PNG' });
  assert.deepEqual(imageSource('/Quay-2/logo.svg', '/Quay-2/'), { kind: 'unshown', reason: 'an .svg image, which the reader cannot be shown' });
  assert.deepEqual(imageSource('https://example.com/a.png', '/Quay-2/'), { kind: 'unshown', reason: 'it is not part of the built site' });
  assert.deepEqual(imageSource('/Quay-2/../secret.png', '/Quay-2/'), { kind: 'unshown', reason: 'it is not part of the built site' });
  assert.deepEqual(imageSource('data:image/svg+xml;utf8,<svg/>', '/Quay-2/'), { kind: 'unshown', reason: 'an image/svg+xml data URI, which the reader cannot be shown' });
  assert.deepEqual(imageSource('', '/Quay-2/'), { kind: 'unshown', reason: 'it has no still' });
});

test('the reader gets no tools, no settings, no MCP servers and no CLAUDE.md, and its brief replaces the system prompt', () => {
  const args = readerArgs({ briefPath: 'E:/repo/scripts/fresh-eyes/brief.md', model: null });
  const value = (flag: string) => args[args.indexOf(flag) + 1];
  assert.equal(args[0], '-p');
  assert.equal(value('--tools'), '');
  assert.equal(value('--setting-sources'), '');
  assert.equal(value('--system-prompt-file'), 'E:/repo/scripts/fresh-eyes/brief.md');
  assert.equal(value('--input-format'), 'stream-json');
  assert.equal(value('--output-format'), 'stream-json');
  assert.ok(args.includes('--strict-mcp-config'));
  assert.ok(args.includes('--no-session-persistence'));
  assert.equal(JSON.parse(value('--json-schema')).required[0], 'findings');
  assert.ok(!args.includes('--model'));
  const withModel = readerArgs({ briefPath: 'brief.md', model: 'opus' });
  assert.equal(withModel[withModel.indexOf('--model') + 1], 'opus');

  const env = readerEnv({ PATH: 'C:/bin', CLAUDE_CODE_DISABLE_CLAUDE_MDS: '0' });
  assert.equal(env.PATH, 'C:/bin');
  assert.equal(env.CLAUDE_CODE_DISABLE_CLAUDE_MDS, '1');
  assert.equal(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
});

test('the reader message holds the page text, then each image after a line naming it', () => {
  const page = extractPage(helloPage);
  const message = readerMessage(page, [
    { n: 1, kind: 'data', mediaType: 'image/webp', data: 'AAAA' },
    { n: 2, kind: 'unshown', reason: 'it has no still' },
  ]);
  assert.equal(message.type, 'user');
  assert.equal(message.message.role, 'user');
  const [text, label, image, unshown] = message.message.content;
  assert.ok(text.type === 'text' && text.text.endsWith(page.text));
  assert.deepEqual(label, { type: 'text', text: 'Image 1:' });
  assert.deepEqual(image, { type: 'image', source: { type: 'base64', media_type: 'image/webp', data: 'AAAA' } });
  assert.deepEqual(unshown, { type: 'text', text: 'Image 2 cannot be shown to you: it has no still.' });
  assert.equal(message.message.content.length, 4);
});

const resultLine = (fields: object) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, ...fields });

test('the reader output gives its findings and the model that read the page', () => {
  const findings = [{ kind: 'unexplained-term', step: 2, quote: 'Press `Ctrl+B %`', problem: 'What does it split?' }];
  const stdout = [
    JSON.stringify({ type: 'system', subtype: 'init' }),
    resultLine({ structured_output: { findings }, modelUsage: { 'claude-haiku-5-5': { outputTokens: 10 }, 'claude-opus-5-5': { outputTokens: 900 } } }),
    '',
  ].join('\n');
  assert.deepEqual(parseReaderOutput(stdout), { findings, model: 'claude-opus-5-5' });
});

test('reader output that failed, has no result or breaks the findings shape is refused with the reason', () => {
  assert.throws(() => parseReaderOutput(JSON.stringify({ type: 'system' })), /no result/);
  assert.throws(() => parseReaderOutput(resultLine({ subtype: 'error_during_execution', is_error: true, result: 'Not logged in' })), /Not logged in/);
  assert.throws(() => parseReaderOutput(resultLine({ structured_output: { findings: [{ kind: 'typo', step: 1, quote: 'a', problem: 'b' }] } })), /finding 1.*kind/);
  assert.throws(() => parseReaderOutput(resultLine({ structured_output: { findings: [{ kind: 'two-readings', step: 1.5, quote: 'a', problem: 'b' }] } })), /finding 1.*step/);
  assert.throws(() => parseReaderOutput(resultLine({ structured_output: { findings: [{ kind: 'two-readings', step: 1, quote: ' ', problem: 'b' }] } })), /finding 1.*quote/);
  assert.throws(() => parseReaderOutput(resultLine({ structured_output: {} })), /findings/);
});

const findings: Finding[] = [
  { kind: 'two-readings', step: 2, quote: 'Look at asker.', problem: 'Look where: the pane or its badge?' },
  { kind: 'unnamed-control', step: 1, quote: "Click **Start Terminal**", problem: 'Where is Start Terminal?' },
  { kind: 'unexplained-term', step: 1, quote: 'the rail', problem: 'What is the rail?' },
  { kind: 'missing-prerequisite', step: 7, quote: 'npm install', problem: 'Node is not in Before you start.' },
];

test('a finding is on the page when its quote is in its own step, ignoring markdown marks, curly quotes and spacing', () => {
  const checked = checkFindings(extractPage(helloPage), findings);
  assert.deepEqual(
    checked.map(({ step, title, onPage }) => ({ step, title, onPage })),
    [
      { step: 2, title: 'Check it worked', onPage: true },
      { step: 1, title: 'Get the starter project', onPage: true },
      { step: 1, title: 'Get the starter project', onPage: false },
      { step: 7, title: null, onPage: false },
    ],
  );
});

test('the findings report is ready for the run record: by step, quoted, each awaiting an outcome', () => {
  const page = extractPage(helloPage);
  const report = formatFindings({
    page: 'docs/tutorials/swarm/hello/index.md',
    commit: 'abc1234',
    dirty: true,
    model: 'claude-opus-5-5',
    findings: checkFindings(page, findings),
    unshown: [{ n: 2, reason: 'it has no still' }],
  });
  assert.equal(
    report,
    [
      '### Fresh-eyes findings',
      '',
      'Read by `claude-opus-5-5` from `docs/tutorials/swarm/hello/index.md` as built at `abc1234`, with uncommitted changes. Mark each finding fixed, or dismissed with a reason.',
      '',
      'Not shown to the reader: image 2 (it has no still).',
      '',
      "1. **Step 1, Get the starter project: a control or pane the page doesn't name or show.**",
      '   > Click **Start Terminal**',
      '',
      '   Where is Start Terminal?',
      '',
      '   Outcome:',
      "2. **Step 1, Get the starter project: a term the page doesn't explain.**",
      '   > the rail',
      '',
      '   This quote is not in step 1, so check where it belongs.',
      '',
      '   What is the rail?',
      '',
      '   Outcome:',
      '3. **Step 2, Check it worked: an action open to two readings.**',
      '   > Look at asker.',
      '',
      '   Look where: the pane or its badge?',
      '',
      '   Outcome:',
      '4. **Step 7: a prerequisite missing from Before you start.**',
      '   > npm install',
      '',
      '   The page has no step 7, so check where this belongs.',
      '',
      '   Node is not in Before you start.',
      '',
      '   Outcome:',
      '',
    ].join('\n'),
  );
});

test('a read with no findings says so, and a clean build gives no uncommitted note', () => {
  const report = formatFindings({ page: 'p.md', commit: 'abc1234', dirty: false, model: null, findings: [], unshown: [] });
  assert.equal(
    report,
    ['### Fresh-eyes findings', '', 'Read from `p.md` as built at `abc1234`. Mark each finding fixed, or dismissed with a reason.', '', 'No findings.', ''].join('\n'),
  );
});
