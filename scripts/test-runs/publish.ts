import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MarkdownRenderer } from 'vitepress';
import { glanceTile, readStepCardRecord, usesStepCards, type GlanceTile } from '../../docs/.vitepress/step-cards.ts';
import { TUTORIALS, tutorialSlugOf } from '../../docs/.vitepress/tutorials.ts';
import { isDateStamp } from '../../src/lib/dates.ts';
import { runFingerprint } from './test-runs.ts';

type Token = ReturnType<MarkdownRenderer['parse']>[number];
type CoreRule = Parameters<MarkdownRenderer['core']['ruler']['push']>[1];

/** How many passing runs a run fingerprint needs before its tutorial is published. */
const RUNS_TO_PUBLISH = 2;
/** The repository the tutorials live in, for links to its issues and files. */
export const REPO = 'https://github.com/seanrobertwright/Quay-2';
const NOT_MEASURED = 'not measured yet';

/** One finished test run, as the build reads it from a tutorial's `test-runs.md`. */
export interface TestRun {
  date: string;
  result: 'pass' | 'fail';
  fingerprint: string;
  /** The step a failed run stopped at; null for a passing run. */
  failedAt: number | null;
  /** The issue tracking a failed run; null for a passing run. */
  issue: { label: string; url: string } | null;
  /** Each agent CLI the run used, as its Agent CLIs table lists it. */
  clis: { name: string; version: string }[];
  /** A passing run's minutes from starting step 1 to the last done item; null for a failed run. */
  minutes: number | null;
  /** A passing run's agents, each with its CLI's token count or null when the CLI reports none; empty for a failed run. */
  agents: { cli: string; tokens: number | null }[];
}

/** A value the maintainer has not filled in yet, still in the italics `pnpm docs:test-run` wrote. */
const unfilled = (value: string) => /^_.*_$/.test(value);

/** The value on a section's `- **<label>:** <value>` line, or null when it has none. */
function field(lines: string[], label: string): string | null {
  const prefix = `- **${label}:**`;
  const line = lines.find((each) => each.startsWith(prefix));
  return line === undefined ? null : line.slice(prefix.length).trim();
}

/** The body rows of the table under a section's `### <heading>`, each as its trimmed cells. */
function tableRows(lines: string[], heading: string): string[][] {
  const at = lines.indexOf(`### ${heading}`);
  if (at === -1) return [];
  const rows: string[][] = [];
  for (const line of lines.slice(at + 1)) {
    if (line.startsWith('#')) break;
    if (line.startsWith('|')) rows.push(line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()));
  }
  // The header row and the --- row under it.
  return rows.slice(2);
}

/** A count written with or without thousands commas, as 48,213 or 48213. */
function parseCount(value: string): number | null {
  return /^(?:\d{1,3}(?:,\d{3})+|\d+)$/.test(value) ? Number(value.replaceAll(',', '')) : null;
}

/** A positive number of minutes, as 23 or 23.5. */
function parseMinutes(value: string): number | null {
  const minutes = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
  return minutes > 0 ? minutes : null;
}

function parseIssue(value: string): TestRun['issue'] {
  const url = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)(?![\w/])/.exec(value);
  if (url) {
    const [whole, owner, repo, number] = url;
    const label = `${REPO}/issues/${number}` === whole ? `#${number}` : `${owner}/${repo}#${number}`;
    return { label, url: whole };
  }
  const short = /^#(\d+)$/.exec(value)?.[1];
  return short === undefined ? null : { label: `#${short}`, url: `${REPO}/issues/${short}` };
}

