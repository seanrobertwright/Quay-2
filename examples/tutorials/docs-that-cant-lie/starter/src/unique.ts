import { slugify } from "./slugify.ts";

/**
 * Slugifies `text` and makes the slug unused: when `taken` already holds it, appends `-2`,
 * then `-3` and so on, and returns the first one `taken` doesn't hold.
 */
export function uniqueSlug(text: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slugify(text);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
