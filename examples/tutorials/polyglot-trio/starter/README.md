# csv2json

A command-line tool that turns a CSV file into a JSON array of objects, one per record. It
isn't written yet: `src/cli.ts` and `src/csv.ts` are stubs.

`SPEC.md` is the contract: the numbered rules and the exact output for
`samples/orders.csv`. `AGENTS.md` says who may edit which file and how a review is laid out.

```text
node src/cli.ts <file.csv>
```

It needs Node 24 or later, which runs TypeScript as it is. `npm test` runs the tests and
`npm run typecheck` type-checks the project.
