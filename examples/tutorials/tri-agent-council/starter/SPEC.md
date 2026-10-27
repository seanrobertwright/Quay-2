# Link checker: the spec

A command-line tool that finds broken links in a folder of Markdown files. It works offline:
it never fetches a web address.

## Rules

1. **Usage.** Run it as `node src/cli.ts <folder>`. With no argument, or with a path that isn't
   a folder, it prints `Usage: node src/cli.ts <folder>` to stderr and exits 2.
2. **Files.** It checks every file whose name ends in `.md` under `<folder>`, in every
   subfolder. Other files are never checked, but a link may point at one.
3. **Links.** A link is an inline link, `[text](target)`, or an image, `![alt](target)`. The
   text holds no `]`, and the target ends at the first space or `)`. Reference-style links such
   as `[text][name]`, autolinks such as `<https://example.com>` and bare web addresses are not
   links. Nothing between a line starting with three backticks and the next such line counts:
   neither links nor headings in a fenced code block.
4. **External.** A target starting with `http://`, `https://` or `mailto:` counts as a link but
   is never broken.
5. **Relative.** Any other target is a path relative to the folder of the file it is in,
   optionally followed by `#` and an anchor. When no file is at that path, the link is broken:
   `(missing file)`.
6. **Anchors.** A target that is only `#` and an anchor points into its own file. An anchor
   matches a heading when it equals the heading's slug. Only lines starting with one to six `#`
   and a space are headings. The slug is the heading's text, lowercased, with every character
   that isn't a letter from `a` to `z`, a digit, a space or a hyphen dropped, then each space
   turned into a hyphen: `Options & flags` becomes `options--flags`. When the file exists but no
   heading in it matches, the link is broken: `(missing anchor)`.
7. **Report.** For each broken link it prints one line to stdout:
   `<path>:<line>: <target> (missing file)` or `<path>:<line>: <target> (missing anchor)`.
   `<path>` is the file's path relative to `<folder>` with forward slashes, and `<line>` counts
   from 1. Lines are sorted by path, comparing character codes, then by line. Then it prints one
   last line: `Checked <K> links in <M> files: <N> broken.`, where `<K>` counts every link,
   external ones included, `<M>` counts the `.md` files and `<N>` the broken links.
8. **Exit.** It exits 0 when no link is broken, 1 when any link is, and 2 on a usage error.

## The expected output for docs-sample

`node src/cli.ts docs-sample` prints exactly these four lines to stdout, and exits 1:

```text
guide/config.md:18: ../reference/api.md (missing file)
guide/getting-started.md:17: config.md#enviroment-variables (missing anchor)
reference/cli.md:19: #exit-code (missing anchor)
Checked 18 links in 5 files: 3 broken.
```
