# Front-end components and state (React and peers)

> **Load when:** writing, reviewing, or debugging UI components in React,
> Next.js App Router, Vue 3, or Svelte 5; deciding where state lives, whether
> an Effect is needed, how to key a list, or how to fetch, cache, and
> revalidate page data; or fixing stale UI, lost input, double-fired Effects,
> render loops, or hydration mismatches.
> **See also:** [JavaScript and TypeScript](../languages/javascript-typescript.md),
> [HTML and CSS](../frontend/html-and-css.md), [Accessibility](../frontend/accessibility.md),
> [Web performance](../frontend/web-performance.md),
> [Application and API security](../security/application-security.md),
> [HTTP and REST API design](../api/api-design.md), [Caching and Redis](../data/caching-and-redis.md),
> [Unit, integration, and TDD](../testing/testing.md), [Code and module design](../core/code-design.md)

## Top rules

1. **Keep render pure: same props, state, and context give the same output,
   with no side effects and no mutation during render.** React may render
   twice or discard a render, and the compiler and memoisation assume purity.
   *[Rules of React; Data Security]*
2. **Store only the minimal state that cannot be computed, and derive the rest
   during render.** Duplicated or derived state drifts out of sync and costs an
   extra render to repair. *[Thinking in React; Choosing the State Structure;
   You Might Not Need an Effect]*
3. **Use an Effect only to synchronise with something outside React; if no
   external system is involved, delete the Effect.** Code caused by a user
   action belongs in the event handler, not in an Effect that fires again on
   reload or dependency change. *[You Might Not Need an Effect; Synchronizing
   with Effects]*
4. **Give every Effect that subscribes, connects, or starts a timer a cleanup,
   and guard every async response against staleness.** Out-of-order responses
   overwrite newer data, and leaked timers fire after unmount. *[Synchronizing
   with Effects; You Might Not Need an Effect; Review lessons]*
5. **Key list items with a stable id from the data; never the array index on a
   list that can change, never a value generated during render.** Index keys
   move state onto the wrong row on insert or reorder; random keys remount
   everything. *[Rendering Lists; Review lessons]*
6. **Never suppress `react-hooks/exhaustive-deps` or `rules-of-hooks`; change
   the code to remove a dependency.** Suppression creates stale closures and
   silences warnings for every later edit. *[Removing Effect Dependencies;
   Rules of React; Review lessons]*
7. **Treat every `'use server'` function as a public POST endpoint: parse its
   arguments, re-check authentication, tenant, and ownership inside it, and
   return only what the UI needs.** A page-level auth check does not protect
   the actions defined on that page. *[Data Security; 'use server'; Review
   lessons]*
8. **Pass client components the minimum serialisable data they render, never
   raw database rows.** Every prop lands in a payload the browser can read.
   *[Data Security]*
9. **Ask what happens at 10k rows for every list: paginate or cap the query,
   virtualise long renders, and add the index the query pattern needs.** An
   unbounded list freezes the page and an unbounded query loads the database.
   *[Review lessons]*
10. **Keep React and the RSC framework on the latest patched release, upgrade
    within days of an advisory, and rotate secrets if an exposed app was
    affected.** RSC payload decoders have had unauthenticated remote code
    execution bugs that hit apps with no Server Functions, and follow-up DoS
    fixes needed further upgrades into 2026. *[RSC advisories]*

## Rules of React and component structure

- **Never mutate props, state, Hook arguments, Hook return values, or a value
  already passed into JSX; build a new value.** Each render reads a snapshot,
  and mutation desynchronises the UI and defeats memoisation. *[Rules of React]*
- **Call Hooks only at the top level of a component or custom Hook, before any
  early return, never inside loops, conditions, or nested functions.** React
  matches Hook state by call order. *[Rules of React]*
- **Render components through JSX only; never call a component as a plain
  function or pass a Hook around as a value.** A direct call bypasses React's
  tracking of that component's Hooks. *[Rules of React]*
- **Declare every component at module top level, never inside another
  component's body.** The inner function is a new component type each render,
  so its state and DOM reset every time. *[Preserving and Resetting State]*
