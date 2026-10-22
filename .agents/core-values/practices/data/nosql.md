# NoSQL data stores

> **Load when:** designing, querying, or reviewing code against a document, wide-column, or
> key-value store (MongoDB, Cassandra/ScyllaDB, DynamoDB-style, HBase, RocksDB-backed stores):
> choosing a store, shaping documents or partition keys, writing updates that must be atomic or
> idempotent, picking consistency levels or write concerns, adding indexes, choosing shard keys,
> or handling TTLs, deletes, and schema migrations.
> **See also:** [Data modeling](../data/data-modeling.md),
> [SQL](../data/sql-and-query-performance.md), [Caching](../data/caching-and-redis.md),
> [Database operations](../data/database-operations.md), [Search](../data/search-elasticsearch.md),
> [Distributed systems](../distributed/distributed-systems.md),
> [Event-driven](../architecture/event-driven-and-messaging.md),
> [Scalability](../architecture/scalability-and-system-design.md)

## Top rules

1. **List and number the queries first, then shape documents or tables to serve them.** Copying
   a normalized relational schema into collections or tables is the main beginner mistake.
   *[MongoDB-ADP ch. 1, 2; Cassandra TDG ch. 5; DDIA ch. 2]*
2. **Keep every change that must be atomic inside one document or one partition, and write it
   as a conditional update.** Put the precondition in the filter (`qty >= n`, `version = v`,
   `IF NOT EXISTS`) and check the matched count or `applied` flag; never load, modify in code,
   and save back. *[MongoDB-ADP ch. 3, 5; Cassandra TDG ch. 9; DDIA ch. 7]*
3. **Enforce "only one", "never twice", and "at most N" in the store itself.** Use a unique
   index (prefixed by the shard key when sharded), a lightweight transaction, or a conditional
   update, and name it in any docstring that promises the invariant; an in-process check is
   not enforcement. *[Review lessons; MongoDB-ADP ch. 6; Cassandra TDG ch. 6, 9]*
4. **Bound every document and every partition.** No arrays that grow per user action, and a
   worst-case size estimate for each partition before shipping; bucket by time or page when
   growth is unbounded. *[MongoDB-ADP ch. 1, 6; Cassandra TDG ch. 5; DDIA ch. 2]*
5. **Pick a shard or partition key that spreads writes and lets hot reads hit one partition.**
   Never lead a range-partitioned key with a monotonically increasing value (timestamp,
   ObjectId, sequence) unless it is hashed; the key is costly to change later.
   *[MongoDB-ADP ch. 4; Cassandra TDG ch. 5; DDIA ch. 6; DBI ch. 13]*
6. **Set consistency level and write concern explicitly, and make R + W exceed the
   replication factor wherever reads must see the latest write.** Driver defaults are often
   weaker than the code assumes, and a retry must never downgrade the level.
   *[Cassandra TDG ch. 6, 8, 9; DBI ch. 11; MongoDB-ADP ch. 4]*
7. **Put the tenant key in every filter, update, and delete, and parse request input into a
   typed filter before it reaches the driver.** A globally unique id alone is not enough, and a
   raw request object can smuggle query operators. *[Review lessons]*
8. **Retry and speculatively execute only idempotent writes.** A timed-out counter increment
   or list append may already have applied. *[Cassandra TDG ch. 4, 8; DBI ch. 8; DDIA ch. 12]*
9. **Give every query a supporting index or a dedicated table, and prove it.** No
   `ALLOW FILTERING`, no unanchored regex, no collection scan on a request path; check
   `explain()` or a trace. *[MongoDB-ADP ch. 4, 5; Cassandra TDG ch. 7, 9]*
10. **Treat deletes as writes that leave tombstones.** Never build a queue or other
    delete-heavy design on an LSM-backed store (reads scan past every tombstone), prefer TTL
    over explicit deletes, and finish repair inside the tombstone grace period.
    *[Cassandra TDG ch. 5, 6, 9; DBI ch. 7]*

## Choosing a store and a model

- **Choose the model from the shape of the relationships.** Documents fit self-contained trees
  loaded together; relational fits many-to-many data and joins; graph fits densely connected
  data. Joins emulated in application code are usually slower and buggier. *[DDIA ch. 2]*
