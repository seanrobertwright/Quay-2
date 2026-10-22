# Observability and reliability

> **Load when:** adding logs, metrics, traces, or OpenTelemetry; defining
> SLIs, SLOs, or error budgets; writing alerts, dashboards, or runbooks;
> adding health, readiness, or watchdog checks; gating a canary on production
> signals; handling overload (retry budgets, deadlines, criticality); running
> an incident, postmortem, game day, restore test, or readiness review.
> **See also:** [Distributed systems](../distributed/distributed-systems.md),
> [Continuous integration and delivery](../devops/ci-cd.md),
> [Kubernetes](../devops/kubernetes.md), [Debugging](../core/debugging.md),
> [Performance and load testing](../testing/performance-and-load-testing.md),
> [Application and API security](../security/application-security.md),
> [Database operations](../data/database-operations.md),
> [Cloud architecture](../cloud/cloud-architecture.md)

## Top rules

1. **Instrument every feature as part of building it, not after launch.**
   Each service exports the four golden signals (latency, traffic, errors,
   saturation) plus duration and status for every downstream call; missing
   telemetry is a review defect. *[DevOps Handbook ch. 14; SRE-Monitoring;
   UDS ch. 20; CNDK8s ch. 1]*
2. **Page on user-visible symptoms through multiwindow SLO burn-rate alerts,
   not on CPU or other causes.** Causes are many and shift; symptoms are what
   users feel. *[SRWB-Alerting; SRE-Monitoring; UDS ch. 20]*
3. **Make every page urgent, actionable, and linked to a dashboard and a
   runbook.** Automate pages that need no judgment and delete pages nobody
   acts on; alert fatigue hides the real ones. *[SRE-Monitoring; DevOps
   Handbook ch. 15; UDS ch. 20]*
4. **Define each SLI as good events over valid events, set the SLO below
   100%, and write down what happens when the error budget is spent.** An SLO
   that cannot change a priority decision is decoration. *[SRWB-SLOs;
   SRE-Risk; UDS ch. 20]*
5. **Record latency as histograms and report percentiles; never alert on a
   mean.** A good mean hides a slow tail, and fast failures drag it lower.
   *[SRE-Monitoring; UDS ch. 20]*
6. **Emit one structured event per request or message carrying the trace id,
   and propagate W3C trace context across every hop.** Tracing is very hard
   to retrofit. Use OpenTelemetry; statsd, Zipkin, and X-Ray examples in
   older books are dated. *[UDS ch. 21; OTel-Logs; OTel-Context]*
7. **Keep unbounded values (user, order, request ids, raw URLs) off metric
   labels and span names.** They explode series count and cost; put them in
   logs and span attributes. *[SRWB-Monitoring; OTel-HTTP; OTel-MetricsSDK]*
8. **Never let telemetry change behavior or take the service down.** Log
   asynchronously with bounded buffers, rethrow exceptions unchanged after
   recording them, and keep secrets and personal data out of logs, labels,
   and baggage. *[UDS ch. 21; OTel-Libraries; OTel-Baggage]*
9. **Watch every deploy on production signals and roll back automatically
   when they regress.** Overlay deploy markers on graphs, compare the canary
   with a concurrent control, and mitigate before diagnosing. *[DevOps
   Handbook ch. 12, 14, 16; SRWB-Canarying; UDS ch. 19, 20]*
10. **After every incident, ship mechanisms, not intentions.** A blameless
    review yields owned, dated countermeasures (tests, telemetry, alerts,
    automation), and the fix is swept across every sibling with the same
    defect. *[DevOps Handbook ch. 19; SRE-Postmortem; Review lessons]*

## Metrics

- **Instrument the shared HTTP or RPC client once** so every dependency gets
  latency, status, payload size, and a timeout flag. Label catch-all
  endpoints with the real operation. *[SRWB-Monitoring; UDS ch. 16]*
- **Record latency for successes and failures as separate series.** Slow
  errors hurt most, and mixing the two hides both. *[SRE-Monitoring]*
- **Use exponential histogram buckets and report p50, p99, and p99.9.**
  Latency is skewed, so standard-deviation thresholds misfire.
  *[SRE-Monitoring; SRE-SLOs; DevOps Handbook ch. 15]*
- **Count wrong-content and too-slow responses as errors,** not only non-2xx;
  catching a 200 with wrong content needs an end-to-end probe run from the
  regions users are in. *[SRE-Monitoring; UDS ch. 20]*
