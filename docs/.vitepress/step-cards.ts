import type { MarkdownRenderer } from 'vitepress';

type Token = ReturnType<MarkdownRenderer['parse']>[number];
type BlockRule = Parameters<MarkdownRenderer['block']['ruler']['before']>[2];

const SLOTS = ['do', 'paste', 'see', 'must', 'may', 'ifnot', 'done'] as const;
type SlotName = (typeof SLOTS)[number];
const CONTAINERS: readonly string[] = ['step', ...SLOTS];

/** Each rule a tutorial page must follow, as the build reports it when broken. */
export const STEP_CARD_RULES = {
  'page-title': 'the title reads <Series> <n>: <Title>, for example "A2A 1: Hello, A2A"',
  'first-step': 'step 1 is "Get the starter project"',
  'no-troubleshooting': "there is no troubleshooting section; each fix is an If not in the step it belongs to",
  'slot-in-step': 'slots sit directly inside a step, and steps do not nest',
  'step-heading': 'each step opens with its numbered heading, "## <n>. <Title>"',
  'slot-order': "a step's slots come once each, in the order Do, Paste, You should see, Must match, May differ, If not, You're done when; only If not may repeat",
  'do-or-paste': 'every step has Do, Paste, or both',
  'paste-target': 'Paste names the pane or Quay field it goes into, as in "::: paste Mission Control"',
  'paste-one-prompt': 'Paste holds one copy-paste prompt: a single fenced code block of one line',
  'see-required': 'You should see is required',
  'must-may-pair': 'Must match and May differ come as both or neither',
  'must-may-agent-output': 'Must match and May differ are required on any step with agent output, which is any step with Paste',
  'ifnot-symptom': 'If not names the symptom it fixes, as in "::: ifnot asker says it has no quay tools"',
  'done-required': "You're done when is required on the last step",
  'done-last-only': "You're done when is on the last step only",
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
  if (!opener || !CONTAINERS.includes(opener[2])) return false;
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

  const open = state.push(`step_card_${opener[2]}_open`, 'div', 1);
  open.markup = opener[1];
  open.block = true;
  open.info = opener[3] ?? '';
  open.map = [startLine, nextLine];
  state.md.block.tokenize(state, startLine + 1, nextLine);
  const close = state.push(`step_card_${opener[2]}_close`, 'div', -1);
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

const LABELS: Record<Exclude<SlotName, 'ifnot'>, string> = {
  do: 'Do',
  paste: 'Paste into',
  see: 'You should see',
  must: 'Must match',
  may: 'May differ',
  done: 'You’re done when',
};

export function registerStepCardContainers(md: MarkdownRenderer): void {
  md.block.ruler.before('fence', 'step_card_containers', containerRule, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
  const rules = md.renderer.rules;

  rules.step_card_step_open = (tokens, idx) => {
    const later = tokens.slice(idx + 1).some((token) => token.type === 'step_card_step_open' && token.level === tokens[idx].level);
    return `<section class="step-card${later ? '' : ' step-card--last'}">\n`;
  };
  rules.step_card_step_close = () => '</section>\n';

  for (const slot of SLOTS) {
    if (slot === 'ifnot') continue;
    rules[`step_card_${slot}_open`] = (tokens, idx) => {
      const info = tokens[idx].info;
      const label = slot === 'paste' && info !== '' ? `${LABELS.paste} ${md.renderInline(info)}` : LABELS[slot];
      return `<div class="step-card__slot step-card__slot--${slot}"><p class="step-card__label">${label}</p>\n`;
    };
    rules[`step_card_${slot}_close`] = () => '</div>\n';
  }

  rules.step_card_ifnot_open = (tokens, idx) =>
    `<details class="details custom-block step-card__ifnot"><summary>If not: ${md.renderInline(tokens[idx].info)}</summary>\n`;
  rules.step_card_ifnot_close = () => '</details>\n';
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

interface Page {
  steps: Step[];
  /** Slots opened outside every step. */
  misplaced: number;
}

function readPage(tokens: Token[]): Page {
  const page: Page = { steps: [], misplaced: 0 };
  let step: Step | null = null;
  let stepLevel = 0;
  let slot: Slot | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const opened = /^step_card_([a-z]+)_open$/.exec(token.type)?.[1];
    if (!step) {
      if (opened === 'step') {
        const heading = tokens[i + 1].tag === 'h2' && tokens[i + 1].nesting === 1 ? tokens[i + 2].content : null;
        step = { number: page.steps.length + 1, heading, title: null, slots: [], misplaced: 0 };
        step.title = heading?.replace(/^\d+\.\s*/, '') ?? null;
        stepLevel = token.level;
        page.steps.push(step);
      } else if (opened) {
        page.misplaced++;
      }
    } else if (token.type === 'step_card_step_close' && token.level === stepLevel) {
      step = null;
    } else if (token.level === stepLevel + 1) {
      if (opened === 'step') {
        step.misplaced++;
      } else if (opened) {
        slot = { name: opened as SlotName, info: token.info, children: [] };
        step.slots.push(slot);
      } else if (/^step_card_[a-z]+_close$/.test(token.type)) {
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

export function checkStepCards(tokens: Token[]): StepCardViolation[] {
  const violations: StepCardViolation[] = [];
  const { steps, misplaced } = readPage(tokens);
  const headings = tokens.flatMap((token, i) => (token.type === 'heading_open' ? [{ tag: token.tag, text: tokens[i + 1].content }] : []));
  if (!/^(Swarm|A2A) [1-9]\d*: \S/.test(headings.find((heading) => heading.tag === 'h1')?.text ?? '')) {
    violations.push({ rule: 'page-title', step: null, title: null });
  }
  if (headings.some((heading) => /troubleshooting/i.test(heading.text))) {
    violations.push({ rule: 'no-troubleshooting', step: null, title: null });
  }
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
    if (!state.tokens.some((token) => token.type.startsWith('step_card_'))) return;
    const violations = checkStepCards(state.tokens);
    if (violations.length > 0) {
      const env = state.env as { relativePath?: string; path?: string };
      throw new Error(formatStepCardViolations(env.relativePath ?? env.path ?? 'A page', violations));
    }
  });
}
