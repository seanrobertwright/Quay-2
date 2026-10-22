# Web performance

> **Load when:** building, changing, or reviewing anything that affects how fast a web page
> loads, responds, or stays visually stable: the HTML `<head>`, script and stylesheet tags,
> images, video, fonts, embeds, ads, or third-party tags; event handlers and other main-thread
> work; bundler code-splitting; Cache-Control, CDN, redirect, or Server-Timing headers on
> HTML and static assets; service workers, prefetch, prerender, or speculation rules; long
> lists and large DOMs; or when a task mentions Core Web Vitals, LCP, INP, CLS, TTFB,
> Lighthouse, PageSpeed, RUM, the `web-vitals` library, bfcache, or a performance budget.
> **See also:** [HTML and CSS](../frontend/html-and-css.md),
> [Components and state](../frontend/components-and-state.md),
> [Accessibility](../frontend/accessibility.md),
> [JavaScript and TypeScript](../languages/javascript-typescript.md),
> [Performance and load testing](../testing/performance-and-load-testing.md),
> [Caching and Redis](../data/caching-and-redis.md),
> [API design](../api/api-design.md),
> [Application security](../security/application-security.md),
> [Observability](../operations/observability-and-reliability.md),
> [CI/CD](../devops/ci-cd.md)

## Top rules

1. **Judge pages by the three Core Web Vitals at the 75th percentile of real loads, split by
   mobile and desktop: LCP at most 2.5 s, INP at most 200 ms, CLS at most 0.1.** A page passes
   only when all three pass at p75; set priorities from field data and use lab tools to
   reproduce and to catch regressions. *[web.dev Perf, Web Vitals; web.dev Perf, Lab and field
   data differences]*
2. **Put the LCP image in the server-sent HTML, never lazy-load it, and mark it
   `fetchpriority="high"`.** An image injected by JavaScript or referenced only from CSS is
   invisible to the preload scanner and starts late. *[web.dev Perf, Optimize LCP; web.dev
   Perf, Browser-level image lazy loading]*
3. **Give every image, video, iframe, ad slot, and late banner reserved space** with
   `width`/`height` attributes or `aspect-ratio`/`min-height`. Unsized content is the main
   cause of layout shift. *[web.dev Perf, Optimize CLS]*
4. **In event handlers, paint the visual response first and yield before everything else.**
   Saving, analytics, and derived updates go after a yield, so the next frame is not held
   behind them. *[web.dev Perf, Optimize INP; web.dev Perf, Optimize long tasks]*
5. **Keep the parser and first render unblocked.** No synchronous scripts in `<head>`, no CSS
   `@import`, no hide-until-hydrated or client-side A/B wrappers around the LCP element.
   Prefer server rendering or static generation for above-the-fold content. *[web.dev
   Perf, Optimize LCP; web.dev Perf, Optimize resource loading]*
6. **Ship less JavaScript at startup.** Load code that only an interaction needs with dynamic
   `import()`, load third-party tags `async` or `defer`, and lazy-load below-the-fold embeds.
   *[web.dev Perf, Code-split JavaScript; web.dev Perf, Efficiently load third-party
   JavaScript]*
7. **Cache fingerprinted assets for a year and revalidate HTML; never let a shared cache
   store per-user or per-tenant responses.** Use `no-cache` plus `ETag` on HTML, `private` on
   anything personalized, and key any shared cache of it by tenant and user, or skip it.
   A cache keyed only by URL serves one tenant's page to another. *[web.dev Perf, HTTP
   cache; Review lessons]*
8. **Never register `unload` handlers.** They can make the page ineligible for the
   back/forward cache and Chrome is phasing the event out; use `pagehide` or
   `visibilitychange` instead. *[web.dev Perf, Back/forward cache]*
9. **Cap, paginate, or virtualize every list that can grow, and keep the DOM small.** Ask what
   happens at 10k rows: layout and style costs scale with node count and land on every
   interaction. *[web.dev Perf, DOM size and interactivity; Review lessons]*