- **Track saturation for every constrained resource, soft limits included:**
  file descriptors, thread and connection pools, heap, queue wait, disk, log
  volume. Alert before exhaustion; target utilization below 100%.
  *[SRWB-Monitoring; SRE-Monitoring]*
- **Measure queue backlog as age (enqueue to first read) and alert on it.**
  Backlogs get costlier to drain the longer they grow. *[UDS ch. 12]*
- **Break traffic down by status code and count rate-limited requests,** even
  codes too noisy to alert on; a shifted error mix is the first sign of a bad
  change. *[SRWB-Monitoring]*
- **Export the running version, config version, and flag values as
  metrics** so an outage lines up with a rollout at a glance.
  *[SRWB-Monitoring; DevOps Handbook ch. 14]*
- **Emit error counters as zero every interval, not only on error.** A gap is
  ambiguous: no errors, or a dead emitter. *[UDS ch. 20]*
- **Cover every layer:** business (sign-ups, conversions), application,
  infrastructure, client (browser and mobile), and the pipeline, with business
  graphs beside infrastructure ones. *[DevOps Handbook ch. 14]*
- **Ask what happens at 10k tenants or endpoints before adding a label.**
  Drop unused attributes with Views and alert on the OTel overflow series:
  past the per-stream limit, breakdowns silently go wrong. *[OTel-MetricsSDK;
  Review lessons]*

## Logs

- **Build one wide structured event per unit of work through a context
  object:** caller, operation, outcome, timings, each outbound call's status
  and latency, request and trace ids. *[UDS ch. 21]*
- **Choose log levels by who must act and how fast.** ERROR is worth waking
  someone; WARN may become an error; DEBUG is off in production and
  switchable at runtime. *[DevOps Handbook ch. 14; UDS ch. 21]*
- **Always log security- and operations-significant events:** authn and
  authz decisions, privileged and config changes, invalid input, resource
  pressure, health changes, startup and shutdown, breaker trips, and backup
  results. *[DevOps Handbook ch. 14, 22]*
- **Control log cost with failure-weighted sampling, collector rate limits,
  and non-blocking writers.** A log that fills the disk or blocks on I/O is an
  outage, as is a line per row of a 10k-item loop. *[UDS ch. 21; Review
  lessons]*
- **Scrub user content, credentials, and personal data with a field
  allowlist before the log call.** Logs are copied widely and kept long.
  *[UDS ch. 21; OTel-Collector]*
- **Write timestamps in UTC with an explicit offset, through the project's
  single date helper.** A zone-less timestamp read as local time misorders an
  incident timeline. *[Review lessons; UDS ch. 20]*
- **Centralize logs and metrics in one self-service store** and give the
  developers who own a service direct query access. *[DevOps Handbook ch. 14;
  CNDK8s ch. 1]*

## Tracing and OpenTelemetry

- **Always set `service.name` and `deployment.environment.name`;** let
  resource detectors fill host and cloud attributes. Without a name the SDK
  reports `unknown_service`; the older `deployment.environment` was renamed
  in semantic conventions 1.27. *[OTel-Resources]*
- **In a library, depend only on the OTel API, never configure the SDK, and
  accept an optional provider.** Without an SDK the calls are no-ops.
  *[OTel-Libraries]*
- **Create spans only for public operations that do I/O or handle a request
  or message,** never duplicating spans network instrumentation already
  emits; record internal steps as span events. *[OTel-Libraries]*
- **On failure, record the exception, set status Error, rethrow unchanged,
  and end the span in `finally`.** An unended span is lost. *[OTel-Libraries]*
- **Name HTTP spans by method plus route template, never the raw path,** and
  set status by kind: 4xx is an error on client spans only, 5xx always, and
  caller cancellation never. *[OTel-HTTP]*
- **Redact credentials and signed query values in recorded URLs; keep header
  capture opt-in.** *[OTel-HTTP]*
- **Treat inbound trace headers from untrusted callers as untrusted input,
  avoid propagating context to third parties, and never put secrets in
  baggage.** Baggage travels in plain headers. *[OTel-Context; OTel-Baggage]*
- **Follow semantic-convention naming:** lowercase dotted namespaces, an app
  prefix for custom attributes, never `otel.*`, and no unit or `_total`
  suffix on metric names. *[OTel-Naming]*