- **Adopt a distributed NoSQL store only for a stated requirement (write rate, data size,
  multi-region availability) that one replicated relational node cannot meet.** Polyglot
  persistence is fine: pick document, search, graph, or relational per service.
  *[Cassandra TDG ch. 7; DDIA ch. 1]*
- **Do not use a wide-column store (Cassandra, HBase, Bigtable) for analytic column scans.**
  It stores rows by key for key and key-range lookups; that is not a columnar store. *[DBI ch. 1]*

## Modeling from access patterns

- **Name one system of record for each fact and treat every other copy as a rebuildable
  cache.** When copies disagree the system of record wins, and a repair job rebuilds the rest.
  *[MongoDB-ADP ch. 5, 8, 9; DDIA ch. 11]*
- **Denormalize only the fields a reader displays, and decide whether each copy is a
  snapshot or a synced cache.** A cart line keeps the price at add time; an author name copied
  onto posts must be updated when the author renames. *[MongoDB-ADP ch. 5, 8]*
- **Update denormalized copies atomically or derive them from a change stream.** Use one
  self-contained write, a native transaction, or a logged batch; otherwise partial failures
  leave copies out of sync forever. *[DDIA ch. 7, 11; Cassandra TDG ch. 9]*
- **Reference shared entities by an immutable id and keep human-readable slugs in a separate
  field.** Meaning encoded in `_id` turns every rename into a rewrite of the key and all
  references. *[MongoDB-ADP ch. 5; DDIA ch. 2]*
- **Store typed values: native dates, numbers as numbers, parsed fields instead of raw text.**
  Typed fields are smaller and support range queries and sorts. Produce dates through the
  project's single date helper and store them in UTC. Drop raw-event fields nobody queries or
  displays. *[MongoDB-ADP ch. 4; Review lessons]*
- **Treat "schemaless" as schema-on-read and still declare the schema.** Add a collection
  validator (`$jsonSchema`) and a schema version field, and validate in code at the write
  boundary. *[DDIA ch. 2; MongoDB-ADP ch. 2; Review lessons]* (updated: validators postdate
  MongoDB-ADP)
- **Never use data values such as user ids as field names.** Use arrays of subdocuments with
  `$elemMatch` or array filters; user-controlled keys invite injection and collisions.
  *[MongoDB-ADP ch. 8; Review lessons]*
- **Build read-optimized collections (feeds, walls, per-period pages) when reads dominate, and
  do the fan-out writes off the request path through a queue.** *[MongoDB-ADP ch. 8]*

## Document stores (MongoDB and peers)

- **Embed a child set when the parent is almost always read with it or must change atomically
  with it.** One read beats several round trips, and a single-document write is atomic and
  isolated. *[MongoDB-ADP ch. 1, 3]*
- **Reference children in their own collection when they are filtered, sorted, or paginated
  on their own.** *[MongoDB-ADP ch. 1]*
- **Never embed an unbounded or high-arity relationship.** Growing documents waste cache, slow
  every update, and can hit the 16 MB document limit and block writes. *[MongoDB-ADP ch. 1;
  DDIA ch. 2]*
- **For many-to-many, store an array of ids on one side.** Full copies fan out on every update;
  a join collection forces several application joins. *[MongoDB-ADP ch. 1]*
- **Use bucket documents (a fixed batch of children with a page number and count) for large
  ordered child sets.** Accept slight overflow instead of adding coordination.
  *[MongoDB-ADP ch. 6]*
- **Keep only a bounded subset (latest few comments) in denormalized documents and enforce the
  bound with `$push` plus `$slice` or a trim job.** *[MongoDB-ADP ch. 8]*
- **Store subtypes in one collection with shared top-level fields, a type discriminator, and a
  nested `details` subdocument.** One query spans all subtypes. *[MongoDB-ADP ch. 2, 5]*
- **Model sparse attributes as an indexed array of `{k, v}` subdocuments.** Never use EAV
  tables or opaque serialized blobs, which cannot be filtered or sorted. *[MongoDB-ADP ch. 2, 5]*
