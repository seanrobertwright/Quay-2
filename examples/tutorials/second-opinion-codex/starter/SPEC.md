# SPEC.md

`retry(fn, options)` in `src/retry.ts` calls `fn` until it succeeds or runs out of attempts.

```ts
retry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T>
```

`options` has three fields:

- `attempts`: how many times `fn` may be called.
- `delayMs`: the base delay between attempts, in milliseconds. Defaults to 0.
- `backoff`: the factor the delay grows by after each retry. Defaults to 2.

## Rules

1. `attempts` is the total number of calls to `fn`, so `attempts: 3` calls `fn` at most three
   times.
2. An error whose `retryable` property is `false` is thrown at once, without another attempt.
3. The delay before retry number `n` is `delayMs * backoff ** (n - 1)`, so with `delayMs: 100`
   and `backoff: 2` the delays are 100, 200, 400 ms.
4. No delay is waited after the last failed attempt.
5. When every attempt fails, the error thrown is the last one `fn` threw.
6. An `attempts` below 1 rejects with a `RangeError` before `fn` is called.
7. `fn` receives the attempt number, starting at 1.
8. The returned promise settles exactly once.
