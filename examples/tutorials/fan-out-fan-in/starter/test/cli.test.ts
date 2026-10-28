// cli-dev's tests: npm run test:cli. Nobody edits this file. They pass a fake buildPage, so
// they never depend on src/site.ts.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '../src/cli/run.ts';

const fakeBuildPage = (markdown: string, template: string) => `${template}|${markdown}`;

let dir: string;
let log: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ssg-cli-'));
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function site(files: Record<string, string>): string {
  const input = join(dir, 'in');
  mkdirSync(input);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(input, name), text);
  return input;
}

describe('run', () => {
  it('builds one .html page per .md file with buildPage and the template', async () => {
    const input = site({ 'template.html': 'T', 'a.md': 'A', 'b.md': 'B' });
    const out = join(dir, 'out');
    expect(await run(['build', input, out], fakeBuildPage)).toBe(0);
    expect(readFileSync(join(out, 'a.html'), 'utf8')).toBe('T|A');
    expect(readFileSync(join(out, 'b.html'), 'utf8')).toBe('T|B');
  });

  it('prints how many pages it built and where', async () => {
    const input = site({ 'template.html': 'T', 'a.md': 'A', 'b.md': 'B' });
    const out = join(dir, 'out');
    await run(['build', input, out], fakeBuildPage);
    expect(log).toHaveBeenCalledWith(`Built 2 pages to ${out}`);
  });

  it('skips files that are not .md and creates a nested output folder', async () => {
    const input = site({ 'template.html': 'T', 'a.md': 'A', 'notes.txt': 'N', 'logo.svg': '<svg/>' });
    const out = join(dir, 'out', 'nested');
    expect(await run(['build', input, out], fakeBuildPage)).toBe(0);
    expect(readdirSync(out)).toEqual(['a.html']);
  });

  it('prints the usage and exits 2 when arguments are missing', async () => {
    expect(await run([], fakeBuildPage)).toBe(2);
    expect(await run(['build', 'site'], fakeBuildPage)).toBe(2);
    expect(await run(['serve', 'site', 'dist'], fakeBuildPage)).toBe(2);
    expect(error).toHaveBeenCalledWith('Usage: ssg build <in> <out>');
  });

  it('exits 1 and writes nothing when template.html is missing', async () => {
    const input = site({ 'a.md': 'A' });
    const out = join(dir, 'out');
    expect(await run(['build', input, out], fakeBuildPage)).toBe(1);
    expect(String(error.mock.calls[0]?.[0])).toContain('template.html');
    expect(existsSync(out)).toBe(false);
  });
});
