# Scalability and system design

> **Load when:** designing, reviewing, or writing a design doc for how a system copes with growth
> in traffic, data, or tenants: capacity estimates and latency targets, stateless tiers, load
> balancing and auto-scaling, read replicas, sharding and partition keys, consistent hashing,
> quorum and consistency choices, moving work onto queues and sizing workers, rate limits, single
> points of failure, or answering a system-design question.
> **See also:** [Distributed systems](../distributed/distributed-systems.md),
> [Caching and Redis](../data/caching-and-redis.md), [Event-driven architecture and
> messaging](../architecture/event-driven-and-messaging.md),
> [Microservices](../architecture/microservices.md), [Software architecture fundamentals](../architecture/architecture-fundamentals.md),
> [NoSQL data stores](../data/nosql.md), [Database operations, internals, and high
> availability](../data/database-operations.md), [SQL and query
> performance](../data/sql-and-query-performance.md), [Apache Kafka](../messaging/kafka.md),
> [Observability and reliability](../operations/observability-and-reliability.md),
> [Performance and load testing](../testing/performance-and-load-testing.md),
> [Cloud architecture](../cloud/cloud-architecture.md), [Kubernetes](../devops/kubernetes.md)

## Top rules

1. **Write down the load parameters before choosing an architecture.** Requests per second,
   read/write ratio, fan-out per request, data volume, key skew, and a sober growth forecast;
   scaling work built on wrong assumptions is wasted, and most products never need horizontal
   data partitioning. *[DDIA ch. 1; WSSE ch. 2]*
2. **Set targets on latency percentiles (p50, p95, p99), never the mean.** The tail is where the
   heaviest users live, and fan-out makes every request as slow as its slowest backend.
   *[DDIA ch. 1; DDS ch. 7]*
3. **Keep every request-serving tier stateless.** Sessions, uploads, locks, and invalidatable
   caches go to shared external stores, so any instance can serve any request and be killed at
   will. *[WSSE ch. 3, 4; DDIA ch. 1]*
4. **Scale stateful data on one node until cost, availability, or latency forces distribution.**
   Replicate for read throughput and availability; shard only when the data or write rate no
   longer fits one machine. *[DDIA ch. 1; WSSE ch. 5; DDS ch. 6]*
5. **Never place keys with `hash(key) % N`.** Changing N remaps almost every key; use many fixed
   logical partitions or consistent hashing with virtual nodes so a resize moves only a slice.
   *[DDIA ch. 6; WSSE ch. 5, 6; Grokking-ASDI, Consistent Hashing; DDS ch. 6]*
6. **Enforce "only one", "never twice", and "at most N" in the database.** A unique or partial
   unique index, `onConflict`, `SELECT ... FOR UPDATE`, or an advisory lock holds across every
   clone; a process-local mutex or an in-memory check does not. *[WSSE ch. 3; DDIA ch. 7;
   Review lessons]*
7. **Carry the tenant column in every query on tenant-owned data, and lead the shard key with it.**
   A globally unique id alone is not scoping; a tenant-prefixed key keeps a tenant's queries on one
   shard, and a tenant too big for one shard gets its own. *[Review lessons; WSSE ch. 5]*
8. **Move slow or unreliable work off the request path onto a queue whenever the caller can
   continue without the result.** Queues absorb spikes, scale by adding consumers, and keep the
   front door up while workers fail. *[WSSE ch. 7; DDS ch. 8; Grokking-ASDI, Messaging Systems]*
9. **Choose consistency per operation from the business requirement and write the trade-off down.**
   Say what a user sees when replicas lag by minutes; pay for linearizability only for leader
   election, locks, and hard uniqueness. *[Grokking-ASDI, Dynamo; DDIA ch. 5, 9]*
10. **Remove single points of failure by asking "what if this is off?" for every box in the
    diagram.** Run at least two replicas across failure domains for anything with an SLA, and keep
    a written recovery plan for whatever stays single. *[WSSE ch. 2; DDS ch. 5]*

## Sizing and requirements