- **Head-sample by trace-id ratio at the root and have every downstream
  service honor the parent's decision; add Collector tail sampling only when
  every error or slow trace must be kept.** Do not sample at low volume.
  *[OTel-Sampling]*
- **Pin dashboards and alerts to the stable HTTP attribute names**
  (`http.response.status_code`, not `http.status_code`) and switch older
  instrumentation with `OTEL_SEMCONV_STABILITY_OPT_IN=http/dup` until the
  queries move. *[OTel-HTTP]*
- **Parse sampling ratios, exporter endpoints, and alert thresholds at
  startup and fail fast on NaN, empty, or out-of-range values.** A ratio read
  with a bare `Number()` can silently disable tracing. *[Review lessons]*
- **Unit-test instrumentation with the in-memory exporter.** The API swallows
  misuse, so missing spans show only when a test asserts on them.
  *[OTel-Libraries]*
- **Harden the Collector:** bind receivers to localhost or a pod IP, require
  TLS and auth, load secrets from the environment, run as non-root, and cap
  memory and queues. Collectors before v0.110.0 bound all interfaces by
  default. *[OTel-Collector]*

## SLIs, SLOs, and error budgets

- **Write down each SLI's numerator, denominator, threshold, and measurement
  point,** as close to the user as is affordable; count requests or records,
  not uptime minutes. *[SRWB-SLOs; SRE-Risk; UDS ch. 20]*
- **Set latency SLOs at two percentiles (say p90 and p99), separately for
  interactive and bulk traffic,** over a stated four-week rolling window.
  *[SRWB-SLOs; SRE-SLOs]*
- **Start loose and tighten; never copy current performance into the
  target.** Today's numbers may rest on heroics, and loosening a published
  target is hard. *[SRE-SLOs; UDS ch. 20]*
- **Write an error-budget policy naming actions (feature freeze, reliability
  first), owners, and escalation,** and keep it with the SLO in a versioned
  document reviewed quarterly. *[SRWB-SLOs; SRE-Risk; UDS ch. 20]*
- **Give a critical dependency at least the availability of the journey that
  needs it; never multiply zone availabilities on paper.** Shared failure
  domains make replicas fail together. *[SRWB-SLOs]*

## Alerting

- **Require a long window and a short one (about a twelfth as long) to both
  exceed the burn threshold.** That keeps precision and clears the alert
  soon after recovery. *[SRWB-Alerting]*
- **For a 99.9% SLO start from three tiers:** page at 14.4x burn over 1 hour,
  page at 6x over 6 hours, ticket at 1x over 3 days. Budget spent is burn
  rate times window over the SLO period; recompute for other targets.
  *[SRWB-Alerting; UDS ch. 20]*
- **Page on a cause only when failure is definite and imminent** (storage
  nearly full, a service at N+0); route other causes to dashboards and
  tickets. *[SRE-Monitoring]*
- **Add synthetic traffic before trusting burn-rate pages on low-traffic
  services.** At ten requests an hour one failure is a 1,000x burn.
  *[SRWB-Alerting]*
- **Derive extra alerts from past incidents:** the leading indicators that
  would have caught each one sooner. *[DevOps Handbook ch. 15, 19]*
- **Keep alert rules and dashboards as code and test them:** the metric is
  exported, the rule fires on synthetic series, the route reaches the right
  receiver. *[SRWB-Monitoring; UDS ch. 20]*
- **Give alert webhooks and paging clients a timeout and disabled redirects,
  with tokens from a secrets manager.** *[Review lessons; DevOps Handbook
  ch. 22]*

## Dashboards and runbooks

- **Build each dashboard for one audience** (SLO summary, public API,
  internals), key charts first, in UTC, with one time range. *[UDS ch. 20]*
- **Annotate charts with thresholds, deploy and config-change markers, and
  runbook links.** Most incidents follow a change. *[UDS ch. 20; DevOps
  Handbook ch. 14]*
- **Write runbooks with steps, owners, and duration, and re-verify their
  claims when the system changes.** Cite service and symbol names, never
  `file:line`, and compute counts rather than typing them. *[DevOps Handbook
  ch. 20; Review lessons]*
- **Scope tenant-data dashboards and telemetry queries by tenant, checking
  the permission the data requires.** *[Review lessons]*
- **Restrict metrics, debug, and admin endpoints to named callers, never `*`
  CORS, and set `nosniff` on log or dump downloads.** *[Review lessons;
  OTel-Collector]*

## Health checks and self-healing

