// The changed-shot report: each new still compared with the committed one by a pixel diff at
// the screenshot research's tolerance, and one report per release that shows, per tutorial,
// which shots changed, old beside new. README.md beside this file says how it is used.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pixelmatch from 'pixelmatch';
import sharp from 'sharp';
import { SHOT_NAME } from '../../docs/.vitepress/step-cards.ts';
import { TUTORIALS } from '../../docs/.vitepress/tutorials.ts';

/**
 * Playwright's `toHaveScreenshot` default, the tolerance the screenshot research named: how far
 * a pixel's colour may move, from 0 to 1, before it counts as changed. Repeated captures of one
 * screen differed by a luminance step of 1 in 255 on a few pixels, far inside it, so byte
 * equality is never the test.
 */
export const DIFF_THRESHOLD = 0.2;

/** How long a capture waits for another one to finish writing the same report. */
const LOCK_WAIT_MS = 60_000;

export type ShotStatus = 'changed' | 'new' | 'unchanged';

const STATUSES: readonly string[] = ['changed', 'new', 'unchanged'] satisfies ShotStatus[];

export interface Size {
  width: number;
  height: number;
}

const sameSize = (a: Size, b: Size) => a.width === b.width && a.height === b.height;

export interface ShotComparison {
  name: string;
  /** `new` when nothing is committed under its name. */
  status: ShotStatus;
  /** Pixels past the tolerance; every pixel of the new shot when its size changed; 0 when new. */
  changedPixels: number;
  /** The committed shot's size, or null when new. */
  oldSize: Size | null;
  newSize: Size;
  /**
   * A PNG of the shot's changes over a faded committed shot, when it changed at the same size:
   * changed pixels in red, and in yellow the anti-aliasing pixelmatch saw and did not count.
   */
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
  if (!sameSize(oldSize, newSize)) {
    return { name, status: 'changed', changedPixels: next.width * next.height, oldSize, newSize, diff: null };
  }
  const output = new Uint8Array(old.data.length);
  const changedPixels = pixelmatch(old.data, next.data, output, old.width, old.height, { threshold: DIFF_THRESHOLD });
  if (changedPixels === 0) return { name, status: 'unchanged', changedPixels, oldSize, newSize, diff: null };
  const diff = await sharp(output, { raw: { width: old.width, height: old.height, channels: 4 } }).png().toBuffer();
  return { name, status: 'changed', changedPixels, oldSize, newSize, diff };
}

/** One commit that changed a tutorial's sidecar manifest, and the Quay version the sidecar named after it. */
export interface SidecarCommit {
  commit: string;
  /** Its first parent, or null for a root commit. */
  parent: string | null;
  /** Null when the sidecar was removed or unreadable at that commit. */
  quayVersion: string | null;
}

/**
 * The commit whose stills a release's capture is compared with, from the commits that changed
 * the tutorial's sidecar, newest first. Until a capture for this release is committed it is
 * HEAD. Once one is, the new stills are at HEAD, so it is the commit before the sidecar first
 * named this release: a recapture still reports what changed since the last release. Null when
 * that commit has no parent, so nothing was committed before.
 */
export function releaseBase(history: SidecarCommit[], quayVersion: string): string | null {
  if (history[0]?.quayVersion !== quayVersion) return 'HEAD';
  let first = history[0];
  for (const entry of history) {
    if (entry.quayVersion !== quayVersion) break;
    first = entry;
  }
  return first.parent;
}

/**
 * Splits the output of `git cat-file --batch` for `count` objects into each one's bytes, or
 * null for one git reports missing.
 */
export function parseCatFileBatch(out: Buffer, count: number): (Buffer | null)[] {
  const files: (Buffer | null)[] = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    const end = out.indexOf(0x0a, at);
    if (end === -1) throw new Error(`git cat-file --batch ended after ${i} of ${count} objects`);
    const header = out.subarray(at, end).toString('utf8');
    at = end + 1;
    if (header.endsWith(' missing')) {
      files.push(null);
      continue;
    }
    const match = /^[0-9a-f]+ blob (\d+)$/.exec(header);
    if (match === null) throw new Error(`git cat-file --batch answered ${JSON.stringify(header)}, not a file`);
    const size = Number.parseInt(match[1], 10);
    if (at + size > out.length) throw new Error(`git cat-file --batch ended inside a ${size}-byte file`);
    files.push(out.subarray(at, at + size));
    at += size + 1;
  }
  return files;
}

