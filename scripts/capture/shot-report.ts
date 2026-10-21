// The changed-shot report: each new still compared with the committed one by a pixel diff at
// the screenshot research's tolerance, and one report per release that shows, per tutorial,
// which shots changed, old beside new. README.md beside this file says how it is used.

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pixelmatch from 'pixelmatch';
import sharp from 'sharp';
import { TUTORIALS } from '../../docs/.vitepress/tutorials.ts';

/**
 * Playwright's `toHaveScreenshot` default, the tolerance the screenshot research named: how far
 * a pixel's colour may move, from 0 to 1, before it counts as changed. Repeated captures of one
 * screen differed by a luminance step of 1 in 255 on a few pixels, far inside it, so byte
 * equality is never the test.
 */
export const DIFF_THRESHOLD = 0.2;

export type ShotStatus = 'changed' | 'new' | 'unchanged';

export interface Size {
  width: number;
  height: number;
}

export interface ShotComparison {
  name: string;
  /** `new` when nothing is committed under its name. */
  status: ShotStatus;
  /** Pixels past the tolerance; every pixel of the new shot when its size changed; 0 when new. */
  changedPixels: number;
  /** The committed shot's size, or null when new. */
  oldSize: Size | null;
  newSize: Size;
  /** A PNG of the changed pixels in red over a faded committed shot, when it changed at the same size. */
  diff: Buffer | null;
}

async function decode(name: string, which: string, bytes: Buffer) {
  try {
    const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height };
  } catch (error) {
    throw new Error(`${name}: the ${which} shot is not an image sharp can read: ${(error as Error).message}`);
  }
}

/** Compares a new shot with the one committed under its name, if any. */
export async function compareShot(name: string, committed: Buffer | null, captured: Buffer): Promise<ShotComparison> {
  const next = await decode(name, 'new', captured);
  const newSize = { width: next.width, height: next.height };
  if (committed === null) return { name, status: 'new', changedPixels: 0, oldSize: null, newSize, diff: null };
  const old = await decode(name, 'committed', committed);
  const oldSize = { width: old.width, height: old.height };
  if (old.width !== next.width || old.height !== next.height) {
    return { name, status: 'changed', changedPixels: next.width * next.height, oldSize, newSize, diff: null };
  }
  const output = new Uint8Array(old.data.length);
  const changedPixels = pixelmatch(old.data, next.data, output, old.width, old.height, { threshold: DIFF_THRESHOLD });
  if (changedPixels === 0) return { name, status: 'unchanged', changedPixels, oldSize, newSize, diff: null };
  const diff = await sharp(output, { raw: { width: old.width, height: old.height, channels: 4 } }).png().toBuffer();
  return { name, status: 'changed', changedPixels, oldSize, newSize, diff };
}

/** One shot as the report keeps it. */
export interface ReportedShot extends Omit<ShotComparison, 'diff'> {
  /** Whether the report holds a diff image for it. */
  diffImage: boolean;
}

/** One tutorial's section of a release's report, kept as `<slug>.json` in the report folder. */
export interface TutorialShots {
  tutorial: string;
  quayVersion: string;
  capturedOn: string;
  shots: ReportedShot[];
}

/** A release's report folder, `capture-reports/<version>/`, which git ignores. */
export function shotReportDir(root: string, quayVersion: string): string {
  return join(root, 'capture-reports', quayVersion);
}

function readSection(dir: string, file: string): TutorialShots {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  } catch (error) {
    throw new Error(`${join(dir, file)} is not JSON: ${(error as Error).message}`);
  }
  const section = value as Partial<TutorialShots> | null;
  if (
    typeof section !== 'object' ||
    section === null ||
    typeof section.tutorial !== 'string' ||
    `${section.tutorial}.json` !== file ||
    typeof section.quayVersion !== 'string' ||
    typeof section.capturedOn !== 'string' ||
    !Array.isArray(section.shots)
  ) {
    throw new Error(`${join(dir, file)} is not a tutorial's section of a changed-shot report; remove it or the folder`);
  }
  return section as TutorialShots;
}

export interface CapturedShot {
  name: string;
  /** The shot committed under its name at HEAD, or null when there is none. */
  committed: Buffer | null;
  captured: Buffer;
}

/**
 * Compares a tutorial's new shots with its committed ones and writes its section of the
 * release's report: `<slug>.json`, and under `<slug>/` the old, new and diff images of each
 * shot that changed and the new image of each new shot. A recapture of the tutorial replaces
 * its section. Then it writes the report's `index.html` from every section in the folder, which
 * must all be from the same release.
 */
export async function reportShots(input: { dir: string; tutorial: string; quayVersion: string; capturedOn: string; shots: CapturedShot[] }): Promise<TutorialShots> {
  mkdirSync(input.dir, { recursive: true });
  const sections = readdirSync(input.dir)
    .filter((file) => file.endsWith('.json') && file !== `${input.tutorial}.json`)
    .map((file) => readSection(input.dir, file));
  for (const other of sections) {
    if (other.quayVersion !== input.quayVersion) {
      throw new Error(`${input.dir} is the report for Quay ${other.quayVersion} (${other.tutorial}); a capture of Quay ${input.quayVersion} goes in its own report`);
    }
  }
  const images = join(input.dir, input.tutorial);
  rmSync(images, { recursive: true, force: true });
  const shots: ReportedShot[] = [];
  for (const shot of input.shots) {
    const { diff, ...result } = await compareShot(shot.name, shot.committed, shot.captured);
    if (result.status !== 'unchanged') {
      mkdirSync(images, { recursive: true });
      writeFileSync(join(images, `${shot.name}.new.webp`), shot.captured);
      if (shot.committed !== null) writeFileSync(join(images, `${shot.name}.old.webp`), shot.committed);
      if (diff !== null) writeFileSync(join(images, `${shot.name}.diff.png`), diff);
    }
    shots.push({ ...result, diffImage: diff !== null });
  }
  const section: TutorialShots = { tutorial: input.tutorial, quayVersion: input.quayVersion, capturedOn: input.capturedOn, shots };
  writeFileSync(join(input.dir, `${input.tutorial}.json`), `${JSON.stringify(section, null, 2)}\n`);
  writeFileSync(join(input.dir, 'index.html'), renderShotReport(input.quayVersion, [...sections, section]));
  return section;
}

