import type { SwarmPreset } from '../../src/slices/orchestrator/swarmTypes.ts';
import { BUILTIN_SWARM_PRESETS } from '../../src/slices/orchestrator/swarmTypes.ts';
import type { RunKind, StageLayout } from '../../src/slices/terminal/types.ts';

/** Each CLI's name as the docs write it. */
const CLI_NAMES: Record<RunKind, string> = {
  claude: 'Claude Code',
  antigravity: 'Antigravity',
  codex: 'Codex',
  pi: 'Pi Agent',
  gemini: 'Gemini CLI',
  grok: 'Grok CLI',
  aider: 'Aider',
  kiro: 'Kiro CLI',
  copilot: 'GitHub Copilot',
  opencode: 'OpenCode',
  powershell: 'PowerShell',
  command: 'Command',
  archon: 'Archon',
};

const LAYOUT_NAMES: Record<StageLayout, string> = {
  single: 'Single view',
  'split-horizontal': 'Side-by-side split',
  'split-vertical': 'Stacked split',
  grid: '2x2 grid',
};

/** The panes of each layout, in the order a swarm's agents fill them at launch. */
const PANES: Record<StageLayout, readonly string[]> = {
  single: [],
  'split-horizontal': ['left', 'right'],
  'split-vertical': ['top', 'bottom'],
  grid: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
};

const TEXT_ESCAPES: Record<string, string> = { '<': '&lt;', '>': '&gt;', '{': '&#123;', '}': '&#125;' };

/** Text that renders as itself on GitHub and in VitePress, which reads `{{ }}` as Vue. */
function escapeText(text: string): string {
  return text
    .replace(/&(?=#?[a-z0-9]+;)/gi, '&amp;')
    .replace(/[<>{}\\`*_[\]]/g, (char) => TEXT_ESCAPES[char] ?? `\\${char}`);
}

function longestBacktickRun(text: string): number {
  return Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
}

function inlineCode(text: string): string {
  const ticks = '`'.repeat(longestBacktickRun(text) + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${ticks}${pad}${text}${pad}${ticks}`;
}

function fencedText(text: string): string[] {
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(text) + 1));
  return [`${fence}text`, ...text.split(/\r?\n/), fence];
}

/** The built-in presets as the swarm presets feature page lists them, one `###` section each. */
export function presetPageSection(presets: readonly SwarmPreset[]): string[] {
  return presets.flatMap((preset, i) => {
    const agents = preset.agents.map((agent, slot) => {
      const details = [CLI_NAMES[agent.run_kind], agent.custom_flags && inlineCode(agent.custom_flags), PANES[preset.layout][slot]];
      return `- **${inlineCode(agent.name)}** (${details.filter(Boolean).join(', ')}): ${escapeText(agent.role)}.`;
    });
    const prompted = preset.agents.filter((agent) => agent.role_prompt);
    const rolePrompts = prompted.length === 0 ? [] : [
      '',
      '::: details Role prompts',
      ...prompted.flatMap((agent) => ['', `**${inlineCode(agent.name)}**`, '', ...fencedText(agent.role_prompt ?? '')]),
      '',
      ':::',
    ];
    return [
      ...(i === 0 ? [] : ['']),
      `### ${i + 1}. ${escapeText(preset.title)}`,
      '',
      escapeText(preset.description),
      '',
      `- **Layout**: ${LAYOUT_NAMES[preset.layout]}.`,
      ...agents,
      ...rolePrompts,
    ];
  });
}

/** The built-in presets as the README's swarm bullets list them. */
export function readmeBullets(presets: readonly SwarmPreset[]): string[] {
  return presets.map((preset) => {
    const agents = preset.agents.map((agent) => inlineCode(agent.name)).join(', ');
    return `- *${escapeText(preset.title)}* (${agents}): ${escapeText(preset.description)}`;
  });
}

/**
 * Replaces the lines between `<!-- BEGIN GENERATED: <region>` and `<!-- END GENERATED: <region> -->`
 * with `lines`, indented as the begin marker is, in the file's own line endings. Throws unless the
 * file holds exactly one begin marker for the region, followed by exactly one end marker.
 */
export function replaceGeneratedRegion(text: string, region: string, lines: readonly string[]): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const fileLines = text.split(/\r?\n/);
  // The region's name ends at a space, a full stop or the comment's end, so `a` never matches `a-b`.
  const find = (marker: string) =>
    fileLines.flatMap((line, at) => {
      const text = line.trimStart();
      const rest = text.slice(marker.length);
      return text.startsWith(marker) && /^([ .]|-->)/.test(rest) ? [at] : [];
    });
  const begins = find(`<!-- BEGIN GENERATED: ${region}`);
  const ends = find(`<!-- END GENERATED: ${region}`);
  if (begins.length !== 1 || ends.length !== 1 || ends[0] < begins[0]) {
    throw new Error(`Expected one "<!-- BEGIN GENERATED: ${region}" line followed by one "<!-- END GENERATED: ${region} -->" line`);
  }
  const indent = /^\s*/.exec(fileLines[begins[0]])?.[0] ?? '';
  const body = lines.map((line) => (line === '' ? '' : `${indent}${line}`));
  return [...fileLines.slice(0, begins[0] + 1), ...body, ...fileLines.slice(ends[0])].join(eol);
}

export interface GeneratedFile {
  path: URL;
  /** The file's text with its generated region rewritten from `BUILTIN_SWARM_PRESETS`. */
  regenerate: (text: string) => string;
}

const REGION = 'builtin-swarm-presets';

/** The files that hold a list generated from `BUILTIN_SWARM_PRESETS`. */
export const GENERATED_FILES: readonly GeneratedFile[] = [
  {
    path: new URL('../../docs/features/swarm-presets.md', import.meta.url),
    regenerate: (text) => replaceGeneratedRegion(text, REGION, ['', ...presetPageSection(BUILTIN_SWARM_PRESETS), '']),
  },
  {
    path: new URL('../../README.md', import.meta.url),
    regenerate: (text) => replaceGeneratedRegion(text, REGION, readmeBullets(BUILTIN_SWARM_PRESETS)),
  },
];
