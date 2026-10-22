# Microservices

> **Load when:** designing or changing a system of independently deployed services: adopting
> microservices, splitting or merging a service, drawing boundaries, giving a service its own data,
> calling or publishing to another service, keeping a multi-service transaction consistent (sagas),
> versioning a service contract, adding an API gateway or BFF, passing identity between services,
> testing or deploying one service alone, or migrating a monolith to services.
> **See also:** [Software architecture fundamentals](../architecture/architecture-fundamentals.md),
> [Domain-driven design](../architecture/domain-driven-design.md), [Event-driven architecture and
> messaging](../architecture/event-driven-and-messaging.md), [Distributed
> systems](../distributed/distributed-systems.md), [HTTP and REST API design](../api/api-design.md),
> [Application and API security](../security/application-security.md), [Unit, integration, and
> test-driven development](../testing/testing.md), [Continuous integration and
> delivery](../devops/ci-cd.md), [Kubernetes](../devops/kubernetes.md), [Observability and
> reliability](../operations/observability-and-reliability.md), [Refactoring and legacy
> code](../core/refactoring-and-legacy-code.md)

## Top rules

1. **Start with a monolith or modular monolith, and adopt microservices only for a written goal.**
   Boundaries in a new domain move too often and the operational tax eats small teams; record the
   business driver and the characteristic you are trading away. *[BM2 ch. 1, 3; MSP ch. 1, 13;
   MAP ch. 6, 7; MSA-PL Application architecture]*
2. **Protect independent deployability in every change.** If a change needs two services released
   together, the boundary or the contract is wrong; lockstep services are a distributed monolith
   with the costs of both styles. *[BM2 ch. 1, 5; MSP ch. 2; SAHP ch. 2]*
3. **Give each service exclusive ownership of its data; nobody else reads or writes its tables.**
   Other services and reports go through its API or events, because a shared schema is an implicit
   contract that freezes refactoring. *[BM2 ch. 1, 2; MSP ch. 1; MAP ch. 1, 4; MSA-PL Database
   architecture]*
4. **Draw boundaries around business capabilities or subdomains, never technical layers, and keep
   data that must change atomically inside one service.** Things that change for the same reason
   live together; if an operation truly needs ACID across two services, merge them. *[BM2 ch. 2;
   MSP ch. 2; MAP ch. 5; MSA-PL Decomposition]*
5. **Put a timeout, a circuit breaker, and a decided fallback on every synchronous remote call.**
   One hung dependency otherwise exhausts the caller's threads and the failure climbs the chain; a
   breaker never replaces the timeout. *[BM2 ch. 12; MSP ch. 3; MAP ch. 2; OCNM ch. 4; MSA-PL
   Reliability]*
6. **Never write the database and publish a message as two separate steps; use a transactional
   outbox, and make every consumer idempotent.** Brokers deliver at least once, and a crash between
   the two writes loses or duplicates events. *[MSP ch. 3; BM2 ch. 5; MSA-PL Transactional
   messaging]* See [event-driven and messaging](../architecture/event-driven-and-messaging.md).
7. **Use a saga with explicit compensations for multi-service business transactions, never
   two-phase commit.** 2PC costs availability and is unsupported by many stores; each saga step is
   a local transaction. *[BM2 ch. 6; MSP ch. 4; OCNM ch. 3, 6; MSA-PL Maintaining data consistency]*
8. **Evolve contracts by expansion only, gate them with a schema compatibility check in CI, and
   verify them with consumer-driven contract tests.** Old and new versions always run side by side
   during rollouts. *[BM2 ch. 5, 9; MSP ch. 3, 9; MAP ch. 8]*
9. **Authorize inside the service that owns the data, using the end user's identity from a signed,
   short-lived token, and scope every query by tenant.** Trusting any caller inside the network is
   the confused-deputy bug. *[BM2 ch. 11; MSP ch. 11; OCNM ch. 4; Review lessons]*
10. **Ship every service with a correlation id, aggregated structured logs, traces, metrics, and
    health checks from the first release.** A failure spread across services cannot be debugged
    from one log, and these are painful to retrofit. *[BM2 ch. 10; MSP ch. 11; OCNM ch. 5;
    MSA-PL Observability]*

## Service boundaries and granularity