- **Keep liveness local and use readiness for routing.** A check on a shared
  dependency fails every instance at once; probe wiring is in
  [Kubernetes](../devops/kubernetes.md). *[UDS ch. 17; SRE-Cascading]*
- **Make load balancers fail open when most of the pool is unhealthy,** and
  verify the setting; many defaults do not. *[UDS ch. 17]*
- **Add a watchdog restart only for a known slow fault (a leak) on a local
  threshold such as free memory, and alert on its restarts.** A buggy
  watchdog causes restart loops. *[UDS ch. 17]*
- **Enforce "runs once" for scheduled jobs (backups, cleanups, report sends)
  with an advisory lock or unique run key in the database.** Every replica
  runs the same cron. *[Review lessons]*

## Overload in production

Timeouts, breakers, bulkheads, and basic shedding live in
[Distributed systems](../distributed/distributed-systems.md).

- **Enforce two retry budgets:** at most three attempts per request, and
  retries under about 10% of a client's traffic. Layers not directly above
  the overloaded one return "overloaded, do not retry". *[SRE-Overload;
  SRE-Cascading]*
- **Propagate an absolute deadline and cancellation down the call tree,**
  checking time left before each stage. *[SRE-Cascading]*
- **Tag requests with a criticality at the edge and shed the lowest first;**
  batch defaults to sheddable. *[SRE-Overload]*
- **Keep queues short relative to workers and prefer LIFO or CoDel under
  overload.** Deep FIFO queues serve callers who already gave up.
  *[SRE-Cascading]*
- **Exercise degraded and shedding modes regularly and alert when many
  servers enter them.** Load-test to failure with ramps and spikes.
  *[SRE-Cascading]*

## Deploy safety

Pipeline mechanics, flags, and blue-green live in
[Continuous integration and delivery](../devops/ci-cd.md).

- **Canary on a small slice against a concurrent control, one at a time,
  judged on a few user-facing metrics that exclude 4xx.** A 5% canary at 20%
  errors shows as 1% service-wide. *[SRWB-Canarying]*
- **Gate each stage on bake time and minimum request counts; roll back on
  regressions in the service's own signals and its neighbors'.** *[UDS
  ch. 19; DevOps Handbook ch. 12, 16]*

## Incidents and postmortems

- **Mitigate first (roll back, scale out, flag off), then find root cause,**
  logging actions in a shared channel. *[UDS ch. 20; DevOps Handbook ch. 16]*
- **Agree postmortem triggers in advance:** user impact over a threshold,
  data loss, on-call intervention, long resolution, a monitoring miss, or a
  large budget burn. *[SRE-Postmortem; UDS ch. 20]*
- **Build the timeline from chat logs and metrics, ban "should have", and
  ask why each action made sense.** *[DevOps Handbook ch. 19; SRE-Postmortem]*
- **Give every countermeasure an owner and a date; "be more careful" is not
  one.** Publish reviews where everyone can search them. *[DevOps Handbook
  ch. 19; SRE-Postmortem]*
- **Grep for the incident's defect pattern across all services and fix every
  sibling in the same change.** *[Review lessons]*

## Availability and recovery

- **Run production workloads with more than one replica across two or three
  zones, sized to survive losing a node.** *[CNDK8s ch. 3]*
- **Back up state, document the restore, and test restores on a schedule.**
  An unrestored backup proves nothing. *[CNDK8s ch. 3]*
- **Prove HA by breaking it:** reboot nodes off-peak, run game days and
  fault injection, and check consumers do not lean on better-than-SLO
  behavior. *[CNDK8s ch. 3; DevOps Handbook ch. 19; UDS ch. 20]*
- **Pass a launch-readiness review before real traffic:** monitoring, alert
  volume, automated deploy and rollback, and data scope (PII, payments).
  *[DevOps Handbook ch. 16]*
- **Put the developers who build a service on its pager,** with alert volume
  kept sustainable. *[DevOps Handbook ch. 16; CNDK8s ch. 1]*

## Tensions

- **Statistical or anomaly alerting vs SLO burn-rate pages.** The DevOps
  Handbook starts from means and standard deviations; the SRE books call
  learned thresholds opaque. House position: page only on burn-rate and
  definite-cause rules; anomaly detection feeds dashboards and tickets.
  *[DevOps Handbook ch. 15; SRE-Monitoring; SRWB-Alerting]*