10. **Prove every performance claim with before/after numbers from the same setup, and
    enforce budgets in CI.** Never type a speed-up you did not measure, and scope any budget
    exception to the one page that needs it, with a tracked reason. *[web.dev Perf,
    Performance budgets 101; Review lessons]*

## Images and media

- **Serve images at rendered size times device pixel ratio.** Use `srcset` width descriptors
  with a matching `sizes` (width descriptors without `sizes` do not work), or density
  descriptors for fixed-size slots, with one aspect ratio across all candidates. *[web.dev
  Perf, Image performance; web.dev Perf, Optimize CLS]*
- **Offer modern formats through `<picture>`: AVIF, then WebP, then a JPEG or PNG
  fallback.** If the server negotiates format from the `Accept` header, send `Vary: Accept`
  so caches keep the variants apart. *[web.dev Perf, Image performance]*
- **Use native `loading="lazy"` for offscreen images and iframes, not a JavaScript
  lazy-loader.** It still works when a script fails and is harmless where unsupported; it does
  not apply to CSS background images. *[web.dev Perf, Browser-level image lazy loading;
  web.dev Perf, Efficiently load third-party JavaScript]*
- **Never lazy-load any image likely to be in the initial viewport.** Lazy above-the-fold
  images start late and often become the LCP. *[web.dev Perf, Browser-level image lazy
  loading]*
- **Always size lazy images.** Without dimensions they collapse to zero height and a whole
  gallery can count as "in view" and load at once. *[web.dev Perf, Browser-level image lazy
  loading]*
- **Use `fetchpriority="high"` on one or two images at most, and `fetchpriority="low"` on
  visible-but-secondary ones** such as carousel slides after the first. Too many high hints
  compete for the same bandwidth. *[web.dev Perf, Fetch Priority]*

## LCP and the critical rendering path

- **Break LCP into its four subparts before optimizing: TTFB, resource load delay, resource
  load duration, element render delay.** Both delays should be near zero; shrinking an image
  while render delay dominates only moves the time. *[web.dev Perf, Optimize LCP]*
- **When the LCP resource can only come from CSS or JavaScript, add
  `<link rel="preload" as="..." fetchpriority="high">` for it.** Otherwise the browser
  discovers it only after the stylesheet or script runs. *[web.dev Perf, Optimize LCP;
  web.dev Perf, Optimize resource loading]*
- **Serve critical resources, including the LCP image, from the HTML's own origin when
  possible.** A new origin costs DNS, TCP, and TLS setup on the critical path. *[web.dev Perf,
  Optimize LCP]*
- **Choose script loading on purpose.** `defer` for ordered scripts that need the parsed
  document, `async` for independent ones; `type="module"` is deferred by default; a plain
  `<script>` blocks the parser and waits for pending CSS. *[web.dev Perf, Optimize resource
  loading]*
- **Link every stylesheet with `<link rel="stylesheet">`; do not chain them with `@import`.**
  Imports serialize downloads and hide files from the preload scanner; preload the imported
  file if `@import` is unavoidable. *[web.dev Perf, Optimize resource loading]*
- **Inline only small critical CSS and tiny scripts, and measure the result.** Inlined bytes
  are re-sent on every page and cannot be cached. *[web.dev Perf, Optimize resource loading]*
- **Preload only resources the parser finds late; set `as` on every preload, and
  `crossorigin` only for CORS resources such as fonts.** A missing `as` or a wrong
  `crossorigin` fetches the file twice. *[web.dev Perf, Resource hints]*
- **Preconnect only to the few cross-origin hosts the current page needs early; use
  `dns-prefetch` for the rest.** Unused connections close after about ten seconds, so extra
  preconnects are wasted work; font origins need `crossorigin` on the preconnect.
  *[web.dev Perf, Resource hints; web.dev Perf, Efficiently load third-party JavaScript]*

## Interactivity (INP) and main-thread work

