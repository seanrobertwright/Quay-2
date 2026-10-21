import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { MarkdownRenderer } from 'vitepress';
import { readStepCardRecord, type StepCardRecord } from '../../docs/.vitepress/step-cards.ts';
import { isDateStamp } from '../../src/lib/dates.ts';

/** The folders of a tutorial whose files go into its run fingerprint, as they go into its zips. */
const FINGERPRINT_FOLDERS = ['starter', 'check'] as const;

function git(cwd: string, args: string[], input?: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
}

/**
 * The files under `folder` that `pack-starters.mjs` packs: tracked or untracked, minus every file
 * a .gitignore matches, even a tracked one. Paths are relative to the repo root, use `/` and are
 * sorted.
 */
function packedFiles(top: string, tutorialDir: string, folder: string): string[] {
  if (!existsSync(join(tutorialDir, folder))) return [];
  const list = (args: string[]) =>
    git(tutorialDir, ['ls-files', '--full-name', '--exclude-standard', '-z', ...args, '--', folder]).split('\0').filter(Boolean);
  const ignored = new Set(list(['--cached', '--ignored']));
  return [...new Set(list(['--cached', '--others']))]
    .filter((file) => !ignored.has(file) && existsSync(join(top, file)))
    .sort();
}

/**
 * A tutorial's run fingerprint: 16 hex digits of a SHA-256 over its Do and Paste slots, as
 * written and in page order, and the files in its `starter/` and `check/` folders. Each file
 * counts as its git blob id, so line endings follow the repo's `.gitattributes` and
 * `core.autocrlf`, not how a checkout wrote them. Wording, captions, Must match, May differ and
 * If not text are left out.
 */
export function runFingerprint(actions: StepCardRecord['actions'], tutorialDir: string): string {
  if (!existsSync(join(tutorialDir, 'starter'))) {
    throw new Error(`${tutorialDir} has no starter/ folder; every tutorial folder holds one`);
  }
  // `hash-object --stdin-paths` reads its paths from the repo root, whatever the working folder.
  const top = git(tutorialDir, ['rev-parse', '--show-toplevel']).trim();
  const prefix = git(tutorialDir, ['rev-parse', '--show-prefix']).trim();
  const files = FINGERPRINT_FOLDERS.flatMap((folder) => packedFiles(top, tutorialDir, folder));
  const blobs = files.length === 0 ? [] : git(top, ['hash-object', '--stdin-paths'], `${files.join('\n')}\n`).trim().split('\n');
  const identity = {
    version: 1,
    actions: actions.map(({ step, slot, info, source }) => [step, slot, info, source]),
    // Paths count from the tutorial folder, so the fingerprint doesn't depend on where it sits.
    files: files.map((file, i) => [file.slice(prefix.length), blobs[i]]),
  };
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 16);
}

/** A value the maintainer replaces, written in italics so an unfilled one stands out. */
const fill = (hint: string) => `_${hint}_`;

const IF_NOT_OUTCOMES = fill('not used, fix worked, or fix failed');

/**
 * The skeleton of one test run's section, from the page's step cards: a box for each Must match
 * and You're done when item, a line for each If not, the Before you start check from pass rule 5,
 * and the run fingerprint. Steps with neither Must match nor If not are left out.
 */
export function runSection(record: StepCardRecord, { date, fingerprint }: { date: string; fingerprint: string }): string {
  const box = (item: string) => `- [ ] ${item}`;
  const steps = record.steps
    .filter((step) => step.must.length > 0 || step.ifnots.length > 0)
    .flatMap((step) => [
      `#### ${step.number}. ${step.title ?? ''}`.trimEnd(),
      '',
      ...step.must.map(box),
      ...step.ifnots.map((symptom) => `- **If not, ${symptom}:** ${IF_NOT_OUTCOMES}`),
      '',
    ]);
  return [
    `## ${date}`,
    '',
    `- **Result:** ${fill('pass or fail')}`,
    `- **Run fingerprint:** \`${fingerprint}\``,
    `- **Failed at:** ${fill('the step a failed run stopped at, or none')}`,
    `- **Tracking issue:** ${fill('the issue a failed run is tracked in, or none')}`,
    `- **Quay:** ${fill('version, from its release installer')}`,
    '',
    '### Agent CLIs',
    '',
    '| CLI | Version | Default model |',
    '| --- | --- | --- |',
    `| ${fill('name')} | ${fill('version')} | ${fill('model')} |`,
    '',
    '### Time and Tokens',
    '',
    '| Agent | CLI | Minutes | Tokens |',
    '| --- | --- | --- | --- |',
    `| ${fill('pane label')} | ${fill('CLI')} | ${fill('minutes')} | ${fill('count, or not reported')} |`,
    `| **Total** | | ${fill('minutes')} | ${fill('count')} |`,
    '',
    '### Before you start',
    '',
    box('Every agent CLI and tool the run used is on this list:'),
    ...record.before.map((item) => `  - ${item}`),
    `- **Used but not listed:** ${fill('none')}`,
    '',
    '### Steps',
    '',
    ...steps,
    "### You're done when",
    '',
    ...record.done.map(box),
    '',
    '### Fresh-eyes findings',
    '',
    `- ${fill('step, quoted line and finding: fixed, or dismissed with a reason; none if the read found nothing')}`,
    '',
    '### Off-page knowledge',
    '',
    `- ${fill('none')}`,
    '',
    '### Differed from the screenshots',
    '',
    `- ${fill('none')}`,
    '',
  ].join('\n');
}

