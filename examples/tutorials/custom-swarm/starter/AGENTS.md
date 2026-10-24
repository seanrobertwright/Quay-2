# AGENTS.md

**Goal:** `tally` counts the lines, words and characters in files. The code is finished. The work
is `README.md`, which is a stub until the squad replaces it.

## Commands

- `npm test` runs every test once: the `tally()` tests and the README tests.
- `npm run typecheck` type-checks the project.
- `npm start -- [--lines] [--words] [--chars] [--json] <file...>` runs the CLI, for example
  `npm start -- LICENSE package.json`.

## README requirements

`test/readme.test.ts` checks these, and `npm test` passes once they hold:

- The first line is `# tally`.
- The sections `## Install`, `## Usage`, `## Options`, `## Scripts` and `## License`, in that
  order.
- Every option `src/cli.ts` declares, documented under Options.
- Every script in `package.json`, documented under Scripts.
- The MIT license, named under License.
- No `TODO` or `TBD` anywhere.

The tests can't check that the words are true, so also:

- Every example's output is copied from a real run of the CLI, never written by hand.
- Document only what the code really does.

## Ownership

- `writer` drafts `README.md`.
- `editor` edits `README.md` only after the writer says the draft is ready.
- Nobody edits `src/`, `test/`, `package.json` or `LICENSE`.

## House rules

- Use npm, never yarn or pnpm. Add no dependencies.
- Write TypeScript that Node can run as it is: no `enum`, no `namespace`, no parameter
  properties.
