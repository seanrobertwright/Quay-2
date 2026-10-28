# AGENTS.md

## Goal

`createLimiter` is a fixed-window rate limiter, one window per key.

## Rules

1. A key's window opens at its first check and lasts `windowMs`. A check made `windowMs` or more after the window opened starts a new window.
2. In a window, the first `limit` checks are allowed and every later one is refused.
3. `remaining` is how many more checks this window allows after this one, never below 0.
4. `retryAfterMs` is 0 when allowed, otherwise the milliseconds until the window ends.
5. Keys never affect each other.
6. Time comes only from `options.now()`.

## Commands

- `npm test` runs the tests.
- `npm run typecheck` checks TypeScript types without emitting code.

## House Rules

- Use `npm` only.
- Do not install new dependencies.
- Do not use `enum` or `namespace`.
- Keep the exported types in `src/limiter.ts` unchanged.
