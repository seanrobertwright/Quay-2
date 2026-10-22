# Database operations, internals, and high availability

> **Load when:** writing code or config that depends on how a relational
> server (PostgreSQL, MySQL/InnoDB, or similar) behaves: transactions,
> isolation, locking, and retries; migrations on live tables; connection
> pools and timeouts; database roles, auth, TLS, and row-level security;
> backup, restore, and point-in-time recovery; replication, failover, and
> split-brain; durability settings, MVCC and vacuum; monitoring or upgrading
> a database server.
> **See also:** [SQL and query performance](../data/sql-and-query-performance.md),
> [Relational and analytical data modeling](../data/data-modeling.md),
> [NoSQL data stores](../data/nosql.md),
> [Distributed systems](../distributed/distributed-systems.md),
> [Application and API security](../security/application-security.md),
> [Observability and reliability](../operations/observability-and-reliability.md),
> [Scalability and system design](../architecture/scalability-and-system-design.md)

## Top rules

1. **Never count a replica, RAID, or snapshot as a backup.** They copy a
   `DROP TABLE` or a bad write at once. Keep backup generations off the
   database hosts and restore-test them on a schedule, timing the restore.
   *[HPM4 ch. 10, Backup Myth #1; HA-MySQL-CB ch. 2, Introduction;
   PG13 Cookbook ch. 3, pg_dump and pg_restore]*
2. **Write down RPO and RTO before choosing replication or backups.**
   Asynchronous replication loses committed transactions on failover; use
   synchronous commit where that loss is unacceptable. *[HPM4 ch. 10,
   Defining Recovery Requirements; HA-MySQL-CB ch. 5, Designing a replication
   setup; PG13 Cookbook ch. 4, synchronous streaming replication]*
3. **Enforce "only one", "never twice", and "at most N" in the database.** Use
   a unique or partial unique index, `ON CONFLICT`, `SELECT ... FOR UPDATE`,
   an advisory lock, or serializable isolation; an in-process guard or a
   comment is not enforcement. *[Review lessons; DBI ch. 5, Isolation Levels]*
4. **Write every transaction so it can be retried whole.** Catch deadlock,
   serialization, and lock-timeout errors, retry with bounded, jittered
   backoff, and keep user or network waits out of the transaction.
   *[DBI ch. 5, Deadlocks; MySQL Internals ch. 8, Dealing with deadlocks;
   HPM4 ch. 1, Deadlocks]*
5. **Keep per-commit durability on for primaries, backup sources, and
   promotion candidates.** Log flush and binlog sync on commit, `fsync`, and
   `synchronous_commit` stay on; relaxing them loses commits on a crash.
   *[HPM4 ch. 5, The InnoDB Transaction Log; ch. 9, Making Replication Crash
   Safe; MySQL Internals ch. 5, innodb_flush_log_at_trx_commit; DBI ch. 5,
   Recovery]*
6. **Never let two nodes accept writes for the same data.** Fence the old
   primary before promoting, use three failure domains or a witness for
   quorum, and keep replicas `super_read_only` or read-only standbys.
   *[HA-MySQL-CB ch. 4, partitioning and arbitration; ch. 6, Fencing; PG13
   Cookbook ch. 4, Promoting a standby; HPM4 ch. 5, super_read_only]*
7. **Change large live tables only through online methods.** Native INSTANT
   or in-place DDL, `CREATE INDEX CONCURRENTLY`, gh-ost, or pg_repack; a plain
   rewrite, `VACUUM FULL`, or tablespace move blocks writes throughout.
   *[HPM4 ch. 6, Running schema changes in production; PG13 Cookbook ch. 10,
   pg_repack]*
8. **Scope every read and write of tenant-owned rows by the tenant column.** A
   globally unique id alone is not enough; back the filter with row-level
   security where the engine has it. *[Review lessons; PG13 Cookbook ch. 7,
   row-level security]*
9. **Connect each service with its own least-privilege role, never as a
   superuser.** A shared or superuser credential makes one leak or bad
   statement fatal to everything. *[PG13 Cookbook ch. 7, roles and
   privileges; HPM4 ch. 13, Separation of Roles]*
10. **Pool connections and cap the server-side total.** Each connection costs
    a process or thread plus memory, and hitting the limit becomes
    application errors at once. *[PG13 Cookbook ch. 6, pgBouncer pool
    settings; HPM4 ch. 5, max_connections]*

## Transactions, locking, and invariants

