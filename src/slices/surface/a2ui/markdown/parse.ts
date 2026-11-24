// The parser, with raw HTML off, and the bounds on what it is given.
import MarkdownIt, { type Token } from "markdown-it";
import { linkTarget } from "../../linkTarget.ts";

/** The most characters read as Markdown: a review's `body` at its limit. */
const MOST_CHARACTERS = 20_000;

/** The deepest block read as Markdown. The parser drops what is nested past a hundred. */
const DEEPEST_BLOCK = 20;

const parser = new MarkdownIt({ html: false, linkify: false, typographer: false });
// A link's address is judged as it was written, and one that leads nowhere Quay opens is no link.
parser.normalizeLink = (href) => href;
parser.validateLink = (href) => linkTarget(href) !== null;

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