/**
 * Adds a run's section to a tutorial's record, or starts the record when `existing` is null.
 * Sections stay newest first: the new one goes above every section dated on or before its date.
 */
export function addRunSection(
  existing: string | null,
  { title, slug, date, section }: { title: string; slug: string; date: string; section: string },
): string {
  const record =
    existing?.replace(/\r\n/g, '\n') ??
    `# Test runs: ${title}\n\n` +
      `One section per test run, newest first. \`pnpm docs:test-run ${slug}\` adds each run's section from the ` +
      "page's step cards. How to set up the test account and do a run is in `scripts/test-runs/README.md`.\n";
  const lines = record.split('\n');
  // Dates written YYYY-MM-DD sort as text.
  const at = lines.findIndex((line) => /^## \S/.test(line) && line.slice(3, 13) <= date);
  if (at === -1) return `${record.replace(/\n*$/, '\n\n')}${section}`;
  return [...lines.slice(0, at), ...section.replace(/\n*$/, '\n').split('\n'), ...lines.slice(at)].join('\n');
}

const TUTORIALS = join('docs', 'tutorials');

/** The page `docs/tutorials/<series>/<slug>/index.md`, as a path relative to `docs/`. */
function findPage(root: string, slug: string): string {
  const seriesDir = join(root, TUTORIALS);
  const series = existsSync(seriesDir) ? readdirSync(seriesDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()) : [];
  const pages = series.map((entry) => `tutorials/${entry.name}/${slug}/index.md`).filter((page) => existsSync(join(root, 'docs', page)));
  if (pages.length === 0) throw new Error(`no tutorial page for ${slug}: expected docs/tutorials/<series>/${slug}/index.md`);
  if (pages.length > 1) throw new Error(`${slug} has a page in more than one series: ${pages.map((page) => `docs/${page}`).join(', ')}`);
  return pages[0];
}

/**
 * Starts a test run: reads the tutorial's page, which must pass the step-card rules, and adds a
 * section for the run to `examples/tutorials/<slug>/test-runs.md`, creating the file if needed.
 * `md` is a renderer with the site's markdown setup.
 */
export function newTestRun({ root, slug, date, md }: { root: string; slug: string; date: string; md: MarkdownRenderer }): { file: string } {
  const page = findPage(root, slug);
  const tutorialDir = join(root, 'examples', 'tutorials', slug);
  if (!existsSync(join(tutorialDir, 'starter'))) {
    throw new Error(`examples/tutorials/${slug} has no starter/ folder; every tutorial folder holds one`);
  }
  const src = readFileSync(join(root, 'docs', page), 'utf8');
  // Parsing runs the step-card check, which throws on a page that breaks a rule.
  const record = readStepCardRecord(md.parse(src, { relativePath: page }), src);
  if (record.steps.length === 0) throw new Error(`docs/${page} has no step cards`);
  const file = join(tutorialDir, 'test-runs.md');
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : null;
  const section = runSection(record, { date, fingerprint: runFingerprint(record.actions, tutorialDir) });
  writeFileSync(file, addRunSection(existing, { title: record.title ?? slug, slug, date, section }));
  return { file };
}

const USAGE = 'usage: pnpm docs:test-run <slug> [--date YYYY-MM-DD]';
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Reads the command's arguments. The date defaults to `today()`. */
export function parseTestRunArgs(argv: string[], today: () => string): { slug: string; date: string } {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: { date: { type: 'string' } }, allowPositionals: true, strict: true });
  } catch (error) {
    throw new Error(`${(error as Error).message}\n${USAGE}`);
  }
  const { values, positionals } = parsed;
  if (positionals.length !== 1) throw new Error(USAGE);
  const [slug] = positionals;
  if (!SLUG.test(slug)) throw new Error(`slug "${slug}" must be lowercase letters and digits, with single hyphens between them`);
  const date = values.date ?? today();
  if (!isDateStamp(date)) throw new Error(`--date "${date}" is not a date written YYYY-MM-DD`);
  return { slug, date };
}