- **Run Strict Mode and the current `eslint-plugin-react-hooks` `recommended`
  config in every React project, with the hook rules as errors, and scope any
  unavoidable suppression to one line in one file.** These are React's own checks for the rules above;
  downgrading a correctness rule globally hides real bugs. *[Rules of React;
  Removing Effect Dependencies; Review lessons]*
- **Generate ids inside reusable components with `useId()`, never fixed
  strings.** Two instances on one page otherwise share an id and break label
  and ARIA wiring. *[Review lessons]*

## Modelling state and identity

- **Before adding state, ask whether the value is constant, comes from props,
  or can be computed; if any answer is yes, it is not state.** Store the list
  and read its length, not a separate count. *[Thinking in React]*
- **Put each piece of state in the closest common parent of the components
  that read it, and pass setters down as callbacks.** Data flows down and
  events flow up; add a holder component if no parent fits. *[Thinking in
  React]*
- **Replace interdependent booleans with one status value whose type allows
  only valid combinations.** `isSending` and `isSent` can both be true; a
  `'typing' | 'sending' | 'sent'` union cannot. *[Choosing the State
  Structure]*
- **Store the selected item's id, not a copy of the selected object, and look
  the object up during render.** A copy goes stale when the list is edited.
  *[Choosing the State Structure]*
- **Do not mirror a prop into state; name a prop that is only a seed
  `initialX`.** `useState(prop)` reads the prop once and ignores later
  updates. *[Choosing the State Structure]*
- **Try explicit props or passing JSX as `children` before reaching for
  context; reserve context for tree-wide data such as theme, current user, or
  routing.** Composition removes most prop drilling and keeps data flow
  visible. In React 19 code, render `<Context value>`, not `<Context.Provider>`.
  *[Passing Data Deeply with Context]*
- **Treat a client-side guard, such as a disabled button, as UX only; enforce
  "only one" or "never twice" on the server with a unique index, conflict
  clause, or lock.** Double clicks, retries, and second tabs bypass any
  in-component check. *[Review lessons]*
- **Reset a component's state when its entity changes by rendering it with
  `key={entityId}` from the parent, not by clearing state in an Effect.** A
  new key makes a new instance; an Effect leaves one render of stale values.
  *[You Might Not Need an Effect; Preserving and Resetting State]*

## Effects: when not to use one

- **Compute derived values at the top of render instead of storing them and
  updating them in an Effect.** The Effect version renders stale data once
  and can drift. *[You Might Not Need an Effect]*
- **Decide placement by asking why the code runs: a user interaction means the
  event handler; the component appearing on screen means an Effect.** A POST
  on submit goes in the handler; a "form shown" analytics ping goes in an
  Effect. *[You Might Not Need an Effect; Synchronizing with Effects]*
- **Compute all next state inside one event handler instead of chaining
  Effects that each set state.** Chains cascade re-renders; they are
  acceptable only when each step must fetch, as in dependent dropdowns.
  *[You Might Not Need an Effect]*
- **Notify a parent in the same handler that updates local state, or make the
  child fully controlled; never call `onChange` from an Effect.** Two synced
  copies of state mean the state should be lifted. *[You Might Not Need an
  Effect]*
- **Subscribe to external mutable stores with `useSyncExternalStore` inside a
  custom Hook, with a stable subscribe function.** It handles tearing and
  server snapshots that a hand-written Effect gets wrong. *[You Might Not Need
  an Effect]*

## Effects and async work: writing them correctly

- **Never use a ref to block Strict Mode's second Effect run; fix the missing
  cleanup instead.** The development remount exists to expose leaks that
  appear in production during navigation. *[Synchronizing with Effects]*
- **When fetching in an Effect, set an ignore flag (or compare a request id)
  in the cleanup so only the latest response is applied, and keep the logic in
  a purpose-built custom Hook.** Responses arrive out of order when inputs
  change quickly. *[You Might Not Need an Effect; Synchronizing with Effects; Review lessons]*
- **Shrink dependency arrays mechanically: updater functions instead of reading
  state, objects and functions created inside the Effect or hoisted out of the
  component, primitive fields instead of whole objects, and one Effect per
  unrelated concern.** New identities each render re-trigger the Effect.
  *[Removing Effect Dependencies]*