- **Estimate with arithmetic, not adjectives.** Peak RPS, bytes per record times records,
  growth per month, and per-node throughput give the node count; expect a redesign at each order
  of magnitude. *[DDIA ch. 1; WSSE ch. 2]*
- **Measure latency on the client side with an open-loop load generator.** A generator that waits
  for each response keeps server queues short and hides head-of-line blocking; see
  [Performance and load testing](../testing/performance-and-load-testing.md). *[DDIA ch. 1]*
- **Merge histograms to get fleet-wide percentiles; never average percentiles.** Keep mergeable
  sketches (HdrHistogram, t-digest) per node and window. *[DDIA ch. 1]*
- **Budget for tail amplification in fan-out.** With many backend calls per request, nearly every
  request hits some backend's p99; set per-backend p99 and p999 targets accordingly.
  *[DDIA ch. 1; DDS ch. 7]*
- **Classify each data store by PACELC, not only CAP.** Partitions are rare; the trade-off you live
  with daily is latency against consistency in normal operation. *[Grokking-ASDI, PACELC;
  DDIA ch. 9]*
- **Prefer a key-value store when every access is by primary key and the volume outgrows one
  relational node.** A relational engine adds overhead for workloads that never join or range-scan.
  *[Grokking-ASDI, Dynamo]*
- **Justify a technology choice with a load test of your own workload, not a published
  benchmark.** Every benchmark has an agenda and unstated conditions. *[WSSE ch. 3]*
- **Make every quantitative claim in a design doc match the code.** Capacity numbers, "serialised",
  "at most one", and ordering promises are verified against the implementation or computed, never
  typed by hand. *[Review lessons]*

## Stateless tiers, load balancing, and auto-scaling

- **Frame each scaling step as clones, functional partitioning, or data partitioning.** Clones are
  cheapest; data partitioning scales furthest but makes every query find its partition first.
  *[WSSE ch. 2]*
- **Scale vertically while it is cheap, and know where it stops.** Price per unit climbs steeply,
  hardware has ceilings, and lock contention can make extra cores useless; check the application's
  concurrency limits first. *[WSSE ch. 1]*
- **Keep session state in a shared low-latency store keyed by session id.** Use a signed or
  encrypted cookie only for a tiny payload such as a user id, since cookies ride on every request.
  *[WSSE ch. 3]*
- **Avoid sticky sessions as a substitute for shared state.** If a long-lived connection needs
  affinity, key it on a cookie or header, not source IP, which collapses behind NAT and proxies.
  *[WSSE ch. 3; DDS ch. 5]*
- **Store uploaded and generated files in managed object storage.** Build a file service only as a
  last resort, with a metadata database recording each file's location. *[WSSE ch. 3]*
- **Put a load balancer, not round-robin DNS, in front of every pool.** Health checks eject failed
  hosts and connection draining enables zero-downtime rolling deploys; DNS caching makes removal
  unreliable. *[WSSE ch. 3, 4]*
- **Route only to ready replicas.** Expose readiness separately from liveness; details in
  [Distributed systems](../distributed/distributed-systems.md). *[DDS ch. 5]*
- **Make every auto-scaled node disposable and self-bootstrapping.** Everything it needs comes from
  its image, launch parameters, or a config store; scale-in must never log users out, and scaling
  policies must shrink as well as grow. *[WSSE ch. 3, 9]*
- **Run at least two replicas for any service with an availability SLA, however small its load.**
  With frequent deploys, rollouts alone push a singleton past its error budget. *[DDS ch. 5]*
- **Rate-limit at the edge and return 429 with `Retry-After` and a remaining-quota header.** Give
  anonymous callers a low limit and authenticated callers higher ones; most overload comes from a
  misconfigured client. *[DDS ch. 5]* (updated: the book names only the non-standard
  `X-RateLimit-Remaining`; prefer the IETF `RateLimit` fields and always send `Retry-After`)
- **Enforce per-client quotas on shared infrastructure.** A few heavy tenants can saturate a
  cluster; throttling by delaying responses keeps them under quota without client-side backoff
  logic. *[Grokking-ASDI, Kafka Characteristics]*
