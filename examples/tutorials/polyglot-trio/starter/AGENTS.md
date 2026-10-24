# AGENTS.md

**Goal:** a command-line CSV-to-JSON converter that does what `SPEC.md` says. `SPEC.md` ends
with the exact output for `samples/orders.csv`.

## Commands

- `npm test` runs the tests once.
- `npm run typecheck` type-checks the project.
- `node src/cli.ts samples/orders.csv` runs the converter on the sample.

## Who edits what

- `agy-planner` creates and edits only `PLAN.md`.
- `claude-dev` edits only files under `src/` and `test/`.
- `codex-reviewer` creates and edits only `review.md`.
- Nobody edits `SPEC.md`, `AGENTS.md`, `CLAUDE.md`, `README.md` or anything under `samples/`.

## House rules

- Use npm, never yarn or pnpm. Add no dependencies.
- Read files with `node:fs`. Use no other Node module for parsing.
- Write TypeScript that Node can run as it is: no `enum`, no `namespace`, no parameter
  properties. Imports name the `.ts` file, as `import { parseCsv } from "./csv.ts"`.

## The review.md shape

A review goes in `review.md` at the project root:

1. The first line reads exactly `VERDICT: APPROVED` or `VERDICT: CHANGES REQUESTED`.
2. Then a numbered list of findings, one per problem. Each names the file and line, says
   what is wrong against which `SPEC.md` rule, and gives a one-line fix.
3. With `VERDICT: APPROVED` the list may be empty.