- **Know what INP measures.** Only clicks, taps, and key presses count (not hover, scroll, or
  zoom), and the value is near the worst interaction, so one slow common handler fails the
  page. *[web.dev Perf, INP]*
- **Yield through one shared `yieldToMain()` helper.** Use `scheduler.yield()` when both
  `scheduler` and `scheduler.yield` exist, and fall back to a `setTimeout` promise; browser
  support is incomplete, so the fallback is required. *[web.dev Perf, Optimize long tasks]*

  ```js
  const yieldToMain = () =>
    globalThis.scheduler?.yield ? scheduler.yield() : new Promise(r => setTimeout(r, 0));
  ```

- **In long loops, batch work and yield after a deadline (about 50 ms), not after every
  item.** Use `for` with `await`; `forEach` does not wait for async callbacks. *[web.dev Perf,
  Optimize long tasks]*
- **Yield unconditionally; do not gate yields on `isInputPending()`.** It misses real input
  and ignores pending rendering work, and web.dev no longer recommends it. *[web.dev Perf,
  Optimize long tasks]*
- **Read layout before writing styles, and never read `offsetHeight`, `getBoundingClientRect`,
  or similar after a style change in the same task.** Read-after-write forces synchronous
  layout; inside a loop it thrashes, and layout cost grows with the whole document.
  *[web.dev Perf, Avoid large, complex layouts and layout thrashing]*
- **Keep the DOM only as big as the visible task needs.** Flatten wrappers, use framework
  fragments, render collapsed sections when opened, and apply `content-visibility: auto` or
  CSS containment to large offscreen subtrees; Lighthouse starts warning around 800 nodes.
  *[web.dev Perf, DOM size and interactivity]*
- **Avoid building big HTML strings or large client renders in one go.** The browser does not
  yield while it parses a large `innerHTML` or renders a big tree, unlike streamed server HTML.
  *[web.dev Perf, Optimize INP]*
- **Do not recompute expensive derivations on every render or keystroke.** Memoize, index, or
  move them off the hot path; derived counts belong after a yield. *[Review lessons; web.dev
  Perf, Optimize INP]*
- **Move heavy self-contained work (parsing, image metadata, diffing large data) to a Web
  Worker and post results back for the main thread to apply.** Do not try to move DOM code;
  use a messaging wrapper when the protocol grows. *[web.dev Perf, Web worker overview]*
- **Clear timers, observers, and pending work when a component unmounts, and drop stale async
  responses with a request id.** Orphaned callbacks keep running on the main thread and can
  paint outdated data. *[Review lessons]*

## Layout stability (CLS)

- **Reserve space for ads, embeds, and injected banners at their smallest likely size, and
  keep the placeholder when nothing fills it.** Collapsing an empty slot is also a shift;
  insert late content below the viewport or overlay it outside the flow. *[web.dev Perf,
  Optimize CLS]*
- **Animate with `transform` and `opacity`, never `top`, `left`, `width`, or `height`, and
  honor `prefers-reduced-motion`.** Composited transforms are not layout shifts; geometric
  properties trigger layout. *[web.dev Perf, CLS; web.dev Perf, Optimize CLS]*
- **Do not rely on the 500 ms post-input grace window for network-loaded content.** If a
  "load more" fetch can exceed it, reserve the space immediately; shifts after scroll or hover
  are never excused. *[web.dev Perf, Optimize CLS; web.dev Perf, CLS]*

## Fonts

- **Set `font-display` explicitly on every `@font-face`: `optional` for body text where
  stability matters most, `swap` for brand faces.** Use `block` only when text must never show
  in a fallback face; `auto` varies by browser. *[web.dev Perf, Font best practices]*
- **Match fallback metrics with `size-adjust` and the ascent, descent, and line-gap
  overrides** so the late swap barely moves text. *[web.dev Perf, Font best practices;
  web.dev Perf, Optimize CLS]*
- **Ship WOFF2, subset with `unicode-range`, and inline the `@font-face` rules in `<head>`.**
  Check the font license before subsetting. *[web.dev Perf, Font best practices]*
