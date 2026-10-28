# AGENTS.md

**Goal:** `retry` in `src/retry.ts` must do what `SPEC.md` says.

## Commands

- `npm test` runs the tests once.
- `npm run typecheck` type-checks the project.

## Reviews

Reviews go in `review.md` at the project root. A review's first line reads exactly
`VERDICT: APPROVED` or `VERDICT: CHANGES REQUESTED`. After it comes a numbered list of findings,
each naming the line in `src/retry.ts`, what is wrong, and a one-line fix.

## House rules

- Use npm, never yarn or pnpm. Add no dependencies.
- Write TypeScript that Node can run as it is: no `enum`, no `namespace`, no parameter
  properties.
- Imports name the `.ts` file, as `test/retry.test.ts` does with `../src/retry.ts`.
  `npm run typecheck` rejects an import without the extension.
- Keep the exported signature of `retry` unchanged.
