// lead's end-to-end test: npm run e2e. Nobody edits this file. It runs the real ssg command on
// site/ and compares each page it writes with the one in site/expected/.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Whitespace between tags is free, and so are line endings. */
const squash = (html: string) => html.replace(/\r\n/g, '\n').replace(/>\s+</g, '><').trim();

let out: string;
let result: ReturnType<typeof spawnSync>;

beforeAll(() => {
  out = join(mkdtempSync(join(tmpdir(), 'ssg-e2e-')), 'dist');
  result = spawnSync(process.execPath, ['bin/ssg.ts', 'build', 'site', out], { encoding: 'utf8' });
});

afterAll(() => {
  rmSync(join(out, '..'), { recursive: true, force: true });
});

describe('ssg build site', () => {
  for (const name of ['index', 'about', 'hello']) {
    it(`writes ${name}.html exactly as site/expected/${name}.html`, () => {
      expect(result.status, String(result.stderr)).toBe(0);
      const built = readFileSync(join(out, `${name}.html`), 'utf8');
      const expected = readFileSync(join('site', 'expected', `${name}.html`), 'utf8');
      expect(squash(built)).toBe(squash(expected));
    });
  }
});
