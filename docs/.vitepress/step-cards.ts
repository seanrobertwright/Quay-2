import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MarkdownRenderer } from 'vitepress';
import { tutorialSlugOf } from './tutorials.ts';

type Token = ReturnType<MarkdownRenderer['parse']>[number];
type BlockRule = Parameters<MarkdownRenderer['block']['ruler']['before']>[2];

const SLOTS = ['do', 'paste', 'see', 'must', 'may', 'ifnot', 'done'] as const;
type SlotName = (typeof SLOTS)[number];
/** The parts of a tutorial page around its steps, each a container of its own. */
const PAGE_PARTS = ['glance', 'before', 'next'] as const;
type PagePartName = (typeof PAGE_PARTS)[number];
const CONTAINERS = ['step', ...SLOTS, ...PAGE_PARTS] as const;
type ContainerName = (typeof CONTAINERS)[number];

/** Each slot's name as the page and the build's messages show it. */
const LABELS: Record<SlotName, string> = {
  do: 'Do',
  paste: 'Paste',
  see: 'You should see',
  must: 'Must match',
  may: 'May differ',
  ifnot: 'If not',
  done: 'You’re done when',
};

const GLANCE_TILES = ['Time', 'Tokens', 'Agents', 'Level'] as const;
export type GlanceTile = (typeof GLANCE_TILES)[number];
/** The tiles the page leaves empty, for the build to write from the tutorial's test runs. */
const GENERATED_TILES: readonly GlanceTile[] = ['Time', 'Tokens'];
const LEVELS = ['Starter', 'Intermediate', 'Advanced'];
const BEFORE_YOU_START = 'Before you start';
const NEXT_UP = 'Next up';

/**
 * A screenshot's name, `NN-<what>`, where `NN` is the step number. A step marker in a recording
 * takes the same name, and the capture script writes the still under it.
 */
