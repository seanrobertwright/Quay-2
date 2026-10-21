// The fresh-eyes read of a tutorial page. The page is built, its text, screenshots and alt text are
// extracted from the built HTML, and only those go to a new agent with the brief beside this file.
// Everything here is pure; read.ts does the building, the files and the agent process.

interface Element {
  tag: string;
  attrs: Map<string, string>;
  children: Node[];
}
type Node = Element | string;

export interface PageImage {
  /** The image's position among the page's images, counting from 1. */
  n: number;
  kind: 'screenshot' | 'clip';
  /** The step the image is in, or null when it is outside every step. */
  step: number | null;
  alt: string;
  /** The image's src, or a clip's poster: the still the reader is shown. Empty when there is none. */
  src: string;
}

export interface PageStep {
  number: number;
  /** The step's heading without its number, as markdown, or null when it has no heading. */
  title: string | null;
  /** The step's text, from its heading to its last slot. */
  text: string;
}

export interface ExtractedPage {
  /** The whole page as markdown, with a placeholder where each image sits. */
  text: string;
  steps: PageStep[];
  images: PageImage[];
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title']);
const SKIPPED_TAGS = new Set(['button', 'script', 'style', 'svg', 'template', 'noscript', 'head']);
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'details', 'dialog', 'div', 'dl', 'figcaption', 'figure', 'footer', 'form',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tr', 'ul',
]);

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', times: '×' };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (entity, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return Object.hasOwn(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : entity;
  });
}

function parseAttributes(source: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const [, name, double, single, bare] of source.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    attrs.set(name.toLowerCase(), decodeEntities(double ?? single ?? bare ?? ''));
  }
  return attrs;
}