const escape = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

/** A path inside the report folder, as an `src` attribute's value. */
const imagePath = (tutorial: string, file: string) => escape(`${encodeURIComponent(tutorial)}/${encodeURIComponent(file)}`);

const sizeText = (size: Size) => `${size.width} × ${size.height}`;

function shotFigure(tutorial: string, shot: ReportedShot): string {
  const image = (file: string, caption: string) => {
    const src = imagePath(tutorial, `${shot.name}${file}`);
    return `<figure><a href="${src}"><img src="${src}" alt="${escape(`${shot.name}, ${caption}`)}" loading="lazy"></a><figcaption>${escape(caption)}</figcaption></figure>`;
  };
  const what =
    shot.status === 'new'
      ? 'new: nothing is committed under this name'
      : shot.oldSize !== null && sizeText(shot.oldSize) !== sizeText(shot.newSize)
        ? `changed size, from ${sizeText(shot.oldSize)} to ${sizeText(shot.newSize)}`
        : `${shot.changedPixels.toLocaleString('en-US')} pixels changed`;
  const images = [shot.status === 'changed' ? image('.old.webp', 'committed') : '', image('.new.webp', 'new'), shot.diffImage ? image('.diff.png', 'changed pixels') : ''];
  return `<article class="shot"><h3>${escape(shot.name)}.webp <span>${escape(what)}</span></h3><div class="images">${images.join('')}</div></article>`;
}

/** Each tutorial's section in the order the docs list tutorials, then any the docs don't list, by slug. */
function inDocsOrder(sections: TutorialShots[]): TutorialShots[] {
  const place = (slug: string) => {
    const at = TUTORIALS.findIndex((t) => t.slug === slug);
    return at === -1 ? TUTORIALS.length : at;
  };
  return [...sections].sort((a, b) => place(a.tutorial) - place(b.tutorial) || a.tutorial.localeCompare(b.tutorial));
}

/**
 * The release's report page: the tutorials whose shots changed or are new, which go to the
 * release re-run, then per tutorial each changed shot's committed image beside its new one and
 * the changed pixels, each new shot, and the names of the shots that did not change.
 */
export function renderShotReport(quayVersion: string, sections: TutorialShots[]): string {
  const ordered = inDocsOrder(sections);
  const differs = (section: TutorialShots) => section.shots.some((shot) => shot.status !== 'unchanged');
  const rerun = ordered.filter(differs);
  const summary =
    rerun.length === 0
      ? '<p>No tutorial needs a release re-run: every shot matched its committed one.</p>'
      : `<p>Tutorials for the release re-run, whose shots changed or are new:</p><ul class="rerun">${rerun
          .map((s) => `<li><a href="#${escape(s.tutorial)}">${escape(s.tutorial)}</a></li>`)
          .join('')}</ul>`;
  const body = ordered.map((section) => {
    const changed = section.shots.filter((shot) => shot.status !== 'unchanged');
    const same = section.shots.filter((shot) => shot.status === 'unchanged').map((shot) => escape(shot.name));
    return [
      `<section id="${escape(section.tutorial)}">`,
      `<h2>${escape(section.tutorial)}</h2>`,
      `<p class="meta">Captured ${escape(section.capturedOn)}. ${changed.length} of ${section.shots.length} shots changed or new.</p>`,
      ...changed.map((shot) => shotFigure(section.tutorial, shot)),
      same.length > 0 ? `<p class="same">Unchanged: ${same.join(', ')}</p>` : '',
      '</section>',
    ].join('\n');
  });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Changed shots, Quay ${escape(quayVersion)}</title>
<style>
  :root { color-scheme: dark; --bg: #0d1117; --panel: #161b22; --line: #30363d; --text: #e6edf3; --muted: #8b949e; --accent: #f0883e; }
  body { margin: 0; padding: 24px 16px; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, sans-serif; }
  main { max-width: 1600px; margin: 0 auto; }
  a { color: var(--accent); }
  h2 { margin-top: 40px; border-bottom: 1px solid var(--line); padding-bottom: 6px; }
  h3 { font-size: 15px; margin: 0 0 8px; }
  h3 span, .meta, .same, figcaption { color: var(--muted); font-weight: normal; }
  .shot { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px; margin: 16px 0; }
  .images { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
  figure { margin: 0; }
  img { display: block; width: 100%; height: auto; border: 1px solid var(--line); }
</style>
</head>
<body>
<main>
<h1>Changed shots, Quay ${escape(quayVersion)}</h1>
<p>Each new shot is compared with the one committed at HEAD by a pixel diff at threshold ${DIFF_THRESHOLD}. Review every change below. Commit the new shots, and send the listed tutorials to the release re-run. A shot that changed for no reason this release explains is a regression to chase before publishing.</p>
${summary}
${body.join('\n')}
</main>
</body>
</html>
`;
}
