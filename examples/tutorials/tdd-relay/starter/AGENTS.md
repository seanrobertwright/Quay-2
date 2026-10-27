# AGENTS.md

**Goal:** `parseDuration(text)` in `src/duration.ts` turns a duration such as `1h30m` into a
whole number of seconds.

## Format

- A duration is one to three parts with nothing between them: no spaces, no separators.
- Each part is a whole number, digits only and leading zeros allowed, followed at once by a
  lowercase unit: `h` (hours), `m` (minutes) or `s` (seconds).
- Each unit appears at most once, and the units that appear come in the order `h`, `m`, `s`.
- A number may be any size: `90m` is 5400 and `0s` is 0.

## Examples

- `1h30m` is 5400.
- `45s` is 45.
- `2h5s` is 7205.
- `05m` is 300.

## Errors

Anything else throws a `RangeError` whose message is `invalid duration: ` followed by the input
exactly as given. That includes the empty string, a repeated unit (`1m2m`), units out of order
(`30m1h`), a sign (`-5m`, `+5m`), a decimal point (`1.5h`), an uppercase unit (`5M`), a space
(`1h 30m`), a number with no unit (`90`), a unit with no number (`h`) and any other character.

## Who edits what

- `test/` is `test-architect`'s. `src/` is `feature-impl`'s.

## Commands

- `npm test` runs the tests once.
- `npm run test:watch` runs the tests in watch mode. The `test-runner` pane already runs it, so
  never start it yourself: it doesn't end on its own.
- `npm run typecheck` type-checks the project.

## House rules

- Use npm, never yarn or pnpm. Add no dependencies.
- Write TypeScript that Node can run as it is: no `enum`, no `namespace`, no parameter
  properties.
- Imports name the `.ts` file, as `test/duration.test.ts` does with `../src/duration.ts`.
  `npm run typecheck` rejects an import without the extension.
- Keep the exported signature in `src/duration.ts` unchanged.