- **Preload only the one or two most important font files.** Preload ignores `unicode-range`,
  so every preloaded subset downloads even when the page needs none of its glyphs. *[web.dev
  Perf, Font best practices]*
- **Replace icon fonts with inline or sprite SVG.** Icon-font fallbacks render as unrelated
  glyphs and cause large shifts. *[web.dev Perf, Font best practices]*

## JavaScript size and third parties

- **Keep the bundler's shared-chunk splitting on.** Disabling it duplicates shared modules
  across bundles. *[web.dev Perf, Code-split JavaScript]*
- **Find unused startup JavaScript and CSS with the DevTools Coverage panel and Lighthouse's
  JavaScript execution-time diagnostic before adding more code.** Treat its thresholds (the
  source cites a warning near 2 s) as rough, since Lighthouse is moving audits into
  "insights". *[web.dev Perf, Code-split JavaScript]*
- **Add `crossorigin="anonymous"` to third-party script tags you control** so Long Animation
  Frame attribution can name the responsible script. *[Chrome Docs, Long Animation Frames]*

## Server response, caching, and delivery

- **Treat TTFB, FCP, and TBT as diagnostics, not goals.** They explain a Core Web Vital; TTFB
  is roughly good at 0.8 s and poor above 1.8 s at p75. *[web.dev Perf, Web Vitals; web.dev
  Perf, Optimize TTFB]*
- **Remove same-origin redirects (missing `https://`, inconsistent trailing slashes) and
  keep cross-origin chains short; send HSTS** so returning users skip the HTTP hop.
  *[web.dev Perf, Optimize TTFB]*
- **Verify the CDN really serves HTML from the edge.** Unique analytics query parameters can
  turn every request into a miss; keep a cache-bypass switch to measure true backend time.
  *[web.dev Perf, Optimize TTFB; web.dev Perf, Optimize LCP]*
- **Stream or pre-render HTML so parsing starts before the response finishes, and use 103
  Early Hints for critical CSS when the backend is slow.** Early Hints can mask server time,
  so measure server response separately. *[web.dev Perf, Optimize TTFB]*
- **Send a `Server-Timing` header that breaks down backend work (database, render, cache hit
  or miss).** It appears in DevTools and Navigation Timing, which makes TTFB regressions
  attributable. *[web.dev Perf, Optimize TTFB]*
- **Use fingerprinted asset URLs with `max-age` of one year, `no-cache` plus `ETag` for
  unversioned URLs such as HTML, `private` for per-user responses, and `no-store` only for
  responses that must never be stored.** *[web.dev Perf, HTTP cache]*
- **Send `X-Content-Type-Options: nosniff` on asset, binary, and download routes.** Long-lived
  cached assets must not be reinterpreted as a different content type. *[Review lessons]*

## Navigation speed: bfcache and speculative loading

- **Use `pagehide` or `visibilitychange` instead of `unload`, and add `beforeunload` only
  while there are unsaved changes.** A `Permissions-Policy: unload=()` header blocks
  third-party unload handlers in Chromium. *[web.dev Perf, Back/forward cache]*
- **Reserve `Cache-Control: no-store` on HTML for truly sensitive pages; use `no-cache` or
  `max-age=0` elsewhere.** `no-store` has historically blocked bfcache (Chrome is relaxing
  this, so never rely on it to hide data after logout); find other blockers with the DevTools
  bfcache test and the `notRestoredReasons` API.
  *[web.dev Perf, Back/forward cache]*
- **Close IndexedDB, WebSocket, and in-flight requests in `pagehide`; in `pageshow` with
  `event.persisted`, refresh user state.** A restored page can show data that went stale, for
  example after logout. *[web.dev Perf, Back/forward cache]*
- **Use speculation rules for likely next navigations, not `<link rel="prerender">`.** Prefer
  document rules with `moderate` or `conservative` eagerness over `immediate` URL lists;
  treat them as progressive enhancement because only Chromium ships them (Safari has them
  behind a flag). *[Chrome Docs,
  Prerender pages; web.dev Perf, Prefetching, prerendering, and precaching]*
