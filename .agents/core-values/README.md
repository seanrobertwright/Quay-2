# Core Values: a best-practices library for AI coding agents

Best practices distilled from about 130 software-engineering books and from
primary web sources (MDN, WCAG, OWASP, the Google SRE books, cloud
well-architected frameworks, LLM provider docs, and framework docs). It is
organized for
progressive disclosure:

- [AGENTS.md](AGENTS.md) is loaded every session. It holds a short set of
  always-on rules and a routing table that says which practice file to load
  for which kind of task or file.
- [practices/](practices) holds one file per domain. Each opens with
  **Top rules**, so an agent can stop after the first section.
- [SOURCES.md](SOURCES.md) lists every book and web page used.
- [CONTRIBUTING.md](CONTRIBUTING.md) gives the practice-file format.

## Using it from another project

Point the other project's instruction file at this one. For example, in its
`AGENTS.md` or `CLAUDE.md`:

```markdown
Follow the best-practices library at <path to this repository>/AGENTS.md.
Load the practice files it routes to before starting each task.
```

Claude Code also accepts an import line such as `@<path>/AGENTS.md`.

## Rebuilding

The source books are copyrighted and are not committed. `build/` holds the
scripts that produced the library:

1. `make_manifest.py` maps each book to the practice files it feeds.
2. `fetch_and_extract.py` downloads the books into `sources/books/` and
   extracts text into `sources/text/` (both gitignored).
3. Per-book extraction notes, practice-file synthesis, and verification ran as
   a multi-agent workflow.
4. `make_sources.py` regenerates `SOURCES.md`.
5. `check_library.py` checks routing, links, required sections, size, and
   banned strings. The pre-commit hook in `.githooks/` runs it.