- **For hierarchies, store an indexed ancestors array; for threads, a sortable materialized
  path queried by anchored prefix.** A bare `parent_id` answers one level per query.
  *[MongoDB-ADP ch. 5, 6]*
- **Put large binaries in object storage or GridFS; keep the metadata as a document.**
  *[MongoDB-ADP ch. 6]*
- **Update named fields with `$set`; avoid whole-document replacement from a decoded model.**
  Older code that re-encodes a fixed model silently drops fields newer code added.
  *[DDIA ch. 4]*

## Wide-column stores (Cassandra and peers)

- **Create one table per query that reads exactly one partition, name it
  `<entity>_by_<lookup>`, and record the query in the table comment.** *[Cassandra TDG ch. 5]*
- **Take partition-key columns from the query's equality inputs and clustering columns for
  uniqueness, range, and sort order.** Sort order is fixed at table creation; write the
  partition key in its own parentheses so reviewers see it. *[Cassandra TDG ch. 5]*
- **Make each primary key unique for its entity, adding an id clustering column when needed.**
  Writes are upserts, so duplicate keys silently overwrite. *[Cassandra TDG ch. 5]*
- **Estimate worst-case partition size before shipping; stay near 100,000 cells and split by
  adding a time bucket or other column to the partition key.** *[Cassandra TDG ch. 5]*
- **Store ledgers and time series as append-only rows in bucketed partitions, never as one
  mutable row.** Compute the balance from transactions. *[Cassandra TDG ch. 5]*
- **Restrict all partition-key columns, and clustering columns only in declared order.**
  Needing to skip one means the table is wrong; replace multi-partition `IN` with parallel
  single-partition queries. *[Cassandra TDG ch. 9]*
- **Prefer sets and maps over lists, keep values small (single-digit MB at most), and prefer
  typed columns or UDTs over a JSON text column.** *[Cassandra TDG ch. 4, 7]*
- **Use logged batches only to keep denormalized copies in sync, keep them small in bytes, and
  never use them for bulk loading.** *[Cassandra TDG ch. 9]*
- **Maintain denormalized tables in application code; keep materialized views and SASI
  disabled.** They are experimental and have consistency gaps with no repair path.
  *[Cassandra TDG ch. 7]*
- **Write each key once when the store resolves conflicts by last write wins, and keep clocks
  synced with NTP.** Skewed or concurrent writes are discarded while reporting success.
  *[DDIA ch. 5, 8; Cassandra TDG ch. 4]*

## Atomic updates and concurrency

- **Use server-side atomic operators (`$inc`, `$push`, `$addToSet`, positional updates) with the
  precondition in the filter.** Load-modify-save loses concurrent updates; use `$inc`, not
  `$set`, for shared counters. *[MongoDB-ADP ch. 3, 5; DDIA ch. 7; DBI ch. 5]*
- **Carry a version field in the filter for optimistic concurrency on user edits, and return a
  conflict when nothing matched.** Commutative edits such as tag sets need no version.
  *[MongoDB-ADP ch. 6; DDIA ch. 7]*
- **Use a lightweight transaction for read-then-write correctness (unique usernames, account
  creation, stock decrements) and check `applied` on every one.** A failed condition is a
  normal result, not an exception; LWTs cost several round trips, so use them only there.
  *[Cassandra TDG ch. 6, 9]*
- **Use a native multi-document transaction only when a cross-document change must be atomic;
  design for single-document writes first.** Transactions add latency, abort under write
  conflicts (retry them), and have a lifetime limit. *[MongoDB-ADP ch. 3]* (updated: native
  transactions exist since MongoDB 4.0, and on sharded clusters since 4.2)
- **Run multi-step workflows as a state machine: move the record into an intermediate state
  with a conditional update, do the work, then move it to a final state.** Every step is
  idempotent and resumable after a crash. *[MongoDB-ADP ch. 3, 5, 6]*
- **Pair every multi-write without a transaction with compensation on failure and a periodic
  reconciliation job, and give holds an expiry that a sweeper releases.** Set the
  reconciliation timeout longer than the expiry so the two do not race. *[MongoDB-ADP ch. 5]*

