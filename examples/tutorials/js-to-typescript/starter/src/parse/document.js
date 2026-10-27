import { parseLine } from "./line.js";

/**
 * Reads a whole shopping list. Blank lines and lines starting with # are skipped. Every other
 * line is an item, or an error that names its line number.
 */
export function parseDocument(text) {
  const items = [];
  const errors = [];
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (isSkipped(line)) continue;
    const item = parseLine(line);
    if (item === null) errors.push(lineError(index + 1, line));
    else items.push(item);
  }
  return { items, errors };
}

/** A blank line or a # comment. */
function isSkipped(line) {
  return line === "" || line.startsWith("#");
}

function lineError(lineNumber, text) {
  return { line: lineNumber, message: `line ${lineNumber} is not "<qty> x <name> @ <price>": ${text}` };
}
