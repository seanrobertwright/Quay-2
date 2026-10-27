// render-dev's tests: npm run test:render. Nobody edits this file.
import { describe, expect, it } from 'vitest';
import { render } from '../src/render/render.ts';
import type { Block, Doc } from '../src/types.ts';

/** Whitespace between tags is free, so compare without it. */
const squash = (html: string) => html.replace(/>\s+</g, '><').trim();

const page = (blocks: Block[], title = 'T'): Doc => ({ title, blocks });

describe('render', () => {
  it('fills every {{title}} and the {{content}} in the template', () => {
    const html = render(page([{ kind: 'paragraph', content: [{ kind: 'text', text: 'x' }] }]), '<title>{{title}}</title><h1>{{title}}</h1><main>{{content}}</main>');
    expect(squash(html)).toBe('<title>T</title><h1>T</h1><main><p>x</p></main>');
  });

  it('turns headings into h1 and h2', () => {
    const html = render(
      page([
        { kind: 'heading', level: 1, content: [{ kind: 'text', text: 'One' }] },
        { kind: 'heading', level: 2, content: [{ kind: 'text', text: 'Two' }] },
      ]),
      '{{content}}',
    );
    expect(squash(html)).toBe('<h1>One</h1><h2>Two</h2>');
  });

  it('turns a list into ul with one li per item', () => {
    const html = render(page([{ kind: 'list', items: [[{ kind: 'text', text: 'a' }], [{ kind: 'code', text: 'b' }]] }]), '{{content}}');
    expect(squash(html)).toBe('<ul><li>a</li><li><code>b</code></li></ul>');
  });

  it('escapes &, <, > and " in the title, text and code', () => {
    const html = render(
      page([{ kind: 'paragraph', content: [{ kind: 'text', text: 'a < b & "c"' }, { kind: 'code', text: '<b>' }] }], 'Q & A'),
      '<title>{{title}}</title>{{content}}',
    );
    expect(squash(html)).toBe('<title>Q &amp; A</title><p>a &lt; b &amp; &quot;c&quot;<code>&lt;b&gt;</code></p>');
  });

  it('renders relative, http, https and mailto links as anchors', () => {
    const link = (href: string) => ({ kind: 'link' as const, text: 'go', href });
    const html = render(page([{ kind: 'list', items: [[link('a.html')], [link('http://x.test')], [link('https://x.test/?a=1&b=2')], [link('mailto:t@x.test')]] }]), '{{content}}');
    expect(squash(html)).toBe(
      '<ul><li><a href="a.html">go</a></li><li><a href="http://x.test">go</a></li><li><a href="https://x.test/?a=1&amp;b=2">go</a></li><li><a href="mailto:t@x.test">go</a></li></ul>',
    );
  });

  it('renders a link with any other scheme as its text alone', () => {
    const html = render(page([{ kind: 'paragraph', content: [{ kind: 'link', text: 'click <me>', href: 'javascript:alert' }] }]), '{{content}}');
    expect(squash(html)).toBe('<p>click &lt;me&gt;</p>');
  });
});
