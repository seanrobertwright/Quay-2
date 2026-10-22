# Performance and load testing

> **Load when:** writing, running, or reviewing a load, stress, soak, spike, or breakpoint test
> (k6, Gatling, JMeter, Locust, or a hand-rolled harness); writing a microbenchmark (JMH or
> similar) or acting on its result; setting latency or throughput SLO thresholds or a
> performance budget; adding a performance gate to CI (k6 thresholds, Lighthouse CI);
> comparing a baseline run against a candidate run; deciding whether a change is a performance
> regression or improvement; collecting or reading lab or field (RUM) page-speed data; or
> making a performance claim in a PR description.
> **See also:** [Web performance](../frontend/web-performance.md),
> [Testing](testing.md), [CI/CD](../devops/ci-cd.md),
> [Observability and reliability](../operations/observability-and-reliability.md),
> [Scalability](../architecture/scalability-and-system-design.md),
> [SQL performance](../data/sql-and-query-performance.md),
> [Caching](../data/caching-and-redis.md), [Concurrency](../concurrency/concurrency.md),
> [Java](../languages/java.md), [Debugging](../core/debugging.md),
> [Operating systems](../systems/operating-systems-and-linux.md)

## Top rules

1. **Write pass/fail criteria as machine-checked thresholds that fail the run, never as numbers
   someone reads off a summary.** A failed k6 threshold makes the process exit non-zero, so CI
   gates performance like any other test. *[k6 Terms 11 Thresholds; web.dev Perf: Performance
   budgets 101]*
2. **Gate on percentiles (p95, p99; p75 for Core Web Vitals) and on an error rate together.**
   Averages hide the slow tail users feel, a latency-only gate passes a system that fails fast,
   and an error-only gate passes one that is slow but correct. *[k6 Terms 7, 8, 11; JavaPerf
   ch. 2; web.dev Perf: Best practices for measuring Web Vitals in the field]*
3. **Pick the load model on purpose: arrival rate (open) when the requirement is "sustain N
   requests per second", VU count with think time (closed) when it is "N concurrent users".**
   In a closed model a slow system receives less load just when it is struggling (coordinated
   omission), which hides saturation. *[k6 Terms 19, 23; JavaPerf ch. 2; k6 docs: Open and
   closed models]*
4. **Model real user journeys with a realistic mix, data volume, and per-user session state.**
   One endpoint hit in a loop misses contention on shared state, sessions, caches, and
   downstream calls. *[k6 Terms 15, 17, 20, 21; JavaPerf ch. 2]*
5. **Run the decisive test against the whole system, on production-like hardware, with real
   dependencies, at the expected load.** Mocks, laptops, and isolated modules change JIT, GC,
   cache, network, and contention behaviour; extrapolated numbers are predictions.
   *[JavaPerf ch. 2]*
6. **Find the system-wide bottleneck before optimising any component.** Throughput is set by
   the slowest stage; speeding up another stage only pushes more load into the bottleneck and
   can lower total throughput. *[JavaPerf ch. 1, 2]*
7. **Never call a change a regression or an improvement from one run each.** Repeat baseline
   and candidate, compare with a significance test, and weigh effect size by how often the code
   runs. *[JavaPerf ch. 2; web.dev Perf: Lighthouse CI getting started]*
8. **Treat a microbenchmark as a hint, never as evidence for a decision.** Write it with JMH or
   an equivalent harness, have it reviewed, and confirm the result in a module-level or
   full-application test; a good harness does not remove benchmarking pitfalls.
   *[JavaPerf ch. 2; JMH]*
9. **Back every performance claim in a PR or doc with the measurement, environment, and run
   count that produced it.** A sentence such as "2x faster" with no reproducible run is an
   unverified claim, and the claims audit rejects it. *[Review lessons; JavaPerf ch. 2]*
10. **Load only systems you own or are authorised to load, and keep tokens out of scripts.**
    Point tests at your own environment, read credentials from environment variables or a
    secret store, and never commit them with the script. *[k6 Terms caveats; web.dev Perf:
    Lighthouse CI getting started; Review lessons]*

## Planning a test

- **Name the question before writing the script, then choose the test type that answers it.**
  Smoke (script works, minimal load), average-load (expected traffic), stress (above average),
  soak (average load for hours), spike (sudden short surge), breakpoint (ramp until failure).
  *[k6 docs: Load test types; k6 Terms 20 Load Testing]*
- **Run a smoke test first and an average-load test before any stress, spike, or soak test.**
  A broken script or a system that already fails at normal load makes the harder tests
  meaningless. *[k6 docs: Load test types]*
