// The parser, with raw HTML off.
import MarkdownIt, { type Token } from "markdown-it";
import { linkTarget } from "../../linkTarget.ts";

const parser = new MarkdownIt({ html: false, linkify: false, typographer: false });
// A link's address is judged as it was written, and one that leads nowhere Quay opens is no link.
parser.normalizeLink = (href) => href;
parser.validateLink = (href) => linkTarget(href) !== null;

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

/** Whether the last three tokens are a body cell with nothing in it. */
const endsInEmptyCell = (tokens: readonly Token[]) =>
  tokens[tokens.length - 1]?.type === "td_close" && tokens[tokens.length - 2]?.content === "" && tokens[tokens.length - 3]?.type === "td_open";

/** The tokens of `text`, blocks and all. */
export const blockTokens = (text: string): Token[] => withoutFilledCells(parser.parse(text, {}));

/** The tokens of `text` read as inline formatting alone. */
export const inlineTokens = (text: string): Token[] => parser.parseInline(text, {});