- **Parse every scaling knob at startup.** Pool sizes, worker counts, TTLs, and limits from env vars
  or flags go through a parser that rejects NaN, empty, and out-of-range values and fails fast.
  *[Review lessons]*
- **Cap or paginate every list endpoint and back it with the index its query needs.** Ask what
  happens at 10k rows and at 10 million; an unbounded query is a latent outage. *[Review lessons;
  WSSE ch. 8]*

## Replication and read scaling

- **Use read replicas for reads and availability, never to scale writes.** Every write still goes
  through one primary (or every node in multi-primary); write-heavy load needs sharding or a
  different store. *[WSSE ch. 5]*
- **Never write to the primary and then read the same data from a replica.** Send fresh-data reads
  to the primary or keep the written value client-side; lag that is usually sub-second can spike
  to minutes. Read-your-writes techniques are in [Distributed
  systems](../distributed/distributed-systems.md). *[WSSE ch. 5; DDIA ch. 5]*
- **Use multi-primary or ring replication only when the design doc names the need (multi-region
  writes, offline clients) and a conflict rule.** No node is the source of truth, and lag
  accumulates around a ring. *[WSSE ch. 5; DDIA ch. 5]*
- **Run analytics against a warehouse fed from OLTP, not against the OLTP primary.** Large scans
  compete with small indexed lookups and hurt user-facing latency. *[DDIA ch. 3]*
- **Use a dedicated search engine for full-text and faceted search.** Write to the system of
  record and update the index from its change stream; see [Search and
  Elasticsearch](../data/search-elasticsearch.md). *[WSSE ch. 8; DDIA ch. 11]*
- **Pick each service's store from its access patterns (polyglot persistence), and count the
  operating cost of each extra technology.** Read the store's known anti-patterns before adopting
  it. *[WSSE ch. 5]*
- **For NoSQL and very large data sets, list the queries first, then shape and denormalize the
  data for them.** See [NoSQL data stores](../data/nosql.md). *[WSSE ch. 8; DDIA ch. 2]*

## Partitioning and sharding

- **Shard when the state no longer fits; replicate when request rate is the limit.** Ten
  replicated 10 GB caches still hold 10 GB of distinct data; ten shards hold 100 GB.
  *[DDS ch. 6; WSSE ch. 2]*
- **Choose a high-cardinality shard key that keeps common queries on one shard.** A user or tenant
  id gives many small buckets; a coarse key such as country gives skewed, oversized shards, and
  cross-shard queries cannot be rolled back atomically. *[WSSE ch. 5; Grokking-ASDI, Cassandra]*
- **Build the key from exactly the fields that determine the result.** Extra fields such as a
  timestamp scatter identical requests; missing fields such as locale serve wrong data.
  *[DDS ch. 6]*
- **Create many more logical partitions than nodes and move whole partitions on resize.** Or use
  consistent hashing with many virtual nodes per machine, so rebalancing is incremental and
  stronger machines can take more ranges. *[DDIA ch. 6; Grokking-ASDI, Data Partitioning;
  WSSE ch. 5]*
- **Build each replica set from distinct physical machines and failure domains.** Two virtual
  nodes on one host are not two independent copies. *[Grokking-ASDI, Replication; DDS ch. 5]*
- **Do not lead a range-partitioned key with a monotonically increasing value.** Prefix the
  timestamp or sequence with an entity id, or every current write lands on one hot partition.
  *[DDIA ch. 6; DDS ch. 7]*
- **Plan for hot keys and hot shards.** Autoscale replicated shards independently, and split a
  known hot key with a small random suffix that reads fan in across; see [NoSQL data
  stores](../data/nosql.md). *[DDS ch. 6; DDIA ch. 6]*
- **Decide how ids are generated before you shard.** Per-shard auto-increment collides; prefer
  node-generated time-ordered ids (UUIDv7, ULID, Snowflake-style) over a central counter, which is
  a single point of failure. *[WSSE ch. 5]* (dated: the book offers offsets and a shared counter)