## Consistency and replication

- **Reason about replication factor (per keyspace) and consistency level (per query)
  separately.** Use QUORUM, or LOCAL_QUORUM across data centers, for both reads and writes when
  freshness matters. *[Cassandra TDG ch. 6, 9; DBI ch. 11]*
- **Set the default consistency level in driver configuration and override per statement or
  execution profile.** Some drivers default to a single-replica level. *[Cassandra TDG ch. 8, 9]*
- **Never count `ANY`, hinted handoff, or sloppy-quorum writes as readable.** *[Cassandra TDG
  ch. 6; DBI ch. 12]*
- **Never configure a retry policy that lowers the consistency level.** If the weaker level
  were acceptable, it should have been the level. *[Cassandra TDG ch. 8]*
- **Use majority write concern for data you cannot lose.** Journal acknowledgment alone does
  not survive losing the server. *[MongoDB-ADP ch. 4]* (updated: majority is the default
  since MongoDB 5.0; do not lower it)
- **Read from secondaries only for staleness-tolerant work such as analytics, not to scale
  reads.** Lagging replicas serve stale data and failover shifts load. *[DDIA ch. 5]*
  (updated: MongoDB-ADP ch. 5 scales catalog reads this way; current guidance reverses it)
- **Provide session guarantees explicitly where clients can reach any replica.** Use causal
  sessions, version tokens, or sticky routing for read-your-writes and monotonic reads.
  *[DBI ch. 11; DDIA ch. 5]*
- **Choose conflict resolution on purpose.** Last write wins drops data; use CRDT-style
  counters and sets or keep siblings for an application merge when loss is unacceptable.
  *[DBI ch. 11; DDIA ch. 5]*

## Indexing and querying

- **Index every query your code can issue, including the first `$match` of each aggregation.**
  Read-heavy collections justify many indexes. *[MongoDB-ADP ch. 4, 5]*
- **Order compound index fields equality first, then sort, then range.** *[MongoDB-ADP ch. 4]*
- **Verify with `explain()` that keys examined is close to documents returned; use `hint()`
  only when the planner demonstrably picks badly.** *[MongoDB-ADP ch. 4]*
- **Drop indexes whose prefix another compound index covers.** Each index costs RAM and write
  time. *[MongoDB-ADP ch. 4, 8]*
- **Use only anchored, case-sensitive prefix regexes on indexed fields, and escape user input
  before building any regex.** Use a collation or a lowercased copy for case-insensitive
  match, and a search engine for word search. *[MongoDB-ADP ch. 5; Review lessons]*
- **Paginate by range on the sort key, not with large `skip()`.** In Cassandra, use driver
  paging and treat the paging state as an opaque token for one statement.
  *[MongoDB-ADP ch. 8; Cassandra TDG ch. 9]*
- **Cap every list query with a limit and ask what happens at 10,000 matches.** Unbounded
  `find()` calls exhaust memory and time out. *[Review lessons; Cassandra TDG ch. 9]*
- **Serve hot Cassandra queries from denormalized tables; use an index only for occasional
  queries, and on 5.0+ make it SAI.** With legacy 2i, avoid very high or very low cardinality
  and churned columns, and rebuild after repairing the base table. *[Cassandra TDG ch. 7, 12]*
  (updated: SAI arrived in Cassandra 5.0 and SASI is deprecated)
- **Design around how a secondary index is partitioned.** Local indexes scatter every query;
  global indexes make writes touch several partitions and update asynchronously. *[DDIA ch. 6]*

## Partitioning and sharding

- **Test a candidate shard key against real insert and query logs before sharding.**
  *[MongoDB-ADP ch. 4]* (updated: refining and online resharding exist but are costly)
- **Compound a low-cardinality or skewed natural key with a high-cardinality suffix.** All
  documents sharing one key value sit in one chunk that cannot split. *[MongoDB-ADP ch. 4, 6]*
- **Prefix time-ordered keys with an entity id such as the user or sensor.** This spreads
  current writes and gives cheap per-owner range scans. *[DDIA ch. 6; MongoDB-ADP ch. 4]*
