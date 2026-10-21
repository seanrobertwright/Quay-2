import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { publishedTutorials, tutorialPage, tutorialTables, tutorialTitle } from '../../docs/.vitepress/tutorials.ts';

const START = '<!-- tutorials:start -->';
const END = '<!-- tutorials:end -->';

/** Where the tables go, relative to the repo root, and how each place writes them. */
const TARGETS = [
  { file: 'docs/tutorials/index.md', base: '', heading: '##' },
  { file: 'README.md', base: 'https://seanrobertwright.github.io/Quay-2', heading: '###' },
] as const;

export interface SyncReport {
  /** Files whose tables differ from the published tutorials. */
  stale: string[];
  /** Anything that stops the tables being written or checked. */
  problems: string[];
}

/**
 * Brings the tables between the `tutorials:start` and `tutorials:end` markers in the landing page
 * and the README in line with the published tutorials. With `write`, rewrites the stale files;
 * without it, only reports them. Each file keeps its own line endings.
 */
export function syncTutorialTables({ root, write }: { root: string; write: boolean }): SyncReport {
  const report: SyncReport = { stale: [], problems: [] };
  const published = publishedTutorials(join(root, 'docs'));

  // The tables show the catalogue's titles, so a page that has drifted from them would be listed
  // under a name it doesn't carry.
  for (const tutorial of published) {
    const page = `docs/${tutorialPage(tutorial)}`;
    const body = readFileSync(join(root, page), 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
    const title = /^# (.+?)\r?$/m.exec(body)?.[1];
    if (title !== tutorialTitle(tutorial)) {
      const found = title === undefined ? 'missing' : `"${title}"`;
      report.problems.push(`${page}: its title is ${found}, but the tutorials list in docs/.vitepress/tutorials.ts calls it "${tutorialTitle(tutorial)}"`);
    }
  }

  for (const target of TARGETS) {
    const path = join(root, target.file);
    const text = readFileSync(path, 'utf8');
    const start = text.indexOf(START);
    const end = text.indexOf(END);
    if (start === -1 || end < start || text.indexOf(START, start + 1) !== -1 || text.indexOf(END, end + 1) !== -1) {
      report.problems.push(`${target.file}: needs one "${START}" line followed by one "${END}" line`);
      continue;
    }
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const tables = tutorialTables(published, target).replaceAll('\n', eol);
    const synced = `${text.slice(0, start + START.length)}${eol}${tables}${eol}${text.slice(end)}`;
    if (synced === text) continue;
    report.stale.push(target.file);
    if (write) writeFileSync(path, synced);
  }
  return report;
}