- **Choose test types from the system's risk profile; no single type covers every risk.** Soak
  finds leaks, connection exhaustion, and log or disk growth; stress and spike find saturation
  and recovery problems; breakpoint finds capacity. *[k6 docs: Load test types]*
- **Classify the measurement as elapsed time (batch), throughput, or response time, and report
  throughput and latency together.** Lower latency at lower throughput is not an improvement.
  *[JavaPerf ch. 2]*
- **Derive thresholds from an SLO or a stated user requirement, not from whatever the first run
  produced.** A threshold copied from a baseline run encodes the current performance, good or
  bad, as the target. *[k6 Terms 11; web.dev Perf: Performance budgets 101]*
- **Ask "what happens at 10k rows" (and at 10x expected traffic) for every list, query, and
  queue on the path under test.** Seed data at production-like volume so missing indexes,
  unbounded result sets, and per-render recomputation show up in the test, not in production.
  *[Review lessons]*
- **Run performance tests continuously in the development cycle, not once before release.**
  Regressions that need architectural fixes are cheap only while little code depends on the
  slow design. *[JavaPerf ch. 2]*

## Workload modelling

- **Ramp up, hold a plateau, and ramp down; do not start at peak.** A ramp shows the load level
  where degradation begins and keeps warm-up separate from saturation. Keep shapes simple so
  runs are comparable. *[k6 Terms 5, 22, 23; k6 docs: Load test types]*
- **Give each distinct user journey its own scenario, executor, and load shape.** Parallel
  scenarios (browse plus checkout, read plus write) reproduce a mixed workload in one run.
  *[k6 Terms 15 Scenario]*
- **Add think time between actions in closed-model (VU) tests.** Without pauses each VU fires
  far faster than a person, so the VU count no longer means concurrent users; iteration time is
  request time plus sleep. *[k6 Terms 23; JavaPerf ch. 2]*
- **For a fixed request rate, use an arrival-rate executor (or a fixed cycle time) and check
  that achieved throughput matches the target.** A large gap means the test itself failed. In
  k6, threshold `dropped_iterations`: drops from the start mean too few VUs (raise
  `preAllocatedVUs` or `maxVUs`); drops that begin mid-run mean the system is slowing, and more
  VUs will not fix that. *[JavaPerf ch. 2; k6 docs: Open and closed models; Dropped iterations]*
- **Give each virtual user its own cookies, session, and identity, and start new sessions as
  often as real users do.** Shared or missing session state skips auth paths, inflates cache
  hit rates, and leaves the heap shaped differently from production. *[k6 Terms 17 Cookies;
  JavaPerf ch. 10]*
- **Spread test traffic across many tenants and users, not one test account.** A single tenant
  hides queries that are missing the tenant column in their index and keeps every row hot in
  cache. *[Review lessons]*
- **Make test data vary per iteration (ids, search terms, payload sizes) within production-like
  distributions.** Repeating one request measures the cache, not the system. *[JavaPerf ch. 2]*
- **Exercise the same features production uses in module-level benchmarks.** A benchmark
  request with no session or no auth can reverse a comparison once real requests carry them.
  *[JavaPerf ch. 2]*
- **Include a concurrency test for every "only one", "never twice", or "at most N" invariant.**
  Fire parallel duplicate requests and assert the database (unique index, `onConflict`,
  `FOR UPDATE`, advisory lock) held the invariant; an in-process guard passes single-user tests
  and fails under load. *[Review lessons]*

## Thresholds, checks, and results

- **Pair a latency threshold (`http_req_duration` p95/p99) with an error-rate threshold
  (`http_req_failed` rate).** Either one alone lets a broken system pass. *[k6 Terms 11]*
- **Add per-endpoint thresholds for critical routes, scoped by tag or request name** (for
  example `http_req_duration{name:checkout}`). One slow checkout call can hide inside a healthy
  global aggregate. *[k6 Terms 11; k6 docs: Thresholds]*
- **Use checks to assert response correctness, and put a threshold on the `checks` rate when
  correctness must gate the run.** A failed check alone does not change the exit code.
  *[k6 Terms 9 Checks; k6 docs: Thresholds]*
- **Use k6's default failure classification (status outside 200-399) or set expected statuses
  explicitly.** Do not rely on hand-written rules about which codes count as failures.
  *[k6 Terms caveats]*
- **Use `abortOnFail` on thresholds that make further load pointless or harmful**, such as an
  error rate that shows the system is already down, and set `delayAbortEval` so a few early
  samples cannot abort the run. *[k6 docs: Thresholds]*
