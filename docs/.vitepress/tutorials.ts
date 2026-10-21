import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DefaultTheme } from 'vitepress';

export type Series = 'swarm' | 'a2a';

export interface Tutorial {
  series: Series;
  /** Its place in the series, which the page title and the sidebar show and the slug never carries. */
  number: number;
  slug: string;
  /** The page title after "<Series> <n>: ". */
  title: string;
  /** The landing page's one-line "what you'll do". */
  summary: string;
}

/** Each series' name as page titles and the sidebar show it, in the order the series are listed. */
export const SERIES: Record<Series, string> = { swarm: 'Swarm', a2a: 'A2A' };

const SWARM = [
  ['first-swarm', 'Your first swarm', 'Launch Dev & Watcher and watch a Claude Code agent build a tip calculator while its tests go green.'],
  ['tdd-swarm-kata', 'TDD Swarm kata', 'Build a password-strength checker test-first, driving a tester, an implementer and a reviewer one pane at a time.'],
  ['full-stack-pair', 'Full-Stack Pair: bookmarks app', "Have two agents build a bookmarks app's API and React UI side by side, then open it in your browser."],
  ['custom-swarm', 'Build and save a custom swarm', 'Build a two-agent Docs Squad in the swarm builder, save it, and launch it again after a restart.'],
  ['bug-hunt', 'Bug Hunt', 'Hand a bug report to four agents that reproduce, trace, patch and verify each bug in turn.'],
  ['red-team-blue-team', 'Red Team / Blue Team: notes app', 'Pit an attacking agent against a defending one on a notes app, then let the Pre-PR Audit Gate catch what both missed.'],
  ['js-to-typescript', 'JS to TypeScript migration', 'Have three agents convert a JavaScript project to TypeScript, one folder each, while `tsc --watch` counts the errors down to zero.'],
  ['tri-agent-council', 'Tri-Agent Council: plan, build, verify', 'Have a planner, a builder and a verifier take a Markdown link checker from spec to verdict.'],
  ['polyglot-trio', 'Polyglot Trio', 'Have Antigravity plan, Claude Code build and Codex review a CSV-to-JSON converter, passing work over the A2A bus.'],
  ['parallel-worktrees', 'Parallel experiments with worktrees', 'Try two designs at once in two git worktrees, measure them, merge the winner and throw the loser away.'],
] as const;

const A2A = [
  ['hello-a2a', 'Hello, A2A', 'Send an agent a message from Mission Control, then watch one agent ask another a question and wait for the reply.'],
  ['contract-first-handoff', 'Contract-first handoff', "Have two agents agree a notes app's API over the A2A bus before either builds its half."],
  ['tdd-relay', 'Hands-off TDD relay', 'Type one prompt and watch a test writer hand failing tests to an implementer, who reports back when they pass.'],
  ['review-gate', 'Review gate before commit', 'Have a reviewer agent check every change to a rate limiter until its reply ends in `APPROVED`.'],
  ['fan-out-fan-in', 'Fan-out / fan-in', 'Have a lead agent split a static-site generator across three workers at once, then wire their parts together.'],
  ['fire-then-poll', 'Long jobs: fire, then poll', 'Hand a 90-second benchmark to another agent without waiting, check on it, and collect the result from a file.'],
  ['broadcast', 'Broadcast coordination', 'Have a release captain broadcast a code freeze, hold it through a failed release and lift it when the release passes.'],
  ['mission-control', 'Mission Control operator run', 'Lead three agents from Mission Control alone as they plan, build and verify a text-stats CLI.'],
  ['docs-that-cant-lie', "Docs that can't lie", 'Have three agents rewrite a broken README until every code sample in it runs as written.'],
  ['second-opinion-codex', 'Second opinion from Codex', 'Have a Claude Code agent ask a Codex agent for a review, then fix every finding it writes down.'],
] as const;

function inSeries(series: Series, rows: readonly (readonly [string, string, string])[]): Tutorial[] {
  return rows.map(([slug, title, summary], index) => ({ series, number: index + 1, slug, title, summary }));
}

/** Every tutorial in both series, written or not, in series order. */
export const TUTORIALS: readonly Tutorial[] = [...inSeries('swarm', SWARM), ...inSeries('a2a', A2A)];

/** The tutorial's page, relative to the docs folder. */
export function tutorialPage(tutorial: Tutorial): string {
  return `tutorials/${tutorial.series}/${tutorial.slug}/index.md`;
}

/** The tutorial's page title, "<Series> <n>: <Title>". */
export function tutorialTitle(tutorial: Tutorial): string {
  return `${SERIES[tutorial.series]} ${tutorial.number}: ${tutorial.title}`;
}

/** The tutorial's URL on the site, before the site's base. */
export function tutorialLink(tutorial: Tutorial): string {
  return `/tutorials/${tutorial.series}/${tutorial.slug}/`;
}

export const LANDING_LINK = '/tutorials/';

/**
 * The tutorials whose pages exist under `docsDir`, in series order. The nav, the sidebar and both
 * tables list only these, so nothing links to an unwritten page.
 */
export function publishedTutorials(docsDir: string): Tutorial[] {
  return TUTORIALS.filter((tutorial) => existsSync(join(docsDir, tutorialPage(tutorial))));
}

/** Each series that has a published tutorial, with those tutorials in order. */
function bySeries(published: readonly Tutorial[]): [Series, Tutorial[]][] {
  return (Object.keys(SERIES) as Series[])
    .map((series): [Series, Tutorial[]] => [series, published.filter((tutorial) => tutorial.series === series)])
    .filter(([, tutorials]) => tutorials.length > 0);
}

/**
 * The landing page's two tables, one per series, each under a heading of `heading` (`##` or `###`),
 * with links prefixed by `base`: empty on the site, the GitHub Pages address in the README.
 */
export function tutorialTables(published: readonly Tutorial[], { base, heading }: { base: string; heading: string }): string {
  if (published.length === 0) return 'The first tutorials are on their way.';
  return bySeries(published)
    .map(([series, tutorials]) => [
      `${heading} ${SERIES[series]}`,
      '',
      "| # | Tutorial | What you'll do |",
      '| --- | --- | --- |',
      ...tutorials.map((tutorial) => `| ${tutorial.number} | [${tutorial.title}](${base}${tutorialLink(tutorial)}) | ${tutorial.summary} |`),
    ].join('\n'))
    .join('\n\n');
}

/** The one sidebar every tutorial page shares: the landing page, then each series, numbered. */
export function tutorialsSidebar(published: readonly Tutorial[]): DefaultTheme.SidebarItem[] {
  return [
    { text: 'Tutorials', link: LANDING_LINK },
    ...bySeries(published).map(([series, tutorials]) => ({
      text: SERIES[series],
      items: tutorials.map((tutorial) => ({ text: `${tutorial.number}. ${tutorial.title}`, link: tutorialLink(tutorial) })),
    })),
  ];
}