- **Pick an isolation level by listing the anomalies the code must not see.**
  Names differ by engine: MySQL defaults to REPEATABLE READ with gap locks,
  PostgreSQL's REPEATABLE READ is snapshot isolation. *[DBI ch. 5, Isolation
  Levels; HPM4 ch. 1, Isolation Levels]*
- **Do not trust snapshot isolation with an invariant that spans rows.** Two
  transactions writing disjoint rows can both commit and break it (write
  skew); lock what you read, use serializable, or add a constraint.
  *[DBI ch. 5, Isolation Levels; ch. 13, Percolator]*
- **Make every read-modify-write safe against lost updates.** Use an atomic
  `SET n = n + 1`, a version column checked in the `WHERE`, or a lock held
  from read to write. *[DBI ch. 5, Read and Write Anomalies]*
- **Use optimistic concurrency only where conflicts are rare.** Abort and
  retry collapses throughput on hot rows; lock those pessimistically.
  *[DBI ch. 5, Optimistic Concurrency Control]*
- **Lock rows in one consistent order and back every `UPDATE` or `DELETE`
  `WHERE` with an index.** InnoDB locks each entry and gap it scans, so an
  unindexed write locks wide ranges. *[MySQL Internals ch. 8, Dealing with
  deadlocks; Record locking; HPM4 ch. 1, Deadlocks]*
- **Set finite lock-wait and statement timeouts on app connections.** A stuck
  transaction should fail with a retryable error, not hang callers.
  *[MySQL Internals ch. 5, innodb_lock_wait_timeout; ch. 8]*
- **Never hold a transaction open across user input or remote calls.** An idle
  open transaction blocks purge or vacuum, so bloat and query cost grow.
  *[HPM4 ch. 5, Old row versions; DBI ch. 4, Vacuum and Maintenance]*
- **Keep non-transactional tables and `LOCK TABLES` out of transactions.**
  Their changes cannot roll back, and table locks hide deadlocks from the
  detector. *[HPM4 ch. 1, Mixing storage engines; MySQL Internals ch. 8]*
- **Serialise singleton jobs (migrations, schedulers) with an advisory lock
  or lease row.** Otherwise every instance runs them after a deploy.
  *[Review lessons]*
- **Make the comment match the constraint.** A docstring or migration note
  promising "at most one" or an ordering names the index or lock that makes
  it true. *[Review lessons]*

## Schema changes and migrations

- **Keep migrations in version control, lint them in pull requests, and ship
  them through the code pipeline.** Lint for charset, a primary key, and
  unsafe DDL. *[HPM4 ch. 6, A CI/CD pipeline for schema changes; Review
  lessons]*
- **Give every table an explicit, compact primary key.** Row-based and
  logical replication, pg_repack, and online upgrades depend on one.
  *[HA-MySQL-CB ch. 1, Designing a MySQL Cluster; MySQL Internals ch. 10,
  InnoDB; PG13 Cookbook ch. 11, logical replication upgrades]*
- **Check the manual for the exact server version before picking a DDL
  method.** Native online DDL keeps expanding; use gh-ost with throttling
  when it falls short. *[HPM4 ch. 6, Running schema changes in production]*
- **Ship the index a new query pattern needs in the same migration, built
  online, and count its write cost on write-heavy tables.** Ask what the
  query does at 10k and 10M rows; every secondary index is maintained on
  every write. *[Review lessons; DBI ch. 1, Primary Index as an
  Indirection]*
- **Chunk backfills, purges, and bulk `UPDATE`/`DELETE` by primary-key
  range.** One huge statement holds locks, bloats logs, and becomes replica
  lag of the same length. *[HA-MySQL-CB ch. 8, Replication tuning; MySQL
  Internals ch. 12, Two-Threaded Slave; HPM4 ch. 8, Chopping Up a Query]*
- **Store timestamps as UTC and convert through one project date helper.** A
  zone-less column holds wall-clock digits, so name its zone explicitly; do
  not use MySQL `TIMESTAMP` for values that may pass 2038. *[Review lessons;
  HPM4 ch. 6, Choosing Optimal Data Types]*
- **Set SQL mode and strictness identically in every environment.** A
  different mode silently changes invalid-value and quoting behaviour.
  *[MySQL Internals ch. 5, sql-mode; HPM4 ch. 6, NULL Not Invented Here]*
- **Default surrogate keys to 64 bits and track remaining key space.** 32-bit
  keys run out, and widening later is a large migration. *[HPM4 ch. 2,
  Auto-increment space; ch. 6, Integer types]*

## Connections and routing