- **Group failures by `error_code` and status tag, not by raw error strings.** Network-level
  failures (DNS, reset, timeout) point to different fixes than application errors.
  *[k6 Terms 13, 14, 18]*
- **Export machine-readable results (`handleSummary()` to JSON or JUnit) as CI artifacts.**
  Trends and reviews then use stored data, not console scrollback. *[k6 Terms 1]*
- **Report at least one high percentile and the average, and look at the distribution.**
  Averages hide outliers such as GC pauses; percentiles hide the outliers' size. *[JavaPerf
  ch. 2; k6 Terms 7, 8]*
- **Exclude the warm-up period from steady-state measurements of JIT-compiled or cache-backed
  systems.** Measure cold deliberately only when startup or a cold-cache job is the question.
  *[JavaPerf ch. 2, 4]*
- **Track memory footprint (committed, not reserved) as a standard result.** Footprint growth
  causes swapping and starves co-located processes. *[JavaPerf ch. 8]*

## Environment and harness

- **Script the whole run: deploy, configure, verify a known machine state, repeat, compute
  statistics, and produce the report.** A result is repeatable only if the environment is.
  Part of the known state is whether autoscaling, rate limits, and WAF rules were on: set them
  deliberately and record them with the results, or runs are not comparable. *[JavaPerf ch. 2]*
- **Test co-located services together on their real host or node.** Runtime defaults (GC
  threads, heap size, pool sizes) assume they own the machine and behave differently next to
  neighbours. *[JavaPerf ch. 2, 5]*
- **Keep the load generator from becoming the bottleneck.** Discard response bodies the test
  does not inspect, watch generator CPU and memory, and scale out generators before raising VUs.
  *[k6 Terms 23; JavaPerf ch. 1]*
- **Suspect the harness when latency grows steadily over a run.** Profile the load generator as
  well as the server; a harness that does more work per sample as data accumulates looks like a
  server leak. *[JavaPerf ch. 1]*
- **Keep imports and options in init code and one-time data preparation in `setup()`.** Init
  runs per VU and is not load; do not make HTTP calls there. *[k6 Terms 1; k6 Terms caveats]*
- **Parse every test parameter (target URL, rate, VUs, duration) from env vars or flags with a
  validator that rejects empty, NaN, and out-of-range values.** A `Number()` on a missing
  variable silently runs a zero-rate test that passes every threshold. *[Review lessons]*
- **Set an explicit request `timeout` in the load script, and set `maxRedirects: 0` where a
  token must not follow a redirect.** k6 waits 60 s by default, which can exceed the SLO and
  turn hangs into slow successes. *[Review lessons]*

## Collect evidence during the run

- **On every run, collect OS metrics (CPU, run queue, disk, network, memory), application and GC
  logs, a low-overhead profile or flight recording, periodic thread dumps, and database host
  metrics.** A regression can then be diagnosed after the fact instead of re-run. *[JavaPerf
  ch. 2, 3]*
- **Read the regression signature before tuning.** More CPU points to the profile, more GC to
  the heap, and less of both to contention or blocking. *[JavaPerf ch. 2, 3]*
- **Explain low CPU before adding threads.** Idle CPU with work queued means threads are blocked
  on a lock, I/O, a downstream resource, or a too-small pool; only the last is fixed by more
  threads. *[JavaPerf ch. 3]*
- **Treat a run queue above the core count for a sustained period as overload.** Reduce or move
  work; adding threads makes it worse. *[JavaPerf ch. 3]*
- **Suspect new application code first, configuration second, and the runtime or OS last.**
  In a profile, look at the callers of hot leaf methods as well as the leaves. *[JavaPerf
  ch. 1]*
- **Emit `Server-Timing` or equivalent per-stage timings from the service under test.** Backend
  breakdowns (database, render, cache hit or miss) make latency regressions attributable.
  *[web.dev Perf: Optimize Time to First Byte]*

## Microbenchmarks