- **Decide deliberately where shard routing lives.** A client-side proxy keeps the service simple;
  a server-side routing tier keeps clients simple; choose by who owns which code. *[DDS ch. 3;
  DDIA ch. 6]*
- **Design secondary-index queries around how the index is partitioned.** Local indexes scatter
  every query to all shards; global indexes make writes touch several shards. *[DDIA ch. 6]*
- **Keep a central coordinator on the control path only.** Clients fetch and cache metadata, then
  move data directly to storage nodes; plan from day one how a single metadata master will split.
  *[Grokking-ASDI, GFS; Grokking-ASDI, HDFS]*

## Caching as a capacity decision

Cache mechanics (hit ratio, TTLs, HTTP headers, invalidation, consistent hashing for cache nodes)
live in [Caching and Redis](../data/caching-and-redis.md). The system-level rules:

- **Rate a service's capacity as if part of the cache is gone.** If a 50% hit rate doubles
  capacity, losing the cache overloads the backend; publish a rating that survives losing some
  cache shards. *[DDS ch. 6]*
- **Load test with the cache on and off before calling it optional.** Even a latency-only cache
  lets queues pile up when it is flushed or redeployed. *[DDS ch. 6]*
- **Run a cache as its own tier of a few large nodes, not as a sidecar on every web replica.** Many
  small replicated caches hold fewer distinct entries and tie cache scale to web scale.
  *[DDS ch. 5]*
- **Replicate each cache shard that cannot be lost.** Single-instance shards lose capacity on every
  rollout. *[DDS ch. 6]*
- **Cache as high up the stack as possible, starting with a CDN for static assets.** Every request
  answered by a browser or CDN never reaches your servers. *[WSSE ch. 3, 6]*

## Asynchronous work and worker pools

Delivery semantics, ordering, idempotent consumers, poison messages, and dead-letter queues are
in [Event-driven architecture and messaging](../architecture/event-driven-and-messaging.md) and
[Apache Kafka](../messaging/kafka.md). The capacity rules:

- **Send slow side effects (email, SMS, third-party calls) to async handlers.** Model optional
  follow-ups as subscribers or webhooks so new actions need no change to the core service.
  *[DDS ch. 8; WSSE ch. 7]*
- **Size workers so processing time divided by parallelism stays below the mean inter-arrival
  time, with headroom.** At equality bursts never drain; above it backlog grows without bound.
  *[DDS ch. 10]*
- **Cap worker counts for cost only after confirming steady-state load fits under the cap.**
  Otherwise the queue never catches up. *[DDS ch. 10]*
- **Create at least as many partitions as the maximum consumer parallelism you will need.**
  Consumers beyond the partition count sit idle. *[Grokking-ASDI, Consumer Groups]*
- **Decide what happens when producers outpace consumers, and alert on consumer lag.** Drop,
  bound the buffer, or apply backpressure on purpose. *[DDIA ch. 11]*
- **Set retention explicitly by time, size, or compaction for every log and topic.** "Until the
  disk is full" is not a policy. *[Grokking-ASDI, Kafka Characteristics]*
- **Keep generic queue machinery shared and the per-job parts small.** A source that lists items
  and a worker that processes one item plug into common retry and tracking code. *[DDS ch. 10]*
- **Prefer an associative reduce over a join barrier unless the step needs the full dataset.**
  Barriers remove parallelism and add latency. *[DDS ch. 12]*
- **Have batch jobs write new immutable outputs and swap them in atomically.** Row-by-row writes
  into a serving database overload it and leak partial results on retry. *[DDIA ch. 10]*
- **Use FaaS for stateless, bursty, event-triggered work; use long-running services for sustained
  load and large in-memory state.** Plan the migration as usage grows. *[DDS ch. 8]*

## Consistency, replication conflicts, and coordination

Clocks, fencing tokens, leases, failure detection, and consensus are in [Distributed
systems](../distributed/distributed-systems.md). The design-level choices:

- **Never rely on process-local locks in code that runs on more than one instance.** Use the
  database's constraints and row locks, or a shared lock service with expiry. *[WSSE ch. 3;
  Review lessons]*