- **Put pgBouncer or a similar pooler in front of PostgreSQL once
  connections reach the hundreds.** Clients then queue cheaply instead of
  holding idle backends. *[PG13 Cookbook ch. 6, chapter introduction]*
- **Size each server-side pool near twice the database's CPU cores, then
  benchmark.** Pools exist per user and database pair; the total is their
  sum. *[PG13 Cookbook ch. 6, Configuring the pool settings]*
- **Use transaction pooling only for sessionless clients.** It breaks `SET`,
  session advisory locks, temp tables, and `LISTEN`. Updated: the book says
  prepared statements break too, but pgBouncer 1.21+ supports them with
  `max_prepared_statements`. *[PG13 Cookbook ch. 6, pool modes]*
- **Parse pool size, timeouts, ports, and lag thresholds at startup.** Reject
  empty, non-numeric, and out-of-range values with a clear message.
  *[Review lessons]*
- **Give apps separate write and read endpoints, routed by health checks
  that know the current primary.** Writes follow a failover without a config
  change. *[PG13 Cookbook ch. 6, HAProxy]*
- **Send read-after-write paths to the primary; make replica reads tolerate
  lag.** *[HPM4 ch. 9, Excessive Replication Lag; MySQL Internals ch. 12,
  Overview]*
- **Health-check replicas on lag, latency, and read-only status, not an open
  port.** A writable node in a read pool is a routing bug. *[HPM4 ch. 11,
  Health Checks for Read Pools]*

## Access control and security

- **Grant privileges to NOLOGIN group roles per schema, then grant the roles
  to login users.** *[PG13 Cookbook ch. 2, group role; ch. 7, roles and
  privileges]*
- **When RLS is a tenant boundary, use `FORCE ROW LEVEL SECURITY`, keep the
  app role from owning the tables, and index the tenant column.** Owners,
  superusers, and `BYPASSRLS` roles otherwise skip policies. *[PG13 Cookbook
  ch. 7, row-level security; Review lessons]*
- **After fixing a missing tenant filter or lock in one query, grep for the
  pattern and fix every sibling in the same commit.** *[Review lessons]*
- **Use scram-sha-256 (MySQL: `caching_sha2_password`), never `trust`, plain
  passwords, MD5, or `mysql_native_password`.** Updated: the books use md5
  and legacy MySQL auth; PostgreSQL 18 deprecates MD5 and MySQL 9.0 removes
  `mysql_native_password`. Order `pg_hba.conf` most specific first; the
  first match wins. *[PG13 Cookbook ch. 7, pg_hba.conf; MySQL Internals
  ch. 4, Authentication Protocol Security]*
- **Keep the database port off public networks and require TLS on untrusted
  links.** *[MySQL Internals ch. 4; PG13 Cookbook ch. 7, SSL]*
- **Keep credentials in a secret store with rotation.** Credential files
  are written mode 0600 to uniquely named paths, never committed.
  *[HPM4 ch. 13, Secrets Management; Review lessons]*
- **Put user, database, client, and application name in every log line, log
  DDL, and use pgaudit for compliance.** *[PG13 Cookbook ch. 7, Auditing]*

## Backup and restore

- **Use physical backups (XtraBackup, pgBackRest, Barman, WAL-G) plus
  archived WAL or binlogs for large databases and point-in-time recovery.**
  Logical restores of big datasets take days; PostgreSQL 17+ `pg_basebackup`
  also does incrementals. *[HPM4 ch. 10, Designing a MySQL Backup Solution;
  PG13 Cookbook ch. 3, pgBackRest]*
- **Treat a logical dump as a portable copy, not disaster recovery.**
  `pg_dump` omits roles and tablespaces; add `pg_dumpall --globals-only`.
  *[PG13 Cookbook ch. 3, pg_dump; pg_dumpall]*
- **Archive WAL with a durable, no-overwrite tool before go-live.** Use
  pgBackRest or WAL-G archive-push, or an `archive_library` (PostgreSQL
  15+); the book's bare `cp` neither fsyncs nor refuses to overwrite.
  *[PG13 Cookbook ch. 1, Enable archiving]*
- **Back up binlogs, server config, and stored code as well as data.**
  *[HPM4 ch. 10, What to Back Up]*
- **Make backup storage write-only from database hosts.** A separate identity
  reads and deletes, so a compromised host cannot destroy its backups.
  *[HPM4 ch. 12, Backing up binary logs]*
- **Record log coordinates or the GTID set while a snapshot lock is held.**
  A replica seeded without them skips or repeats transactions. *[HA-MySQL-CB
  ch. 5, Using LVM to reduce downtime]*