- **Use JMH (or the language's equivalent harness) instead of a hand-timed loop, and work
  through its samples before writing the first benchmark.** It provides warm-up iterations,
  forked JVMs, and `Blackhole` sinks for the pitfalls the book shows hand-rolled loops getting
  wrong (updated: the book predates JMH becoming the norm). *[JavaPerf ch. 2; JMH]*
- **Consume every result, precompute inputs outside the timed region, discard warm-up, and use a
  representative input range.** Otherwise the compiler deletes the work, the loop times the
  input generator, or fast-failing inputs skew the comparison. *[JavaPerf ch. 2, 4]*
- **Distrust threaded microbenchmarks.** In a tiny body, time is dominated by the shared lock,
  so the test measures contention that real workloads may never hit. *[JavaPerf ch. 2]*
- **Rank a microbenchmark win by how often the code runs in production.** A nanosecond matters on
  a call made millions of times per request and not on one made once. *[JavaPerf ch. 2]*

## Comparing runs and gating regressions

- **Run baseline and candidate several times each on the same environment and compare the
  per-run results with a significance test.** The book uses Student's t-test; prefer Welch's
  t-test, which does not assume equal variance (updated). A large gap between a few noisy runs
  can still be inconclusive. *[JavaPerf ch. 2]*
- **Add runs when a result is inconclusive; never read "not significant" as "no difference".**
  *[JavaPerf ch. 2]*
- **Prioritise by effect size and frequency, not p-value alone.** A highly significant 1%
  change matters less than a possible 10% change that needs more data. *[JavaPerf ch. 2]*
- **Gate pull requests on budgets that combine quantity limits (bytes, request count,
  third-party count) with user-centric timings.** When a change breaks the budget, optimise,
  remove something, or do not ship. *[web.dev Perf: Performance budgets 101]*
- **Fail the build on a threshold breach; never downgrade a performance gate to a warning
  globally.** Scope any temporary exemption to the named route or audit with a tracked follow-up.
  *[Review lessons; web.dev Perf: Lighthouse CI getting started]*
- **After fixing a performance defect, grep for the same pattern and fix every sibling in the
  same commit.** The same N+1 query or unbounded loop usually exists in several handlers.
  *[Review lessons]*
- **State in the PR description what was measured, on what environment, how many runs, and the
  result.** Compute numbers from stored results; do not type counts or percentages by hand.
  *[Review lessons]*

## Front-end lab and field testing

Page-speed targets (LCP, INP, CLS thresholds) and optimisation techniques live in
[Web performance](../frontend/web-performance.md); this section covers how to measure them.

- **Set priorities from field data (your RUM or CrUX) and use lab runs to reproduce problems and
  catch regressions before deploy.** Lab and field are expected to differ: the lab has a cold
  cache, one viewport, no personalisation, and no real interactions. *[web.dev Perf: Lab and
  field data differences; Web Vitals]*
- **Do not treat a load-only lab run as an INP measurement.** Use TBT only as a proxy, and test
  interactions with scripted user flows, including during page load. *[web.dev Perf: Lab and
  field data differences; Optimize INP]*
- **Run lab tests on low-end mobile hardware or with CPU and network throttling.** Field data
  only includes users who managed to load the page. *[web.dev Perf: Lab and field data
  differences; Performance budgets 101]*
- **Test cache-dependent metrics cold and warm, and start TTFB measurement at the original entry
  URL.** Lab tools often start at the final URL and miss redirects; a warm CDN hides a slow
  backend. *[web.dev Perf: Optimize Time to First Byte; Lab and field data differences]*
- **Run Lighthouse CI several times per URL (three by default), on as large a CI machine as the
  budget allows, and run `lhci autorun` once per build.** Single runs are noisy, bigger machines
  give more stable results, and the server accepts one upload per commit hash. *[web.dev Perf:
  Lighthouse CI getting started]*
- **Start Lighthouse CI from the recommended preset and switch currently failing audits off as
  a tracked backlog.** This gates new regressions without blocking on old debt. *[web.dev Perf:
  Lighthouse CI getting started]*
- **Collect field Core Web Vitals with the `web-vitals` library's attribution build, and send
  with `sendBeacon` (falling back to `fetch` with `keepalive`) when the page becomes hidden.**
  CLS and INP are final only at hide time, and unload may never fire. Pin the library version.
  *[web.dev Perf: Debug performance in the field; Best practices for measuring Web Vitals in the
  field]*
- **Report field metrics at p75 against thresholds plus p90 or p95, segmented by device and
  connection type.** *[web.dev Perf: Best practices for measuring Web Vitals in the field]*
- **Tag RUM data with a unique build or release id and assign A/B groups on the server.**
  Deploy-date comparisons blur releases, and client-side A/B tools distort LCP. *[web.dev Perf:
  Best practices for measuring Web Vitals in the field]*
- **Keep RUM code cheap: load it async and late, work at idle, send only fields you use, and keep
  only the worst few entries per page.** Heavy measurement code creates the long tasks it
  detects. *[web.dev Perf: Best practices for measuring Web Vitals in the field; Long Animation
  Frames API]*
- **Group field debug targets (LCP element, shift source, INP target, LoAF script URL) across
  users and fix the ones affecting most users first.** One lab run can point at the wrong
  element. *[web.dev Perf: Debug performance in the field]*
- **Diagnose slow INP in the field with Long Animation Frames, and treat the data as a Chromium
  sample.** Filter frames with a UI event and high blocking duration; use forced style and
  layout time to spot thrashing. *[web.dev Perf: Long Animation Frames API]*

## Tensions

- **Closed (VU) model vs open (arrival-rate) model.** The k6 cheat sheet shows only VU-based
  ramping. This library defaults to arrival rate for API and service capacity tests, because a
  closed model lowers load as the system slows; use VUs with think time when the requirement is
  explicitly about concurrent users or session-bound flows. *[k6 Terms 23; JavaPerf ch. 2;
  k6 docs: Open and closed models]*
- **Percentiles only vs percentiles plus averages.** web.dev says rely on percentiles instead
  of averages, and the k6 cheat sheet's threshold examples use only percentiles; JavaPerf says
  look at both. This library gates on percentiles and error rate, and reports the average
  alongside them for diagnosis only. *[k6 Terms 11; JavaPerf ch. 2; web.dev Perf: Best
  practices for measuring Web Vitals in the field]*
- **Production-like environment vs fast CI feedback.** JavaPerf insists on target hardware and
  real dependencies; CI gates need fast, cheap runs. Run small smoke and mesobenchmark gates on
  every PR to catch large regressions, and make release decisions only from full runs on
  production-like infrastructure. *[JavaPerf ch. 2; web.dev Perf: Lighthouse CI getting
  started]*
- **Lab vs field as the source of truth.** Field data decides priorities and whether users are
  served well; lab data decides whether a specific change regressed. Do not overrule field data
  with a passing lab run. *[web.dev Perf: Lab and field data differences]*
- **Writing known-fast idioms early vs avoiding premature optimisation.** Choose the faster of
  two equally clear constructs while writing; defer optimisations that complicate the design
  until a measurement justifies them. *[JavaPerf ch. 1]*
- **Dated advice.** The k6 cheat sheet calls browser testing experimental behind an environment
  flag; current k6 ships the stable `k6/browser` module, configured per scenario. Performance
  budgets 101 (2018) budgets on TTI and FID; budget on LCP, INP, and CLS in the field and TBT
  plus bytes in the lab instead. JavaPerf (2014, Java 7 and 8) never mentions JMH and predates
  current collectors and unified GC logging; keep its method, not its flags, and use JMH for
  microbenchmarks. *[k6 Terms caveats; web.dev Perf: Performance budgets 101; JavaPerf ch. 2;
  JMH]*

## Sources

- **k6 Terms**: Most Commonly Used Terms in K6 (cheat sheet, Anshita Bhasin); numbers are its
  term numbers
- **k6 docs**: Grafana k6 documentation: Load test types
  (<https://grafana.com/docs/k6/latest/testing-guides/test-types/>); Open and closed models
  (<https://grafana.com/docs/k6/latest/using-k6/scenarios/concepts/open-vs-closed/>);
  Thresholds (<https://grafana.com/docs/k6/latest/using-k6/thresholds/>); Dropped iterations
  (<https://grafana.com/docs/k6/latest/using-k6/scenarios/concepts/dropped-iterations/>)
- **JavaPerf**: Java Performance: The Definitive Guide (Scott Oaks, O'Reilly, 1st edition, 2014)
- **JMH**: OpenJDK Java Microbenchmark Harness, README and samples
  (<https://github.com/openjdk/jmh>)
- **web.dev Perf**: web.dev and Chrome performance articles, cited by page title:
  Web Vitals (<https://web.dev/articles/vitals>);
  Lab and field data differences (<https://web.dev/articles/lab-and-field-data-differences>);
  Best practices for measuring Web Vitals in the field
  (<https://web.dev/articles/vitals-field-measurement-best-practices>);
  Debug performance in the field (<https://web.dev/articles/debug-performance-in-the-field>);
  Optimize INP (<https://web.dev/articles/optimize-inp>);
  Optimize Time to First Byte (<https://web.dev/articles/optimize-ttfb>);
  Performance budgets 101 (<https://web.dev/articles/performance-budgets-101>);
  Long Animation Frames API
  (<https://developer.chrome.com/docs/web-platform/long-animation-frames>);
  Lighthouse CI getting started
  (<https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/getting-started.md>)
- **Review lessons**: rules distilled from the maintainer's code-review findings
