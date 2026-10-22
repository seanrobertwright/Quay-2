# JavaScript and TypeScript

> **Load when:** writing, reviewing, or debugging JavaScript or TypeScript
> (`*.js`, `*.mjs`, `*.cjs`, `*.ts`, `*.tsx`, `package.json`,
> `tsconfig*.json`), designing TypeScript types, writing promise or
> `async`/`await` code or `fetch` calls, parsing input, numbers, or dates in
> JS, configuring modules, packages, or the compiler, or writing Node
> servers, CLIs, streams, child processes, or `node:test` tests.
> **See also:** [Front-end components and state](../frontend/components-and-state.md),
> [Web performance](../frontend/web-performance.md),
> [Application and API security](../security/application-security.md),
> [HTTP and REST API design](../api/api-design.md),
> [Testing](../testing/testing.md),
> [Concurrency and parallelism](../concurrency/concurrency.md),
> [Regular expressions](../tools/regular-expressions.md),
> [Continuous integration and delivery](../devops/ci-cd.md)

## Top rules

1. **Turn on `strict` and `noUncheckedIndexedAccess`, and fix the errors a
   compiler upgrade raises instead of turning flags off.** Unchecked index
   reads hide missing-key and out-of-bounds bugs. *[TSConfig Reference]*
2. **Type unknown values as `unknown`, never `any`, and turn external input
   into typed values with a schema parser at the boundary.** An `as` cast or
   annotation validates nothing at runtime. *[TS Do's and Don'ts, General
   types; Review lessons]*
3. **Return or `await` every promise, enforced by a no-floating-promises
   lint rule.** A floating promise lets the next step run early, and its
   rejection escapes every handler. *[MDN Using promises, Chaining]*
4. **After every `fetch`, check `response.ok` and bound the call with an
   `AbortSignal` timeout.** `fetch` resolves on 4xx and 5xx and never times
   out by itself. *[MDN fetch(); MDN AbortSignal; Review lessons]*
5. **Never call bare `Number()` or `parseInt` on external input; validate
   the whole string, then check `Number.isSafeInteger` and the range.**
   `Number("")` is `0` and `parseInt("12abc")` is `12`. *[MDN parseInt();
   Review lessons]*
6. **Route all date handling through one project helper; never build a
   `Date` from a non-ISO or offset-less string outside it.** Offset-less
   date-times are read as process-local time. *[MDN Date; Review lessons]*
7. **Model variants as a discriminated union and end every `switch` over it
   with a `never` exhaustiveness check.** A new variant then fails to
   compile wherever it is unhandled. *[TS Handbook: Narrowing]*
8. **Match `module` and `moduleResolution` to the runtime that loads the
   code, and set `verbatimModuleSyntax`.** A mismatch type-checks, then
   fails to resolve at runtime. *[TS Modules: Choosing Compiler Options]*
