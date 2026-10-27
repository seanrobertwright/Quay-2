# Link checker

A command-line tool that finds broken links in a folder of Markdown files. `SPEC.md` says
exactly what it must do, and `AGENTS.md` says who builds which part.

```text
node src/cli.ts <folder>
```

`src/cli.ts` isn't written yet: it prints `not implemented`. `docs-sample/` holds five Markdown
files with three broken links, and `SPEC.md` ends with the exact output the checker must print
for them.

It needs Node 24 or later, which runs TypeScript as it is.