/**
 * A shot saved by hand in `dir`: `<name>.webp` as it is, or `<name>.png`, which Snipping Tool
 * saves, converted to WebP at `quality`. Null when neither is there.
 */
export async function readSavedShot(dir: string, name: string, quality: number): Promise<Buffer | null> {
  const webp = join(dir, `${name}.webp`);
  if (existsSync(webp)) return readFileSync(webp);
  const png = join(dir, `${name}.png`);
  if (existsSync(png)) return sharp(readFileSync(png)).webp({ quality }).toBuffer();
  return null;
}

/**
 * Puts screenshots taken by hand beside a tutorial's page. Each still already in `stills`, a
 * placeholder or an earlier shot, is replaced by the shot of the same name saved in `saved`, as
 * `readSavedShot` reads it. Returns the stills it replaced and the ones `saved` had no shot for,
 * in name order. A shot in `saved` named after no still fails before anything is written, since
 * it is most often a typo in the name.
 */
export async function placeSavedShots(stills: string, saved: string, quality: number): Promise<{ placed: string[]; missing: string[] }> {
  const names = readdirSync(stills)
    .filter((file) => file.endsWith('.webp') && SHOT_NAME.test(file.slice(0, -'.webp'.length)))
    .map((file) => file.slice(0, -'.webp'.length))
    .sort();
  const unknown = readdirSync(saved)
    .filter((file) => /\.(?:png|webp)$/i.test(file))
    .filter((file) => !names.includes(file.replace(/\.(?:png|webp)$/i, '')))
    .sort();
  if (unknown.length > 0) {
    throw new Error(`${unknown.join(', ')} ${unknown.length === 1 ? 'is' : 'are'} named after no still beside the page; the stills are ${names.join(', ')}`);
  }
  const placed: string[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const bytes = await readSavedShot(saved, name, quality);
    if (bytes === null) {
      missing.push(name);
      continue;
    }
    writeFileSync(join(stills, `${name}.webp`), bytes);
    placed.push(name);
  }
  return { placed, missing };
}

/** One shot as the report keeps it. */
export type ReportedShot = Omit<ShotComparison, 'diff'>;

/** One tutorial's section of a release's report, kept as `<slug>.json` in the report folder. */
export interface TutorialShots {
  tutorial: string;
  quayVersion: string;
  capturedOn: string;
  /** The commit the shots were compared with, or null when nothing was committed before. */
  base: string | null;
  shots: ReportedShot[];
}

/** A release's report folder, `capture-reports/<version>/`, which git ignores. */
export function shotReportDir(root: string, quayVersion: string): string {
  return join(root, 'capture-reports', quayVersion);
}

function isSize(value: unknown): value is Size {
  const size = value as Partial<Size> | null;
  return typeof size === 'object' && size !== null && Number.isInteger(size.width) && Number.isInteger(size.height);
}

function isShot(value: unknown): value is ReportedShot {
  const shot = value as Partial<ReportedShot> | null;
  return (
    typeof shot === 'object' &&
    shot !== null &&
    typeof shot.name === 'string' &&
    typeof shot.status === 'string' &&
    STATUSES.includes(shot.status) &&
    Number.isInteger(shot.changedPixels) &&
    (shot.oldSize === null || isSize(shot.oldSize)) &&
    isSize(shot.newSize)
  );
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
    (section.base !== null && typeof section.base !== 'string') ||
    !Array.isArray(section.shots) ||
    !section.shots.every(isShot)
  ) {
    throw new Error(`${join(dir, file)} is not a tutorial's section of a changed-shot report; remove it or the folder`);
  }
  return section as TutorialShots;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `write` holding the report folder's lock, a `.lock` folder made only if it isn't there,
 * so two captures for one release never write over each other's sections or page.
 */