- **Wrap logic that must read the latest props without re-triggering the
  Effect in `useEffectEvent` (React 19.2 or later), call it only from Effects
  or other Effect Events, keep it out of dependency arrays, and never pass it
  to components or Hooks.** It replaces omitting a dependency; never wrap code
  in it only to silence the lint rule. *[Separating Events from Effects;
  useEffectEvent]*

## Lists, pagination, and scale

- **Do not recompute expensive derivations, such as sort, filter, or group, on
  every render of a large list; derive once per input change.** With the
  compiler on this is automatic for pure code; without it, memoise after
  measuring. *[Review lessons; You Might Not Need an Effect]*
- **When fixing a bug in one `loadMore`, list handler, or fetch Hook, grep for
  every sibling with the same pattern and fix them in the same change.** The
  same defect usually lands in several near-identical components. *[Review lessons]*

## Rendering untrusted data and parsing inputs

- **Let the framework escape text; never pass unsanitised strings to
  `dangerouslySetInnerHTML`, `v-html`, or `{@html}`.** These bypass escaping
  and turn stored data into script. *[Review lessons]*
- **Allow only `http`, `https`, `mailto`, and relative URLs in user-supplied
  `href` and `src` values.** A `javascript:` URL in a link executes on click.
  *[Review lessons]*
- **Parse URL search params, route params, and form data with a schema at the
  component or action boundary, rejecting NaN, empty strings, malformed ids,
  and out-of-range values.** `Number(searchParams.get('page'))` silently
  becomes NaN and propagates. *[Review lessons]*
- **Route all date formatting and "today" through the project's one date
  helper, with an explicit time zone.** Server and browser time zones differ,
  so raw `new Date(string)` in a component produces wrong dates and hydration
  mismatches. *[Review lessons]*
- **Check the permission the displayed data requires, not only the permission
  the page's action requires.** A page that reads another tenant's data is a
  leak even if its buttons are guarded. *[Review lessons]*

## Server and Client Components (React 19, Next.js App Router)

- **Keep components on the server by default and put `'use client'` only on
  the leaf files that need state, handlers, Effects, or browser APIs.**
  Everything a client file imports joins the client bundle. *[Server and
  Client Components]*
- **Nest server-rendered UI inside interactive wrappers by passing it as
  `children` or props, not by importing it into a client file.** Server output
  passed as props stays out of the client module graph. *[Server and Client
  Components]*
- **Mark modules that hold secrets or privileged logic with `import
  'server-only'` and browser-only modules with `client-only`.** A
  wrong-environment import then fails the build instead of leaking or reading
  empty env vars. *[Server and Client Components]*
- **Route reads and writes through one server-only Data Access Layer that
  checks authorisation, scopes every query by tenant, and returns minimal
  DTOs; only that layer reads `process.env` or imports database packages.**
  One audit point beats authorisation scattered across pages. *[Data Security;
  Review lessons]*