- **Treat the independently deployable unit (the architecture quantum) as the unit of analysis.**
  A "service" that cannot be released alone is not separate, however its repositories are laid
  out. Ask what release cadence it needs and which other deployments it affects. *[SAHP ch. 2]*
- **Write a one-sentence scope for each service; if it needs "and", split it.** A customer service
  that also sends notifications and stores comments is three services. *[MAP ch. 5]*
- **Start coarse-grained and split as you learn; never equate a service with a class.** Splitting
  an understood service is cheaper than merging wrong ones. *[MAP ch. 5; BM2 ch. 3; SAHP ch. 2]*
- **Weigh both failure modes when sizing.** Too small creates transaction and orchestration pain;
  too large creates scaling and deployment pain. A saga framework or broker does not settle
  granularity. *[SAHP ch. 2; MAP ch. 6]*
- **Count remote calls per important request, and treat a chatty pair as a misplaced boundary.**
  Add a batch API first; if calls stay chatty, merge the services. Five sequential 100 ms hops cost
  half a second before any logic runs. *[MSP ch. 2; MAP ch. 5, 9; BM2 ch. 2]*
- **Do the availability math for synchronous chains.** Per-service availability multiplies along
  a path, so splitting a monolith lowers availability unless callers handle dependency failure.
  *[OCNM ch. 4]*
- **Give each service its own model of a shared concept instead of a shared entity library or a
  central data service.** A shared model forces lockstep schema changes; a CRUD-only service holds
  no logic and leaks rules into callers. *[MSP ch. 2; BM2 ch. 2]*
- **Let the owning service validate every requested state transition.** A call from another
  service is a request, not a command; model the aggregate as a state machine. *[BM2 ch. 2, 4]* See
  [domain-driven design](../architecture/domain-driven-design.md) for aggregate rules.
- **Remove pass-through coupling.** An intermediary accepts domain data and builds the downstream
  payload itself; a service that calls many downstreams usually centralizes too much logic.
  *[BM2 ch. 2]*
- **Give every service exactly one owning team.** A team may own several services; a service with
  no owner or many owners decays. *[BM2 ch. 15; OCNM ch. 2; MSA-PL Decomposition]*

## Data ownership and queries

- **A private schema or private tables on a shared server satisfy database-per-service.** A
  dedicated server is not required; shared access is the defect. *[MSP ch. 1; BM2 ch. 8]*
- **Settle each cross-service workflow's consistency strategy before the split.** Foreign keys and
  transactions stop at the service boundary; plan soft deletes, copied reference values, or sagas
  up front. *[BM2 ch. 3; SAHP ch. 1, 2]*
- **Choose consistency or availability per capability, from how much staleness the business
  tolerates.** One service can serve stale reads yet require consistent writes. *[BM2 ch. 12]*
- **Answer cross-service queries with API composition first; move to a CQRS read model only when
  composition needs large in-memory joins or misses its latency target.** CQRS adds stores,
  replication lag, and operations. *[MSP ch. 7; MSA-PL Querying; OCNM ch. 6]*
- **Call providers in parallel in an API composer, and paginate or cap every composed list.** The
  sequential sum is the response time, and an uncapped fan-out fails at ten thousand rows.
  *[MSP ch. 7; Review lessons]*
- **Make CQRS view updates idempotent and order-safe by storing the last applied event id per
  source aggregate in the view row.** Redelivered or concurrent events otherwise regress the view.
  *[MSP ch. 7]*
- **Give clients a way to read their own writes against a lagging view.** Return the published
  event id as a token the query side checks, or update the UI from the command response.
  *[MSP ch. 7]*
- **Feed reporting with curated events pushed into a reporting store, never by reading service
  tables or calling every API in turn.** Reach-in reads break on schema change; API loops are too
  slow. A team-owned reporting database is an acceptable, versioned alternative. *[MAP ch. 4;
  BM2 ch. 3]*
- **Back every "only one", "never twice", or "at most N" rule with a unique index, a constraint,
  or a row lock in the owning database.** With several replicas, an in-process check or a cache
  is not enforcement. *[Review lessons]*

## Inter-service communication

- **Make remote calls visible in code; never hide them behind local-looking abstractions.** They
  add latency, serialization cost, and partial-failure modes. *[BM2 ch. 4, 5]*
