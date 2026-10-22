# Caching and Redis

> **Load when:** adding, changing, or reviewing a cache of any kind (in-process, Redis, Valkey,
> Memcached, reverse proxy, CDN, browser storage) or any code that talks to Redis: cache-aside,
> write-through, or write-behind; cache keys, TTLs, and invalidation; eviction or persistence;
> Redis data types, Lua scripts, Functions, transactions, Pub/Sub, or Streams; counters, rate
> limits, sessions, or locks on Redis; or running Redis with replicas, Sentinel, or Cluster.
> **See also:** [Scalability](../architecture/scalability-and-system-design.md),
> [Distributed systems](../distributed/distributed-systems.md), [NoSQL](../data/nosql.md),
> [SQL](../data/sql-and-query-performance.md), [API design](../api/api-design.md),
> [Web performance](../frontend/web-performance.md), [Concurrency](../concurrency/concurrency.md),
> [Event-driven](../architecture/event-driven-and-messaging.md), [Security](../security/application-security.md),
> [Observability](../operations/observability-and-reliability.md)

## Top rules

1. **Keep the system correct with the cache empty, cold, evicted, or gone.** A volatile cache
   may only make things slower when it misses; every read path must rebuild from the system of
   record, and no code may assume an entry is present. *[Caching at Scale ch. 5;
   Mastering Redis ch. 3; WSSE ch. 6]*
2. **Never cache an operation with side effects unless the side effect still runs on a hit.**
   Writes to other systems, audit records, and device commands are silently skipped when a
   cached result is returned. *[Caching at Scale ch. 3; WSSE ch. 4]*
3. **Build every key from the full identity of the result, tenant first.** Include the
   operation, every input that changes the result, and the tenant or user id; a key without the
   tenant leaks one tenant's data to another. *[Caching at Scale ch. 3; Mastering Redis ch. 2;
   Review lessons]*
4. **Name an owner for every cache's consistency and touch it on every write path.** With
   cache-aside, write the store first and then delete the key; after fixing one missed
   invalidation, grep every writer of that data and fix the siblings in the same commit.
   *[Caching at Scale ch. 4, 7; Review lessons]*
5. **Set `maxmemory` with headroom and an explicit `maxmemory-policy` on every cache
   instance.** The default `noeviction` makes writes fail once memory fills; leave room for
   fork copy-on-write and client buffers. *[Caching at Scale ch. 4; Mastering Redis ch. 3;
   Redis Essentials ch. 6]*
6. **Set the value and its TTL in one command (`SET key val EX n`), and on every full
   overwrite re-apply the TTL or pass `KEEPTTL`.** Separate `SET` then `EXPIRE` can leave an
   immortal key; a plain `SET` clears the TTL while `INCR`, `HSET`, and `APPEND` keep it.
   *[Mastering Redis ch. 3; Redis Essentials ch. 4]* (updated: `KEEPTTL` since Redis 6.0)
7. **Never run O(N) commands over large data on a live server.** No `KEYS`, no `HGETALL` or
   `SMEMBERS` on unbounded collections, no long Lua scripts; use `SCAN` family commands and cap
   collections. *[Mastering Redis ch. 2, 5; Redis Essentials ch. 1, 4]*
8. **Do not make Redis the only copy of data you cannot lose, and do not use a Redis lock to
   enforce a correctness invariant.** Replication is asynchronous, so failover drops
   acknowledged writes; enforce "only one" or "never twice" with a database constraint.
   *[Mastering Redis ch. 6; Redis Essentials ch. 9; Review lessons]*
9. **Never expose Redis to an untrusted network, and run it with auth, TLS, and least-privilege
   ACL users.** Redis assumes trusted clients; an open instance hands out `FLUSHALL` and
   `CONFIG`. *[Mastering Redis ch. 10; Redis Essentials ch. 7; Caching at Scale ch. 8]*
10. **Measure hit rate, miss rate, and cache latency in production, and remove a cache that
    does not beat its break-even hit rate.** A cache below break-even adds latency and failure
    modes for nothing. *[Caching at Scale ch. 3, 9; WSSE ch. 6]*

## Deciding whether and where to cache

- **Add a cache only when the source is slow or costly, the same result is requested
  repeatedly, and the result is stable between requests.** If any of these fails, the cache is
  overhead plus a new failure mode. *[Caching at Scale ch. 2]*
