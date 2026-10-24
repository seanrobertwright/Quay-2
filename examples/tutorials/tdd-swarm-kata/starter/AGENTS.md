# AGENTS.md

**Goal:** `checkStrength(password)` in `src/strength.ts` reports which of three rules a
password fails.

## Rules

In this order, and with these names:

1. `length`: at least 12 characters.
2. `classes`: at least three of these four: a lowercase letter (a-z), an uppercase letter
   (A-Z), a digit (0-9), a symbol (any other character).
3. `repeats`: no character appears three or more times in a row.

## Report

- `score` is the number of rules the password passes, from 0 to 3.
- `failed` lists the names of the rules it fails, in the order above.

## Commands

- `npm test` runs the tests once.
- `npm run test:watch` runs the tests in watch mode. The `test-runner` pane already runs it, so
  never start it yourself: it doesn't end on its own.
- `npm run typecheck` type-checks the project.

## House rules

- Use npm, never yarn or pnpm. Add no dependencies.
- Write TypeScript that Node can run as it is: no `enum`, no `namespace`, no parameter
  properties.
- Keep the exported signature in `src/strength.ts` unchanged.