- **Use asynchronous messaging for state-changing work that does not need an immediate answer,
  and synchronous calls with resilience guards for queries.** Long synchronous chains add temporal
  coupling and cascading slowness. *[BM2 ch. 4; MSP ch. 3; MAP ch. 10; MSA-PL Communication
  style]*
- **Make a service self-contained: answer a synchronous request from local data where possible.**
  Keep an event-fed replica, or save the request as pending, reply, and finish through messages.
  *[MSP ch. 3; MSA-PL Decomposition]*
- **Publish events as facts, not commands, carrying the data typical consumers need.** Stop short
  of tailoring events per consumer, since every field becomes contract; split PII into a narrowly
  distributed event. *[BM2 ch. 4; MSP ch. 5]*
- **Key partitioned channels by aggregate id so one entity's messages arrive in order at one
  consumer.** Competing consumers on a plain queue can process "cancelled" before "created".
  *[MSP ch. 3; BM2 ch. 5]*
- **Bound retries per message and route failures to an inspectable, replayable dead-letter
  queue.** A poison message can otherwise kill every worker in turn. *[BM2 ch. 4]*
- **Use a cross-language schema'd format (JSON with JSON Schema, Protobuf, Avro), never native
  language serialization.** Services in other languages will appear. *[MSP ch. 3]*
- **Resolve services through the platform's discovery (Kubernetes Service DNS or the mesh), not a
  client-side registry library.** Client-side discovery and self-registration (Eureka, Ribbon) pay
  off only when services span several platforms. *[MSP ch. 3; MSA-PL Discovery]*

## Resilience on remote calls

- **Set every timeout from measured healthy latency, log every timeout, and enforce an overall
  deadline whose remaining budget passes downstream.** An arbitrary timeout either hangs callers
  or aborts requests that succeeded. *[BM2 ch. 12; MAP ch. 2; OCNM ch. 4]*
- **Retry only transient failures (connection reset, 503, 504, never 404 or 400), with exponential
  backoff and jitter, inside the time budget, at one tier only.** Stacked immediate retries
  multiply load on a struggling service. *[BM2 ch. 12; OCNM ch. 4]*
- **Make a state-changing call safe to retry before you retry it.** Send an idempotency key or a
  business key, and record it under a unique constraint in the receiver. A timeout cannot tell you
  whether the work happened. *[MAP ch. 2; BM2 ch. 12; Review lessons]*
- **Isolate resources per dependency with bulkheads (separate pools, capped in-flight calls).**
  One slow dependency must not drain the shared pool. *[BM2 ch. 12; MSP ch. 3; OCNM ch. 4, 6]*
- **Decide with the business, per dependency, what the caller does when it fails.** Error for
  essential data; omit, cache, or default supplementary data; model "degraded" as an explicit
  domain value, not a null. *[BM2 ch. 12; MSP ch. 3; OCNM ch. 4]*
- **Wire resilience in through client middleware or a mesh, with standard defaults.** Use
  Resilience4j on the JVM, Polly on .NET, or mesh retry and outlier policies; business code should
  not carry breaker checks. *[MAP ch. 2; BM2 ch. 12]*
- **Give outbound clients that carry tokens a timeout, disabled redirects, and TLS.** A followed
  redirect can carry credentials to another host. *[Review lessons; BM2 ch. 11]*
- **Return correct HTTP status classes.** Breakers and retries misbehave when a service returns
  2xx for errors or mixes 4xx and 5xx. *[BM2 ch. 10, 16]*

## Sagas and cross-service consistency

- **Write a compensating transaction for every compensatable step, as a semantic undo.** Committed
  steps cannot roll back; "cancel the order" replaces "delete the row", and aborted work stays on
  record. *[MSP ch. 4; BM2 ch. 6]*
- **Classify steps as compensatable, pivot, or retriable, and run risky steps early and
  irreversible ones at or after the pivot.** Retriable steps after the pivot must eventually
  succeed. *[MSP ch. 4; BM2 ch. 6]*
- **Treat sagas as unisolated and pick countermeasures on purpose.** Use semantic locks
  (`*_PENDING` states), commutative updates, or rereads; back each semantic lock with a row lock
  or conditional update, and decide whether other commands fail fast or wait. *[MSP ch. 4;
  Review lessons]*
