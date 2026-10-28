export type SlugifyOptions = {
  /** Put between words. Default `"-"`. */
  separator?: string;
  /** The longest slug to return. Cuts between words, never inside one. */
  maxLength?: number;
};

/**
 * Turns `text` into a URL slug: accents stripped, lowercased, and every run of `a`-`z` and `0`-`9`
 * left after that a word, joined by `separator`. Any other character, including a letter with no
 * plain-Latin form such as `ß` or `ø`, separates words and is dropped. With `maxLength`, drops whole words from the end until
 * the slug fits; only a first word longer than `maxLength` on its own is cut.
 */
export function slugify(text: string, options: SlugifyOptions = {}): string {
  const { separator = "-", maxLength } = options;
  if (maxLength !== undefined && (!Number.isInteger(maxLength) || maxLength < 1)) {
    throw new RangeError(`maxLength must be a whole number of 1 or more, got ${maxLength}`);
  }
  const words =
    text
      .normalize("NFKD")
      .replace(/\p{Mark}/gu, "")
      .toLowerCase()
      .match(/[a-z0-9]+/g) ?? [];
  if (maxLength === undefined) return words.join(separator);

  const [first = ""] = words;
  if (first.length > maxLength) return first.slice(0, maxLength);
  let slug = first;
  for (const word of words.slice(1)) {
    const next = slug + separator + word;
    if (next.length > maxLength) break;
    slug = next;
  }
  return slug;
}