- **Block other writers during a restore, restore every shard piece, and
  verify row counts.** A partial restore finishes without error.
  *[HA-MySQL-CB ch. 2, Restoring from an online backup]*
- **Run `ANALYZE` (MySQL: `ANALYZE TABLE`) after bulk loads, restores, and
  major upgrades.** Stale statistics give bad plans. PostgreSQL 18's
  pg_upgrade keeps most planner statistics but not extended statistics, so
  still analyze those. *[PG13 Cookbook ch. 11, Major version upgrade; HPM4
  ch. 7, Updating Index Statistics]*
- **Keep a delayed replica to undo human error, never as a failover
  candidate.** *[PG13 Cookbook ch. 4, delayed standby; HPM4 ch. 9]*

## Replication

- **On MySQL use row-based logging and GTIDs with auto-positioning.**
  Statement-based apply diverges on nondeterministic writes. *[HPM4 ch. 9,
  Choosing Replication Format; MySQL Internals ch. 12]*
- **Use streaming replication for HA and logical replication for selected
  tables or cross-version copies.** Logical replication carries no DDL or
  roles. *[PG13 Cookbook ch. 4, introduction]*
- **Keep one writer plus replicas.** Avoid dual-writer active-active, rings,
  and database-level filters, which match the session's default database.
  *[HPM4 ch. 9, Discouraged Topologies; MySQL Internals ch. 12, Multi-Master;
  HA-MySQL-CB ch. 5]*
- **Give every server a unique server id and every standby a unique
  application name.** *[MySQL Internals ch. 5, server-id; PG13 Cookbook
  ch. 4]*
- **Measure lag with a heartbeat row and alert when an apply thread stops.**
  Built-in lag figures read 0 or NULL while broken. *[HPM4 ch. 9, Measuring
  Replication Lag; MySQL Internals ch. 12]*
- **Never skip replica errors wholesale.** An error means divergence.
  *[MySQL Internals ch. 5, slave-skip-errors]*
- **Cap retained replication logs with expiry or slot limits.** Unpurged
  binlogs or an abandoned slot fill the disk and halt writes. *[HA-MySQL-CB
  ch. 5, Configuring a replication master; PG13 Cookbook ch. 4]*

## High availability and failover

- **Size for one node or zone lost, with at least two copies of every
  fragment.** *[HA-MySQL-CB ch. 1, Designing a MySQL Cluster; ch. 4]*
- **Stop the minority side of a partition rather than let both halves
  write.** Diverged copies are nearly impossible to reconcile.
  *[HA-MySQL-CB ch. 4, Single storage node failure; DBI ch. 10, Leader
  Election]*
- **Automate failover only through a consensus-backed manager (Patroni with
  an etcd quorum, InnoDB Cluster/Group Replication, Orchestrator in raft
  mode) plus fencing or a watchdog.** *[PG13 Cookbook ch. 5, Watchdog;
  HA-MySQL-CB ch. 6, Fencing]*
- **Promote in order: fence the old primary, let the least-lagged replica
  apply its backlog, then lift its write barrier.** *[HA-MySQL-CB ch. 5,
  Active/passive; PG13 Cookbook ch. 4, Promoting a standby]*
- **Make the failover runbook ask first whether the primary will restart
  within the RTO.** With durable settings a restart loses nothing, while a
  rushed promotion can. *[HPM4 ch. 9, Trade-Offs of Promotion]*
- **Keep data checksums (the initdb default since PostgreSQL 18) or
  `wal_log_hints` on so a demoted primary can rejoin via pg_rewind.**
  pg_rewind refuses to run without one. *[PG13 Cookbook ch. 4, pg_rewind]*
- **Never let two server processes open the same data files.** *[HA-MySQL-CB
  ch. 6, Configuring MySQL with GFS]*
- **Use asynchronous replication across a WAN; never stretch a synchronous
  cluster by raising timeouts.** *[HA-MySQL-CB ch. 1]*

## Configuration, durability, and monitoring

- **Fix queries and schema before server settings; skip hit-ratio tuning.**
  Size the buffer pool and redo log, leave the rest near defaults.
  *[HPM4 ch. 5, What Not to Do; MySQL Internals ch. 5]*
- **Version-control config and change one setting at a time against a
  baseline.** *[HPM4 ch. 5, Planning Your Variable Changes; HA-MySQL-CB
  ch. 8, Introduction]*
- **Check `postgresql.auto.conf` when a config edit seems ignored.** It is
  read last and wins. *[PG13 Cookbook ch. 1, postgresql.auto.conf]*