9. **Keep synchronous and super-linear work out of Node request paths, and
   cap input size before parsing.** One event loop serves every client.
   *[Node: Don't Block the Event Loop]*
10. **Launch subprocesses with `execFile` or `spawn` and an argument array,
    never `exec` or `shell: true` on dynamic input.** Interpolated values in
    a shell string inject commands. *[Node API: Child process]*

## Types and type design

- **Use `string`, `number`, `boolean`, and `object`, never the boxed
  `String`, `Number`, `Boolean`, or `Object`.** `Object` accepts nearly
  anything. *[TS Do's and Don'ts, General types]*
- **Prefer a union with a literal `kind` field over one interface full of
  optional fields.** Optional-field designs force non-null assertions.
  *[TS Handbook: Narrowing, Discriminated unions]*
- **Write the exhaustiveness check as an assignment to `never`**, for example
  `default: { const unhandled: never = shape; throw new Error(...) }`.
  *[TS Handbook: Narrowing, Exhaustiveness checking]*
- **Compare against `null` explicitly (`x != null`) when `0`, `""`, `NaN`,
  or `0n` are valid.** Truthiness guards drop legitimate falsy values, and
  `typeof null` is `"object"`. *[TS Handbook: Narrowing]*
- **Write reusable runtime checks as type predicates (`x is T`) with honest
  bodies.** They narrow through callers and `.filter`; the compiler trusts
  the body unchecked. *[TS Handbook: Narrowing, Using type predicates]*
- **Use `satisfies` to check a value against a type while keeping its
  precise inferred type.** Annotations widen; `as` skips excess-property
  checks. *[TS 4.9 release notes]*
- **Never use `as` or `!` to silence an error about external data.** Narrow
  or parse instead; a cast is an unchecked claim. *[TS Handbook: Narrowing;
  Review lessons]*
- **Prefer an `as const` object plus a derived union over `enum`, and never
  publish an ambient `const enum`.** As-const objects survive type
  stripping; ambient const enums break under `isolatedModules` and inline
  stale values. *[TS Handbook: Enums]*
- **Type ignored callback results as `void`, and prefer a union parameter
  over overloads that differ in one position.** Callers holding a
  `string | number` cannot call per-type overloads. *[TS Do's and Don'ts]*
- **Mark overriding methods with `override` under `noImplicitOverride`.** A
  renamed base method then breaks the build instead of orphaning the
  override. *[TSConfig Reference]*
- **Make JSDoc and comments match the implementation exactly.** "Never
  throws", "newest first", or "at most one" is a contract; fix prose or code
  in the same change. *[Review lessons]*

## Async, promises, and errors

- **Keep chains flat with one terminal `catch`; nest only to scope recovery
  to an optional step.** Mid-chain catches swallow failures and continue in
  a bad state. *[MDN Using promises, Error handling]*
- **Run independent work concurrently and pick the combinator by failure
  semantics.** `all` fails fast, `allSettled` reports every outcome, `any`
  takes the first success, `race` the first settlement. *[MDN Using
  promises, Composition]*
- **Bound fan-out.** `Promise.all(items.map(fetchOne))` over ten thousand
  items opens ten thousand requests; use a concurrency limiter or batches.
  *[Review lessons]*
- **Promisify each callback API once, at the lowest level, and prefer
  `node:fs/promises` and `node:timers/promises`.** A throw inside a timer or
  event callback bypasses promise handling. *[MDN Using promises; Node API:
  File system]*
- **Thread an `AbortSignal` through cancellable work; combine the caller's
  signal with `AbortSignal.timeout(ms)` via `AbortSignal.any`.** Timeouts
  reject with `TimeoutError`, manual aborts with `AbortError`; check
  `err.name` to tell them apart. *[MDN AbortSignal; MDN Using promises]*
- **For outbound clients that carry a token, set a timeout and disable
  redirects (`redirect: "manual"` or `"error"`).** A followed redirect can
  carry credentials to another host. *[Review lessons]*
- **Guard async UI and polling code against stale responses with a request
  id or abort, and clear timers on teardown.** Component patterns live in
  [Front-end components and state](../frontend/components-and-state.md).
  *[Review lessons]*
- **Treat `catch` variables as `unknown` and narrow (`err instanceof Error`)
  before reading `.message` or `.code`.** JS can throw any value.
  *[TSConfig Reference, useUnknownInCatchVariables]*
- **Rethrow with `new Error(msg, { cause: err })`, and keep machine-readable
  codes in fields, not messages.** Messages get reworded; `cause` keeps the
  original stack. *[MDN Error.cause]*
- **Release resources with `using` / `await using` where the runtime
  supports it, otherwise `try`/`finally`.** Disposal runs on every return and
  throw, and cleanup errors surface as `SuppressedError`. *[TS 5.2 release
  notes]*
- **On `uncaughtException`, log synchronously, release handles, and exit;
  never resume.** Process state is undefined; let a supervisor restart it.
  *[Node API: Process]*
- **Do not add an `unhandledRejection` listener that only logs.** Rejections
  crash by default; a logging listener turns that into silent data loss.
  Fix the missing `await`. *[Node API: Process]*
- **Set `process.exitCode` instead of calling `process.exit()`.** `exit()`
  abandons pending I/O and can truncate stdout. *[Node API: Process]*

## Parsing input and language pitfalls

- **Parse env vars, CLI flags, query params, and bodies with a schema parser
  at startup or the handler, failing fast with the bad key named.** Reject
  NaN, empty strings, malformed UUIDs, and out-of-range values there.
  *[Review lessons]*
- **Validate numeric strings with an anchored pattern, parse with radix 10,
  and check with `Number.isSafeInteger`.** `parseInt` accepts trailing
  garbage; use `Math.trunc` to truncate. *[MDN parseInt()]*
- **Carry 64-bit ids beyond 2^53−1 as strings or `BigInt`, never
  `number`.** Above `Number.MAX_SAFE_INTEGER`, distinct ids compare equal.
  *[MDN Number.MAX_SAFE_INTEGER]*
- **Use `Object.hasOwn(obj, key)`, not `key in obj`, and use `Map` or
  `Object.create(null)` for input-keyed dictionaries.** `"constructor" in {}`
  is `true`. *[Review lessons; Node: Security Best Practices]*
- **Escape ids and user strings before building a `RegExp` from them.** See
  [Regular expressions](../tools/regular-expressions.md). *[Review lessons]*
- **Use `===` by default and `Number.isNaN` for NaN; reach for `Object.is`
  only when the sign of zero matters.** `indexOf` cannot find NaN;
  `includes`, `Map`, and `Set` can.
  *[MDN Equality comparisons and sameness]*
- **Give every date-time string an explicit offset, and treat offset-less
  strings as UTC or as wall-clock digits with a named zone.** Date-only ISO
  strings parse as UTC, date-times as local; months are zero-based.
  *[MDN Date; Review lessons]*
- **Never compute "today" as `new Date().toISOString().slice(0, 10)`
  outside the date helper.** That is the UTC date, wrong for part of every
  local day. *[Review lessons; MDN Date]*
- **Use Temporal types by meaning where available: `Instant` for
  timestamps, `ZonedDateTime` for events at a place, `PlainDate` for
  calendar dates.** *[MDN Temporal]*
- **Pass `sort` a comparator returning a signed number, and use `toSorted`
  to avoid mutation.** The default compares strings, so `[10, 9]` stays
  `[10, 9]`. *[MDN Array.prototype.sort()]*
- **Deep-copy plain data with `structuredClone`, not a JSON round-trip;
  never use it on class instances.** It keeps Dates, Maps, and cycles but
  drops prototypes. *[MDN structuredClone()]*

## Compiler and module configuration

- **Use `nodenext` for code Node runs and `bundler` resolution for bundled
  apps; never compile an unbundled npm library with `bundler`.** It accepts
  extensionless imports that break Node consumers. *[TS Modules: Choosing
  Compiler Options]*
- **Write `import type` for type-only imports.** With
  `verbatimModuleSyntax`, emit matches source and transpilers behave
  predictably. *[TSConfig Reference, verbatimModuleSyntax]*
- **Enable `exactOptionalPropertyTypes` when "absent" and "present but
  `undefined`" differ**, as in patch and merge code. *[TSConfig Reference]*
- **Build libraries with `strict`, `declaration`, and separate `rootDir`
  and `outDir`.** Shipped `.ts` beside output shadows the `.d.ts` files.
  *[TS Modules: Choosing Compiler Options]*
- **Give server, DOM, worker, and test code separate tsconfigs joined by
  project references.** One config leaks DOM globals into server code.
  *[TS Modules: Choosing Compiler Options]*
- **Define the public surface with `"exports"`, `"types"` condition first
  and `"default"` last; map internal paths with `"imports"` `#`
  specifiers.** Conditions match in key order. *[Node API: Packages]*
- **Test every output of a dual ESM/CJS build, including with a
  package-types checker, before publishing.** One `tsc` pass checks only one
  format. *[TS Modules: Choosing Compiler Options]*
- **Avoid top-level `await` in ESM that CommonJS code will `require()`.**
  It throws `ERR_REQUIRE_ASYNC_MODULE`. *[Node API: Packages]*
- **Run `npm publish --dry-run` with a `files` allowlist.** npm otherwise
  publishes nearly everything, secrets included. *[Node: Security Best
  Practices]*

## Running TypeScript in Node

- **When Node runs `.ts` directly, use only erasable syntax, enforced by
  `erasableSyntaxOnly`.** Type stripping rejects enums, runtime namespaces,
  parameter properties, and decorators. *[Node API: TypeScript]*
- **Treat type stripping as execution only: run `tsc --noEmit` in CI and
  write `.ts` extensions in relative imports.** Node reads no tsconfig
  (`paths` aliases fail; use `#` imports) and checks no types; set
  `allowImportingTsExtensions` or `rewriteRelativeImportExtensions` so `tsc`
  accepts the extensions. *[Node API: TypeScript; TSConfig Reference]*

## Node runtime, I/O, and performance

- **Keep `*Sync` APIs (`fs`, `zlib`, `crypto.pbkdf2Sync`, `execSync`) out of
  request paths; startup code and CLIs may use them.** *[Node: Don't Block
  the Event Loop]*
- **Reject oversized bodies before `JSON.parse`, and stream large
  payloads.** An O(n²) loop over attacker-sized n is a denial of service.
  *[Node: Don't Block the Event Loop]*
- **Move CPU-heavy work to a bounded `worker_threads` pool; never spawn a
  process per request.** *[Node: Don't Block the Event Loop]*
- **Connect streams with `pipeline` from `node:stream/promises`, not
  `.pipe()`, and wait for `drain` when `write()` returns false.** `.pipe()`
  neither forwards errors nor destroys peers. *[Node: Backpressuring in
  Streams]*
- **Open a file directly and handle `ENOENT`, instead of checking with
  `exists` or `stat` first.** Check-then-use is a race. *[Node API: File
  system]*
- **Close every `FileHandle` in `finally`, and never overlap writes to one
  file through `fs/promises`.** Concurrent writes can corrupt data. *[Node
  API: File system]*
- **Write secrets to uniquely named files with mode `0o600`, never a
  predictable path.** *[Review lessons; Node API: File system]*
- **Never treat an in-process `Map`, flag, or mutex as enforcing "only
  one".** Node apps run as several processes; enforce it in the database
  ([SQL and query performance](../data/sql-and-query-performance.md)).
  *[Review lessons]*

## Node servers, subprocesses, and supply chain

- **Set `timeout` and `maxBuffer` on child processes, and validate values
  placed in a shell `export` or `eval` as identifiers.** On Windows,
  `.bat` and `.cmd` files run through `cmd.exe` and carry injection risk.
  *[Node API: Child process; Review lessons]*
- **Never recursively merge untrusted JSON into objects.** `__proto__` keys
  pollute every object's prototype. *[Node: Security Best Practices]*
- **Compare secrets with `crypto.timingSafeEqual` after checking lengths,
  and hash passwords with `crypto.scrypt`.** *[Node: Security Best
  Practices]*
- **Set `headersTimeout`, `requestTimeout`, and `keepAliveTimeout` on HTTP
  servers; never ship `insecureHTTPParser` or an exposed inspector.**
  *[Node: Security Best Practices]*
- **Set `x-content-type-options: nosniff` on download routes, escape values
  interpolated into HTML, and never answer state-changing endpoints with
  CORS `*`.** See [Application and API
  security](../security/application-security.md). *[Review lessons]*
- **Commit the lockfile, install with `npm ci`, disable install scripts
  unless needed, and run `npm audit` in CI.** Every dependency runs with the
  process's privileges. *[Node: Security Best Practices]*

## Testing with `node:test`

- **Await every subtest (`await t.test(...)`) and use the context-scoped
  `t.mock`.** Pending subtests are cancelled as failures. *[Node API: Test
  runner]*
- **Mock timers and `Date` with `mock.timers` instead of real sleeps.**
  *[Node API: Test runner]*

## Lint and repository gates

- **Make unused imports, dead code, and floating promises lint errors, and
  run `eslint-plugin-jsx-a11y` or an equivalent on JSX.** *[Review lessons]*
- **Never downgrade a correctness rule such as `react-hooks/rules-of-hooks`
  to `warn` globally; scope suppressions to one file.** *[Review lessons]*
- **Run a pre-commit check that fails on U+FFFD and personal identifiers in
  tracked files.** *[Review lessons]*
- **After a fix, grep for the same pattern (bare `Number()`, unchecked
  `fetch`, `key in obj`) and fix every sibling in the same commit.**
  *[Review lessons]*

## Tensions

- **`enum` vs `as const` objects.** The Handbook treats enums as
  first-class; Node type stripping rejects them. Prefer `as const` in new
  code; keep enums only where `tsc` or a bundler always compiles. *[TS
  Handbook: Enums; Node API: TypeScript]*
- **Always set `"type"` vs omit it in bundled apps.** Node says always set
  it; TypeScript advises against `"type": "module"` in bundler-built apps.
  Follow TypeScript for bundler-only apps, Node for code Node runs. *[Node
  API: Packages; TS Modules: Choosing Compiler Options]*
- **Floating `nodenext` vs pinned `node18`-style modes.** Apps may float;
  libraries pin the oldest Node they support. *[TS Modules: Choosing
  Compiler Options]*
- **Extra strict flags vs migration cost.** `exactOptionalPropertyTypes`
  and `noUncheckedIndexedAccess` sit outside `strict`. Turn them on in new
  projects; migrate old ones module by module. *[TSConfig Reference]*
- **Temporal vs `Date`.** Temporal is the better model but not in every
  engine yet. Use it behind the single date helper where the runtime or a
  polyfill supports it. *[MDN Temporal; Review lessons]*
- **Dated offloading advice.** The event-loop guide names C++ addons,
  `cluster`, and old helper packages. Current practice is a bounded
  `worker_threads` pool, with child processes only for isolation. *[Node:
  Don't Block the Event Loop]*
- **Global logging `unhandledRejection` handler vs default crash.** That
  advice predates Node 15, when rejections became fatal. Keep the default.
  *[Node API: Process]*

## Sources

- **TSConfig Reference**: TypeScript TSConfig Reference, <https://www.typescriptlang.org/tsconfig/>
- **TS Handbook: Narrowing**: TypeScript Handbook, Narrowing, <https://www.typescriptlang.org/docs/handbook/2/narrowing.html>
- **TS Handbook: Enums**: TypeScript Handbook, Enums, <https://www.typescriptlang.org/docs/handbook/enums.html>
- **TS Do's and Don'ts**: TypeScript Handbook, Declaration Files: Do's and Don'ts, <https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html>
- **TS Modules: Choosing Compiler Options**: TypeScript Modules Reference, <https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options.html>
- **TS 4.9 release notes**: <https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html>
- **TS 5.2 release notes**: <https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-2.html>
- **Node API: TypeScript**: Node.js API, Modules: TypeScript, <https://nodejs.org/api/typescript.html>
- **Node API: Packages**: Node.js API, Modules: Packages, <https://nodejs.org/api/packages.html>
- **Node API: Process**: Node.js API, Process, <https://nodejs.org/api/process.html>
- **Node API: Child process**: Node.js API, Child process, <https://nodejs.org/api/child_process.html>
- **Node API: File system**: Node.js API, File system, <https://nodejs.org/api/fs.html>
- **Node API: Test runner**: Node.js API, Test runner, <https://nodejs.org/api/test.html>
- **Node: Security Best Practices**: Node.js Learn, <https://nodejs.org/en/learn/getting-started/security-best-practices>
- **Node: Don't Block the Event Loop**: Node.js Learn, Don't Block the Event Loop (or the Worker Pool), <https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop>
- **Node: Backpressuring in Streams**: Node.js Learn, <https://nodejs.org/en/learn/modules/backpressuring-in-streams>
- **MDN Using promises**: MDN Web Docs, <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises>
- **MDN fetch()**: MDN Web Docs, Window: fetch() method, <https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch>
- **MDN Equality comparisons and sameness**: MDN Web Docs, <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Equality_comparisons_and_sameness>
- **MDN parseInt()**: MDN Web Docs, <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/parseInt>
- **MDN Number.MAX_SAFE_INTEGER**: MDN Web Docs, <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/MAX_SAFE_INTEGER>
- **MDN Date**: MDN Web Docs, <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date>
- **MDN Temporal**: MDN Web Docs, <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal>
- **MDN Array.prototype.sort()**: MDN Web Docs, <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort>
- **MDN structuredClone()**: MDN Web Docs, <https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone>
- **MDN AbortSignal**: MDN Web Docs, <https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal>
- **MDN Error.cause**: MDN Web Docs, <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause>
- **Review lessons**: rules distilled from the maintainer's code-review findings