// Enough of an HTML parser for the pages VitePress builds: they are well formed, so a close tag
// closes the nearest open element of its name, and anything left open closes with its parent.
function parseHtml(html: string): Element {
  const root: Element = { tag: '#root', attrs: new Map(), children: [] };
  const open = [root];
  const lowered = html.toLowerCase();
  const tag = /<!--[\s\S]*?-->|<![^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;
  let at = 0;
  const text = (end: number) => {
    if (end > at) open[open.length - 1].children.push(decodeEntities(html.slice(at, end)));
  };
  for (let match = tag.exec(html); match; match = tag.exec(html)) {
    text(match.index);
    at = tag.lastIndex;
    const [, closing, opening, attributes, selfClosing] = match;
    if (closing) {
      const index = open.findLastIndex((element) => element.tag === closing.toLowerCase());
      if (index > 0) open.length = index;
    } else if (opening) {
      const element: Element = { tag: opening.toLowerCase(), attrs: parseAttributes(attributes), children: [] };
      open[open.length - 1].children.push(element);
      if (RAW_TEXT_TAGS.has(element.tag)) {
        const end = lowered.indexOf(`</${element.tag}`, at);
        const stop = end === -1 ? html.length : end;
        element.children.push(html.slice(at, stop));
        at = tag.lastIndex = stop;
      } else if (!VOID_TAGS.has(element.tag) && !selfClosing) {
        open.push(element);
      }
    }
  }
  text(html.length);
  return root;
}

function hasClass(element: Element, name: string): boolean {
  return (element.attrs.get('class') ?? '').split(/\s+/).includes(name);
}

function findElement(node: Element, test: (element: Element) => boolean): Element | null {
  if (test(node)) return node;
  for (const child of node.children) {
    const found = typeof child === 'string' ? null : findElement(child, test);
    if (found) return found;
  }
  return null;
}

// What the page shows a sighted reader once, not twice: the copy button, the code block's language
// label and heading anchors are chrome, and a figure's caption is hidden from screen readers because
// it repeats the image's alt text, which the image placeholder already carries.
function isSkipped(element: Element): boolean {
  return (
    SKIPPED_TAGS.has(element.tag) ||
    hasClass(element, 'header-anchor') ||
    (element.tag === 'span' && hasClass(element, 'lang')) ||
    element.attrs.get('aria-hidden') === 'true'
  );
}

function textContent(node: Node): string {
  if (typeof node === 'string') return node;
  return isSkipped(node) ? '' : node.children.map(textContent).join('');
}

class PageReader {
  steps: PageStep[] = [];
  images: PageImage[] = [];
  private step: number | null = null;

  blocks(nodes: Node[]): string[] {
    const out: string[] = [];
    let inline: Node[] = [];
    const flush = () => {
      const text = this.inline(inline);
      if (text !== '') out.push(text);
      inline = [];
    };
    for (const node of nodes) {
      if (typeof node !== 'string' && BLOCK_TAGS.has(node.tag)) {
        flush();
        out.push(...this.block(node));
      } else {
        inline.push(node);
      }
    }
    flush();
    return out;
  }

  private block(element: Element): string[] {
    if (isSkipped(element)) return [];
    const heading = /^h([1-6])$/.exec(element.tag);
    if (heading) return [`${'#'.repeat(Number(heading[1]))} ${this.inline(element.children)}`];
    switch (element.tag) {
      case 'p':
        return this.blocks(element.children);
      // A summary heads a collapsed section; the section's contents follow it.
      case 'summary':
        return [`▸ ${this.inline(element.children)}`];
      case 'ul':
      case 'ol':
        return [this.list(element)];
      case 'pre':
        return [`\`\`\`\n${textContent(element).replace(/\n+$/, '')}\n\`\`\``];
      case 'blockquote':
        return [this.blocks(element.children).join('\n\n').replace(/^/gm, '> ')];
      case 'hr':
        return ['---'];
      case 'table':
        return [this.table(element)];
      case 'section':
        if (hasClass(element, 'step-card')) return this.stepCard(element);
    }
    return this.blocks(element.children);
  }

  private stepCard(element: Element): string[] {
    const number = this.steps.length + 1;
    this.step = number;
    const blocks = this.blocks(element.children);
    this.step = null;
    const heading = /^## (?:\d+\.\s+)?(.*)$/.exec(blocks[0] ?? '');
    this.steps.push({ number, title: heading?.[1] ?? null, text: blocks.join('\n\n') });
    return blocks;
  }

  private list(element: Element): string {
    const ordered = element.tag === 'ol';
    const start = Number.parseInt(element.attrs.get('start') ?? '1', 10);
    const items = element.children.filter((child): child is Element => typeof child !== 'string' && child.tag === 'li');
    return items
      .map((item, i) => {
        const marker = ordered ? `${(Number.isNaN(start) ? 1 : start) + i}. ` : '- ';
        const lines = this.blocks(item.children).join('\n').split('\n');
        return lines.map((line, j) => (j === 0 ? marker : ' '.repeat(marker.length)) + line).join('\n');
      })
      .join('\n');
  }

  private table(element: Element): string {
    const rows: string[] = [];
    const visit = (node: Element) => {
      if (node.tag === 'tr') {
        const cells = node.children.filter((child): child is Element => typeof child !== 'string' && (child.tag === 'td' || child.tag === 'th'));
        rows.push(`| ${cells.map((cell) => this.inline(cell.children)).join(' | ')} |`);
      } else {
        for (const child of node.children) if (typeof child !== 'string') visit(child);
      }
    };
    visit(element);
    return rows.join('\n');
  }

  private inline(nodes: Node[]): string {
    return nodes
      .map((node) => this.inlineNode(node))
      .join('')
      .split('\n')
      .map((line) => line.replace(/[ \t\r\f\v​]+/g, ' ').trim())
      .join('\n')
      .trim();
  }

  private inlineNode(node: Node): string {
    if (typeof node === 'string') return node.replace(/\s+/g, ' ');
    if (isSkipped(node)) return '';
    const inner = () => this.inline(node.children);
    switch (node.tag) {
      case 'code':
      case 'kbd':
        return `\`${textContent(node).replace(/\s+/g, ' ')}\``;
      case 'strong':
      case 'b':
        return `**${inner()}**`;
      case 'em':
      case 'i':
        return `*${inner()}*`;
      case 'a': {
        const href = node.attrs.get('href');
        return href ? `[${inner()}](${href})` : inner();
      }
      case 'br':
        return '\n';
      case 'input':
        return node.attrs.get('type') === 'checkbox' ? (node.attrs.has('checked') ? '[x]' : '[ ]') : '';
      case 'img':
        return this.image('screenshot', node.attrs.get('alt') ?? '', node.attrs.get('src') ?? '');
      case 'video':
        return this.image('clip', node.attrs.get('aria-label') ?? '', node.attrs.get('poster') ?? '');
    }
    return node.children.map((child) => this.inlineNode(child)).join('');
  }

  private image(kind: PageImage['kind'], alt: string, src: string): string {
    const n = this.images.length + 1;
    this.images.push({ n, kind, step: this.step, alt, src });
    const what = kind === 'clip' ? 'a video clip, shown to you as its still' : 'a screenshot';
    return alt === '' ? `[Image ${n}: ${what}, with no alt text]` : `[Image ${n}: ${what}. Alt text: "${alt}"]`;
  }
}

/**
 * Reads a page VitePress built: its content as markdown, each step's own text, and each screenshot
 * and clip with its step and alt text. Only the page's `.vp-doc` content is read, never the site's
 * navigation around it. Throws when the HTML has no such content.
 */
export function extractPage(html: string): ExtractedPage {
  const content = findElement(parseHtml(html), (element) => element.tag === 'div' && hasClass(element, 'vp-doc'));
  if (!content) throw new Error('The HTML has no .vp-doc content, so it is not a page VitePress built.');
  const reader = new PageReader();
  const text = reader.blocks(content.children).join('\n\n');
  return { text, steps: reader.steps, images: reader.images };
}

// The image types the reader can be shown.
const MEDIA_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const SHOWABLE_MEDIA_TYPES = new Set(Object.values(MEDIA_TYPES));

export type ImageSource =
  | { kind: 'data'; mediaType: string; data: string }
  /** `path` is relative to the built site's folder. */
  | { kind: 'file'; mediaType: string; path: string }
  | { kind: 'unshown'; reason: string };

/** Where the still for an image's `src` comes from, given the site's `base`, or why it can't be shown. */
export function imageSource(src: string, base: string): ImageSource {
  if (src === '') return { kind: 'unshown', reason: 'it has no still' };
  const data = /^data:([^;,]+)((?:;[^;,]*)*),(.*)$/s.exec(src);
  if (data) {
    const mediaType = data[1].toLowerCase();
    if (!SHOWABLE_MEDIA_TYPES.has(mediaType)) return { kind: 'unshown', reason: `an ${mediaType} data URI, which the reader cannot be shown` };
    if (!data[2].split(';').includes('base64')) return { kind: 'unshown', reason: `an ${mediaType} data URI that is not base64` };
    return { kind: 'data', mediaType, data: data[3] };
  }
  const outside: ImageSource = { kind: 'unshown', reason: 'it is not part of the built site' };
  if (!src.startsWith(base)) return outside;
  let path: string;
  try {
    path = decodeURIComponent(src.slice(base.length).split(/[?#]/)[0]);
  } catch {
    return outside;
  }
  if (path.split(/[/\\]/).some((segment) => segment === '..' || segment === '.' || segment === '')) return outside;
  const extension = /\.[^./]+$/.exec(path)?.[0].toLowerCase() ?? '';
  if (!Object.hasOwn(MEDIA_TYPES, extension)) return { kind: 'unshown', reason: `an ${extension || 'unknown'} image, which the reader cannot be shown` };
  return { kind: 'file', mediaType: MEDIA_TYPES[extension], path };
}

/** The four kinds of finding a fresh-eyes read reports, as the record names them. */
export const FINDING_KINDS = {
  'missing-prerequisite': 'a prerequisite missing from Before you start',
  'unnamed-control': "a control or pane the page doesn't name or show",
  'unexplained-term': "a term the page doesn't explain",
  'two-readings': 'an action open to two readings',
} as const;

export type FindingKind = keyof typeof FINDING_KINDS;

export interface Finding {
  kind: FindingKind;
  step: number;
  /** A line from the step, as the page has it. */
  quote: string;
  /** What a newcomer wouldn't know or couldn't tell, in the reader's words. */
  problem: string;
}

export const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: Object.keys(FINDING_KINDS) },
          step: { type: 'integer', minimum: 1 },
          quote: { type: 'string', minLength: 1 },
          problem: { type: 'string', minLength: 1 },
        },
        required: ['kind', 'step', 'quote', 'problem'],
        additionalProperties: false,
      },
    },
  },
  required: ['findings'],
  additionalProperties: false,
};

