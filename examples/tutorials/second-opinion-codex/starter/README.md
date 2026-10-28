# retry-kit

`retry(fn, options)` in `src/retry.ts` calls an async function again when it fails, waiting a
little longer each time. `SPEC.md` is its contract, and `AGENTS.md` holds the commands and the
house rules.

The previous developer left in a hurry. The tests pass, and a review is due before 1.0.0 ships.
The review lands in `review.md` at the project root.

It needs Node 24 or later, which runs TypeScript as it is.
