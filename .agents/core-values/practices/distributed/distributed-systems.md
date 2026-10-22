# Distributed systems

> **Load when:** writing or reviewing code that crosses a network or process
> boundary and must stay correct when parts fail: remote calls and their
> timeouts, retries, and idempotency keys; replication lag and read
> consistency; distributed locks, leases, and leader election; clocks and
> event ordering; keeping several stores or services consistent (sagas, 2PC,
> outbox); sharding and fan-out; zone or region topology and quorum sizing;
> or sidecar, ambassador, and adapter containers.
> **See also:** [Microservices](../architecture/microservices.md),
> [Event-driven architecture and messaging](../architecture/event-driven-and-messaging.md),
> [Scalability and system design](../architecture/scalability-and-system-design.md),
> [Apache Kafka](../messaging/kafka.md),
> [Data modeling](../data/data-modeling.md),
> [Database operations](../data/database-operations.md),
> [NoSQL data stores](../data/nosql.md),
> [Caching and Redis](../data/caching-and-redis.md),
> [Observability and reliability](../operations/observability-and-reliability.md),
> [Cloud architecture](../cloud/cloud-architecture.md),
> [Kubernetes](../devops/kubernetes.md),
> [Concurrency and parallelism](../concurrency/concurrency.md)

## Top rules

1. **Put an explicit timeout on every network call, pool checkout, and lock
   acquisition.** Many clients wait forever by default, and one hung call
   leaks a thread or socket until the pool runs dry.
   *[UDS ch. 16; DDIA ch. 4]*
2. **Treat a timed-out remote call as "outcome unknown", never as "failed".**
   The request may have been applied, so a blind retry repeats it; count a
   request as done only when the application confirms it.
   *[DDIA ch. 4, ch. 8; UDS ch. 16]*
3. **Make every side-effecting operation idempotent end to end.** Generate a
   request id at the client, pass it through every hop, and enforce its
   uniqueness with a unique index in the store that records the effect.
   *[DDIA ch. 12; UDS ch. 12; Review lessons]*
4. **Retry only transient failures, at one layer only, with capped
   exponential backoff and jitter.** Retries at several layers multiply, and
   synchronized retries become a storm against a dependency already failing.
   *[UDS ch. 16]*
5. **Never dual-write from request code to two stores.** Make one store the
   system of record and derive the others from its ordered change log (CDC or
   an outbox table). *[DDIA ch. 11; UDS ch. 11]*
6. **Never order events across machines by wall-clock time; measure
   durations with a monotonic clock.** Clock skew makes last-write-wins drop
   newer writes silently. *[DDIA ch. 8; UDS ch. 8]*
7. **Protect any resource guarded by a lock or lease with a fencing token
   that the resource itself checks.** A paused process still believes it
   holds the lock after its lease expired. *[DDIA ch. 8; UDS ch. 9; DDS ch. 9]*