- **Do not speculate on personalized or authenticated pages, and skip speculation when
  Save-Data is on.** Delay side effects such as analytics until the prerendered page is
  activated. *[web.dev Perf, Prefetching, prerendering, and precaching; Chrome Docs, Prerender
  pages]*
- **Precache in a service worker only what is very likely to be used.** Hashed files need no
  extra revision; let the build assign revisions to unversioned files, and prefer runtime
  caching when unsure. *[web.dev Perf, Prefetching, prerendering, and precaching]*

## Perceived performance

- **Show feedback (pressed state, spinner, skeleton) within about 50 ms of an action, and
  render partial content as it arrives.** Feedback does not shorten the task, but it stops the
  UI from feeling frozen; keep frames at an even pace of about 16.7 ms. *[MDN Perf, Perceived
  performance]*
- **Give loading indicators an accessible name and status** so the speed-up is not
  visual-only; follow the live-region guidance in the accessibility file. *[Review lessons]*

## Measuring and budgets

- **Collect field vitals with the `web-vitals` library's attribution build, and pin its
  version.** Send the LCP element, CLS source, INP target, and subpart breakdown with each
  metric. *[web.dev Perf, Debug performance in the field; web.dev Perf, Web Vitals]*
- **Send RUM data with `sendBeacon` (or `fetch` with `keepalive`) when `visibilitychange`
  reports hidden.** CLS and INP are final only when the page hides, and unload may never fire.
  *[web.dev Perf, Field measurement best practices]*
- **Report p75 against thresholds and p90 or p95 for the slowest users, segmented by device
  and connection; never averages.** *[web.dev Perf, Field measurement best practices]*
- **Tag RUM with a release version, and assign A/B groups on the server.** Deploy dates blur
  releases, and client-side A/B tools distort LCP. *[web.dev Perf, Field measurement best
  practices]*
- **Keep RUM code cheap (late, async, idle work, only fields you use), and diagnose field INP
  with Long Animation Frames, a Chromium-only sample.** Heavy measurement creates the long
  tasks it is meant to find. *[web.dev Perf, Field measurement best practices; Chrome Docs,
  Long Animation Frames]*
- **Do not treat a Lighthouse load run as an INP measurement.** TBT is only a proxy; test
  interactions by hand or with scripted flows, including during load. *[web.dev Perf, Lab and
  field data differences]*
- **Measure durations with `performance.now()` or Performance entries, not `Date`
  subtraction, and bucket stored timestamps through the project's single date helper in UTC.**
  Wall-clock time jumps and local-time parsing corrupt percentiles. *[Review lessons]*
- **Parse RUM beacon bodies at the endpoint boundary with a schema that rejects NaN, negative,
  and out-of-range values, and scope its CORS to your own origins.** A beacon endpoint is
  public input that writes state. *[Review lessons]*
- **Set budgets per page type that combine byte and request limits with user-centric timings
  (LCP, INP, CLS, TBT), and fail the build when they break.** Lab setup and CI gating belong
  in the performance-testing file. *[web.dev Perf, Performance budgets 101]*

## Reviewing and shipping performance changes

- **State a performance claim in a comment or PR description only with measured numbers,
  the setup that produced them, and the metric's percentile.** Re-check every such claim the
  diff touches; a "lazy" or "under budget" comment must match the code. *[Review lessons]*
- **After fixing one performance defect, grep for its siblings and fix them in the same
  commit.** A lazy-loaded hero, an `unload` handler, or a missing image size usually repeats
  across templates. *[Review lessons]*

## Tensions

- **Inline critical CSS vs cached external stylesheets.** Default to linked stylesheets;
  inline only a small critical set when field LCP shows render delay, and measure repeat
  views. *[web.dev Perf, Optimize resource loading; web.dev Perf, Optimize LCP]*