/** Reads one dated section. Returns null for a run still being filled in, whose Result is unfilled. */
function parseRun(date: string, lines: string[], problems: string[]): TestRun | null {
  const result = field(lines, 'Result') ?? '';
  if (unfilled(result)) return null;
  const problem = (text: string) => problems.push(`${date}: ${text}`);
  const before = problems.length;
  if (!isDateStamp(date)) problem('the section heading is the run date, written YYYY-MM-DD');
  if (result !== 'pass' && result !== 'fail') problem('Result is pass or fail');
  const fingerprint = /^`([0-9a-f]{16})`$/.exec(field(lines, 'Run fingerprint') ?? '')?.[1];
  if (fingerprint === undefined) problem('Run fingerprint is the 16 hex digits pnpm docs:test-run wrote');
  const clis = tableRows(lines, 'Agent CLIs')
    .filter(([name = '', version = '']) => !unfilled(name) && !unfilled(version) && name !== '' && version !== '')
    .map(([name, version]) => ({ name, version }));

  let failedAt: number | null = null;
  let issue: TestRun['issue'] = null;
  let minutes: number | null = null;
  const agents: TestRun['agents'] = [];
  if (result === 'fail') {
    issue = parseIssue(field(lines, 'Tracking issue') ?? '');
    if (issue === null) {
      problem('a failed run links the issue that tracks it under Tracking issue, as #123 or https://github.com/<owner>/<repo>/issues/123');
    }
    const step = /^(?:step\s+)?(\d+)\b/i.exec(field(lines, 'Failed at') ?? '')?.[1];
    if (step === undefined) problem('a failed run names the step it stopped at under Failed at, starting with the step number');
    else failedAt = Number(step);
    if (clis.length === 0) problem('a failed run lists each CLI it used with its version under Agent CLIs');
  } else if (result === 'pass') {
    const rows = tableRows(lines, 'Time and Tokens');
    const total = rows.find(([agent]) => agent.replaceAll('*', '') === 'Total');
    let readable = true;
    for (const [, cli = '', , tokens = ''] of rows.filter((row) => row !== total)) {
      const count = tokens === 'not reported' ? null : parseCount(tokens);
      if (unfilled(cli) || cli === '' || (count === null && tokens !== 'not reported')) readable = false;
      else agents.push({ cli, tokens: count });
    }
    if (!readable || agents.length === 0) {
      problem('each agent has a row under Time and Tokens with its CLI and its tokens: a count, such as 48,213, or "not reported"');
    }
    minutes = parseMinutes(total?.[2] ?? '');
    if (minutes === null) problem("the Total row's minutes are the run's minutes from step 1 to the last done item");
    const sum = agents.reduce((all, agent) => all + (agent.tokens ?? 0), 0);
    const reported = agents.some((agent) => agent.tokens !== null);
    const totalTokens = total?.[3] ?? '';
    if (readable && (reported ? parseCount(totalTokens) !== sum : totalTokens !== 'not reported')) {
      const expected = reported ? String(sum) : '"not reported"';
      problem(`the Total row's tokens, ${parseCount(totalTokens) ?? JSON.stringify(totalTokens)}, are not the sum of the agents' tokens, ${expected}`);
    }
  }
  if (problems.length > before || fingerprint === undefined) return null;
  return { date, result: result as TestRun['result'], fingerprint, failedAt, issue, clis, minutes, agents };
}

/**
 * Reads a tutorial's `test-runs.md`: its finished runs in record order, newest first, and every
 * problem that keeps a run from being read. A section whose Result is still unfilled is a run in
 * progress, and is left out without a problem.
 */
