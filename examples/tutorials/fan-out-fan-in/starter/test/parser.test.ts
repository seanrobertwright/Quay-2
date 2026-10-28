// parser-dev's tests: npm run test:parser. Nobody edits this file.
import { describe, expect, it } from 'vitest';
import { parse } from '../src/parser/parse.ts';

describe('parse', () => {
  it('reads the title from the front matter and leaves it out of the blocks', () => {
    const doc = parse('---\ntitle:  Home \nauthor: lead\n---\n\nHi.\n');
    expect(doc.title).toBe('Home');
    expect(doc.blocks).toEqual([{ kind: 'paragraph', content: [{ kind: 'text', text: 'Hi.' }] }]);
  });

  it('gives an empty title when the page has no front matter', () => {
    expect(parse('Hi.\n').title).toBe('');
  });

  it('reads # and ## headings, each one line', () => {
    expect(parse('# One\n## Two\n').blocks).toEqual([
      { kind: 'heading', level: 1, content: [{ kind: 'text', text: 'One' }] },
      { kind: 'heading', level: 2, content: [{ kind: 'text', text: 'Two' }] },
    ]);
  });

  it('joins the lines of a paragraph with single spaces and splits paragraphs at blank lines', () => {
    expect(parse('  first line\nsecond   \n\nthird\n').blocks).toEqual([
      { kind: 'paragraph', content: [{ kind: 'text', text: 'first line second' }] },
      { kind: 'paragraph', content: [{ kind: 'text', text: 'third' }] },
    ]);
  });

  it('reads consecutive - lines into one list', () => {
    expect(parse('Intro:\n\n- a\n- b\n').blocks).toEqual([
      { kind: 'paragraph', content: [{ kind: 'text', text: 'Intro:' }] },
      { kind: 'list', items: [[{ kind: 'text', text: 'a' }], [{ kind: 'text', text: 'b' }]] },
    ]);
  });

  it('reads inline code and links', () => {
    expect(parse('Run `ssg` or read [the docs](docs.html) now.\n').blocks).toEqual([
      {
        kind: 'paragraph',
        content: [
          { kind: 'text', text: 'Run ' },
          { kind: 'code', text: 'ssg' },
          { kind: 'text', text: ' or read ' },
          { kind: 'link', text: 'the docs', href: 'docs.html' },
          { kind: 'text', text: ' now.' },
        ],
      },
    ]);
  });

  it('keeps a backtick or [ that starts nothing as plain text', () => {
    expect(parse('a ` b [c\n').blocks).toEqual([{ kind: 'paragraph', content: [{ kind: 'text', text: 'a ` b [c' }] }]);
  });
});