- **Duration clauses vs pure burn-rate windows.** The Workbook advises
  against `for:` clauses. House position: a short `for:` to absorb scrape
  jitter is fine beside multiwindow rules, never instead. *[SRWB-Alerting]*
- **One wide event vs many leveled log lines.** House position: one
  canonical event per unit of work, plus leveled lines only for events
  someone must act on. *[UDS ch. 21; DevOps Handbook ch. 14]*
- **OTel names vs Prometheus suffixes.** House position: write OTel names
  and let the exporter add `_total` and units, or they appear twice.
  *[OTel-Naming]*
- **Dependency-aware vs local-only health checks.** House position, shared
  with Distributed systems: dependency checks may gate readiness, liveness
  stays local, load balancers fail open. *[UDS ch. 17]*
- **Do not overachieve the SLO vs serve users as well as possible.** Planned
  outages suit shared internal infrastructure; external products should
  throttle or publish the SLO clearly instead. *[SRE-SLOs]*
- **Fix forward vs roll back.** House position: recover by the least risky
  path, flag off first, then roll back; fix forward only for trivial changes
  with a fast pipeline and good telemetry. *[DevOps Handbook ch. 16]*

## Sources

- **UDS**: Understanding Distributed Systems (Roberto Vitillo, version 1.0.4)
- **CNDK8s**: Cloud Native DevOps with Kubernetes (Arundel, Domingus; 2nd
  ed., early release chapters 1 to 3)
- **DevOps Handbook**: The DevOps Handbook (Kim, Humble, Debois, Willis,
  Forsgren; 2nd ed.)
- **SRE-Monitoring**: SRE book, "Monitoring Distributed Systems" (<https://sre.google/sre-book/monitoring-distributed-systems/>)
- **SRE-SLOs**: SRE book, "Service Level Objectives" (<https://sre.google/sre-book/service-level-objectives/>)
- **SRE-Risk**: SRE book, "Embracing Risk" (<https://sre.google/sre-book/embracing-risk/>)
- **SRE-Cascading**: SRE book, "Addressing Cascading Failures" (<https://sre.google/sre-book/addressing-cascading-failures/>)
- **SRE-Overload**: SRE book, "Handling Overload" (<https://sre.google/sre-book/handling-overload/>)
- **SRE-Postmortem**: SRE book, "Postmortem Culture" (<https://sre.google/sre-book/postmortem-culture/>)
- **SRWB-Alerting**: SRE Workbook, "Alerting on SLOs" (<https://sre.google/workbook/alerting-on-slos/>)
- **SRWB-SLOs**: SRE Workbook, "Implementing SLOs" (<https://sre.google/workbook/implementing-slos/>)
- **SRWB-Monitoring**: SRE Workbook, "Monitoring" (<https://sre.google/workbook/monitoring/>)
- **SRWB-Canarying**: SRE Workbook, "Canarying Releases" (<https://sre.google/workbook/canarying-releases/>)
- **OTel-Libraries**: OpenTelemetry, "Instrumenting libraries" (<https://opentelemetry.io/docs/concepts/instrumentation/libraries/>)
- **OTel-Sampling**: OpenTelemetry, "Sampling" (<https://opentelemetry.io/docs/concepts/sampling/>)
- **OTel-Logs**: OpenTelemetry, "Logs" (<https://opentelemetry.io/docs/concepts/signals/logs/>)
- **OTel-Baggage**: OpenTelemetry, "Baggage" (<https://opentelemetry.io/docs/concepts/signals/baggage/>)
- **OTel-Resources**: OpenTelemetry, "Resources" (<https://opentelemetry.io/docs/concepts/resources/>)
- **OTel-Context**: OpenTelemetry, "Context propagation" (<https://opentelemetry.io/docs/concepts/context-propagation/>)
- **OTel-Collector**: OpenTelemetry, "Configuration best practices" (<https://opentelemetry.io/docs/security/config-best-practices/>)
- **OTel-Naming**: OpenTelemetry semantic conventions, "Naming" (<https://opentelemetry.io/docs/specs/semconv/general/naming/>)
- **OTel-HTTP**: OpenTelemetry semantic conventions, "HTTP spans" (<https://opentelemetry.io/docs/specs/semconv/http/http-spans/>)
- **OTel-MetricsSDK**: OpenTelemetry specification, "Metrics SDK" (<https://opentelemetry.io/docs/specs/otel/metrics/sdk/>)
- **Review lessons**: rules distilled from the maintainer's code-review findings
