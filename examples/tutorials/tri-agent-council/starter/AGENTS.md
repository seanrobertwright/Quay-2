# AGENTS.md

**Goal:** build the link checker that `SPEC.md` specifies, in `src/cli.ts`. `docs-sample/` is
the folder it is checked against, and `SPEC.md` ends with the exact output it must print there.

## Commands

- `npm test` runs the tests once.
- `npm run typecheck` type-checks the project.
- `node src/cli.ts docs-sample` runs the link checker on the sample docs.

## Who owns what

- `planner-agent` creates and edits only `PLAN.md`.
- `builder-agent` edits only files under `src/` and `test/`. It replaces each `it.todo` in
  `test/cli.test.ts` with a real test.
- `verifier-agent` edits nothing. It runs the commands and reports.
- Nobody edits `SPEC.md`, `AGENTS.md`, `README.md` or anything in `docs-sample/`.

## House rules

- Use npm, never yarn or pnpm. Add no dependencies.
- The checker uses only `node:fs` and `node:path`. `src/cli.ts` stays the entry point.
- Write TypeScript that Node can run as it is: no `enum`, no `namespace`, no parameter
  properties.
- The expected output at the end of `SPEC.md` is the verifier's definition of done.