- **Set restart-only settings, such as `shared_preload_libraries`, before
  go-live.** *[PG13 Cookbook ch. 1; ch. 8, pg_stat_statements]*
- **Treat an `fsync` failure as fatal and recover from the log.** A retried
  flush can report success for lost pages. *[DBI ch. 5, PostgreSQL Versus
  fsync()]*
- **Default to a transactional, crash-safe engine; in-memory tables hold
  only reloadable data.** *[MySQL Internals ch. 10; HA-MySQL-CB ch. 6]*
- **Keep data, WAL or binlogs, logs, and backups on separate volumes.**
  *[HA-MySQL-CB ch. 2; PG13 Cookbook ch. 1, Moving pg_wal]*
- **Alert on trends: disk growth, connections, lag, backup duration.**
  Alerting at 100% full is too late. *[HPM4 ch. 2, Proactive Monitoring;
  PG13 Cookbook ch. 9]*
- **Page on any read-only or too-many-connections error.** *[HPM4 ch. 2,
  Monitoring for Errors]*
- **Log autovacuum runs and tune it per table.** *[PG13 Cookbook ch. 8,
  Logging autovacuum; DBI ch. 4, Vacuum and Maintenance]*

## Upgrades and choosing a database

- **Apply minor releases promptly; run major upgrades as tested projects
  with a restore-based rollback.** Rehearse on production-shaped data.
  *[PG13 Cookbook ch. 11; HPM4 app. A, Testing Upgrades]*
- **Snapshot before `pg_upgrade --link`.** The old cluster is unusable once
  the new one starts. *[PG13 Cookbook ch. 11, pg_upgrade with hard links]*
- **Evaluate a database by replaying your own workload at scale, weighing
  durability and operability over speed.** *[DBI Preface, Comparing
  Databases]*

## Tensions

- **Foreign keys versus online schema change.** HPM4 lets teams drop foreign
  keys for gh-ost. House: keep them by default; dropping them is a recorded
  decision, and unique and check constraints stay. *[HPM4 ch. 6; Review
  lessons]*
- **Automatic failover versus a human.** PG13 Cookbook automates with
  Patroni; HA-MySQL-CB warns against automatic split-brain resolution.
  House: automate promotion with consensus and fencing; a human picks the
  survivor of a real split brain. *[PG13 Cookbook ch. 5; HA-MySQL-CB ch. 7]*
- **Semisync as a durability tool.** HPM4 dismisses it; lossless semisync
  with a long timeout serves some tools. House: count it only when its
  fallback is monitored. *[HPM4 ch. 9]*
- **Relaxing durability on a lagging replica.** HPM4 allows it as a last
  resort; DBI counts nothing durable before the log flush. House: only on a
  non-promotable, non-backup replica, with automation that restores it.
  *[HPM4 ch. 9; DBI ch. 5]*
- **LIMIT batching versus deterministic replication.** HA-MySQL-CB advises
  both. House: chunk by primary-key range with row-based logs.
  *[HA-MySQL-CB ch. 5; ch. 8]*
- **Dated tooling.** HA-MySQL-CB and MySQL Internals predate MySQL 8: read
  source/replica for master/slave, and use GTIDs, multi-threaded apply,
  online DDL, and Orchestrator or Group Replication; the query cache is gone,
  and `expire_logs_days` is now `binlog_expire_logs_seconds`. PG13
  Cookbook's `wal_keep_segments` became `wal_keep_size` in PostgreSQL 13;
  prefer slots capped by `max_slot_wal_keep_size`. *[HA-MySQL-CB; MySQL
  Internals; PG13 Cookbook]*

## Sources

- **HA-MySQL-CB**: High Availability MySQL Cookbook (Alex Davies; Packt, 1st
  ed., 2010)
- **HPM4**: High Performance MySQL: Proven Strategies for Operating at Scale,
  4th Edition (Silvia Botros, Jeremy Tinley; O'Reilly, 2021)
- **PG13 Cookbook**: PostgreSQL 13 Cookbook (Vallarapu Naga Avinash Kumar;
  Packt, 1st ed., 2021)
- **DBI**: Database Internals: A Deep Dive into How Distributed Data Systems
  Work (Alex Petrov; O'Reilly, 1st ed., 2019)
- **MySQL Internals**: Understanding MySQL Internals (Sasha Pachev; O'Reilly,
  1st ed., 2007)
- **Review lessons**: rules distilled from the maintainer's code-review
  findings