- **Shard on the field your hot reads and updates filter by.** Operations without the shard
  key broadcast to every shard. *[MongoDB-ADP ch. 5, 8]*
- **Make every unique index that correctness depends on start with the shard key.**
  Uniqueness is enforced only per shard otherwise. *[MongoDB-ADP ch. 6]*
- **Spread a known hot key with a small random suffix and fan reads back in.** Hashing does
  not help when every request targets the same key. *[DDIA ch. 6]*

## Deletes, TTL, and retention

- **Never write nulls for unset fields, and configure mappers and ORMs to skip nulls.** Each
  null is a tombstone. *[Cassandra TDG ch. 9]*
- **Delete at the largest granularity (whole partitions) and update collection elements
  instead of replacing collections.** *[Cassandra TDG ch. 9]*
- **Expire data with TTL instead of deletes.** TTL is per column, so set it on every non-key
  column for whole-row expiry. *[Cassandra TDG ch. 4, 9]*
- **Plan retention for event data before launch: TTL index, time series collection, or
  rotating collections dropped whole.** *[MongoDB-ADP ch. 4]* (updated: prefer a time series
  collection with `expireAfterSeconds` for metrics, available since MongoDB 5.0)
- **Treat tombstone, large-partition, and large-batch log warnings as data-model bugs, and set
  guardrails to fail past those limits.** *[Cassandra TDG ch. 11, 13]* (updated: guardrails
  arrived in Cassandra 4.1)

## Schema evolution and migration

- **Evolve documents lazily: make readers accept old and new shapes, migrate in small
  background batches, then delete the compatibility code.** A collection-wide update has the
  same locking cost as a huge `ALTER TABLE`. *[MongoDB-ADP ch. 2; DDIA ch. 2, 4]*
- **Move from a relational store one use case at a time behind an API layer.** Re-derive the
  access patterns instead of copying tables one to one. *[Cassandra TDG ch. 15]*
- **Cut over with CDC or temporary dual writes, then bulk-load history, validate source
  against target, and only then stop writing to the legacy store.** Use a loader that logs
  rejected rows. *[Cassandra TDG ch. 15; DDIA ch. 11]*

## Analytics and time series

- **Pre-aggregate dashboard counters at write time with an upsert plus `$inc` into one
  document per entity per period, with coarser rollup collections for long ranges.** Nest
  fine-grained counters (minutes inside hours) rather than hundreds of flat keys.
  *[MongoDB-ADP ch. 4]*
- **Make rollups incremental and re-runnable with a watermark and a lag cutoff for late
  events.** *[MongoDB-ADP ch. 4]* (updated: use the aggregation pipeline with `$merge`;
  map-reduce is deprecated)
- **Batch high-volume inserts and inspect every per-document error before retrying.**
  Unordered bulk writes report each failed index. *[MongoDB-ADP ch. 4]*
- **Keep analytic scans off the online cluster: use a separate analytics data center or a
  warehouse fed by CDC.** *[Cassandra TDG ch. 15; DDIA ch. 3]*

## Drivers and application code

- **Create one long-lived client or session per process and reuse it.** Sessions hold pools to
  many nodes and are expensive to build. *[Cassandra TDG ch. 8]*
- **Use prepared statements and bound parameters for every repeated query.** They parse once,
  enable token-aware routing, and keep input out of the query text. *[Cassandra TDG ch. 8;
  Review lessons]*
- **Parse ids, numbers, and filters at the boundary.** Reject malformed ObjectIds or UUIDs, NaN,
  and empty strings, and reject objects where a scalar is expected so `{"$ne": null}` cannot
  reach a filter; check keys with `Object.hasOwn`. *[Review lessons]*
- **Configure an explicit local data center, skip driver-level remote failover, and never put
  a load balancer in front of Cassandra.** *[Cassandra TDG ch. 8, 10]*
- **Time out every database call; retry only idempotent work, with backoff and jitter.**
  See [Distributed systems](../distributed/distributed-systems.md). *[DBI ch. 8; Review lessons]*