- **Implement sagas in code, keep each saga's state queryable, and keep orchestrators limited to
  sequencing.** Avoid GUI process tools that resist versioning and tests; a smart orchestrator
  with dumb services misplaces business logic. *[BM2 ch. 6; MSP ch. 4]*

## Contracts, versioning, and shared code

- **Publish only fields a known consumer needs; keep persistence ids, internal flags, and
  getters out of response and event schemas.** Every published field becomes a dependency.
  *[BM2 ch. 2; OCNM ch. 3]*
- **Write consumers as tolerant readers and servers with defaults for missing fields.** Bind only
  the fields you use and ignore unknown ones, but still reject malformed values in the fields you
  consume. *[BM2 ch. 5; MSP ch. 3; Review lessons]*
- **Publish a machine-readable contract (OpenAPI, Protobuf, AsyncAPI) for every sync and async
  interface.** *[OCNM ch. 4; MSP ch. 3; BM2 ch. 5]*
- **Fail CI on backward-incompatible schema changes using a tool that gives a pass/fail verdict.**
  Schemas catch structural breaks; semantic breaks still need tests. *[BM2 ch. 5]*
- **For an unavoidable break, serve old and new versions from the same deployment and translate in
  the adapter layer, never in domain logic.** Running two deployed versions of a service doubles
  fixes and routing. *[BM2 ch. 5; MSP ch. 3]* Versioning mechanics live in [API
  design](../api/api-design.md).
- **Reject a missing or unrecognized version marker instead of defaulting.** A silent default sends
  a malformed request down the wrong path. *[MAP ch. 8; Review lessons]*
- **Cap live versions, publish a deprecation schedule, and log per-endpoint usage with a client
  id.** Without usage data you cannot retire an endpoint or find the laggards. *[MAP ch. 8;
  BM2 ch. 5]*
- **Never share domain-model libraries between services; tolerate duplication across services.**
  Share only stable infrastructure code, split by concern, as versioned artifacts each service
  adopts on its own schedule, never a shared source project. *[BM2 ch. 5; MAP ch. 3]*
- **After fixing a defect in one service's handler, client, or consumer, sweep every service for
  the same pattern in the same change.** Templated services repeat the same bug. *[Review lessons]*

## Edge: API gateway and backends for frontends

- **Do not let external clients call fine-grained services directly.** Put a gateway in front for
  routing, edge authentication, and protocol translation. *[MSP ch. 8; MSA-PL External API]*
- **Use one backend-for-frontend per client type, owned by that UI's team.** A shared aggregating
  gateway becomes a contention point; move real duplication into a domain service. *[BM2 ch. 14;
  MSP ch. 8]*
- **Keep business logic out of the gateway, never route east-west traffic through it, and
  automate its pipeline.** A central gateway team that must expose every endpoint recreates the
  ESB bottleneck. *[BM2 ch. 5; MSP ch. 8]*
- **Scope CORS to named origins and endpoints at the edge; never use a wildcard on a stateful
  endpoint.** *[Review lessons]* See [application security](../security/application-security.md).

## Security between services

- **Authenticate at the edge, propagate identity in a signed short-lived token, and authorize
  fine-grained (per aggregate) inside each owning service.** The gateway can only do coarse
  role-to-path checks. *[MSP ch. 11; BM2 ch. 11; MSA-PL Security]*
- **Verify signature, algorithm, issuer, audience, and expiry on every service.** Use asymmetric
  signing with published verification keys rather than a shared secret, and reject unexpected
  algorithms. *[OCNM ch. 4; MSP ch. 11; BM2 ch. 11]*
- **Carry the tenant and user from the token into every query's WHERE clause.** A globally unique
  id alone lets one tenant read another's records through a trusted caller. *[Review lessons;
  BM2 ch. 11]*
- **Do not share server sessions or a session store across services.** Sessions create affinity
  and cannot be passed downstream safely. *[OCNM ch. 4; MSP ch. 11]*
- **Give each service its own least-privilege credentials, rotate them, support revocation without
  redeploy, and prefer workload identity over long-lived secrets.** *[BM2 ch. 11]*
- **Authenticate service-to-service traffic with mutual TLS (often via the mesh).** More hops mean
  more exposure. *[BM2 ch. 11]*
