# AGENTS.md

**Goal:** implement `findDuplicates` in `src/dedupe.ts` so every test in `test/dedupe.test.ts`
passes.

## The rule

- Two contacts are the same person when their emails match after trimming and lower-casing, or
  their phones match once everything but the digits is dropped.
- It is transitive: when A matches B and B matches C, all three are one person.
- An empty email or phone never matches anything.
- Return each group of two or more contacts as a list of ids, with the ids in input order and the
  groups ordered by their first member.

## Commands

- `npm test` runs the tests in watch mode.
- `npm run test:once` runs the tests once.
- `npm run typecheck` type-checks the project.

## House rules

- A watcher pane is already running the tests and re-runs them on every save. Don't run the
  tests yourself; save your changes and the watcher shows the result.
- Change only `src/dedupe.ts`. Never edit `test/` or `scripts/`.
- Keep the exported `Contact` type and the `findDuplicates` signature unchanged.
- Use npm, never yarn or pnpm. Add no dependencies.
- Write TypeScript that Node can run as it is: no `enum`, no `namespace`, no parameter
  properties.
- Speed is measured separately. Don't write benchmarks.
- Stay inside the folder you were started in.