/** The `claude` arguments for a reader that has the brief as its whole system prompt and nothing to look at but its message. */
export function readerArgs({ briefPath, model }: { briefPath: string; model: string | null }): string[] {
  return [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    // No tools, so the reader can't open a file, run a command or search: it has the page it is handed.
    '--tools', '',
    // No user, project or local settings, so none of the maintainer's plugins, hooks or permissions.
    '--setting-sources', '',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--system-prompt-file', briefPath,
    '--json-schema', JSON.stringify(FINDINGS_SCHEMA),
    ...(model === null ? [] : ['--model', model]),
  ];
}

/** The reader's environment: no CLAUDE.md from any folder or the user's profile, and no auto-memory. */
export function readerEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' };
}

export type ShownImage = { n: number; kind: 'data'; mediaType: string; data: string } | { n: number; kind: 'unshown'; reason: string };

type ContentBlock = { type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

export interface ReaderMessage {
  type: 'user';
  message: { role: 'user'; content: ContentBlock[] };
}

/** The one message the reader gets: the page's text, then each image after a line naming it. */
export function readerMessage(page: ExtractedPage, images: ShownImage[]): ReaderMessage {
  const content: ContentBlock[] = [{ type: 'text', text: `Here is the tutorial page as text. Its images follow it, in order.\n\n${page.text}` }];
  for (const image of images) {
    if (image.kind === 'data') {
      content.push({ type: 'text', text: `Image ${image.n}:` }, { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } });
    } else {
      content.push({ type: 'text', text: `Image ${image.n} cannot be shown to you: ${image.reason}.` });
    }
  }
  return { type: 'user', message: { role: 'user', content } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseFindings(value: unknown): Finding[] {
  if (!isRecord(value) || !Array.isArray(value.findings)) throw new Error('The reader output has no findings list.');
  return value.findings.map((finding: unknown, i) => {
    const which = `The reader's finding ${i + 1}`;
    if (!isRecord(finding)) throw new Error(`${which} is not an object.`);
    const { kind, step, quote, problem } = finding;
    if (typeof kind !== 'string' || !Object.hasOwn(FINDING_KINDS, kind)) throw new Error(`${which} has an unknown kind: ${JSON.stringify(kind)}.`);
    if (typeof step !== 'number' || !Number.isInteger(step) || step < 1) throw new Error(`${which} has a step that is not a step number: ${JSON.stringify(step)}.`);
    if (typeof quote !== 'string' || quote.trim() === '') throw new Error(`${which} has an empty quote.`);
    if (typeof problem !== 'string' || problem.trim() === '') throw new Error(`${which} has an empty problem.`);
    return { kind: kind as FindingKind, step, quote: quote.trim(), problem: problem.trim() };
  });
}

// The model that did the reading: the one that wrote the most output.
function readingModel(usage: unknown): string | null {
  if (!isRecord(usage)) return null;
  let best: { model: string; tokens: number } | null = null;
  for (const [model, entry] of Object.entries(usage)) {
    const tokens = isRecord(entry) && typeof entry.outputTokens === 'number' ? entry.outputTokens : -1;
    if (tokens >= 0 && (best === null || tokens > best.tokens)) best = { model, tokens };
  }
  return best?.model ?? null;
}

/** The findings, and the model that read the page, from the reader's stream-json output. Throws when the read failed. */
export function parseReaderOutput(stdout: string): { findings: Finding[]; model: string | null } {
  let result: Record<string, unknown> | null = null;
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const event: unknown = JSON.parse(line);
      if (isRecord(event) && event.type === 'result') result = event;
    } catch {
      // A line that isn't JSON is the CLI's own message, not an event.
    }
  }
  if (result === null) throw new Error('The reader printed no result, so its read did not finish.');
  if (result.is_error !== false || result.subtype !== 'success') {
    const reason = typeof result.result === 'string' && result.result !== '' ? result.result : String(result.subtype);
    throw new Error(`The reader failed: ${reason}`);
  }
  return { findings: parseFindings(result.structured_output), model: readingModel(result.modelUsage) };
}