8. **Use a proven consensus store (etcd, ZooKeeper, Consul, or the
   platform's lease API) for election, locks, and membership.** A homemade
   consensus algorithm will be wrong. *[DDIA ch. 9; DDS ch. 9; UDS ch. 9]*
9. **Enforce "only one", "never twice", and "at most N" in the database**
   with a unique or partial unique index, `ON CONFLICT`, `SELECT ... FOR
   UPDATE`, or an advisory lock. An in-process guard does not hold across
   replicas. *[Review lessons; DDIA ch. 7, ch. 12]*
10. **Keep stateful data on one node until cost, availability, or latency
    forces distribution.** Distribution adds failure modes a single machine
    never has; stateless tiers can scale out freely. *[DDIA ch. 1, ch. 8]*

## Remote calls: timeouts, retries, and idempotency

- **Route every outbound call through one wrapper** (a client library or a
  sidecar proxy) that applies timeouts, retries, and instrumentation, so no
  call site can forget them. *[UDS ch. 14, ch. 16]*
- **Pick each timeout from the measured latency of that call,** near the
  percentile matching the false-timeout rate you accept (about p99.9 for
  0.1%). *[UDS ch. 16; DDIA ch. 8]*
- **Give any I/O library you write a default timeout and make it
  configurable.** In JavaScript pass `AbortSignal.timeout(ms)` to `fetch`;
  Python `requests` and Go's default `http.Client` still have no default.
  *[UDS ch. 16]* (updated: the book predates `AbortSignal.timeout`)
- **Parse timeout, retry, and pool-size settings at startup,** rejecting NaN,
  empty, zero, negative, or out-of-range values with a clear error. A bare
  `Number()` read can silently become "wait forever". *[Review lessons]*
- **Fail fast on non-transient errors** (4xx, authorization failures,
  constraint violations); retry only 5xx responses, 429 after its
  `Retry-After`, and connection resets. *[UDS ch. 16, ch. 17; DDIA ch. 7]*
- **Never retry a non-idempotent call whose effect matters** (payments,
  emails, inventory) unless it carries an idempotency key the server
  deduplicates on. *[UDS ch. 16; DDIA ch. 12]*
- **Scope idempotency keys and dedup records to the tenant:** unique on
  (tenant id, request id), and every lookup filters on the tenant column.
  *[Review lessons]*
- **Disable redirects on outbound clients that carry a credential,** so a
  redirect cannot forward the token to another host. *[Review lessons]*
- **Guard async callers against stale responses with a request id,** drop
  replies that are not for the latest request, and clear pending timers when
  the caller goes away. *[Review lessons]*
- **After fixing a missing timeout, retry, or dedup check in one client,
  grep every sibling call site and fix them in the same change.**
  *[Review lessons]*

## Overload and failure containment

- **Put a circuit breaker (closed, open, half-open) in front of each
  dependency.** Retries suit brief blips; a breaker suits long degradations
  because it stops sending calls at all. *[UDS ch. 16]*
- **Give each non-critical dependency a coded fallback** (omit the panel,
  serve cached data) and a test that runs the request with that dependency
  down, so it degrades instead of failing the whole request. *[UDS ch. 16]*
- **Shed load at capacity:** count in-flight requests and return 503 above a
  threshold, dropping low-priority work first. *[UDS ch. 17]*
- **Answer a breached quota with 429 and `Retry-After`,** naming the quota.
  Build distributed rate limiters on atomic counters with batched flushes,
  and fail open on the last known state if the counter store is down.
  *[UDS ch. 17; DDS ch. 5]*
- **Isolate tenants with bulkheads or shuffle-sharding** so one heavy or
  poisonous client degrades only its own slice. *[UDS ch. 17, ch. 12]*
- **Size a pool so survivors absorb a lost replica's share plus the retries
  it triggers,** or one failure cascades through the pool. *[UDS ch. 15]*
- **Record in the design what happens when each component fails,**
  including hidden single points of failure: a manually renewed certificate,
  a config database read at startup, DNS, a whole cloud region.
  *[UDS ch. 15; ADTA ch. 3]*
- **Design every process to crash at any instruction:** stateless request
  handling, durable state elsewhere, leases instead of permanent locks, and
  spare capacity for one lost instance. *[UDS ch. 17; ADTA ch. 2]*
- **Make the system survive losing its cache,** and test that degraded mode
  as carefully as the normal one; mechanics are in
  [Caching and Redis](../data/caching-and-redis.md).
  *[UDS ch. 14; DDS ch. 6]*
- **Separate readiness from liveness.** Route only to ready replicas and
  restart only dead ones; liveness that depends on a shared dependency fails
  every instance at once. *[DDS ch. 5; UDS ch. 17]*

## Delivery semantics and consumers

- **Assume at-least-once delivery and make every consumer idempotent,** for
  example by storing the message id or offset in the same transaction as the
  effect. Only exactly-once processing exists, via idempotency.
  *[UDS ch. 12; DDIA ch. 11]*
- **Do not rely on message order unless the broker guarantees it per key
  and one consumer reads each partition.** *[UDS ch. 12; DDIA ch. 11]*
- **Cap redeliveries and move poison messages to a dead-letter channel;**
  never delete them unprocessed. *[UDS ch. 12]*
- **Parse each message at the consumer boundary** with a schema that rejects
  malformed ids and missing fields before any side effect. *[Review lessons]*
- **Keep a checked-in diagram or manifest of chained queues and functions,**
  and alert on call cycles between functions. *[DDS ch. 8, ch. 11]*
- Broker choice, partitioning, and event sourcing live in
  [Event-driven architecture and messaging](../architecture/event-driven-and-messaging.md).

## Consistency across stores and services

- **Keep a database, search index, and cache in sync by appending each change
  once to an ordered log** that every store consumes with a checkpoint. When
  an event must be atomic with a state change, write it to an outbox table in
  the same transaction and relay it. *[DDIA ch. 11; UDS ch. 11]* (updated:
  neither book names the outbox; it is current practice for this case)
- **Avoid two-phase commit (XA) across different technologies.** In-doubt
  transactions hold locks until the coordinator recovers, and one participant
  down blocks every commit. *[DDIA ch. 9; UDS ch. 11]*
- **Implement cross-service workflows as sagas:** local steps with
  compensating actions, run by an orchestrator that persists its state after
  every transition. Participants deduplicate, because the orchestrator
  resends; prefer a managed workflow engine. *[UDS ch. 11]*
- **Protect integrity (nothing lost, duplicated, or contradictory) before
  timeliness (readers see current data).** Staleness heals by waiting;
  corruption does not. Use apology-and-compensate constraints only where the
  business signs off. *[DDIA ch. 12]*
- **Choose the isolation level on purpose;** check-then-write invariants and
  write skew are covered in [Data modeling](../data/data-modeling.md).
  *[UDS ch. 11; DDIA ch. 7]*
- **Do not use the transactional database as a transient message bus.** Put
  work queues on a durable broker, and decide whether in-flight messages must
  survive a region loss. *[ADTA ch. 2]*
- **Make any comment or docstring promising "exactly once", "ordered", or
  "at most one" match what the code and schema enforce.** *[Review lessons]*

## Replication and read consistency

- **Never assume asynchronous replicas are current.** Decide what users see
  if lag grows to minutes, and read the store's actual guarantees before
  relying on read-after-write. *[DDIA ch. 5; UDS ch. 10, ch. 14]*
- **Provide read-your-writes for data the user just changed:** read from the
  leader for a window after a write, or carry the last write position and
  read only from replicas that reached it. Pin each user to one replica for
  monotonic reads. *[DDIA ch. 5]*
- **Fail over only through a tool or managed service that fences the old
  leader,** and use synchronous or quorum replication for writes you cannot
  lose. Asynchronous failover can discard unreplicated writes, cause split
  brain, and reuse auto-increment ids. *[DDIA ch. 5]* (updated: the book
  distrusts automatic failover; fencing tools now make it routine)
- **Avoid multi-leader and leaderless replication unless forced.** Home each
  record's writes in one leader or region; resolve leftover conflicts
  convergently (CRDTs or kept siblings), never by timestamp.
  *[DDIA ch. 5; UDS ch. 14]*
- **Pay for linearizability only where correctness needs it:** election,
  locks, hard uniqueness, and cross-channel races such as "write a file, then
  enqueue a message to read it". It costs latency on every operation.
  *[DDIA ch. 9]*
- **State in the design which consistency guarantee each read and write
  path needs and its normal-case latency,** not "CAP: pick two"; partitions
  happen whether or not you choose them. *[DDIA ch. 9; UDS ch. 10]*

## Time, clocks, and pauses

- **Order events with logical clocks, version vectors, or single-leader
  sequence numbers.** *[DDIA ch. 8; UDS ch. 8]*
- **If correctness depends on synchronized clocks, monitor offsets and evict
  drifting nodes,** and treat each reading as an interval with uncertainty.
  Broken clocks lose data quietly. *[DDIA ch. 8]*
- **Store and transmit timestamps in UTC through one project date helper;**
  never parse a zone-less timestamp from another node as local time.
  *[Review lessons]*
- **Assume a process can freeze for seconds at any line** (GC, VM pause,
  swap, I/O stall). Never check a lease and then act as if no time passed.
  *[DDIA ch. 8; DDS ch. 9]*
- **Choose failure-detection timeouts from measured round trips or an
  adaptive detector.** Declaring a node dead too early repeats its work and
  shifts load onto busy peers. *[DDIA ch. 8; UDS ch. 7]*

## Coordination: leases, locks, and leader election

- **First ask whether one orchestrator-restarted instance meets the SLA.**
  It gives roughly three nines, often enough for background work.
  *[DDS ch. 9]*
- **Build election and locks on a consensus store's compare-and-swap with a
  TTL lease.** On Kubernetes use `coordination.k8s.io` Lease objects through
  the client library; on etcd use v3 leases and transactions (book examples
  with etcd v2 commands are dated). *[DDS ch. 9; UDS ch. 9]*
- **Keep coordination stores for slow-changing data** (leaders, membership,
  config), never high-churn application state. *[DDIA ch. 9]*
- **Give every lock a TTL, wait on a watch rather than a sleep-poll, and
  release only with a compare-and-swap on the version you acquired.**
  *[DDS ch. 9]*
- **Renew a short lease about every TTL/2, and stop guarded work the moment
  renewal fails or the work outlives the lease.** Exiting and restarting as
  a standby is the simplest safe handler. *[DDS ch. 9]*
- **Have the downstream resource reject any fencing token lower than the
  highest it has seen.** If it cannot check tokens, make the guarded
  operation idempotent. *[DDIA ch. 8; UDS ch. 9; DDS ch. 9]*
- **Try optimistic concurrency (version-checked writes) before a leader;**
  when you need one, give it only coordination work, since it is a
  bottleneck and a single point of failure. *[UDS ch. 9]*

## Partitioning, sharding, and fan-out

- **Never map keys to nodes with `hash(key) mod N`.** Changing N moves almost
  every key; use consistent hashing or many fixed partitions moved whole.
  *[DDIA ch. 6; UDS ch. 13; DDS ch. 6]*
- **Build the shard key only from the request fields that determine the
  response.** Including timestamps scatters identical requests; omitting
  locale serves wrong content. *[DDS ch. 6]*
- **Do not lead a range key with a rising timestamp or id;** all current
  writes land on one partition. *[DDIA ch. 6; UDS ch. 13; DDS ch. 7]*
- **Plan for hot keys:** split a known hot key into sub-keys and autoscale
  shards independently; see [NoSQL data stores](../data/nosql.md).
  *[DDIA ch. 6; DDS ch. 6]*
- **Size scatter/gather fan-out against tail latency and availability.** The
  request waits for the slowest leaf, so set per-leaf p99 targets and
  replicate every leaf. *[DDS ch. 7; DDIA ch. 1]*
- **Carry the tenant column in every cross-shard query, update, and
  delete,** even when the record id is globally unique. *[Review lessons]*
- **Shard work queues across failure zones and roll out workers one shard at
  a time,** so a bad build hits one shard's users. *[DDS ch. 11]*

## Topology, quorum, and regions

- **Write down the requirements before choosing a topology:** availability
  target, throughput and latency at a named percentile, regions, residency
  rules, and total cost including staffing. *[ADTA ch. 1]*
- **State the failure budget as a count of simultaneous node, zone, or region
  losses, and size redundancy to it.** *[ADTA ch. 1, ch. 3]*
- **Size replication with majority quorums:** tolerating f losses needs 2f+1
  replicas. *[ADTA ch. 3; DDIA ch. 8]*
- **Spread every tier across at least three zones; for region survival use
  at least three regions, never two.** *[ADTA ch. 2, ch. 3]*
- **Run one Kubernetes cluster per region behind a global load balancer,**
  never one cluster stretched across regions. *[ADTA ch. 2]*
- **Place application nodes in the same regions, zones, and environment as
  the database nodes they call.** *[ADTA ch. 3]*
- **Assign each table a locality on purpose** (global for read-mostly shared
  data, regional-by-row for per-customer data), and verify that regulated
  rows live only in permitted regions. *[ADTA ch. 3]*

## Sidecars, ambassadors, and adapters

- **Add TLS, config sync, or introspection to an app you cannot change with a
  sidecar,** binding the app to localhost so plaintext stays on loopback.
  Reload config through the app's existing path (file watch, SIGHUP,
  restart). On Kubernetes declare it as a native sidecar (an init container
  with `restartPolicy: Always`) so it starts first and stops last.
  *[DDS ch. 2]* (updated: native sidecars postdate the book)