- **Keep store access behind a repository layer and business logic in the service layer.**
  User-defined functions are for simple aggregates only; keep other computation in the
  application tier. *[Cassandra TDG ch. 15; MongoDB-ADP ch. 9]*
- **Load-test schema changes on the real data model against a stated throughput and p99
  target; do not hide model problems with hardware.** *[Cassandra TDG ch. 13]*

## Security and tenancy

- **Lead every tenant-owned key with the tenant id: in the partition key, the shard key
  prefix, and every unique index.** Lookups by global id still filter by tenant. *[Review lessons]*
- **After fixing a missing tenant filter or unsafe query, grep every query on that collection
  or table and fix the siblings in the same change.** *[Review lessons]*
- **Give each service its own keyspace or database and a role limited to it.** No service
  reads another's tables. *[Cassandra TDG ch. 7, 15]*
- **Enable authentication, replace the default superuser, and replicate auth data with a
  topology-aware strategy.** *[Cassandra TDG ch. 6, 14]*
- **Load connection strings and credentials from the environment, parse them at startup, and
  never commit them.** *[Review lessons]*

## Operating LSM and replicated stores

- **Choose compaction per table: size-tiered for write-heavy, leveled for read-heavy, time-window
  for TTL'd time series.** *[Cassandra TDG ch. 13; DBI ch. 7]* (updated: on 5.0+, the Unified
  Compaction Strategy can be tuned to behave like each of these)
- **Schedule full anti-entropy repair from one tool, more often than the tombstone grace
  period, and replace nodes that were down longer.** *[Cassandra TDG ch. 6, 12; DBI ch. 12]*
- **Back up with off-node snapshots; replication copies bad writes everywhere.**
  *[Cassandra TDG ch. 12]*

## Tensions

- **Embed vs reference.** The document-store book favours embedding for locality; DDIA warns
  documents handle many-to-many poorly. This library embeds bounded, read-together, atomically
  changed data, references independently queried or many-to-many data, and picks a relational
  store when relationships dominate. *[MongoDB-ADP ch. 1; DDIA ch. 2]*
- **Single-document design vs native transactions.** The book predates MongoDB transactions and
  hand-rolls two-phase commit. Design for single-document atomicity first, use a native
  transaction when a cross-document change must be atomic, and keep the hand-rolled state
  machine for sagas across services or external systems. *[MongoDB-ADP ch. 3; DBI ch. 13]*
- **Dual writes for migration vs never dual-write.** The Cassandra book cuts over with dual
  writes; DDIA says dual writes drift silently. Prefer CDC or an outbox; accept dual writes only
  as a temporary migration step with validation and reconciliation before cutover.
  *[Cassandra TDG ch. 15; DDIA ch. 11]*
- **Logged batches as sync tool vs no isolation.** They guarantee eventual completion, not
  isolation, so readers see partial state. Use them with idempotent writes and tolerate brief
  divergence. *[Cassandra TDG ch. 9; DDIA ch. 7]*
- **Monotonic keys.** Time-ordered ids help single-node B-trees but hot-spot range-partitioned
  clusters. Use time-ordered ids (UUIDv7, ULID) as row ids, and never let one lead a shard or
  partition key. *[DBI ch. 4, 13; DDIA ch. 6]*
- **Schemaless freedom vs validation.** MongoDB-ADP sells flexible schemas as freedom; this
  library validates at the write boundary and in a collection validator, and versions document
  shapes. Schema-on-read wins only for truly heterogeneous or externally controlled data.
  *[MongoDB-ADP ch. 2; DDIA ch. 2; Review lessons]*

## Sources

- **MongoDB-ADP**: MongoDB Applied Design Patterns (Rick Copeland, 1st edition, 2013)
- **Cassandra TDG**: Cassandra: The Definitive Guide (Jeff Carpenter, Eben Hewitt, 3rd ed., 2020)
- **DDIA**: Designing Data-Intensive Applications (Martin Kleppmann, 1st edition, 2017)
- **DBI**: Database Internals: A Deep Dive into How Distributed Data Systems Work (Alex Petrov,
  1st ed., 2019)
- **Review lessons**: rules distilled from the maintainer's code-review findings
