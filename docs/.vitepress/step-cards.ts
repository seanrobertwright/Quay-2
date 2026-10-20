import type { MarkdownRenderer } from 'vitepress';

type Token = ReturnType<MarkdownRenderer['parse']>[number];
type BlockRule = Parameters<MarkdownRenderer['block']['ruler']['before']>[2];

const SLOTS = ['do', 'paste', 'see', 'must', 'may', 'ifnot', 'done'] as const;
type SlotName = (typeof SLOTS)[number];
const CONTAINERS: readonly string[] = ['step', ...SLOTS];

export interface StepCardViolation {
  rule: string;
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

  const open = state.push(`container_${opener[2]}_open`, 'div', 1);
  open.markup = opener[1];
  open.block = true;
  open.info = opener[3] ?? '';
  open.map = [startLine, nextLine];
  state.md.block.tokenize(state, startLine + 1, nextLine);
  const close = state.push(`container_${opener[2]}_close`, 'div', -1);
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
}

interface Slot {
  name: SlotName;
  info: string;
}

interface Step {
  number: number;
  title: string | null;
  slots: Slot[];
}

function readSteps(tokens: Token[]): Step[] {
  const steps: Step[] = [];
  let step: Step | null = null;
  let stepLevel = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'container_step_open') {
      step = { number: steps.length + 1, title: null, slots: [] };
      stepLevel = token.level;
      steps.push(step);
    } else if (token.type === 'container_step_close') {
      step = null;
    } else if (step && token.level === stepLevel + 1) {
      if (token.type === 'heading_open' && step.title === null && step.slots.length === 0) {
        step.title = tokens[i + 1].content.replace(/^\d+\.\s*/, '');
      }
      const slot = /^container_([a-z]+)_open$/.exec(token.type);
      if (slot) step.slots.push({ name: slot[1] as SlotName, info: token.info });
    }
  }
  return steps;
}

export function checkStepCards(tokens: Token[]): StepCardViolation[] {
  const violations: StepCardViolation[] = [];
  const steps = readSteps(tokens);
  for (const step of steps) {
    const has = (name: SlotName) => step.slots.some((slot) => slot.name === name);
    const broke = (rule: string) => violations.push({ rule, step: step.number, title: step.title });
    const last = step.number === steps.length;
    if (!has('do') && !has('paste')) broke('do-or-paste');
    if (!has('see')) broke('see-required');
    if (has('must') !== has('may')) broke('must-may-pair');
    // A Paste slot hands a prompt to an agent, or to a peer through a Quay field, so its step shows
    // agent output. The check can't see output from a step with only Do.
    else if (has('paste') && !has('must')) broke('must-may-agent-output');
    if (last && !has('done')) broke('done-required');
    if (!last && has('done')) broke('done-last-only');
  }
  return violations;
}