export const SHOT_NAME = /^(\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A step's screenshot, `./NN-<what>.webp` in the tutorial's own folder. */
const SHOT = new RegExp(`^\\.\\/${SHOT_NAME.source.slice(1, -1)}\\.webp$`);
const IMAGE_FILE = /\.(?:webp|png|jpe?g|gif|avif|svg)$/i;
const CLIP_FILE = /\.mp4$/i;
/** Each tutorial's sidecar manifest is `<slug>/sidecar.json` in here, for the capture script to write. */
const SIDECARS = fileURLToPath(new URL('../../examples/tutorials/', import.meta.url));
/** A Quay version as a release names it, `0.3.0` or `v0.3.0`; the group is the version without the `v`. */
export const VERSION = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

// Each container's tokens are `step_card_<name>_open` and `step_card_<name>_close`, so a VitePress
// `::: tip` inside a step is never mistaken for a slot. These two are the only places that know it.
function containerTokenType(name: ContainerName, edge: 'open' | 'close'): string {
  return `step_card_${name}_${edge}`;
}

function isSlot(name: ContainerName): name is SlotName {
  return SLOTS.some((slot) => slot === name);
}

function isPagePart(name: ContainerName): name is PagePartName {
  return PAGE_PARTS.some((part) => part === name);
}

const CONTAINER_TOKENS = new Map(
  CONTAINERS.flatMap((name) => (['open', 'close'] as const).map((edge) => [containerTokenType(name, edge), { name, edge }] as const)),
);

/** Each rule a tutorial page must follow, as the build reports it when broken. */
export const STEP_CARD_RULES = {
  'page-title': 'the title reads <Series> <n>: <Title>, for example "A2A 1: Hello, A2A"',
  'first-step': 'step 1 is "Get the starter project"',
  'no-troubleshooting': `there is no troubleshooting section; each fix is an ${LABELS.ifnot} in the step it belongs to`,
  glance: `an at-a-glance strip comes before step 1: "::: glance" holding one list of the tiles ${GLANCE_TILES.map((tile) => `**${tile}**`).join(', ')}, in that order`,
  'glance-generated': `the ${GENERATED_TILES.map((tile) => `**${tile}**`).join(' and ')} tiles are left empty, since the build writes them from the tutorial's test runs, and every other tile is followed by its value`,
  'glance-level': `the Level tile is ${LEVELS.slice(0, -1).join(', ')} or ${LEVELS.at(-1)}`,
  'you-will-learn': `a "**You'll learn:** ..." line comes before step 1`,
  'before-you-start': `a ${BEFORE_YOU_START} checklist comes before step 1: "::: before" holding "## ${BEFORE_YOU_START}" and one list`,
  'next-up': `a ${NEXT_UP} card comes after the last step: "::: next" opening with one link to the next tutorial in series order`,
  'slot-in-step': 'slots sit directly inside a step, steps do not nest, and the page parts sit outside every step',
  'step-heading': 'each step opens with its numbered heading, "## <n>. <Title>"',
  'slot-order': `a step's slots come once each, in the order ${SLOTS.map((slot) => LABELS[slot]).join(', ')}; only ${LABELS.ifnot} may repeat`,
  'do-or-paste': `every step has ${LABELS.do}, ${LABELS.paste}, or both`,
  'paste-target': `${LABELS.paste} names the pane or Quay field it goes into, as in "::: paste Mission Control"`,
  'paste-one-prompt': `${LABELS.paste} holds one copy-paste prompt: a single fenced code block of one line`,
  'see-required': `${LABELS.see} is required`,
  'see-image': `${LABELS.see} holds one screenshot and nothing else, "![<caption>](./NN-<what>.webp)", where NN is the step number`,
  'image-exists': `the image a ${LABELS.see} names is in the tutorial's folder`,
  'orphan-image': "every image in the tutorial's folder is named by a step card; one that none names is drift",
  'clip-still': 'a clip "NN-<what>.mp4" sits beside its still "NN-<what>.webp"',
  'one-clip': 'a tutorial has at most one clip',
  'release-sidecar': `in the release flow, the tutorial's sidecar manifest records the Quay version being released as "quayVersion"`,
  'must-may-pair': `${LABELS.must} and ${LABELS.may} come as both or neither`,
  'must-may-agent-output': `${LABELS.must} and ${LABELS.may} are required on any step with agent output, which is any step with ${LABELS.paste}`,
  'ifnot-symptom': `${LABELS.ifnot} names the symptom it fixes, as in "::: ifnot asker says it has no quay tools"`,
  'done-required': `${LABELS.done} is required on the last step, which is the check-it-worked step`,
  'done-last-only': `${LABELS.done} is on the last step only`,
} as const;

export type StepCardRule = keyof typeof STEP_CARD_RULES;

export interface StepCardViolation {
  rule: StepCardRule;
  /** The step's position on the page, or null when the rule is about the page. */
  step: number | null;
  title: string | null;
  /** The files the rule is about: in the tutorial's folder, or a sidecar manifest from the repository root. */
  files?: string[];
}

// `::: <name> <info>` opens a container and a bare `:::` closes it. Unlike markdown-it-container,
// the closing line is found by counting nested openers, so slots inside a step close with `:::`
// too, and a `:::` inside a fenced code block is left alone.
const containerRule: BlockRule = (state, startLine, endLine, silent) => {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const opener = /^(:{3,})\s*([a-z]+)(?:\s+(.*?))?\s*$/.exec(lineText(state, startLine));
  const name = CONTAINERS.find((container) => container === opener?.[2]);
  if (!opener || !name) return false;
  if (silent) return true;

  let depth = 1;
  let fence: RegExp | null = null;
  let nextLine = startLine;
  let closed = false;
  while (++nextLine < endLine) {
    const text = lineText(state, nextLine);
    if (text !== '' && state.sCount[nextLine] < state.blkIndent) break;
    if (state.sCount[nextLine] - state.blkIndent >= 4) continue;
    if (fence) {
      if (fence.test(text)) fence = null;
      continue;
    }
    const fenceOpener = /^(`{3,}|~{3,})/.exec(text);
    if (fenceOpener) {
      fence = new RegExp(`^${fenceOpener[1][0]}{${fenceOpener[1].length},}\\s*$`);
    } else if (/^:{3,}\s*$/.test(text)) {
      if (--depth === 0) {
        closed = true;
        break;
      }
    } else if (/^:{3,}\s*\S/.test(text)) {
      depth++;
    }
  }

  const oldParent = state.parentType;
  const oldLineMax = state.lineMax;
  state.parentType = 'container' as typeof state.parentType;
  state.lineMax = nextLine;

  const open = state.push(containerTokenType(name, 'open'), 'div', 1);
  open.markup = opener[1];
  open.block = true;
  open.info = opener[3] ?? '';
  open.map = [startLine, nextLine];
  state.md.block.tokenize(state, startLine + 1, nextLine);
  const close = state.push(containerTokenType(name, 'close'), 'div', -1);
  close.markup = opener[1];
  close.block = true;

  state.parentType = oldParent;
  state.lineMax = oldLineMax;
  state.line = nextLine + (closed ? 1 : 0);
  return true;
};

function lineText(state: Parameters<BlockRule>[0], line: number): string {
  return state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
}

export function registerStepCardContainers(md: MarkdownRenderer): void {
  md.block.ruler.before('fence', 'step_card_containers', containerRule, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
  const rules = md.renderer.rules;

  rules[containerTokenType('step', 'open')] = (tokens, idx) => {
    const later = tokens.slice(idx + 1).some((token) => token.type === containerTokenType('step', 'open') && token.level === tokens[idx].level);
    return `<section class="step-card${later ? '' : ' step-card--last'}">\n`;
  };
  rules[containerTokenType('step', 'close')] = () => '</section>\n';

  for (const slot of SLOTS) {
    if (slot === 'ifnot') continue;
    rules[containerTokenType(slot, 'open')] = (tokens, idx) => {
      const info = tokens[idx].info;
      const label = slot === 'paste' && info !== '' ? `${LABELS.paste} into ${md.renderInline(info)}` : LABELS[slot];
      return `<div class="step-card__slot step-card__slot--${slot}"><p class="step-card__label">${label}</p>\n`;
    };
    rules[containerTokenType(slot, 'close')] = () => '</div>\n';
  }

  // A You should see slot's screenshot renders as a figure, its caption both the image's alt text
  // and shown under it. When the page's folder holds a clip of the same name, the figure holds the
  // clip instead, with the still as its poster and the caption as its text alternative; the theme's
  // `v-step-card-clip` directive starts it unless the reader asks for reduced motion.
  md.core.ruler.push('step_card_shots', (state) => {
    if (!usesStepCards(state.tokens)) return;
    const { path } = state.env as PageEnv;
    let files: Set<string> | null = null;
    for (const step of readPage(state.tokens).steps) {
      for (const see of step.slots.filter((slot) => slot.name === 'see')) {
        const image = seeImage(see);
        if (!image) continue;
        const [paragraph, , close] = see.tokens;
        paragraph.hidden = true;
        close.hidden = true;
        const still = folderFile(image.attrGet('src') ?? '');
        const clip = still?.replace(/\.webp$/, '.mp4');
        files ??= path ? new Set(readdirSync(dirname(path))) : new Set();
        image.meta = { shot: { clip: clip && clip !== still && files.has(clip) ? `./${clip}` : null } };
      }
    }
  });
  const renderImage = rules.image;
  rules.image = (tokens, idx, options, env, self) => {
    const shot = tokens[idx].meta?.shot as { clip: string | null } | undefined;
    if (!shot) return renderImage ? renderImage(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
    const escape = md.utils.escapeHtml;
    const caption = escape(self.renderInlineAsText(tokens[idx].children ?? [], options, env));
    const still = escape(tokens[idx].attrGet('src') ?? '');
    const figcaption = `<figcaption aria-hidden="true">${caption}</figcaption>`;
    if (shot.clip === null) return `<figure class="step-card__shot"><img src="${still}" alt="${caption}">${figcaption}</figure>\n`;
    return (
      '<figure class="step-card__shot step-card__shot--clip">' +
      `<video v-step-card-clip class="step-card__clip" src="${escape(shot.clip)}" poster="${still}" aria-label="${caption}" muted loop playsinline controls preload="metadata"></video>` +
      `${figcaption}</figure>\n`
    );
  };

  rules[containerTokenType('ifnot', 'open')] = (tokens, idx) =>
    `<details class="details custom-block step-card__ifnot"><summary>${LABELS.ifnot}: ${md.renderInline(tokens[idx].info)}</summary>\n`;
  rules[containerTokenType('ifnot', 'close')] = () => '</details>\n';

  rules[containerTokenType('glance', 'open')] = () => '<div class="tutorial-glance">\n';
  rules[containerTokenType('glance', 'close')] = () => '</div>\n';
  rules[containerTokenType('before', 'open')] = () => '<div class="tutorial-checklist">\n';
  rules[containerTokenType('before', 'close')] = () => '</div>\n';
  rules[containerTokenType('next', 'open')] = () =>
    `<nav class="tutorial-next" aria-label="${NEXT_UP}"><p class="tutorial-next__label">${NEXT_UP}</p>\n`;
  rules[containerTokenType('next', 'close')] = () => '</nav>\n';

  // Each item of the Before you start list renders as a checkbox the learner can tick. Its
  // paragraph is hidden, as in a tight list, so the item's text can sit inside the label.
  md.core.ruler.push('step_card_checklist', (state) => {
    let before: number | null = null;
    for (const token of state.tokens) {
      const container = CONTAINER_TOKENS.get(token.type);
      if (container?.name === 'before') before = container.edge === 'open' ? token.level : null;
      else if (before === null) continue;
      else if (token.type.startsWith('list_item_') && token.level === before + 2) token.meta = { checklist: true };
      else if (token.type.startsWith('paragraph_') && token.level === before + 3) token.hidden = true;
    }
  });
  const listItemOpen = rules.list_item_open;
  const listItemClose = rules.list_item_close;
  rules.list_item_open = (tokens, idx, options, env, self) => {
    if (tokens[idx].meta?.checklist) return '<li><label><input type="checkbox"> <span>';
    return listItemOpen ? listItemOpen(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
  };
  rules.list_item_close = (tokens, idx, options, env, self) => {
    if (tokens[idx].meta?.checklist) return '</span></label></li>\n';
    return listItemClose ? listItemClose(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
  };
}

interface Slot {
  name: SlotName;
  info: string;
  /** The level of the slot's opening token. */
  level: number;
  /** The source lines from the slot's opening line to its closing `:::`. */
  lines: [number, number] | null;
  /** The slot's direct children, opening and self-contained block tokens only. */
  children: Token[];
  /** Every token inside the slot. */
  tokens: Token[];
}

interface Step {
  number: number;
  /** The text of the `##` heading the step opens with, if it opens with one. */
  heading: string | null;
  title: string | null;
  slots: Slot[];
  /** Steps and slots opened inside this step anywhere but as its direct children. */
  misplaced: number;
}

interface PagePart {
  name: PagePartName;
  /** How many steps open before it on the page. */
  stepsBefore: number;
  /** The part's direct children, opening and self-contained block tokens only. */
  children: Token[];
  /** Every token inside the part. */
  tokens: Token[];
}

interface Page {
  steps: Step[];
  /** The page parts outside every step and every other container. */
  parts: PagePart[];
  /** How many steps open before each "You'll learn" line. */
  learnLines: number[];
  /** Slots and page parts opened outside every step, anywhere they don't belong. */
  misplaced: number;
  /** The `src` of every image inside a step. */
  stepImages: string[];
}

function readPage(tokens: Token[]): Page {
  const page: Page = { steps: [], parts: [], learnLines: [], misplaced: 0, stepImages: [] };
  let step: Step | null = null;
  let stepLevel = 0;
  let slot: Slot | null = null;
  let part: PagePart | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const container = CONTAINER_TOKENS.get(token.type);
    const opened = container?.edge === 'open' ? container.name : undefined;
    if (step && token.type === 'inline') page.stepImages.push(...imagesIn(token).map((image) => image.attrGet('src') ?? ''));
    if (part) {
      if (container?.name === part.name && container.edge === 'close' && token.level === 0) {
        part = null;
      } else if (opened) {
        page.misplaced++;
      } else {
        part.tokens.push(token);
        if (token.level === 1 && token.nesting !== -1) part.children.push(token);
      }
    } else if (!step) {
      if (opened === 'step') {
        const heading = tokens[i + 1].tag === 'h2' && tokens[i + 1].nesting === 1 ? tokens[i + 2].content : null;
        step = { number: page.steps.length + 1, heading, title: null, slots: [], misplaced: 0 };
        step.title = heading?.replace(/^\d+\.\s*/, '') ?? null;
        stepLevel = token.level;
        page.steps.push(step);
      } else if (opened && isPagePart(opened) && token.level === 0) {
        part = { name: opened, stepsBefore: page.steps.length, children: [], tokens: [] };
        page.parts.push(part);
      } else if (opened) {
        page.misplaced++;
      } else if (token.type === 'paragraph_open' && token.level === 0 && /^\*\*You['’]ll learn:\*\*\s+\S/.test(tokens[i + 1].content)) {
        page.learnLines.push(page.steps.length);
      }
    } else if (container?.name === 'step' && container.edge === 'close' && token.level === stepLevel) {
      step = null;
    } else if (token.level === stepLevel + 1) {
      if (opened && isSlot(opened)) {
        slot = { name: opened, info: token.info, level: token.level, lines: token.map, children: [], tokens: [] };
        step.slots.push(slot);
      } else if (opened) {
        step.misplaced++;
      } else if (container?.edge === 'close') {
        slot = null;
      }
    } else if (opened) {
      step.misplaced++;
    } else if (slot) {
      slot.tokens.push(token);
      if (token.level === stepLevel + 2 && token.nesting !== -1) slot.children.push(token);
    }
  }
  return page;
}

function imagesIn(inline: Token): Token[] {
  return (inline.children ?? []).filter((child) => child.type === 'image');
}

/** The image a You should see slot holds when it holds one paragraph of one image and nothing else. */
function seeImage(slot: Slot): Token | null {
  const [paragraph, inline] = slot.tokens;
  if (slot.children.length !== 1 || paragraph.type !== 'paragraph_open') return null;
  const parts = (inline.children ?? []).filter((child) => child.type !== 'softbreak' && !(child.type === 'text' && child.content.trim() === ''));
  return parts.length === 1 && parts[0].type === 'image' ? parts[0] : null;
}

/** The file a `./<file>` image names in the page's own folder, or null for a path anywhere else. */
function folderFile(src: string): string | null {
  return /^\.\/([^/\\]+)$/.exec(src)?.[1] ?? null;
}

/**
 * The items a container holds, as written: each list item's first paragraph, or each paragraph
 * outside a list. `level` is the level of the container's direct children.
 */
function itemsOf(tokens: Token[], level: number): string[] {
  const items: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const { type, level: at } = tokens[i];
    const item = type === 'list_item_open' && at === level + 1 && tokens[i + 1]?.type === 'paragraph_open';
    const paragraph = type === 'paragraph_open' && at === level;
    if (item || paragraph) items.push(tokens[i + (item ? 2 : 1)].content.replace(/\s*\n\s*/g, ' '));
  }
  return items;
}

/** What a test run checks off on a tutorial page, read from its step cards. */
export interface StepCardRecord {
  /** The page's `#` heading. */
  title: string | null;
  /** The Before you start items. */
  before: string[];
  steps: { number: number; title: string | null; must: string[]; ifnots: string[] }[];
  /** The You're done when items, without a leading ✅. */
  done: string[];
  /** The Do and Paste slots in page order: what the learner and the agents do. */
  actions: { step: number; slot: 'do' | 'paste'; info: string; source: string }[];
}

/**
 * Reads a tutorial page's step cards for its test-run record. `tokens` come from a renderer with
 * the step-card containers registered, and `src` is the markdown they were parsed from. A slot's
 * source is its lines between the opener and the closing `:::`, line endings as `\n`, with
 * trailing spaces and the blank lines around it removed.
 */
export function readStepCardRecord(tokens: Token[], src: string): StepCardRecord {
  const page = readPage(tokens);
  const lines = src.split(/\r?\n/);
  const h1 = tokens.findIndex((token) => token.type === 'heading_open' && token.tag === 'h1');
  const before = page.parts.find((part) => part.name === 'before');
  const slotsOf = (step: Step, name: SlotName) => step.slots.filter((slot) => slot.name === name);
  const slotItems = (step: Step, name: SlotName) => slotsOf(step, name).flatMap((slot) => itemsOf(slot.tokens, slot.level + 1));
  return {
    title: h1 === -1 ? null : tokens[h1 + 1].content,
    before: before ? itemsOf(before.tokens, 1) : [],
    steps: page.steps.map((step) => ({
      number: step.number,
      title: step.title,
      must: slotItems(step, 'must'),
      ifnots: slotsOf(step, 'ifnot').map((slot) => slot.info),
    })),
    done: page.steps.flatMap((step) => slotItems(step, 'done')).map((item) => item.replace(/^✅\s*/, '')),
    actions: page.steps.flatMap((step) =>
      step.slots.flatMap((slot) => {
        if (slot.name !== 'do' && slot.name !== 'paste') return [];
        const [open, close] = slot.lines ?? [0, 0];
        const source = lines.slice(open + 1, close).map((line) => line.trimEnd()).join('\n').replace(/^\n+|\n+$/g, '');
        return [{ step: step.number, slot: slot.name, info: slot.info, source }];
      }),
    ),
  };
}

/** A glance tile's bold label and the value after it, or null for an item that isn't a tile. */
function readTile(inline: Token): { name: string; value: string | null } | null {
  const tile = /^\*\*([^*]+)\*\*(?:\s+(\S[\s\S]*))?$/.exec(inline.content);
  return tile && { name: tile[1], value: tile[2] ?? null };
}

/** Whether a page uses the step-card containers, which makes it a tutorial page. */
export function usesStepCards(tokens: Token[]): boolean {
  return tokens.some((token) => CONTAINER_TOKENS.has(token.type));
}

/** The inline token holding a tile of the page's glance strip, or null when the strip has no such tile. */
export function glanceTile(tokens: Token[], name: GlanceTile): Token | null {
  const glance = readPage(tokens).parts.find((part) => part.name === 'glance');
  return glance?.tokens.find((token) => token.type === 'inline' && readTile(token)?.name === name) ?? null;
}

/** Checks the page parts around the steps: the glance strip, You'll learn, Before you start and Next up. */
function checkPageParts({ steps, parts, learnLines }: Page): StepCardRule[] {
  const broken: StepCardRule[] = [];
  const only = (name: PagePartName, where: (stepsBefore: number) => boolean) => {
    const found = parts.filter((part) => part.name === name);
    return found.length === 1 && where(found[0].stepsBefore) ? found[0] : null;
  };
  const beforeSteps = (stepsBefore: number) => stepsBefore === 0;
  const isList = (children: Token[]) => children.length === 1 && children[0].type === 'bullet_list_open';

  const glance = only('glance', beforeSteps);
  const tiles = (glance?.tokens ?? []).filter((token) => token.type === 'inline').map(readTile);
  if (!glance || !isList(glance.children) || tiles.map((tile) => tile?.name).join() !== GLANCE_TILES.join()) {
    broken.push('glance');
  } else {
    const generated = (name: string) => (GENERATED_TILES as readonly string[]).includes(name);
    if (tiles.some((tile) => tile !== null && generated(tile.name) !== (tile.value === null))) broken.push('glance-generated');
    const level = tiles[GLANCE_TILES.indexOf('Level')]?.value ?? null;
    if (level !== null && !LEVELS.includes(level)) broken.push('glance-level');
  }

  if (!learnLines.some(beforeSteps)) broken.push('you-will-learn');

  const before = only('before', beforeSteps);
  const [heading, list] = before?.children ?? [];
  if (before?.children.length !== 2 || heading.tag !== 'h2' || before.tokens[1].content !== BEFORE_YOU_START || !isList([list])) {
    broken.push('before-you-start');
  }

  const next = only('next', (stepsBefore) => stepsBefore === steps.length && steps.length > 0);
  const link = next?.children[0]?.type === 'paragraph_open' ? next.tokens[1].children ?? [] : [];
  if (!next || link[0]?.type !== 'link_open' || link.at(-1)?.type !== 'link_close' || link.filter((token) => token.type === 'link_open').length !== 1) {
    broken.push('next-up');
  }
  return broken;
}

export function checkStepCards(tokens: Token[]): StepCardViolation[] {
  const violations: StepCardViolation[] = [];
  const page = readPage(tokens);
  const { steps, misplaced } = page;
  const headings = tokens.flatMap((token, i) => (token.type === 'heading_open' ? [{ tag: token.tag, text: tokens[i + 1].content }] : []));
  if (!/^(Swarm|A2A) [1-9]\d*: \S/.test(headings.find((heading) => heading.tag === 'h1')?.text ?? '')) {
    violations.push({ rule: 'page-title', step: null, title: null });
  }
  if (headings.some((heading) => /troubleshooting/i.test(heading.text))) {
    violations.push({ rule: 'no-troubleshooting', step: null, title: null });
  }
  for (const rule of checkPageParts(page)) violations.push({ rule, step: null, title: null });
  if (steps.length > 0 && steps[0].title !== 'Get the starter project') {
    violations.push({ rule: 'first-step', step: 1, title: steps[0].title });
  }
  for (let i = 0; i < misplaced; i++) violations.push({ rule: 'slot-in-step', step: null, title: null });
  for (const step of steps) {
    const has = (name: SlotName) => step.slots.some((slot) => slot.name === name);
    const broke = (rule: StepCardRule) => violations.push({ rule, step: step.number, title: step.title });
    const last = step.number === steps.length;
    if (!new RegExp(`^${step.number}\\.\\s+\\S`).test(step.heading ?? '')) broke('step-heading');
    for (let i = 0; i < step.misplaced; i++) broke('slot-in-step');
    const order = step.slots.map((slot) => SLOTS.indexOf(slot.name));
    if (order.some((at, i) => i > 0 && (at < order[i - 1] || (at === order[i - 1] && SLOTS[at] !== 'ifnot')))) {
      broke('slot-order');
    }
    if (!has('do') && !has('paste')) broke('do-or-paste');
    if (!has('see')) broke('see-required');
    for (const see of step.slots.filter((slot) => slot.name === 'see')) {
      const image = seeImage(see);
      const number = SHOT.exec(image?.attrGet('src') ?? '')?.[1];
      if (!image || Number(number) !== step.number || image.content.trim() === '') broke('see-image');
    }
    if (has('must') !== has('may')) broke('must-may-pair');
    // A Paste slot hands a prompt to an agent, or to a peer through a Quay field, so its step shows
    // agent output. The check can't see output from a step with only Do.
    else if (has('paste') && !has('must')) broke('must-may-agent-output');
    for (const paste of step.slots.filter((slot) => slot.name === 'paste')) {
      if (paste.info === '') broke('paste-target');
      const [prompt, ...rest] = paste.children;
      if (prompt?.type !== 'fence' || rest.length > 0 || !/^[^\n]+\n?$/.test(prompt.content)) {
        broke('paste-one-prompt');
      }
    }
    if (step.slots.some((slot) => slot.name === 'ifnot' && slot.info === '')) broke('ifnot-symptom');
    if (last && !has('done')) broke('done-required');
    if (!last && has('done')) broke('done-last-only');
  }
  return violations;
}

/**
 * Checks a tutorial page against the files in its folder: each You should see image is there,
 * every image there is named by a step card, each clip has its still, and there is at most one clip.
 */
export function checkTutorialFolder(tokens: Token[], files: string[]): StepCardViolation[] {
  const violations: StepCardViolation[] = [];
  const page = readPage(tokens);
  const present = new Set(files);
  for (const step of page.steps) {
    for (const see of step.slots.filter((slot) => slot.name === 'see')) {
      for (const inline of see.tokens.filter((token) => token.type === 'inline')) {
        for (const image of imagesIn(inline)) {
          const file = folderFile(image.attrGet('src') ?? '');
          if (file !== null && !present.has(file)) {
            violations.push({ rule: 'image-exists', step: step.number, title: step.title, files: [file] });
          }
        }
      }
    }
  }
  const named = new Set(page.stepImages.map(folderFile));
  const sorted = [...files].sort();
  for (const file of sorted.filter((file) => IMAGE_FILE.test(file) && !named.has(file))) {
    violations.push({ rule: 'orphan-image', step: null, title: null, files: [file] });
  }
  const clips = sorted.filter((file) => CLIP_FILE.test(file));
  for (const clip of clips.filter((clip) => !present.has(clip.replace(CLIP_FILE, '.webp')))) {
    violations.push({ rule: 'clip-still', step: null, title: null, files: [clip] });
  }
  if (clips.length > 1) violations.push({ rule: 'one-clip', step: null, title: null, files: clips });
  return violations;
}

/**
 * Reads `QUAY_RELEASE_VERSION`, which the release flow sets to the version it is releasing, as
 * `0.3.0` or `v0.3.0`. Unset, it returns null and the build skips the release checks.
 */
export function parseReleaseVersion(value: string | undefined): string | null {
  if (value === undefined) return null;
  const version = VERSION.exec(value)?.[1];
  if (version === undefined) {
    throw new Error(`QUAY_RELEASE_VERSION must be the version being released, such as 0.3.0 or v0.3.0, not ${JSON.stringify(value)}`);
  }
  return version;
}

/** The Quay version a sidecar manifest records as `quayVersion`, or null when it records none. */
function sidecarQuayVersion(json: string): string | null {
  let sidecar: unknown;
  try {
    sidecar = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof sidecar !== 'object' || sidecar === null || !Object.hasOwn(sidecar, 'quayVersion')) return null;
  const { quayVersion } = sidecar as { quayVersion: unknown };
  return typeof quayVersion === 'string' ? (VERSION.exec(quayVersion)?.[1] ?? null) : null;
}

/** Checks that the tutorial at `relativePath` has a sidecar manifest recording `release` as its captured Quay version. */
function checkReleaseSidecar(relativePath: string, sidecars: string, release: string): StepCardViolation[] {
  const broken = { rule: 'release-sidecar', step: null, title: null } as const;
  const slug = tutorialSlugOf(relativePath);
  if (slug === null) return [broken];
  let sidecar: string | null;
  try {
    sidecar = readFileSync(join(sidecars, slug, 'sidecar.json'), 'utf8');
  } catch {
    sidecar = null;
  }
  return sidecar !== null && sidecarQuayVersion(sidecar) === release ? [] : [{ ...broken, files: [`examples/tutorials/${slug}/sidecar.json`] }];
}

export function formatStepCardViolations(file: string, violations: StepCardViolation[]): string {
  const lines = violations.map(({ rule, step, title, files = [] }) => {
    const at = step === null ? [] : [title === null ? `step ${step}` : `step ${step} "${title}"`];
    const where = [...at, ...files].join(', ') || 'page';
    return `  ${where}: ${STEP_CARD_RULES[rule]} (${rule})`;
  });
  return `${file} breaks the step-card rules:\n${lines.join('\n')}`;
}

interface PageEnv {
  relativePath?: string;
  path?: string;
}

export interface StepCardOptions {
  /** The version the release flow is building, or null for an ordinary docs build. */
  release: string | null;
  /** The folder holding each tutorial's `<slug>/sidecar.json`. */
  sidecars: string;
}

/**
 * Registers the step-card containers and the checks. A page that uses any of the containers is
 * checked as a tutorial page, and one that breaks a rule fails to render, which fails
 * `docs:build`. Pages that use none of them render as before. The folder checks read the folder
 * of the page's `path`, which VitePress always passes; a page rendered without one skips them.
 */
export function stepCardsPlugin({ release, sidecars }: StepCardOptions): (md: MarkdownRenderer) => void {
  return (md) => {
    registerStepCardContainers(md);
    md.core.ruler.push('step_card_check', (state) => {
      if (!usesStepCards(state.tokens)) return;
      const env = state.env as PageEnv;
      const violations = checkStepCards(state.tokens);
      if (env.path) violations.push(...checkTutorialFolder(state.tokens, readdirSync(dirname(env.path))));
      if (release !== null) violations.push(...checkReleaseSidecar(env.relativePath ?? '', sidecars, release));
      if (violations.length > 0) {
        throw new Error(formatStepCardViolations(env.relativePath ?? env.path ?? 'A page', violations));
      }
    });
  };
}

/** The step-card plugin as the site uses it: the release flow sets `QUAY_RELEASE_VERSION`. */
export function stepCards(md: MarkdownRenderer): void {
  stepCardsPlugin({ release: parseReleaseVersion(process.env.QUAY_RELEASE_VERSION), sidecars: SIDECARS })(md);
}