- **Rank candidates by aggregate cost (time per call times call count), not by gut.** A few
  milliseconds saved on the busiest call beats a large saving on a rare one; expensive backend
  calls repay consistency risk best. *[WSSE ch. 6; Caching at Scale ch. 9]*
- **Compute the break-even hit rate before shipping.** A miss costs a check, the source call,
  and a write; a hit costs a check, so break-even is (check + write) / (source + write).
  *[Caching at Scale ch. 9]*
- **Measure the access distribution first.** Skewed access caches well; flat access over a
  large keyspace mostly misses and needs a different design or no cache. *[Caching at Scale
  ch. 2; WSSE ch. 6]*
- **Cache as high up the stack as the data allows.** Prefer browser, then CDN or reverse proxy,
  then whole responses or fragments, then service results, and individual queries last; each
  higher layer skips more work. *[WSSE ch. 6; Caching at Scale ch. 5]*
- **Shrink the keyspace by normalizing inputs.** Round coordinates, bucket ranges, and keep
  per-user parameters out of cacheable URLs so many requests share one entry. *[WSSE ch. 6]*
- **Keep only disposable, absolute-TTL data in per-process caches.** Prices, permissions,
  revoked tokens, and anything invalidated together belong in one shared cache, or servers
  disagree and revocation is not immediate. *[WSSE ch. 3, 4, 6]*
- **For per-process copies of Redis data, use server-assisted client-side caching
  (`CLIENT TRACKING`, Redis 6+), cap the local cache, and flush it when the invalidation
  connection drops.** Otherwise local copies go stale silently. *[Redis client-side caching]*
- **Start with one Redis node and scale it vertically before partitioning.** Replication and
  sharding add real operating cost. *[WSSE ch. 6]*