export interface CheckedFinding extends Finding {
  /** The step's title, or null when the page has no such step or the step has no heading. */
  title: string | null;
  stepFound: boolean;
  /** Whether the quote is in the step's text. */
  onPage: boolean;
}

// Compares a quote with the page as text, so a reader that drops markdown marks or straightens
// quotes still matches the line it quoted.
function comparable(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[*`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ties each finding to its step and checks its quote is in that step, in the reader's order. */
export function checkFindings(page: ExtractedPage, findings: Finding[]): CheckedFinding[] {
  return findings.map((finding) => {
    const step = page.steps.find((candidate) => candidate.number === finding.step);
    return {
      ...finding,
      title: step?.title ?? null,
      stepFound: step !== undefined,
      onPage: step !== undefined && comparable(step.text).includes(comparable(finding.quote)),
    };
  });
}

function indented(text: string, prefix: string): string[] {
  return text.split('\n').map((line) => `${prefix}${line}`);
}

/**
 * The findings as a section for the run's record, in step order. Each finding names its step and
 * kind, quotes its line and ends in an empty Outcome for the maintainer: fixed, or dismissed with a
 * reason. A quote that isn't in its step is kept and marked, never dropped.
 */
export function formatFindings(read: {
  page: string;
  commit: string;
  dirty: boolean;
  model: string | null;
  findings: CheckedFinding[];
  unshown: { n: number; reason: string }[];
}): string {
  const by = read.model === null ? '' : `by \`${read.model}\` `;
  const changes = read.dirty ? ', with uncommitted changes' : '';
  const lines = [
    '### Fresh-eyes findings',
    '',
    `Read ${by}from \`${read.page}\` as built at \`${read.commit}\`${changes}. Mark each finding fixed, or dismissed with a reason.`,
    '',
  ];
  if (read.unshown.length > 0) {
    lines.push(`Not shown to the reader: ${read.unshown.map(({ n, reason }) => `image ${n} (${reason})`).join(', ')}.`, '');
  }
  if (read.findings.length === 0) lines.push('No findings.');
  const inStepOrder = read.findings.toSorted((a, b) => a.step - b.step);
  inStepOrder.forEach((finding, i) => {
    const where = finding.title === null ? `Step ${finding.step}` : `Step ${finding.step}, ${finding.title}`;
    lines.push(`${i + 1}. **${where}: ${FINDING_KINDS[finding.kind]}.**`, ...indented(finding.quote, '   > '), '');
    if (!finding.stepFound) lines.push(`   The page has no step ${finding.step}, so check where this belongs.`, '');
    else if (!finding.onPage) lines.push(`   This quote is not in step ${finding.step}, so check where it belongs.`, '');
    lines.push(...indented(finding.problem, '   '), '', '   Outcome:');
  });
  lines.push('');
  return lines.join('\n');
}
