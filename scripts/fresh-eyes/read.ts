// Runs a fresh-eyes read of one or more tutorial pages:
//
//   pnpm docs:fresh-eyes docs/tutorials/<series>/<slug>/index.md [more pages] [--model <name>]
//
// It builds the docs site, extracts each built page's text, screenshots and alt text, and hands only
// those to a new `claude -p` reader. The reader runs in an empty folder outside the repo with
// brief.md as its whole system prompt, no tools, no settings and no CLAUDE.md. Each page's findings
// print to stdout, ready for the run's section of the tutorial's test-runs.md. What the reader was
// given, and its findings, stay in a folder of their own under the system temp folder.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import siteConfig from '../../docs/.vitepress/config.mts';
import { tutorialSlugOf } from '../../docs/.vitepress/tutorials.ts';
import type { ShownImage } from './fresh-eyes.ts';
import { checkFindings, extractPage, formatFindings, imageSource, parseReaderOutput, readerArgs, readerEnv, readerMessage } from './fresh-eyes.ts';

const USAGE = 'usage: pnpm docs:fresh-eyes <docs/.../page.md> [more pages] [--model <name>]';
const READER_TIMEOUT_MS = 20 * 60 * 1000;
const EXTENSIONS: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };

const root = fileURLToPath(new URL('../../', import.meta.url));
const docs = join(root, 'docs');
const dist = join(docs, '.vitepress', 'dist');
const briefPath = fileURLToPath(new URL('brief.md', import.meta.url));

function fail(message: string): never {
  console.error(`fresh-eyes: ${message}`);
  process.exit(1);
}

interface Options {
  /** Each page's path relative to docs/, with forward slashes. */
  pages: string[];
  model: string | null;
}

function parseArgs(argv: string[]): Options {
  const pages: string[] = [];
  let model: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--model') {
      const name = argv[++i];
      if (name === undefined || !/^[A-Za-z0-9][\w.:[\]-]*$/.test(name)) fail(`--model needs a model name, such as opus or claude-opus-5-5.\n${USAGE}`);
      model = name;
    } else if (arg.startsWith('-')) {
      fail(`unknown option ${arg}\n${USAGE}`);
    } else {
      const inDocs = relative(docs, resolve(root, arg));
      if (inDocs.startsWith('..') || isAbsolute(inDocs) || !inDocs.endsWith('.md')) fail(`${arg} is not a markdown page under docs/.\n${USAGE}`);
      if (!existsSync(join(docs, inDocs))) fail(`${arg} does not exist.`);
      pages.push(inDocs.replaceAll('\\', '/'));
    }
  }
  if (pages.length === 0) fail(USAGE);
  return { pages, model };
}

function git(args: string[]): string {
  const run = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (run.status !== 0) fail(`git ${args.join(' ')} failed: ${run.stderr.trim()}`);
  return run.stdout.trim();
}

function build(pages: string[]): void {
  console.error('fresh-eyes: building the docs site with pnpm docs:build');
  // The read comes before a page's test runs, so its tutorials build as drafts, past the test-run gate.
  const drafts = [process.env.QUAY_TUTORIAL_DRAFT ?? '', ...pages.map(tutorialSlugOf)].filter(Boolean).join(',');
  // One command string, since pnpm is a .cmd shim on Windows and only a shell can run it.
  const run = spawnSync('pnpm run docs:build', {
    cwd: root,
    shell: true,
    env: { ...process.env, QUAY_TUTORIAL_DRAFT: drafts },
    stdio: ['ignore', process.stderr, process.stderr],
  });
  if (run.status !== 0) fail('pnpm docs:build failed, so there is no built page to read.');
}

function builtPage(page: string): string {
  return join(dist, page.replace(/\.md$/, '.html'));
}

/** Reads one built page. Returns false when the reader failed. */
function readPage(page: string, base: string, model: string | null): boolean {
  const extracted = extractPage(readFileSync(builtPage(page), 'utf8'));

  // The reader's folder: empty but for what it is given, so its working directory holds no repo.
  const folder = mkdtempSync(join(tmpdir(), 'quay-fresh-eyes-'));
  writeFileSync(join(folder, 'page.md'), `${extracted.text}\n`);
  const shown: ShownImage[] = [];
  const unshown: { n: number; reason: string }[] = [];
  for (const image of extracted.images) {
    const source = imageSource(image.src, base);
    if (source.kind === 'unshown' || (source.kind === 'file' && !existsSync(join(dist, source.path)))) {
      const reason = source.kind === 'unshown' ? source.reason : 'its file is missing from the built site';
      shown.push({ n: image.n, kind: 'unshown', reason });
      unshown.push({ n: image.n, reason });
      continue;
    }
    const data = source.kind === 'data' ? source.data : readFileSync(join(dist, source.path)).toString('base64');
    shown.push({ n: image.n, kind: 'data', mediaType: source.mediaType, data });
    writeFileSync(join(folder, `image-${image.n}${EXTENSIONS[source.mediaType]}`), Buffer.from(data, 'base64'));
  }

  console.error(`fresh-eyes: reading docs/${page} (${extracted.steps.length} steps, ${shown.length - unshown.length} of ${shown.length} images shown)`);
  const run = spawnSync('claude', readerArgs({ briefPath, model }), {
    cwd: folder,
    env: readerEnv(process.env),
    input: `${JSON.stringify(readerMessage(extracted, shown))}\n`,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: READER_TIMEOUT_MS,
    windowsHide: true,
  });
  if (run.error) {
    const hint = (run.error as NodeJS.ErrnoException).code === 'ENOENT' ? ' Is Claude Code installed, with claude on PATH?' : '';
    console.error(`fresh-eyes: could not run the reader for docs/${page}: ${run.error.message}.${hint}`);
    return false;
  }
  let read: ReturnType<typeof parseReaderOutput>;
  try {
    read = parseReaderOutput(run.stdout);
  } catch (error) {
    console.error(`fresh-eyes: docs/${page}: ${(error as Error).message}\n${run.stderr.trim()}`);
    return false;
  }

  const report = formatFindings({
    page: `docs/${page}`,
    commit: git(['rev-parse', '--short', 'HEAD']),
    dirty: git(['status', '--porcelain', '--', join(docs, dirname(page))]) !== '',
    model: read.model,
    findings: checkFindings(extracted, read.findings),
    unshown,
  });
  writeFileSync(join(folder, 'findings.md'), report);
  process.stdout.write(`${report}\n`);
  console.error(`fresh-eyes: what the reader was given, and its findings, are in ${folder}`);
  return true;
}

const options = parseArgs(process.argv.slice(2));
const config = await siteConfig({ command: 'build', mode: 'production' });
const base = config.base ?? '/';
build(options.pages);
for (const page of options.pages) {
  if (!existsSync(builtPage(page))) fail(`docs/${page} is not in the built site. Pages under docs/_examples/ are left out of docs:build.`);
}
let failed = 0;
for (const page of options.pages) if (!readPage(page, base, options.model)) failed++;
if (failed > 0) fail(`${failed} of ${options.pages.length} reads failed.`);