async function withLock<T>(dir: string, write: () => T): Promise<T> {
  const lock = join(dir, '.lock');
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (Date.now() > deadline) throw new Error(`${lock} has been held for over ${LOCK_WAIT_MS / 1000} s; if no other capture is running, remove it`);
      await sleep(100);
    }
  }
  try {
    return write();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

export interface CapturedShot {
  name: string;
  /** The shot committed under its name at the base commit, or null when there is none. */
  committed: Buffer | null;
  captured: Buffer;
}

/**
 * Compares a tutorial's new shots with its committed ones and writes its section of the
 * release's report: `<slug>.json`, and under `<slug>/` the old, new and diff images of each
 * shot that changed and the new image of each new shot. A recapture of the tutorial replaces
 * its section. Then it writes the report's `index.html` from every section in the folder.
 * Every shot is compared, and every other section read, before any file is written or removed.
 */
export async function reportShots(input: { dir: string; tutorial: string; quayVersion: string; capturedOn: string; base: string | null; shots: CapturedShot[] }): Promise<TutorialShots> {
  const compared: { shot: CapturedShot; result: ShotComparison }[] = [];
  for (const shot of input.shots) compared.push({ shot, result: await compareShot(shot.name, shot.committed, shot.captured) });
  mkdirSync(input.dir, { recursive: true });
  return withLock(input.dir, () => {
    const sections = readdirSync(input.dir)
      .filter((file) => file.endsWith('.json') && file !== `${input.tutorial}.json`)
      .map((file) => readSection(input.dir, file));
    const images = join(input.dir, input.tutorial);
    rmSync(images, { recursive: true, force: true });
    const shots: ReportedShot[] = [];
    for (const { shot, result } of compared) {
      const { diff, ...kept } = result;
      if (kept.status !== 'unchanged') {
        mkdirSync(images, { recursive: true });
        writeFileSync(join(images, `${shot.name}.new.webp`), shot.captured);
        if (shot.committed !== null) writeFileSync(join(images, `${shot.name}.old.webp`), shot.committed);
        if (diff !== null) writeFileSync(join(images, `${shot.name}.diff.png`), diff);
      }
      shots.push(kept);
    }
    const section: TutorialShots = { tutorial: input.tutorial, quayVersion: input.quayVersion, capturedOn: input.capturedOn, base: input.base, shots };
    writeFileSync(join(input.dir, `${input.tutorial}.json`), `${JSON.stringify(section, null, 2)}\n`);
    writeFileSync(join(input.dir, 'index.html'), renderShotReport(input.quayVersion, [...sections, section]));
    return section;
  });
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
  const resized = shot.oldSize !== null && !sameSize(shot.oldSize, shot.newSize);
  const what =
    shot.oldSize === null
      ? 'new: nothing is committed under this name'
      : resized
        ? `changed size, from ${sizeText(shot.oldSize)} to ${sizeText(shot.newSize)}`
        : `${shot.changedPixels.toLocaleString('en-US')} pixels changed`;
  const images = [
    shot.status === 'changed' ? image('.old.webp', 'committed') : '',
    image('.new.webp', 'new'),
    shot.status === 'changed' && !resized ? image('.diff.png', 'changed pixels in red; yellow is anti-aliasing, not counted') : '',
  ];
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
    const base = section.base === null ? 'nothing committed before' : `the shots committed at ${section.base}`;
    return [
      `<section id="${escape(section.tutorial)}">`,
      `<h2>${escape(section.tutorial)}</h2>`,
      `<p class="meta">Captured ${escape(section.capturedOn)}, compared with ${escape(base)}. ${changed.length} of ${section.shots.length} shots changed or new.</p>`,
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
<p>Each new shot is compared with the one committed before this release's capture by a pixel diff at threshold ${DIFF_THRESHOLD}. Review every change below. Commit the new shots, and send the listed tutorials to the release re-run. A shot that changed for no reason this release explains is a regression to chase before publishing.</p>
${summary}
${body.join('\n')}
</main>
</body>
</html>
`;
}