- **Scan every service pipeline for committed secrets (gitleaks, trufflehog, or forge push
  protection) and vulnerable dependencies, and rebuild images regularly for OS patches.**
  *[BM2 ch. 11; SAHP ch. 1]*

## Testing

- **Verify inter-service contracts with consumer-driven contract tests run in the provider's
  pipeline, and reuse the contracts as consumer stubs.** They show which consumer breaks without
  starting the whole system. *[BM2 ch. 9; MSP ch. 9, 10; MSA-PL Testing]*
- **Test each service in isolation with component tests against its real image, real database,
  and real broker, stubbing other services.** *[MSP ch. 10]*
- **Keep only a few end-to-end tests, written as user journeys, plus synthetic checks in
  production.** Cross-team suites are slow, brittle, and couple teams. *[MSP ch. 9, 10; BM2 ch. 9]*

## Build, deploy, and configuration

- **Give each service its own independently triggered pipeline, in a monorepo or not, and never
  version or deploy services as one system release.** *[BM2 ch. 7, 9; MSP ch. 9]* See
  [CI/CD](../devops/ci-cd.md).
- **Build each artifact once and promote it unchanged; inject environment config at runtime.**
  *[BM2 ch. 7; MSP ch. 11; OCNM ch. 1, 3; MSA-PL Cross-cutting concerns]*
- **Parse configuration at startup and fail fast on missing, empty, NaN, or out-of-range values.**
  Give optional keys safe defaults, and use the library's dot-to-underscore mapping for env names.
  *[Review lessons; OCNM ch. 3]*
- **Deploy each service as its own isolated unit (container on a managed platform), with rolling
  updates gated by readiness.** Co-hosted services lose isolation. *[MSP ch. 12; BM2 ch. 8;
  MSA-PL Deployment]* See [Kubernetes](../devops/kubernetes.md).
- **Separate deployment from release.** Deploy dark, then shift traffic gradually with flags or
  canaries, and roll back on error signals. *[BM2 ch. 8; MSP ch. 12]*
- **Supply cross-cutting concerns through a copied service template or thin chassis carrying the
  same gates (lint, secret scan, pre-commit checks) in every service.** Copy the template; do not
  link a mandatory framework. *[BM2 ch. 16; MSP ch. 11; MSA-PL Cross-cutting concerns;
  Review lessons]*
- **Do not adopt a service mesh or Kubernetes for a handful of services; prefer managed offerings
  when you do.** *[BM2 ch. 5, 8]*

## Observability

- **Set up log aggregation before the second service, in one structured format the service writes
  to stdout.** *[BM2 ch. 10; OCNM ch. 1; MSP ch. 11]*
- **Generate a correlation id at the edge and propagate W3C trace context with OpenTelemetry on
  every call, event, and background job span.** Never order cross-machine events by timestamp.
  *[BM2 ch. 10; OCNM ch. 5; MSA-PL Observability]*
- **Write event and log timestamps in UTC through one date helper.** Timezone-less strings read as
  local time disagree across hosts. *[Review lessons]*
- **Expose separate liveness and readiness probes, plus a startup probe for slow boots instead of a
  long initial delay; liveness never depends on downstreams.** Readiness reflects the service's own
  ability to serve, not every dependency (see Tensions). *[OCNM ch. 5; MSP ch. 11]*
- **Define SLOs per service, alert on user-visible symptoms and synthetic flows, and record every
  deploy and config change beside the telemetry.** *[BM2 ch. 10; OCNM ch. 5; MSA-PL Observability]*

## Migrating from a monolith

- **Migrate incrementally with a strangler: extract one service, run it in production, assess,
  repeat; never big-bang rewrite.** *[BM2 ch. 3; MSP ch. 13]*
- **Build an inventory first: components with responsibilities, and tables with owners and
  consumers.** Flag shared views and stored procedures. *[SAHP ch. 1]*
- **Extract new features and high-change, high-value capabilities first.** Moving stable code buys
  nothing. *[MSP ch. 13]*
- **Sketch each extraction's data split before moving code, then move code first and migrate the
  data once boundaries settle.** Time-box the shared-schema phase; it trades away independent
  deployability. *[BM2 ch. 3; MAP ch. 1]*
