# AGENTS.md

**Goal:** find out which `countWords` implementation in `src/count-words.ts` to keep, by
benchmarking both.

## Commands

- `npm test` runs the six tests. Both implementations must pass them.
- `npm run typecheck` checks the types.
- `npm run bench` times both implementations and prints a results table. It takes about three
  minutes, longer than your shell tool's default two-minute timeout, so give the command a
  timeout of at least five minutes. Run it in the foreground and wait for it to finish: never
  run it in the background, and never end your turn while it is running.

## House rules

- Use npm, never yarn or pnpm. Add no dependencies.
- Write TypeScript that Node can run as it is: no `enum`, no `namespace`, no parameter
  properties.
- Don't edit `src/`, `test/` or `bench/` unless you are asked to.
