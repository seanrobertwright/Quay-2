// Plain text in a `Text`, which draws Markdown.

/** `text` as Markdown that is drawn as `text` is written. */
export const plainText = (text: string): string =>
  text
    .replace(/[!-/:-@[-`{-~]/g, "\\$&")
    // Markdown reads line breaks, tabs and the spaces at an end as layout, but not their references.
    .replace(/[\t\n]|^ +| +$/g, (layout) => [...layout].map((c) => `&#${c.charCodeAt(0)};`).join(""));

/** The text that `plainText` made `markdown` of. */
export const textOfPlain = (markdown: string): string =>
  markdown.replace(/\\([!-/:-@[-`{-~])|&#(9|10|32);/g, (_, mark?: string, code?: string) => mark ?? String.fromCharCode(Number(code)));