- **Extract a whole vertical slice, replace object references with ids, and add an
  anti-corruption layer.** *[MSP ch. 13]* See [refactoring and legacy
  code](../core/refactoring-and-legacy-code.md).

## Tensions

- **Monolith first vs each new capability as a service.** OCNM proposes a new service per sizable
  feature; BM2, MSP, and MAP start coarse. This library starts with a modular monolith and splits
  when ownership, scaling, or cadence demand it. *[OCNM ch. 1; BM2 ch. 1; MSP ch. 1; MAP ch. 5]*
- **Orchestration vs choreography.** MSP orchestrates all but the simplest sagas; BM2 prefers
  choreography across teams. House position: code-first orchestration (often a durable workflow
  engine) by default; choreography for short flows. *[MSP ch. 4; BM2 ch. 6]*
- **Async by default vs neutral.** MSP and MSA-PL push messaging everywhere; BM2 warns
  event-heavy systems are hard to debug. House position: async for cross-service state changes,
  guarded sync for queries. *[MSP ch. 3; MSA-PL Communication style; BM2 ch. 4]*
- **Circuit breaker instead of timeouts.** MAP presents the breaker as the alternative. This
  library requires both, plus bulkheads and idempotent retries. *[MAP ch. 2; BM2 ch. 12]*
- **Data first vs functionality first.** BM2 extracts data first when separability is in doubt;
  MAP moves code first and data last. House position: plan the data split up front, prove it first
  only where doubtful, otherwise code first and data once. *[BM2 ch. 3; MAP ch. 1]*
- **Transacted messaging vs outbox.** MAP's broker transactions do not include the sender's
  database write. Use the outbox. *[MAP ch. 10; MSP ch. 3]*
- **Header vs URL versioning.** MAP prefers headers; MSP allows URL paths. This library prefers
  expansion-only change and defers mechanism to [API design](../api/api-design.md). *[MAP ch. 8;
  MSP ch. 3]*
- **Dropping end-to-end tests.** BM2 retires them; MSP keeps a few journeys. Keep a thin journey
  set plus production synthetics. *[BM2 ch. 9; MSP ch. 10]*
- **Readiness tied to dependencies.** OCNM fails readiness when a dependency is down, which can
  drain every replica at once. Use breakers and fallbacks instead. *[OCNM ch. 5]*
- **Chassis or mesh vs neither.** MSP recommends a chassis or mesh; BM2 warns against meshes at
  small scale. Use a template or thin chassis first, a mesh only at scale. *[MSP ch. 11; BM2 ch. 5]*
- **Event sourcing as a peer of sagas.** MSA-PL lists it beside sagas; MSP lists real costs.
  Reserve it for domains that need history or audit. *[MSA-PL Maintaining data consistency;
  MSP ch. 6]*
- **Dated tooling.** Hystrix, Sleuth, Ribbon, Eureka, OpenTracing, git-secrets, and probe initial
  delays are superseded; the rules above name current equivalents (Resilience4j, Polly, mesh
  policies, OpenTelemetry, platform DNS discovery, gitleaks, startup probes). *[MSP ch. 3, 11;
  MAP ch. 2; BM2 ch. 10, 11; OCNM ch. 5]*

## Sources

- **BM2**: Building Microservices: Designing Fine-Grained Systems (Sam Newman, O'Reilly, 2nd ed.,
  2021)
- **MSP**: Microservices Patterns: With Examples in Java (Chris Richardson, Manning, 1st ed., 2019)
- **MAP**: Microservices AntiPatterns and Pitfalls (Mark Richards, O'Reilly report, 1st ed., 2016)
- **MSA-PL**: A Pattern Language for Microservices (Chris Richardson, pattern-map poster, 2020)
- **OCNM**: Developing Open Cloud Native Microservices: Your Java Code in Action (Graham Charters,
  Sebastian Daschner, Pratik Patel, Steve Poole; O'Reilly report, 1st ed., 2019)
- **SAHP**: Software Architecture: The Hard Parts (Neal Ford, Mark Richards, Pramod Sadalage, Zhamak
  Dehghani; O'Reilly, 1st ed., 2021), excerpt covering ch. 1 and part of ch. 2
- **Review lessons**: rules distilled from the maintainer's code-review findings
