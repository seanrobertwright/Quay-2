import type { MarkdownRenderer } from 'vitepress';

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

const GLANCE_TILES = ['Time', 'Tokens', 'Agents', 'Level'];
const LEVELS = ['Starter', 'Intermediate', 'Advanced'];
const BEFORE_YOU_START = 'Before you start';
const NEXT_UP = 'Next up';

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
  glance: `an at-a-glance strip comes before step 1: "::: glance" holding one list of the tiles ${GLANCE_TILES.map((tile) => `**${tile}**`).join(', ')}, in that order, each followed by its value`,
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
  /** The slot's direct children, opening and self-contained block tokens only. */
  children: Token[];
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
}

function readPage(tokens: Token[]): Page {
  const page: Page = { steps: [], parts: [], learnLines: [], misplaced: 0 };
  let step: Step | null = null;
  let stepLevel = 0;
  let slot: Slot | null = null;
  let part: PagePart | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const container = CONTAINER_TOKENS.get(token.type);
    const opened = container?.edge === 'open' ? container.name : undefined;
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
        slot = { name: opened, info: token.info, children: [] };
        step.slots.push(slot);
      } else if (opened) {
        step.misplaced++;
      } else if (container?.edge === 'close') {
        slot = null;
      }
    } else if (opened) {
      step.misplaced++;
    } else if (slot && token.level === stepLevel + 2 && token.nesting !== -1) {
      slot.children.push(token);
    }
  }
  return page;
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
  const tiles = (glance?.tokens ?? [])
    .filter((token) => token.type === 'inline')
    .map((token) => /^\*\*([^*]+)\*\*\s+(\S.*)$/.exec(token.content));
  if (!glance || !isList(glance.children) || tiles.map((tile) => tile?.[1]).join() !== GLANCE_TILES.join()) {
    broken.push('glance');
  } else if (!LEVELS.includes(tiles[GLANCE_TILES.indexOf('Level')]?.[2] ?? '')) {
    broken.push('glance-level');
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

export function formatStepCardViolations(file: string, violations: StepCardViolation[]): string {
  const lines = violations.map(({ rule, step, title }) => {
    const where = step === null ? 'page' : title === null ? `step ${step}` : `step ${step} "${title}"`;
    return `  ${where}: ${STEP_CARD_RULES[rule]} (${rule})`;
  });
  return `${file} breaks the step-card rules:\n${lines.join('\n')}`;
}

/**
 * Registers the step-card containers and the slot check. A page that uses any of the containers
 * is checked as a tutorial page, and one that breaks a rule fails to render, which fails
 * `docs:build`. Pages that use none of them render as before.
 */
export function stepCards(md: MarkdownRenderer): void {
  registerStepCardContainers(md);
  md.core.ruler.push('step_card_check', (state) => {
    if (!state.tokens.some((token) => CONTAINER_TOKENS.has(token.type))) return;
    const violations = checkStepCards(state.tokens);
    if (violations.length > 0) {
      const env = state.env as { relativePath?: string; path?: string };
      throw new Error(formatStepCardViolations(env.relativePath ?? env.path ?? 'A page', violations));
    }
  });
}