- **Point the app at localhost and let an ambassador handle sharding,
  discovery, and environment differences,** so config matches in dev and
  prod. *[DDS ch. 3]*
- **Validate a new version by teeing production traffic and discarding its
  responses;** split experiments by user or header, not source IP.
  *[DDS ch. 3, ch. 5]*
- **Use adapters to put heterogeneous components on one monitoring and
  health interface,** with checks that run real queries. *[DDS ch. 4]*
- **Never hard-code credentials in function or sidecar source;** inject them
  from a secret store. *[DDS ch. 8; Review lessons]*

## Evolution and verification

- **Assume old and new versions run at the same time.** Keep requests
  backward compatible and responses forward compatible, preserve unknown
  fields on read-modify-write, and run a schema breaking-change check in CI.
  *[DDIA ch. 4; UDS ch. 5]*
- **Ship an incompatible change as three revertible deploys:** consumers read
  both formats, producers write the new one, then remove the old.
  *[UDS ch. 19]*
- **Deliberately test behavior under partitions, pauses, and process
  kills.** Untested fault paths have caused permanent deadlocks and data
  loss. *[DDIA ch. 8; UDS ch. 20]*
- **Run invariant checks in production and alert on discrepancies** such as
  messages in not equal to messages out. *[DDIA ch. 1, ch. 12]*

