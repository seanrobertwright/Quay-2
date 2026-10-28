# Text stats

A command-line tool that counts the lines and words in a text file and finds its most frequent
word. `SPEC.md` says exactly how, and `AGENTS.md` says who builds which part.

```text
node src/cli.ts <file>
```

`src/cli.ts` is finished, but the three functions it calls in `src/stats.ts` aren't written yet,
so all six tests in `test/stats.test.ts` fail. `SPEC.md` ends with the exact line the CLI must
print for `sample.txt`.

It needs Node 24 or later, which runs TypeScript as it is.