- **Split code aggressively vs a few larger chunks.** This library splits by route and by
  interaction, not by module: tiny chunks compress worse and add round trips, while one huge
  bundle breaks caching on every change. *[web.dev Perf, Code-split JavaScript]*
- **Self-host third-party scripts and fonts vs vendor CDNs.** Self-host behind a CDN with
  HTTP/2 or later and an owner for updates (without both a win is much less likely); measure
  against the vendor setup rather than assuming one. *[web.dev Perf, Efficiently load third-party JavaScript; web.dev Perf, Font
  best practices]*
- **Lab scores vs field data.** Field data decides priorities; the lab reproduces and guards
  against regressions, on throttled low-end mobile settings because field data omits users
  who never finished loading. *[web.dev Perf, Lab and field data differences]*
- **Prerender for instant navigation vs resource cost.** Prefetch by default; prerender only
  near-certain, non-personalized next pages. *[Chrome Docs, Prerender pages; web.dev Perf,
  Prefetching, prerendering, and precaching]*
- **Fetch Priority and Early Hints as wins vs as hints.** Both are hints that CDNs and
  protocols apply unevenly; keep a change only after DevTools or field data shows it helped.
  *[web.dev Perf, Fetch Priority; web.dev Perf, Optimize TTFB]*
- **Dated advice.** INP replaced FID as a Core Web Vital in March 2024, so add no FID
  collection; Lighthouse dropped Time to Interactive, so budgets from older material that use
  TTI should move to LCP, INP, CLS, and TBT; `<link rel="prerender">` now only prefetches;
  `isInputPending()` is no longer recommended. Lighthouse DOM-size thresholds are rough
  guides that may move. *[web.dev Perf, Web Vitals; web.dev Perf, Performance budgets 101;
  web.dev Perf, Optimize long tasks]*

## Sources

- **web.dev Perf**: web.dev performance articles and the Learn Performance course (Google
  Chrome team), cited by article title; each lives at <https://web.dev/> plus the path shown: Web
  Vitals (`articles/vitals`); Optimize LCP (`articles/optimize-lcp`); Optimize INP
  (`articles/optimize-inp`); INP (`articles/inp`); Optimize CLS (`articles/optimize-cls`); CLS
  (`articles/cls`); Optimize long tasks (`articles/optimize-long-tasks`); Optimize TTFB
  (`articles/optimize-ttfb`); Fetch Priority (`articles/fetch-priority`); Browser-level image
  lazy loading (`articles/browser-level-image-lazy-loading`); HTTP cache
  (`articles/http-cache`); Back/forward cache (`articles/bfcache`); Font best practices
  (`articles/font-best-practices`); Efficiently load third-party JavaScript
  (`articles/efficiently-load-third-party-javascript`); DOM size and interactivity
  (`articles/dom-size-and-interactivity`); Avoid large, complex layouts and layout thrashing
  (`articles/avoid-large-complex-layouts-and-layout-thrashing`); Debug performance in the field
  (`articles/debug-performance-in-the-field`); Field measurement best practices
  (`articles/vitals-field-measurement-best-practices`); Lab and field data differences
  (`articles/lab-and-field-data-differences`); Performance budgets 101
  (`articles/performance-budgets-101`); Optimize resource loading
  (`learn/performance/optimize-resource-loading`); Resource hints
  (`learn/performance/resource-hints`); Image performance
  (`learn/performance/image-performance`); Code-split JavaScript
  (`learn/performance/code-split-javascript`); Prefetching, prerendering, and precaching
  (`learn/performance/prefetching-prerendering-precaching`); Web worker overview
  (`learn/performance/web-worker-overview`).
- **Chrome Docs**: Chrome for Developers documentation: Prerender pages
  (<https://developer.chrome.com/docs/web-platform/prerender-pages>) and Long Animation Frames
  API (<https://developer.chrome.com/docs/web-platform/long-animation-frames>)
- **MDN Perf**: MDN Web Docs, Perceived performance
  (<https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Performance/Perceived_performance>)
- **Review lessons**: rules distilled from the maintainer's code-review findings
