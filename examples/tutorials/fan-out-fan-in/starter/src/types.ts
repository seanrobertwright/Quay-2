// The contract between the three parts of ssg. It is finished: nobody edits this file.
// If it seems wrong, tell lead.

/** A parsed Markdown page. */
export interface Doc {
  /** The `title:` value from the front matter, trimmed, or "" when the page has none. */
  title: string;
  blocks: Block[];
}

/** One block of a page, in the order the page has them. */
export type Block =
  | { kind: 'heading'; level: 1 | 2; content: Inline[] }
  | { kind: 'paragraph'; content: Inline[] }
  | { kind: 'list'; items: Inline[][] };

/**
 * A run of text inside a block. Adjacent text is always one `text` inline, and a block never
 * holds an empty `text` inline.
 */
export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

/**
 * Parses the Markdown subset ssg supports, which is all of it:
 *
 * - Front matter: when the first line is `---`, every line up to the next `---` is `key: value`.
 *   Only `title` is read. The front matter is not part of the page's blocks.
 * - A line starting `# ` is a level 1 heading and a line starting `## ` a level 2 heading. A
 *   heading is always one line.
 * - A line starting `- ` is a list item. Consecutive items make one list.
 * - Any other line that isn't blank belongs to a paragraph. Consecutive paragraph lines join into
 *   one paragraph, each line trimmed and joined with a single space.
 * - A blank line ends the paragraph or list before it.
 * - Inside headings, paragraphs and list items: `` `code` `` is a code inline and `[text](href)`
 *   a link inline, whose href runs to the first `)`. A backtick or `[` that doesn't start one of
 *   those is plain text.
 */
export type Parse = (markdown: string) => Doc;

/**
 * Renders a page into a template. Every `{{title}}` in the template becomes the page's title and
 * every `{{content}}` the page's blocks, as HTML. Whitespace between tags is free.
 *
 * - A heading becomes `<h1>` or `<h2>`, a paragraph `<p>`, and a list `<ul>` holding one `<li>`
 *   per item.
 * - Text, code and the title have `&`, `<`, `>` and `"` escaped as `&amp;`, `&lt;`, `&gt;` and
 *   `&quot;`. A code inline becomes `<code>` around its escaped text.
 * - A link becomes `<a href="...">text</a>`, both escaped, when its href is relative or its
 *   scheme is `http`, `https` or `mailto`. Schemes match whatever their case. A relative href has
 *   no scheme (no `:` before its first `/`, `?` or `#`) and doesn't start with `//`. Any other
 *   link, such as `javascript:alert` or `//example.com`, becomes its escaped text alone.
 */
export type Render = (doc: Doc, template: string) => string;

/** Turns one Markdown page into one HTML page with a template. */
export type BuildPage = (markdown: string, template: string) => string;

/**
 * Runs `ssg` with its command-line arguments, and resolves to the process exit code.
 *
 * - `build <in> <out>` reads `<in>/template.html`, then turns every `.md` file directly in `<in>`
 *   into `<out>/<name>.html` with `buildPage`, creating `<out>` if needed. Other files are
 *   skipped. It prints `Built <n> pages to <out>`, with `<out>` as given, and resolves to 0.
 * - Any other arguments print `Usage: ssg build <in> <out>` to stderr and resolve to 2.
 * - A missing `<in>/template.html` prints an error naming `template.html` to stderr, writes
 *   nothing, and resolves to 1.
 */
export type Run = (argv: string[], buildPage: BuildPage) => Promise<number>;
