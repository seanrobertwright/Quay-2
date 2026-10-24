# AGENTS.md

**Goal:** implement the three functions in `src/tip.ts` so every test in `test/tip.test.ts` passes.

## Commands

- `npm test` runs the tests in watch mode.
- `npm run test:once` runs the tests once.
- `npm run typecheck` type-checks the project.
- `node src/cli.ts 42.50 18 3` runs the CLI.

## House rules

- A watcher pane is already running the tests and re-runs them on every save. Don't run the
  tests yourself; save your changes and the watcher shows the result.
- Change only `src/tip.ts`. `src/cli.ts` and the tests are finished.
- Use npm, never yarn or pnpm. Add no dependencies, and never a native one.
- Write TypeScript that Node can run as it is: no `enum`, no `namespace`, no parameter
  properties.