- **Keep distributed locks out of the request path.** Prefer optimistic version checks at write
  time or a queue that serializes the work; reserve locks for batch and worker jobs.
  *[WSSE ch. 4]*
- **Serialize writes for a partition through one leader, and partition the leadership.** One leader
  per partition orders mutations without becoming a global bottleneck. *[Grokking-ASDI, Leader
  and Follower; DDIA ch. 5]*
- **Size quorums so R + W > N where reads must see acknowledged writes, and use odd replica
  counts.** Four nodes tolerate one failure, the same as three; quorum overlap is still not
  linearizability. *[Grokking-ASDI, Quorum; DDIA ch. 5, 9]*
- **Prefer datacenter-local quorum levels for latency-sensitive multi-region traffic.** Reserve
  all-replica levels for operations that justify lower availability. *[Grokking-ASDI, Cassandra
  Consistency Levels]*
- **Define a conflict-resolution rule for every replicated data type.** Prefer commutative merges
  (CRDT-style counters and sets) over last-write-wins, which silently drops concurrent writes;
  decide whether resurrected deletes or lost adds are the lesser evil. *[Grokking-ASDI, Vector
  Clocks; DDIA ch. 5; WSSE ch. 5]*
- **Do not push inconsistency handling onto every client by default.** Users read reappearing
  items as bugs; make the leaky abstraction a deliberate, documented decision.
  *[Grokking-ASDI, Dynamo Characteristics]*
- **Replace cross-service two-phase commit with atomic local writes plus compensating actions.**
  One coordinating service issues the refund when fulfilment fails; 2PC loses availability with
  every participant. *[WSSE ch. 4; DDIA ch. 9]*
- **Use a coordination service only for coarse, rarely acquired locks and small metadata.** Never
  as a data store, high-rate lock manager, or pub/sub bus, and write its clients to survive short
  outages. *[Grokking-ASDI, Chubby; DDIA ch. 9]*
- **Ask whether one orchestrator-restarted instance meets the SLA before building leader
  election.** Automatic restart gives roughly three nines, which is often enough for background
  work. *[DDS ch. 9]*
- **Store and compare timestamps in UTC through one project date helper.** Never order events
  across nodes by wall-clock time. *[Review lessons; DDIA ch. 8]*

## Reliability and failure design

- **Optimize mean time to recovery, not only mean time between failures.** Automate detection and
  repair, make components restart without manual steps, and exercise failures on purpose.
  *[WSSE ch. 2, 9]*
- **Tolerate the loss of a whole machine so nodes can be patched one at a time.** Rolling upgrades
  then need no planned downtime. *[DDIA ch. 1]*
- **Wrap every third-party service in your own indirection layer and assume it is slow or down.**
  Give the outbound client a timeout and disable redirects when it carries a token. *[WSSE ch. 1;
  Review lessons]*
- **Keep the database, caches, queues, and search engine behind abstractions.** The data store
  should not dictate how the architecture evolves. *[WSSE ch. 1]*
- **Design against operator error.** Fast config rollback, gradual rollouts, realistic sandboxes,
  sensible overridable defaults, and manual override even when the system self-heals.
  *[DDIA ch. 1]*
- **Run invariant checks in production and alert on discrepancies.** For example, messages in
  equals messages out; scrub stored data against replicas and test restores regularly.
  *[DDIA ch. 1, 12; Grokking-ASDI, Checksum]*
- **Publish metrics at OS, server, application, and business levels, plus external synthetic
  probes.** Business metrics show customer impact within seconds; see [Observability and
  reliability](../operations/observability-and-reliability.md). *[WSSE ch. 9]*
- **Plan tombstone lifetimes and compaction for delete-heavy replicated stores.** A replica that
  missed a delete resurrects it during repair. *[Grokking-ASDI, Tombstones]*

## Evolving a running system

- **Replace a running system piece by piece behind its existing interfaces, not by a full
  rewrite.** Rewrites run long and tend to recreate the same mess. *[WSSE ch. 1]*