- **Use Server Functions for mutations, not reads, and call them through
  `<form action>` or inside a Transition.** Frameworks run actions serially
  and do not cache them; form actions work before JavaScript loads. *['use
  server']*
- **Never mutate during render, such as logging out on a query parameter,
  deleting cookies, or revalidating; do it in a Server Action.** Render is
  side-effect free on the server too. *[Data Security]*
- **Keep sensitive values out of variables captured by inline action
  closures.** Captured values travel to the client and back; framework
  encryption is a backstop, not a guarantee. *[Data Security]*

## Server data fetching, streaming, and caching (Next.js 16, Cache Components)

- **Start independent requests together and await them with `Promise.all`, or
  `Promise.allSettled` when partial failure is acceptable.** Sequential awaits
  form a waterfall. *[Fetching Data]*
- **Fetch in the component that needs the data and deduplicate non-`fetch`
  access per request with `React.cache`.** This avoids prop drilling without
  sharing data across requests. *[Fetching Data]*
- **Await critical data on the server and pass a non-awaited promise for
  secondary data to a client component that unwraps it with `use()` inside
  `<Suspense>`.** Secondary content streams without blocking the page.
  *[Server Components; Fetching Data]*
- **Push runtime reads (`cookies()`, `headers()`, `searchParams`, dynamic
  `params`, uncached fetches) as deep as possible, each behind its own
  `<Suspense>`.** More of the route joins the static shell, and a layout that
  awaits runtime data blocks navigation. *[Caching; Fetching Data]*
- **Cache explicitly with `'use cache'`, give every directive a `cacheLife`,
  and add a `cacheTag` to every entry a mutation must invalidate.** `fetch` is
  uncached by default, and arguments and captured variables become part of the
  cache key. *[Caching; Revalidating]*
- **After a mutation, call `updateTag` in the Server Action when the user must
  see their own write, and `revalidateTag(tag, 'max')` when
  stale-while-revalidate is acceptable; prefer tags to `revalidatePath`.**
  Path invalidation over-invalidates. *[Revalidating]*
- **Handle `Math.random`, `Date.now`, and `crypto.randomUUID` explicitly in
  prerendered routes: `await connection()` inside `<Suspense>` for per-request
  values, or cache the value on purpose.** Otherwise the value freezes into the
  static shell. *[Caching]*
- **Check that `cacheComponents: true` is set before applying this section,
  and never add `unstable_cache` or segment `revalidate` exports to an app
  that has it.** New `create-next-app` projects enable it; apps without it
  follow the previous-model caching guide. *[Caching; Revalidating]*

## Memoisation and the React Compiler

- **With the compiler on, write plain functions and values in new code; keep
  `useMemo` and `useCallback` only where exact control matters, such as a
  stable Effect dependency.** The compiler memoises at least as precisely, but
  only for code that follows the Rules of React. *[React Compiler]*
- **Without the compiler, memoise a calculation only after measuring it at
  roughly 1 ms or more in a production build with CPU throttling.** `useMemo`
  does not speed up the first render. *[You Might Not Need an Effect]*

## Vue 3

- **Never mutate a prop, including nested fields of an object or array prop;
  copy a seed into a local `ref`, derive with `computed`, and emit an event so
  the parent changes it.** Nested mutation evades Vue's warning but breaks
  one-way data flow. *[Vue Props]*
- **Keep computed getters free of side effects and treat their results as
  read-only; put async work and writes in watchers.** A computed value is a
  snapshot rebuilt from its sources. *[Vue Computed Properties]*
- **When destructuring props (3.5+), pass them to `watch` or composables as
  getters such as `() => foo`.** A bare destructured value passed to a function
  is no longer reactive. *[Vue Props]*
- **Follow the Essential style rules: multi-word component names, typed props,
  a stable unique `:key` on every `v-for`, no `v-if` on the same element as
  `v-for` (filter in a computed), and scoped styles.** `v-if` runs before the
  loop variable exists, and unscoped CSS leaks. *[Vue Style Guide: Essential]*

## Svelte 5

- **Derive with `$derived` or `$derived.by` and treat `$effect` as a last
  resort; never use an effect to sync two pieces of state.** Link values with
  callbacks or function bindings, use `{@attach}` for third-party DOM
  libraries, and `createSubscriber` for external sources. *[Svelte Best
  Practices; Svelte $effect]*
- **Remember `$effect` tracks only values read synchronously, and return a
  teardown for intervals and subscriptions.** Reads after `await` or inside
  `setTimeout` are not dependencies; effects never run during SSR, so no
  browser guard is needed. *[Svelte $effect; Svelte Best Practices]*
- **Share state through `createContext`, never module-level state, and use
  `$state.raw` for large values that are replaced rather than mutated.** Module
  state is shared by every user during server rendering. *[Svelte Best
  Practices]*

## Tensions

- **Raw fetch-in-Effect vs framework data fetching.** The ignore-flag Effect is
  correct but low level. This library prefers Server Components, `use()`, or a
  query library such as TanStack Query or SWR; use the raw pattern only when
  none exists, and keep it inside a custom Hook so it can migrate. *[You Might
  Not Need an Effect; Fetching Data]*
- **Manual memoisation vs the compiler.** Pre-compiler guidance adds `memo`,
  `useMemo`, and `useCallback` after profiling; with the compiler the default
  is none. This library follows the compiler default where it is enabled and
  the measure-first rule where it is not, and never strips existing
  memoisation without tests, since removal can change compiled behaviour.
  Project rules must say whether the compiler is on. *[React Compiler; You
  Might Not Need an Effect]*
- **Adjusting state during render vs restructuring.** React allows the
  "previous prop" pattern but calls it hard to follow. This library
  restructures first (store an id, derive the item, or reset with a `key`) and
  uses the pattern only as a last resort. *[You Might Not Need an Effect]*
- **Ignore flag vs `AbortController`.** Aborting saves bandwidth but does not
  cover every path; the flag or request-id comparison guarantees correctness.
  This library requires the flag and adds abort when requests are expensive.
  *[Synchronizing with Effects; Review lessons]*
- **Framework Server Action protections vs per-action authorisation.**
  Encrypted action ids, dead-code elimination, and the origin check reduce
  exposure but authorise nothing. This library requires every action to
  authenticate and authorise on its own; React's experimental taint APIs are
  an extra layer, not a substitute for DAL filtering. *[Data Security]*

## Sources

- **Rules of React**: react.dev reference (<https://react.dev/reference/rules>)
- **Thinking in React**: react.dev learn (<https://react.dev/learn/thinking-in-react>)
- **Choosing the State Structure**: react.dev learn (<https://react.dev/learn/choosing-the-state-structure>)
- **Rendering Lists**: react.dev learn (<https://react.dev/learn/rendering-lists>)
- **Preserving and Resetting State**: react.dev learn (<https://react.dev/learn/preserving-and-resetting-state>)
- **You Might Not Need an Effect**: react.dev learn (<https://react.dev/learn/you-might-not-need-an-effect>)
- **Synchronizing with Effects**: react.dev learn (<https://react.dev/learn/synchronizing-with-effects>)
- **Separating Events from Effects**: react.dev learn (<https://react.dev/learn/separating-events-from-effects>)
- **Removing Effect Dependencies**: react.dev learn (<https://react.dev/learn/removing-effect-dependencies>)
- **Passing Data Deeply with Context**: react.dev learn (<https://react.dev/learn/passing-data-deeply-with-context>)
- **useEffectEvent**: react.dev reference and React 19.2 release post (<https://react.dev/reference/react/useEffectEvent>, <https://react.dev/blog/2025/10/01/react-19-2>)
- **React Compiler**: react.dev, React Compiler introduction (<https://react.dev/learn/react-compiler/introduction>)
- **Server Components**: react.dev reference (<https://react.dev/reference/rsc/server-components>)
- **'use server'**: react.dev reference (<https://react.dev/reference/rsc/use-server>)
- **RSC advisories**: React blog, "Critical Security Vulnerability in React Server Components" and "Denial of Service and Source Code Exposure in React Server Components" (December 2025); Next.js blog, "Security Advisory: CVE-2025-66478" (<https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components>, <https://react.dev/blog/2025/12/11/denial-of-service-and-source-code-exposure-in-react-server-components>, <https://nextjs.org/blog/CVE-2025-66478>)
- **Server and Client Components**: Next.js App Router docs (<https://nextjs.org/docs/app/getting-started/server-and-client-components>)
- **Fetching Data**: Next.js App Router docs (<https://nextjs.org/docs/app/getting-started/fetching-data>)
- **Caching**: Next.js App Router docs, Caching with Cache Components (<https://nextjs.org/docs/app/getting-started/caching>)
- **Revalidating**: Next.js App Router docs (<https://nextjs.org/docs/app/getting-started/revalidating>)
- **Data Security**: Next.js guide (<https://nextjs.org/docs/app/guides/data-security>)
- **Vue Props**: Vue 3 guide, Props (<https://vuejs.org/guide/components/props.html>)
- **Vue Computed Properties**: Vue 3 guide (<https://vuejs.org/guide/essentials/computed.html>)
- **Vue Style Guide: Essential**: Vue style guide, Priority A rules (<https://vuejs.org/style-guide/rules-essential>)
- **Svelte Best Practices**: Svelte 5 docs (<https://svelte.dev/docs/svelte/best-practices>)
- **Svelte $effect**: Svelte 5 docs (<https://svelte.dev/docs/svelte/$effect>)
- **Review lessons**: rules distilled from the maintainer's code-review findings
