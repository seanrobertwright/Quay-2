import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { formatSource, parseSource, sourceFor, sourceMismatches, treeDigest } from './vendor.ts';

const COMMIT = 'e68b827f40c7cb958a1fd98b6b5ddd6ce6e542ea';
const bytes = (text: string) => new TextEncoder().encode(text);

describe('treeDigest', () => {
  it('ignores the order files are listed in', () => {
    const a = new Map([['x/a.rs', bytes('a')], ['b.json', bytes('b')]]);
    const b = new Map([['b.json', bytes('b')], ['x/a.rs', bytes('a')]]);
    assert.equal(treeDigest(a), treeDigest(b));
  });

  it('changes when one byte of one file changes', () => {
    const before = new Map([['a.rs', bytes('fn a() {}\n')], ['b.rs', bytes('b')]]);
    const after = new Map([['a.rs', bytes('fn a() {}\r\n')], ['b.rs', bytes('b')]]);
    assert.notEqual(treeDigest(before), treeDigest(after));
  });

  it('changes when a file is renamed', () => {
    assert.notEqual(treeDigest(new Map([['a.rs', bytes('x')]])), treeDigest(new Map([['b.rs', bytes('x')]])));
  });
});

describe('SOURCE', () => {
  const files = new Map([
    ['crates/aiws/src/schema.json', bytes('{}\n')],
    ['spec/fixtures.json', bytes('[]\n')],
  ]);

  it('round-trips through formatSource and parseSource', () => {
    const source = sourceFor(COMMIT, files);
    assert.deepEqual(parseSource(formatSource(source)), source);
  });

  it('records the SHA-256 of the schema bytes', () => {
    assert.equal(
      sourceFor(COMMIT, files).schemaSha256,
      'ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356'
    );
  });

  it('refuses files with no schema', () => {
    assert.throws(() => sourceFor(COMMIT, new Map([['spec/fixtures.json', bytes('[]')]])), /schema\.json/);
  });

  it('refuses a short commit id, a missing field and a repeated field', () => {
    const good = formatSource(sourceFor(COMMIT, files));
    assert.throws(() => parseSource(good.replace(COMMIT, 'e68b827')), /full 40-character/);
    assert.throws(() => parseSource(good.replace(/^tree-sha256.*$/m, '')), /no tree-sha256/);
    assert.throws(() => parseSource(`${good}commit: ${COMMIT}\n`), /twice/);
    assert.throws(() => parseSource(`${good}not a field\n`), /key: value/);
  });

  it('reports which digest no longer matches', () => {
    const recorded = sourceFor(COMMIT, files);
    const edited = sourceFor(COMMIT, new Map([...files, ['spec/fixtures.json', bytes('[1]\n')]]));
    assert.deepEqual(sourceMismatches(recorded, recorded), []);
    assert.deepEqual(sourceMismatches(recorded, edited), [
      "The vendored files don't match the tree-sha256 in SOURCE.",
    ]);
  });
});