## Tensions

- **Strong consistency by default vs avoid coordination.** ADTA defaults to
  serializable, globally consistent SQL; DDIA warns linearizability costs
  latency on every operation. House: keep shared transactional state on one
  node or in a strongly consistent store, and accept eventual consistency
  only for derived views. *[ADTA ch. 1, ch. 3; DDIA ch. 9]*
- **CAP framing vs latency framing.** ADTA reasons with CAP; DDIA calls it
  unhelpful. House: name the guarantee and its normal-case latency (PACELC
  style). *[ADTA ch. 3; DDIA ch. 9]*
- **Shared database vs database per service.** ADTA calls a shared store
  nearly always necessary. House: one cluster is fine, but each schema has
  one owning service and no cross-service table access. *[ADTA ch. 1]*
- **Broker vs outbox.** ADTA keeps messages off the database. House: a
  broker for work queues, an outbox when an event must be atomic with a
  state change. *[ADTA ch. 2; DDIA ch. 11]*
- **Serializable when in doubt vs weaker isolation.** UDS leans serializable.
  House: pick the level from the anomalies the code tolerates and enforce
  invariants with constraints or locks. *[UDS ch. 11; DDIA ch. 7]*
- **Microservices by default vs monolith first.** ADTA assumes services; UDS
  starts with a monolith. House: start modular and extract services once
  boundaries are proven. *[ADTA ch. 2; UDS ch. 12]*
- **Dependency health checks vs local-only checks.** DDS runs real queries;
  UDS warns they fail every instance together. House: query checks feed
  readiness, liveness stays local, and load balancers fail open when most of
  the pool is unhealthy. *[DDS ch. 4; UDS ch. 17]*
- **Client-side lease checks vs receiver-side fencing.** DDS checks lease age
  before acting; DDIA shows pauses defeat that. House: client checks reduce
  risk, the receiver-side token check is required. *[DDS ch. 9; DDIA ch. 8]*

## Sources

- **DDIA**: Designing Data-Intensive Applications (Martin Kleppmann, 1st ed.)
- **UDS**: Understanding Distributed Systems (Roberto Vitillo, version 1.0.4)
- **DDS**: Designing Distributed Systems (Brendan Burns, 1st ed.)
- **ADTA**: Architecting Distributed Transactional Applications (Harrison,
  Marshall, Custer; O'Reilly report, 1st ed.)
- **Review lessons**: rules distilled from the maintainer's code-review
  findings