export function parseRecord(text: string): { runs: TestRun[]; problems: string[] } {
  const runs: TestRun[] = [];
  const problems: string[] = [];
  const lines = text.split(/\r?\n/);
  const starts = lines.flatMap((line, i) => (/^## /.test(line) ? [i] : []));
  starts.forEach((start, i) => {
    const run = parseRun(lines[start].slice(3).trim(), lines.slice(start + 1, starts[i + 1]), problems);
    if (run) runs.push(run);
  });
  return { runs, problems };
}

/** Rounds up to the next multiple of 5. */
const upToFive = (minutes: number) => Math.max(5, Math.ceil(minutes / 5) * 5);

/** Rounds a count up to two significant figures and writes it short, as 9.6k, 48k or 1.3M. */
function shortCount(count: number): string {
  const digits = String(Math.trunc(count)).length;
  const step = digits <= 2 ? 1 : 10 ** (digits - 2);
  const rounded = Math.ceil(count / step) * step;
  if (rounded >= 1e6) return `${rounded / 1e6}M`;
  if (rounded >= 1e3) return `${rounded / 1e3}k`;
  return String(rounded);
}

/** The CLIs a set of runs' agents used, in the order they first appear. */
const cliNames = (agents: TestRun['agents']) => [...new Set(agents.map((agent) => agent.cli))];

const totalTokens = (run: TestRun) => run.agents.reduce((all, agent) => all + (agent.tokens ?? 0), 0);

/** The highest passing run's total, naming the CLIs that run counted and the ones it couldn't. */
function tokensTile(passing: TestRun[]): string {
  const highest = passing.reduce((top, run) => (totalTokens(run) > totalTokens(top) ? run : top));
  const uncounted = cliNames(highest.agents.filter((agent) => agent.tokens === null));
  const counted = cliNames(highest.agents).filter((cli) => !uncounted.includes(cli));
  if (counted.length === 0) return `not counted (${uncounted.join(', ')})`;
  const about = `about ${shortCount(totalTokens(highest))}`;
  return uncounted.length === 0 ? about : `${about} (${counted.join(', ')}; ${uncounted.join(', ')} not counted)`;
}

export interface Publication {
  /** The passing runs for the current fingerprint, newest first. */
  passing: TestRun[];
  /** The Time and Tokens tiles' values. */
  time: string;
  tokens: string;
  /** The failed run the page announces, or null. */
  notice: TestRun | null;
}

/**
 * What a tutorial's runs, newest first, give its page at run fingerprint `fingerprint`: the
 * passing runs the gate counts, the generated tiles, and the failed run to announce. The newest
 * failed run is announced until newer passing runs for the current fingerprint clear it: one when
 * it failed on the current fingerprint, two when the page has changed since.
 */
export function publication(runs: TestRun[], fingerprint: string | null): Publication {
  const current = (run: TestRun) => run.result === 'pass' && run.fingerprint === fingerprint;
  const passing = runs.filter(current);
  const failed = runs.findIndex((run) => run.result === 'fail');
  const clearedBy = failed !== -1 && runs[failed].fingerprint === fingerprint ? 1 : RUNS_TO_PUBLISH;
  const notice = failed !== -1 && runs.slice(0, failed).filter(current).length < clearedBy ? runs[failed] : null;
  if (passing.length === 0) return { passing, time: NOT_MEASURED, tokens: NOT_MEASURED, notice };
  const minutes = Math.max(...passing.map((run) => run.minutes ?? 0));
  return { passing, time: `about ${upToFive(minutes)} min`, tokens: tokensTile(passing), notice };
}

/**
 * Reads `QUAY_TUTORIAL_DRAFT`: a comma-separated list of tutorial slugs that build without
 * passing the gate, for the test runs and the fresh-eyes read that come before publication.
 */
export function parseTutorialDrafts(value: string | undefined): Set<string> {
  const slugs = (value ?? '').split(',').map((slug) => slug.trim()).filter((slug) => slug !== '');
  for (const slug of slugs) {
    if (!TUTORIALS.some((tutorial) => tutorial.slug === slug)) {
      throw new Error(`QUAY_TUTORIAL_DRAFT names ${slug}, which is not a tutorial slug; list slugs from docs/.vitepress/tutorials.ts, separated by commas`);
    }
  }
  return new Set(slugs);
}

/** Joins names as "A", "A and B" or "A, B and C". */
const listed = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

function noticeHtml(md: MarkdownRenderer, run: TestRun, stepTitle: string | null): string {
  const escape = md.utils.escapeHtml;
  const step = `step ${run.failedAt}${stepTitle === null ? '' : `, “${md.renderInline(stepTitle)}”`}`;
  const clis = listed(run.clis.map((cli) => escape(`${cli.name} ${cli.version}`)));
  const issue = run.issue ?? { label: '', url: '' };
  return (
    '<div class="warning custom-block tutorial-failed-run"><p class="custom-block-title">This tutorial failed its latest test run</p>\n' +
    `<p>On ${escape(run.date)} a test run stopped at ${step}, with ${clis}. The page may not work as written until it is fixed. ` +
    `The fix is tracked in <a href="${escape(issue.url)}" target="_blank" rel="noreferrer">${escape(issue.label)}</a>.</p>\n</div>\n`
  );
}

/** Writes a value after a glance tile's bold label. */
function fillTile(state: Parameters<CoreRule>[0], tile: GlanceTile, value: string): void {
  const inline = glanceTile(state.tokens, tile);
  if (!inline) return;
  const text = new state.Token('text', '', 0);
  text.content = ` ${value}`;
  inline.children = [...(inline.children ?? []), text];
  inline.content += text.content;
}

export interface TestRunOptions {
  /** Whether a tutorial without two passing runs for its current fingerprint fails to render. */
  gate: boolean;
  /** The tutorials that render without passing the gate. */
  drafts: ReadonlySet<string>;
  /** The folder holding each tutorial's `<slug>/test-runs.md`, `starter/` and `check/`. */
  examples: string;
}

/**
 * Publishes tutorial pages from their test runs. On each page under `tutorials/<series>/<slug>/`,
 * it reads `<slug>/test-runs.md`, writes the Time and Tokens tiles, and adds a notice under the
 * title while the newest failed run is not cleared. A record it cannot read, or a failed run with
 * no issue link, fails the page; so does the gate, when on, unless the tutorial is a draft. Other
 * step-card pages get tiles that say nothing has been measured. Register it after the step cards.
 */
export function testRunsPlugin({ gate, drafts, examples }: TestRunOptions): (md: MarkdownRenderer) => void {
  return (md) => {
    md.core.ruler.push('test_runs', (state) => {
      if (!usesStepCards(state.tokens)) return;
      const relativePath = (state.env as { relativePath?: string }).relativePath ?? '';
      const slug = tutorialSlugOf(relativePath);
      let published = publication([], null);
      if (slug !== null) {
        const tutorialDir = join(examples, slug);
        const file = join(tutorialDir, 'test-runs.md');
        const shown = `examples/tutorials/${slug}/test-runs.md`;
        const record = readStepCardRecord(state.tokens, state.src);
        const fingerprint = existsSync(join(tutorialDir, 'starter')) ? runFingerprint(record.actions, tutorialDir) : null;
        const { runs, problems } = existsSync(file) ? parseRecord(readFileSync(file, 'utf8')) : { runs: [], problems: [] };
        const reasons = problems.map((problem) => `${shown}, ${problem}`);
        published = publication(runs, fingerprint);
        const have = published.passing.length;
        if (gate && !drafts.has(slug) && have < RUNS_TO_PUBLISH) {
          reasons.push(
            fingerprint === null
              ? `examples/tutorials/${slug}/starter/ is missing, so it has no run fingerprint and no test runs`
              : `it has ${have} passing test run${have === 1 ? '' : 's'} for its run fingerprint ${fingerprint}, and needs ${RUNS_TO_PUBLISH}. ` +
                  `Record them in ${shown} (see scripts/test-runs/README.md), or set QUAY_TUTORIAL_DRAFT=${slug} to build it as a draft`,
          );
        }
        if (reasons.length > 0) throw new Error(`${relativePath} cannot be published:\n${reasons.map((reason) => `  ${reason}`).join('\n')}`);
        const notice = published.notice;
        if (notice) {
          const title = notice.fingerprint === fingerprint ? (record.steps[(notice.failedAt ?? 0) - 1]?.title ?? null) : null;
          const block = new state.Token('html_block', '', 0);
          block.content = noticeHtml(md, notice, title);
          const h1 = state.tokens.findIndex((token: Token) => token.type === 'heading_close' && token.tag === 'h1');
          state.tokens.splice(h1 + 1, 0, block);
        }
      }
      fillTile(state, 'Time', published.time);
      fillTile(state, 'Tokens', published.tokens);
    });
  };
}

const EXAMPLES = fileURLToPath(new URL('../../examples/tutorials/', import.meta.url));

/** The test-run plugin as the site uses it: the gate is on for `docs:build`, and `QUAY_TUTORIAL_DRAFT` names the drafts. */
export function testRuns(command: 'build' | 'serve'): (md: MarkdownRenderer) => void {
  return testRunsPlugin({ gate: command === 'build', drafts: parseTutorialDrafts(process.env.QUAY_TUTORIAL_DRAFT), examples: EXAMPLES });
}