- **Split out a service only when the part has its own data, scaling profile, or owning team, and
  few calls into the rest.** A split adds debugging and integration cost before it pays back; see
  [Microservices](../architecture/microservices.md). *[WSSE ch. 4; DDS Part II]*
- **Version every API from its first release, internal ones included.** Servers deploy before
  clients, so requests stay backward compatible and responses forward compatible. *[DDS ch. 10;
  DDIA ch. 4]*
- **Restructure by deriving a new representation beside the old one and moving readers
  gradually.** Rollback stays possible throughout. *[DDIA ch. 12]*
- **Treat every container input (env var, port, file, unit of a number) as a versioned API.** A
  silent unit change from seconds to milliseconds can multiply load downstream. *[DDS ch. 2]*
- **After fixing a scaling defect, sweep the repo for siblings.** An unbounded query or a
  process-local lock rarely appears once; fix every instance in the same change.
  *[Review lessons]*

## Tensions

- **Design for scale now vs build the simplest thing.** Interview-style material assumes
  planet-scale from the start; Ejsmont and Kleppmann say most systems never need it. This library
  builds single-node data and stateless clones first, but keeps the seams (stateless tiers,
  tenant-prefixed keys, no `% N`) that make later partitioning cheap. *[WSSE ch. 2; DDIA ch. 1;
  Grokking-ASDI]*
- **CAP "pick two" vs PACELC vs "CAP is unhelpful".** This library reasons about the specific
  guarantee each operation needs and its everyday latency cost, using PACELC as shorthand.
  *[Grokking-ASDI, CAP Theorem; DDIA ch. 9]*
- **Quorum overlap as a freshness guarantee.** The course treats R + W > N as sufficient;
  Kleppmann shows sloppy quorums, concurrent writes, and partial failures break it. Use
  single-leader writes or consensus when you need linearizability. *[Grokking-ASDI, Quorum;
  DDIA ch. 5]*
- **No sticky sessions vs connection affinity.** Ejsmont forbids them; long-lived connections
  sometimes need affinity. Allow cookie- or header-based affinity for connections, never as the
  only home of state. *[WSSE ch. 3; DDS ch. 5]*
- **Loose constraints with apologies vs database-enforced invariants.** Kleppmann allows
  compensation where the business absorbs it; this library enforces stated invariants in the
  database and uses compensation only for cross-service workflows with explicit sign-off, never
  for irreversible or regulated actions. *[DDIA ch. 12; Review lessons]*
- **Leases and lock-delay vs fencing tokens.** Leases alone assume bounded pauses and clock drift;
  the protected resource must check a fencing token wherever correctness matters.
  *[Grokking-ASDI, Chubby; DDIA ch. 8; DDS ch. 9]*
- **Single metadata master vs distributed metadata.** GFS-style single masters were later
  replaced because of the limits the sources describe; treat one master as a start with an exit
  plan. *[Grokking-ASDI, GFS]*
- **Cost of distribution.** The sources predate mature distributed SQL; those databases lower the
  cost of distributing state, but single-node remains the default for small and medium systems.
  *[DDIA ch. 1]*
- **Dated mechanisms.** Central id counters are restated above as node-generated time-ordered ids,
  and 2014-era deployment tooling as immutable images with configuration as code. The course's
  ZooKeeper-based Kafka coordination is superseded by KRaft (Kafka 4.0 removed ZooKeeper mode); see
  [Apache Kafka](../messaging/kafka.md). *[WSSE ch. 5, 9; Grokking-ASDI, Kafka]*

## Sources

- **WSSE**: Web Scalability for Startup Engineers (Artur Ejsmont, McGraw-Hill Education, 1st ed.,
  2015)
- **Grokking-ASDI**: Grokking the Advanced System Design Interview (online course; cited by
  lesson name)
- **DDIA**: Designing Data-Intensive Applications (Martin Kleppmann, O'Reilly, 1st ed., 2017)
- **DDS**: Designing Distributed Systems: Patterns and Paradigms for Scalable, Reliable Services
  (Brendan Burns, O'Reilly, 1st ed., 2018)
- **Review lessons**: rules distilled from the maintainer's code-review findings