- **For HTTP caching, make GET handlers side-effect free, mark per-user responses `private`,
  send `Vary` for the headers that change the body, and fingerprint static asset URLs.**
  *[WSSE ch. 4, 6]* (updated: use `Cache-Control` `max-age`, `s-maxage`, `immutable`, and
  `stale-while-revalidate` per RFC 9111; the source's `Expires` and `Pragma` are legacy)

## Cache-aside, invalidation, and consistency

- **Default to cache-aside: on a miss, read the source, store the result with a TTL, return
  it.** The application owns consistency, so every write path must invalidate or update.
  *[Caching at Scale ch. 4; Mastering Redis ch. 7; WSSE ch. 6]*
- **On write, update the store first, then delete the key; do not write the new value into
  the cache from the writer.** Deleting is simplest and lets the next read load fresh data.
  *[Caching at Scale ch. 4]*
- **Close the stale-set race.** A slow reader that loaded before the write can store the old
  value after the delete; bound it with a short TTL, a lease or version check on set, or a
  delayed second delete. *[Scaling Memcache at Facebook; Azure Cache-Aside]*
- **Choose write-through only when readers need fresh data immediately after a write and the
  extra write latency is acceptable.** Both stores are written synchronously on each write.
  *[Caching at Scale ch. 4]*
- **Use write-behind only when every reader goes through the cache.** Reports, other services,
  and direct queries read the store and see stale values until the flush runs; a cache crash
  loses unflushed writes. *[Caching at Scale ch. 4]*
- **Write down the tolerated staleness for each cache and check all three sources of drift.**
  Missed updates, propagation delay, and replica divergence each need a stated answer.
  *[Caching at Scale ch. 7]*
- **Use TTL alone only for data where approximate values are acceptable, and state the bound.**
  For fields that must be exact (price, stock, permissions), cache the expensive aggregate and
  read those fields live by primary key. *[Caching at Scale ch. 7; WSSE ch. 6]*
- **When a primary key expires, clean up secondary indexes that reference it.** Use
  hash-field TTLs where one hash holds both, or consume expired-key events otherwise.
  *[Mastering Redis ch. 9; Redis HEXPIRE]* (updated: `HEXPIRE` since Redis 7.4)

## Stampedes, hot keys, and big keys

- **Protect hot keys against stampedes.** When a popular entry expires, many callers rebuild it
  at once; let one caller rebuild under a per-key lease or short `SET NX PX` lock while the
  others wait briefly or serve the stale value. *[Scaling Memcache at Facebook]*
- **Add random jitter to TTLs of keys written together.** Keys created in one batch otherwise
  expire in one burst and hit the source together. *[AWS Caching Best Practices]*
- **Pre-warm caches of static reference data at startup.** A cold restart otherwise sends a
  burst of misses to the store; session caches may start cold. *[Caching at Scale ch. 4, 5]*
- **Spread hot reads with replicas or a short-lived local copy, not by piling them on one
  node.** A few hot keys saturate CPU or network before memory fills. *[Caching at Scale ch. 6;
  WSSE ch. 6]*
- **Bound every collection key.** Trim lists with `LTRIM`, cap sorted sets, and estimate the
  worst-case element count; ask what happens at 10k and 10M members before shipping.
  *[Mastering Redis ch. 2; Review lessons]*

## Keys and serialization

- **Build every key through one helper and commit the key schema.** Record each pattern, its
  type, TTL, and related keys, and test the helper, because Redis enforces no schema. Use one
  delimiter and a namespace prefix (`app:entity:id:field`), singular for one entity
  (`user:42`), plural for collections (`users:active`). *[Mastering Redis ch. 2; Redis
  Essentials ch. 1, 6]*
- **Parse and validate every input before it becomes part of a key.** Reject empty strings,
  NaN, and malformed ids, and escape glob characters (`*`, `?`, `[`) before passing a value to
  `SCAN MATCH`, so a request cannot reach another keyspace. *[Mastering Redis ch. 2;
  Review lessons]*
- **Derive time-bucket keys (`usage:2026-10-20`) and absolute expiries from the project's single
  date helper, in UTC.** Process-local "today" splits buckets across servers and time zones.
  *[Review lessons; Redis Essentials ch. 3]*
- **Use separate instances, not numbered databases with `SELECT`.** Numbered databases share
  one core, blur which workload causes load, and do not exist in Redis Cluster. *[Redis
  Essentials ch. 6]*
- **Never cache credentials or secrets in plaintext, and apply the system of record's access
  rules to cached user data.** *[Azure Cache-Aside; Review lessons]*

## TTLs, expiry, and eviction

- **Give every derived or cache key a TTL sized to how long it stays useful.** Fine-grained
  time buckets expire in hours, rollups last longer; for sessions, refresh the TTL on activity
  so it acts as the idle timeout. *[Redis Essentials ch. 3; Caching at Scale ch. 4]*
- **Do not treat a TTL as an exact deadline or a guaranteed lifetime.** Expiry is lazy plus
  sampled, so keys linger; `volatile-*` eviction can remove keys early. *[Mastering Redis ch. 3]*
- **Do not poll TTLs to drive workflows.** Use keyspace notifications for best-effort reactions
  and a durable delayed-job mechanism when the action must happen. *[Mastering Redis ch. 3, 9]*
- **Pick the eviction policy from what the instance holds.** Use `allkeys-lfu` or `allkeys-lru`
  when every key is rebuildable; use `volatile-*` only when non-evictable keys share the
  instance (with no TTL'd keys it acts like `noeviction`), and prefer separate instances.
  *[Caching at Scale ch. 4; Mastering Redis ch. 3; Redis Key eviction]* (updated: LFU since
  Redis 4.0; `*-lrm` policies since Redis 8.6)
- **Benchmark eviction policies on real traffic using `keyspace_hits`, `keyspace_misses`, and
  `evicted_keys` from `INFO stats`.** Redis LRU and LFU are sampled approximations tuned by
  `maxmemory-samples`. *[Caching at Scale ch. 4; Mastering Redis ch. 3; Redis Key eviction]*

## Choosing Redis data types

- **Store objects read or updated by field as one hash, not one key per field.** Small hashes
  use a compact encoding and save memory. *[Redis Essentials ch. 1, 3; Caching at Scale ch. 5]*
- **Read only the fields you need with `HGET` or `HMGET`; iterate big hashes with `HSCAN`.**
  `HGETALL` is O(size) and blocks other clients. *[Mastering Redis ch. 2; Redis Essentials ch. 1]*
- **Use bitmaps only for dense, bounded integer ids; use a set when ids are sparse.** A bitmap
  allocates up to its highest offset; sum per-day `BITCOUNT` for totals, `BITOP OR` for
  uniques. *[Redis Essentials ch. 2, 6; Mastering Redis ch. 3, 7]*
- **Use HyperLogLog for unique counts only when about 1% error is acceptable.** It is constant
  memory; use a set or sorted set when counts must be exact. *[Redis Essentials ch. 2, 3;
  Mastering Redis ch. 2]*
- **Benchmark memory with realistic data before switching structures.** Check
  `OBJECT ENCODING`, `MEMORY USAGE`, and `INFO memory`; a "smaller" structure can fill
  production. *[Redis Essentials ch. 4, 6; Mastering Redis ch. 3]*
- **Keep small aggregates under the compact-encoding thresholds, and raise thresholds only
  after measuring.** Larger compact encodings trade CPU for memory, and changes do not re-encode
  existing values. *[Mastering Redis ch. 3; Redis Essentials ch. 4]* (updated: ziplist became
  listpack; the settings are `*-max-listpack-*`)

## Atomicity, scripts, and transactions

- **Use single atomic commands for counters and claims.** `INCR`, `INCRBY`, `SET NX`, `GETDEL`
  run alone on the server, so concurrent clients cannot race. *[Redis Essentials ch. 1;
  WSSE ch. 3]*
- **Never read a value, decide in the client, and write it back unguarded.** Use `WATCH` with
  `MULTI`/`EXEC` and retry on a nil reply, or move the logic into a script. *[Redis Essentials
  ch. 4; Mastering Redis ch. 5]*
- **Prefer a Lua script or Function over `WATCH` retries for read-then-write logic.** It runs
  without interleaving and needs no retry loop. *[Redis Essentials ch. 4]* (updated: Redis 7
  Functions persist and replicate with the dataset)
- **Do not expect rollback from `MULTI`/`EXEC` or from a failing script.** Commands after a
  runtime error still run, and script writes before an error stay; validate inputs before the
  first write. *[Mastering Redis ch. 5; Redis Essentials ch. 4]*
- **Keep scripts short and bounded.** A script blocks every client; past the busy threshold
  Redis answers only `BUSY`, and a script that has written can only be stopped by shutting down
  without saving. *[Mastering Redis ch. 5; Redis Essentials ch. 4]*
- **Pass every key a script touches in `KEYS` and everything else in `ARGV`; build no key names
  inside the script.** Cluster routing depends on declared keys in one slot. *[Mastering Redis
  ch. 5; Redis Essentials ch. 4]*
- **Call cached scripts by SHA and handle `NOSCRIPT` by reloading.** The script cache vanishes
  on restart, flush, or failover. *[Mastering Redis ch. 5; Redis Essentials ch. 4]*
- **Use `SET key token NX PX ttl` with a token-checked release for efficiency locks only.** A
  lock can expire while its holder still works, so correctness needs fencing tokens or a
  database constraint. *[WSSE ch. 3, 4; Review lessons]* (updated: the source locks with
  Memcached `add`)

## Client usage and latency

- **Pipeline independent commands, and send `MULTI`/`EXEC` inside a pipeline.** At 100 ms RTT a
  waiting client manages about ten commands per second; split huge batches. *[Redis Essentials
  ch. 4; Mastering Redis ch. 4]*
- **Give every Redis client a connect and command timeout, a bounded pool, and a reconnect
  policy.** A hung cache call must degrade to a miss, not stall the request. *[Review lessons;
  WSSE ch. 2]*
- **Parse Redis URLs, TTLs, and pool sizes from config at startup and fail fast on invalid
  values.** Never feed `Number()` of an unchecked env var into `EX`. *[Review lessons]*
- **Classify a slowdown before tuning: slow commands, round trips, or client queueing.** Use
  `latency-monitor-threshold`, `LATENCY DOCTOR`, and `SLOWLOG`. *[Mastering Redis ch. 3]*
- **Keep subscriptions on their own connection, never a pooled one.** Under RESP2 a subscribed
  connection runs only subscribe commands and `PING`. *[Mastering Redis ch. 9; Redis Essentials
  ch. 4; Redis Pub/sub]* (updated: RESP3 lifts the command limit)
- **Do not leave `MONITOR` running in production.** It can halve throughput; poll `INFO` or use
  an exporter. *[Redis Essentials ch. 4]*

## Messaging on Redis

- **Use Pub/Sub only for fire-and-forget notifications.** Delivery is at-most-once, so offline
  or slow subscribers lose messages for good; in Cluster use sharded `SPUBLISH`/`SSUBSCRIBE`.
  *[Mastering Redis ch. 9; Redis Essentials ch. 4; Redis Pub/sub]* (updated: sharded Pub/Sub
  since Redis 7.0)
- **Use Streams with consumer groups for work that must not be lost.** Acknowledge with `XACK`
  and reclaim stuck entries with `XAUTOCLAIM`. *[Redis Essentials ch. 1; Mastering Redis
  ch. 9]* (updated: Streams postdate both books; a plain list pop loses the item when the
  consumer dies, and `LMOVE` to a processing list is the older fallback)
- **Enable keyspace notifications only for the event classes you consume.** They cost CPU and
  are best-effort. *[Mastering Redis ch. 9]*

## Persistence and durability

- **Choose persistence from the data's loss tolerance.** None for rebuildable caches; RDB when
  losing minutes is fine; AOF (usually `everysec`) with an RDB preamble when writes must
  survive. *[Redis Essentials ch. 8; Caching at Scale ch. 5; Redis persistence]* (updated:
  Redis 4 added the RDB preamble, now on by default; Redis 7.0 made the AOF multi-part)
- **Use `WAIT` or `WAITAOF` when a write must reach replicas or disk before acknowledgment.**
  Even `appendfsync always` is single-node only; failover can still lose the write.
  *[Caching at Scale ch. 5; Mastering Redis ch. 6]* (updated: `WAITAOF` since Redis 7.2)
- **Use `BGSAVE`, never `SAVE`, on a live server, and keep `stop-writes-on-bgsave-error` on.**
  *[Redis Essentials ch. 7, 8; Caching at Scale ch. 5]*
- **Never let a primary with persistence off auto-restart.** It returns empty and wipes every
  replica. *[Redis Essentials ch. 8]*
- **When latency spikes are periodic, check fork time from snapshots and AOF rewrites first.**
  Save less often, move persistence to a replica, or drop it if data is rebuildable.
  *[Redis Essentials ch. 6]*

## Replication, Sentinel, and Cluster

- **Find the limit before scaling.** Evictions and a falling hit rate mean storage; CPU or
  network saturation means hot keys; sharding lifts both, read replicas lift reads only.
  *[Caching at Scale ch. 6]*
- **Route writes to the primary, keep replicas read-only, and read from replicas only where
  staleness is fine.** *[Caching at Scale ch. 6; Redis Essentials ch. 8, 9]*
- **Connect through a Sentinel-aware or cluster-aware client that follows `MOVED` and `ASK`.**
  A hard-coded primary address keeps writing to the old node after failover. *[Redis Essentials
  ch. 8, 9; Mastering Redis ch. 6]*
- **Co-locate keys used by one multi-key command, transaction, or script with an entity-scoped
  hash tag such as `{user:42}:cart`.** Never use a type-wide constant tag; it puts a whole
  dataset on one shard. *[Mastering Redis ch. 6; Redis Essentials ch. 8, 9]*
- **Shard a client-side or proxy cache with consistent hashing, never `hash mod N`.** Modulo
  remaps most keys when nodes change and empties the cache. *[Redis Essentials ch. 8; WSSE
  ch. 6]*
- **Run at least three primaries with a replica each, plus spares for replica migration.** A
  primary without a replica that fails loses its slots. *[Mastering Redis ch. 6; Redis
  Essentials ch. 9]*
- **Run at least three Sentinels in separate zones with a majority quorum, and keep
  `parallel-syncs` low.** *[Mastering Redis ch. 6; Redis Essentials ch. 9]*

## Security and host setup

- **Bind Redis to loopback or a private network, and name allowed client services in firewall
  rules.** Never turn off protected mode or remove `bind` to make remote access work.
  *[Redis Essentials ch. 7; Mastering Redis ch. 10]*
- **Create one ACL user per service with only the commands and key patterns it needs, and
  disable the default user.** Deny `FLUSHALL`, `CONFIG`, `KEYS`, `DEBUG`, and `SAVE` by ACL.
  *[Mastering Redis ch. 10; Redis Essentials ch. 7]* (updated: ACLs and native TLS since Redis
  6 replace `rename-command` and stunnel)
- **Load Redis passwords from a secret store, never source, and make them long and random.**
  Redis answers fast enough to brute-force short ones; config files holding them get 0600.
  *[Redis Essentials ch. 7; Mastering Redis ch. 10; Review lessons]*
- **Encrypt traffic with TLS wherever it leaves the host, and set `masterauth` on replicas.**
  *[Redis Essentials ch. 7; Mastering Redis ch. 10]*
- **On Linux hosts, disable transparent huge pages, set `vm.overcommit_memory=1`, and keep
  `maxmemory` well below RAM.** These keep background forks working; a write-heavy fork can
  double memory use. *[Mastering Redis ch. 3, 8; Redis Essentials ch. 6; Redis administration]*

## Tensions

- **TTL expiry vs explicit invalidation.** WSSE prefers TTLs because one object feeds many
  cached views; Caching at Scale prefers delete-on-write. This library deletes on write for
  single-entity keys the writer can name, and always sets a TTL as the backstop; TTL alone wins
  for aggregates with a stated staleness bound. *[WSSE ch. 6; Caching at Scale ch. 4, 7]*
- **AOF `always` as durable vs failover data loss.** Caching at Scale presents `always` as no
  data loss; the other books note asynchronous replication loses acknowledged writes. This
  library treats Redis as non-authoritative and uses `WAIT`/`WAITAOF` only when needed.
  *[Caching at Scale ch. 5; Mastering Redis ch. 6; Redis Essentials ch. 9]*
- **Redis locks vs database enforcement.** WSSE uses cache-store locks for coordination. This
  library allows them for efficiency and requires a database constraint or fencing token for
  correctness. *[WSSE ch. 3; Review lessons]*
- **Hash bucketing savings.** Redis Essentials reports several-fold savings; Mastering Redis
  saw under 1% with large values. Bucket only small values, and measure first. *[Redis
  Essentials ch. 3; Mastering Redis ch. 3]*
- **LRU vs LFU.** WSSE assumes LRU and the Redis docs call `allkeys-lru` a good default;
  Caching at Scale says benchmark. This library starts with `allkeys-lru`, tries `allkeys-lfu`
  for strongly skewed popularity, and keeps the measured winner. *[WSSE ch. 6; Caching at
  Scale ch. 4; Redis Key eviction]*
- **No swap vs some swap.** Redis Essentials sets swappiness near zero; the Redis docs keep
  swap about equal to RAM so a spike slows rather than kills. This library keeps swap enabled
  and relies on `maxmemory` plus alerts so Redis never runs from it. *[Redis Essentials ch. 6;
  Redis administration]*
- **Redis vs Valkey.** The books predate the license change: Redis 7.2 and earlier are BSD,
  7.4 is RSALv2/SSPLv1, 8.0 adds AGPLv3, and Valkey forked from 7.2. Check the target server,
  version, and license before using version-specific commands. *[Redis Licenses]*

## Sources

- **Caching at Scale**: Caching at Scale with Redis: Cloud Caching Techniques for Enterprise
  Applications (Lee Atchison, Redis Labs)
- **Mastering Redis**: Mastering Redis (Jeremy Nelson, Packt, 1st edition, 2016)
- **Redis Essentials**: Redis Essentials (Maxwell Dayvson Da Silva, Hugo Lopes Tavares, Packt,
  2015)
- **WSSE**: Web Scalability for Startup Engineers (Artur Ejsmont, McGraw-Hill Education, 1st
  edition, 2015)
- **Review lessons**: rules distilled from the maintainer's code-review findings
- **Scaling Memcache at Facebook**: Nishtala et al., NSDI 2013 (<https://www.usenix.org/conference/nsdi13/technical-sessions/presentation/nishtala>)
- **AWS Caching Best Practices**: Amazon Web Services (<https://aws.amazon.com/caching/best-practices/>)
- **Azure Cache-Aside**: Cache-Aside Pattern, Azure Architecture Center (<https://learn.microsoft.com/en-us/azure/architecture/patterns/cache-aside>)
- **Redis client-side caching**: Redis docs (<https://redis.io/docs/latest/develop/reference/client-side-caching/>)
- **Redis Key eviction**: Redis docs (<https://redis.io/docs/latest/develop/reference/eviction/>)
- **Redis HEXPIRE**: Redis docs (<https://redis.io/docs/latest/commands/hexpire/>)
- **Redis Pub/sub**: Redis docs (<https://redis.io/docs/latest/develop/pubsub/>)
- **Redis persistence**: Redis docs (<https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/>)
- **Redis administration**: Redis docs (<https://redis.io/docs/latest/operate/oss_and_stack/management/admin/>)
- **Redis Licenses**: Redis (<https://redis.io/legal/licenses/>)
