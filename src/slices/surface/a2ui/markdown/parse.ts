// The parser, with raw HTML off, and the bounds on what it is given.
import MarkdownIt, { type Token } from "markdown-it";
import { linkTarget } from "../../linkTarget.ts";

/** The most characters read as Markdown. */
const MOST_CHARACTERS = 20_000;

/** The deepest block read as Markdown. The parser drops what is nested past a hundred. */
const DEEPEST_BLOCK = 20;

const parser = new MarkdownIt({ html: false, linkify: false, typographer: false });
// An address stays as it was written, and an image is one whatever its address: what leads nowhere is drawn
// as a box that says so. A link is judged once it is read.
parser.normalizeLink = (href) => href;
parser.validateLink = () => true;

/** What a refused link's opening and closing tokens are drawn as: how it would be written, with its address in it. */
function linkText(open: Token): [before: string, after: string] {
  if (open.markup === "autolink") return ["<", ">"];
  const title = open.attrGet("title");
  return ["[", `](${open.attrGet("href")}${title === null ? "" : ` "${title}"`})`];
}

// A link to what Quay does not open is no link but text.
parser.core.ruler.push("refused_links", ({ tokens, Token: TokenOf }) => {
  for (const token of tokens) {
    // What each link that is open ends in, or null for one that stays a link
    const open: (string | null)[] = [];
    const shownOf = (child: Token): string | null => {
      if (child.type === "link_close") return open.pop() ?? null;
      if (child.type !== "link_open") return null;
      const href = String(child.attrGet("href"));
      const [before, after] = href === "" || linkTarget(href) ? [null, null] : linkText(child);
      open.push(after);
      return before;
    };
    token.children &&= token.children.map((child) => {
      const content = shownOf(child);
      return content === null ? child : Object.assign(new TokenOf("text", "", 0), { content });
    });
  }
});

/** What `tokens` read as, without their formatting. */
const textOf = (tokens: readonly Token[]): string =>
  tokens.map(({ type, content, children }) => (type === "image" ? textOf(children ?? []) : type.endsWith("break") ? "\n" : content)).join("");

/** What an image's token names: an address, and the image's text. */
export const imageOf = (token: Token): { src: string; name: string } => ({
  src: String(token.attrGet("src") ?? ""),
  name: textOf(token.children ?? []).trim(),
});

/** Whether `text` is over the limit, counted in characters as the limit is. */
const isTooLong = (text: string) => text.length > MOST_CHARACTERS && [...text].length > MOST_CHARACTERS;

/** Whether the last three tokens are a body cell with nothing in it. */
const endsInEmptyCell = (tokens: readonly Token[]) =>
  tokens[tokens.length - 1]?.type === "td_close" && tokens[tokens.length - 2]?.content === "" && tokens[tokens.length - 3]?.type === "td_open";

/**
 * `tokens` without the empty cells at the end of a row: the parser fills every row up to the header's
 * width, which a short text can make thousands of cells.
 */
function withoutFilledCells(tokens: readonly Token[]): Token[] {
  const kept: Token[] = [];
  for (const token of tokens) {
    if (token.type === "tr_close") while (endsInEmptyCell(kept)) kept.length -= 3;
    kept.push(token);
  }
  return kept;
}

/** The tokens of `text`, blocks and what is in them in one list, or null when it is past a bound. */
export function blockTokens(text: string): Token[] | null {
  if (isTooLong(text)) return null;
  const tokens = parser.parse(text, {});
  if (tokens.some(({ level }) => level > DEEPEST_BLOCK)) return null;
  return withoutFilledCells(tokens).flatMap((token) => (token.type === "inline" ? (token.children ?? []) : token));
}

/** The tokens of `text` read as inline formatting alone, or null when it is past a bound. */
export const inlineTokens = (text: string): Token[] | null =>
  isTooLong(text) ? null : parser.parseInline(text, {}).flatMap(({ children }) => children ?? []);
