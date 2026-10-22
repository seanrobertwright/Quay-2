# SQL and query performance

> **Load when:** writing, reviewing, or tuning SQL or ORM-generated queries
> (joins, aggregates, window functions, pagination, upserts, bulk updates and
> deletes), adding an index, reading an EXPLAIN plan, chasing a slow query or
> an N+1 pattern, or writing data-access code against PostgreSQL or MySQL.
> **See also:** [Relational and analytical data modeling](../data/data-modeling.md),
> [Database operations, internals, and high availability](../data/database-operations.md),
> [Caching and Redis](../data/caching-and-redis.md),
> [Application and API security](../security/application-security.md),
> [HTTP and REST API design](../api/api-design.md),
> [Concurrency and parallelism](../concurrency/concurrency.md),
> [Performance and load testing](../testing/performance-and-load-testing.md),
> [Search and Elasticsearch](../data/search-elasticsearch.md)

## Top rules

1. **Bind every external value as a driver placeholder; never concatenate it
   into SQL.** Placeholders are the primary injection defence and handle
   quotes, binary data, and NULL; dynamic identifiers (sort column, table)
   come from an allow-list. *[MySQL Cookbook ch. 2, 2.5-2.6; ch. 20, 20.11;
   SQL Cookbook ch. 6]*
2. **Put the tenant column in the WHERE clause of every query, update, and
   delete on user- or org-owned data.** A globally unique id alone lets one
   tenant reach another's rows. *[Review lessons]*
3. **Enforce "only one", "never twice", and "at most N" in the database** with
   a unique or partial unique index, an upsert keyed on it, `SELECT ... FOR
   UPDATE`, or an advisory lock, and add the constraint after any duplicate
   cleanup. Check-then-insert in application code races. *[MySQL Cookbook
   ch. 13, 13.12; ch. 16, 16.1; SQL Cookbook ch. 4, 4.11, 4.16; Review lessons]*
4. **Test NULL with `IS NULL`, and write anti-joins with `NOT EXISTS` or `LEFT
   JOIN ... IS NULL`, never `NOT IN (subquery)`.** `= NULL` matches nothing, and
   one NULL in a `NOT IN` list returns no rows, silently. *[SQL Cookbook ch. 1,
   1.11; ch. 3, 3.4; MySQL Cookbook ch. 3, 3.5; ch. 14, 14.2 (caveats)]*
5. **End the ORDER BY of every "first", "latest", paged, or LIMIT query with a
   unique column.** Tables have no order, and tied rows return arbitrarily, so
   pages repeat or skip rows. *[SQL Cookbook ch. 11, 11.1; MySQL Cookbook ch. 7,
   7.1]*
6. **Cap every user-facing list and paginate it with a keyset cursor.** Ask
   what happens at 10k rows: unbounded fetches exhaust memory, and deep OFFSETs
   read and discard every skipped row. *[HPM4 ch. 8; MySQL Cookbook ch. 20,
   20.10; Review lessons]*
7. **Replace per-row query loops (N+1) with one set-based query, and read the
   SQL your ORM emits before merging.** Each statement pays a round trip, parse,
   and plan. *[Effective MySQL ch. 8; HPM4 ch. 8; pganalyze-PG-Perf, Database
   Performance = Application Performance]*
8. **Give every new query an index serving its filter, join, and sort columns,
   and confirm with EXPLAIN that the planner uses it.** Missing indexes are the
   most common performance problem and often surface months after launch.
   *[pganalyze-PG-Perf, Missing Indices are the #1 database performance problem;
   PG-Indexing, Creating The Best Index For Your Queries; Effective MySQL ch. 1]*
9. **Keep indexed columns bare in predicates.** Move functions and arithmetic to
   the constant side (`created_at >= :start`, not `DATE(created_at) = ...`), or
   index the exact expression. *[MySQL Cookbook ch. 6, 6.20; Effective MySQL
   ch. 4; PG-Indexing, Creating The Best Index For Your Queries]*
10. **Measure every tuning change with `EXPLAIN ANALYZE` on production-scale
    data, one change at a time.** Estimates mislead and small fixtures hide
    missing indexes. *[pganalyze-PG-Perf, Determining missing indices based on
    EXPLAIN plans; PG13 Cookbook ch. 10; Effective MySQL ch. 7]*

## Query correctness

- **Decide how NULLs count in every aggregate.** SUM, AVG, MIN, MAX, and
  `COUNT(col)` skip NULLs; use `COUNT(*)` for rows, and treat COALESCE to zero
  as a business decision. *[SQL Cookbook ch. 7, 7.1, 7.12; MySQL Cookbook ch. 8,
  8.6]*
- **Check multi-table aggregates for join fan-out.** Aggregate the child in a
  CTE first, then join; `SUM(DISTINCT)` also merges legitimately equal values.
  *[SQL Cookbook ch. 3, 3.9-3.10]*
- **Put filters on the optional side of an outer join in ON, not WHERE.** A
  WHERE predicate there turns the outer join back into an inner join.
  *[SQL Cookbook ch. 11, 11.3; ch. 3, 3.10]*
- **Add an optional lookup table with LEFT JOIN.** An inner join drops rows
  with no match; a scalar subquery in SELECT fails if it returns two rows.
  *[SQL Cookbook ch. 3, 3.6]*
- **Join on every column that identifies a match, with explicit `JOIN ... ON`.**
  A partial key gives false matches; n tables need at least n-1 conditions or
  the result is a Cartesian product. *[SQL Cookbook ch. 3, 3.3, 3.8; 3.2
  (caveats)]*
- **Group by every non-aggregated SELECT column, and keep MySQL's
  ONLY_FULL_GROUP_BY on.** Otherwise values come from an arbitrary row.
  *[SQL Cookbook appx. A; MySQL Cookbook ch. 8, 8.6]*
- **Filter aliases, aggregates, and window results in an outer query or CTE.**
  WHERE runs before SELECT and window functions. *[SQL Cookbook ch. 1, 1.6;
  appx. A]*
- **Parenthesise mixed AND/OR, and give every CASE an explicit ELSE.** Both
  mistakes change results with no error. *[SQL Cookbook ch. 1, 1.3, 1.8]*
- **Default to `UNION ALL`.** `UNION` and DISTINCT cost a sort or hash of the
  whole result and are not fixes for unexplained duplicates. *[SQL Cookbook
  ch. 3, 3.1; HPM4 ch. 8]*
- **Make docstrings that promise "newest first" or "at most one" match the
  SQL's ORDER BY, LIMIT, and constraints exactly.** *[Review lessons]*

## Parameters, tenancy, and dynamic SQL

- **Bind a missing value as real NULL, and when a bound value may be null use
  MySQL `<=>` or branch to `IS NULL`.** `col = ?` with null returns zero rows
  silently; PostgreSQL's `IS NOT DISTINCT FROM` is correct but cannot use a
  B-tree index, so branch on hot paths. *[MySQL Cookbook ch. 2, 2.5; ch. 3, 3.6]*
- **Parse LIMIT, OFFSET, ids, and filters at the request boundary.** Reject
  NaN, negatives, empty strings, malformed UUIDs, and page sizes over a cap, and
  bind LIMIT as an integer. *[MySQL Cookbook ch. 3, 3.11; Review lessons]*
- **Pass id lists as an array parameter (`= ANY(:ids)` in PostgreSQL), not a
  string-built IN-list.** *[SQL Cookbook ch. 6, 6.11 (caveats)]*
- **Check the permission the data requires, not only the action's.** A page
  that reads another resource's rows needs that resource's read check and
  tenant filter. *[Review lessons]*
- **Filter dates with half-open bounds on the bare column, computed by the
  project's single date helper and bound as typed UTC values.** `col >= :start
  AND col < :end` is sargable and has no end-of-day gap. *[SQL Cookbook ch. 9
  (caveats); MySQL Cookbook ch. 6, 6.20; Review lessons]*
- **Set the session time zone (UTC) and character set (utf8mb4 on MySQL) in
  the connection options.** Server defaults differ, so times shift and text
  mangles without an error. *[MySQL Cookbook ch. 5, 5.3; ch. 6, 6.4]*

## Access patterns from application code

- **Select only the columns the caller uses, and put LIMIT in the query.**
  `SELECT *` blocks covering indexes; the server sends the full result even if
  the client discards most of it. *[SQL Cookbook ch. 1, 1.4; Effective MySQL
  ch. 5; HPM4 ch. 8]*
- **Paginate with `WHERE (sort_key, id) > (:k, :id) ORDER BY sort_key, id LIMIT
  n`, backed by an index on `(sort_key, id)`.** Cost stays flat with depth and
  concurrent inserts do not shift pages. Both keys must sort the same way; on
  MySQL, expand the row comparison to `sort_key > :k OR (sort_key = :k AND id >
  :id)`, which its optimizer ranges better. *[HPM4 ch. 8; PG-Indexing, B-tree
  indexes; MySQL Row Constructors]*
- **Detect a next page by fetching one extra row, not with an exact COUNT.**
  Exact totals force the whole result; show an estimate if a total is needed.
  *[MySQL Cookbook ch. 20, 20.10; HPM4 ch. 8]*
- **Log, count, and tag the statements each request issues during
  development.** Look for repeated identical queries and unused data; an origin
  comment (`/* checkout.addItem */`) lets log digests group cost by feature.
  *[Effective MySQL ch. 7-8]*
- **Batch large updates, deletes, and purges into bounded chunks on an indexed
  key.** One giant statement holds locks, bloats logs, and lags replicas.
  *[HPM4 ch. 8]*
- **Materialise an expensive repeated report into a summary table** instead of
  re-aggregating live data per request; invalidate any cached result on every
  write path (see [Caching and Redis](../data/caching-and-redis.md)).
  *[MySQL Cookbook ch. 4, 4.2; Effective MySQL ch. 8]*

## Indexing

- **Design indexes from the workload: each hot query's predicates, column
  types, operators, sort, and selected columns.** The type and operator pair
  decides which index types can serve a predicate. *[PG-Indexing, About; HPM4
  ch. 7]*
- **Inspect existing indexes and table size first, and try rewriting the query
  to use an existing index.** Adding a known leading predicate often fixes it
  with no schema change. *[Effective MySQL ch. 1; pganalyze-PG-Perf,
  Determining missing indices based on EXPLAIN plans]*
- **Order composite columns: equality filters first, then the sort or range
  column, and stop at about three key columns unless measured.** B-trees use
  only a leftmost prefix and stop narrowing after the first range. *[HPM4 ch. 7;
  Effective MySQL ch. 4; PG-Indexing, Creating The Best Index For Your Queries]*
- **Let one index serve both the WHERE equality and the ORDER BY.**
  `(filter_col, sort_col)` removes the sort and lets LIMIT stop early.
  *[Effective MySQL ch. 4; PG-Indexing, B-tree indexes; HPM4 ch. 7]*
- **Prefer one composite index to single-column indexes combined by index merge
  or bitmap AND.** A merged plan usually signals a missing composite index.
  *[HPM4 ch. 7; Effective MySQL ch. 4; PG-Indexing, How Postgres uses indexes]*
- **Cover hot queries with `INCLUDE` columns (PostgreSQL 11+) or trailing key
  columns.** Confirm "Using index" (MySQL) or an Index Only Scan with near-zero
  Heap Fetches (PostgreSQL). *[Effective MySQL ch. 5; pganalyze-PG-Perf,
  Determining missing indices based on EXPLAIN plans; PG-Indexing]*
- **In PostgreSQL, index every foreign key column of a child table.** It does
  not create one, so joins and parent deletes scan the child; InnoDB creates it
  automatically. *[SQL Cookbook ch. 5, 5.5; Effective MySQL ch. 3 (dated); MySQL FK]*
- **Declare an index UNIQUE whenever the data is, with NOT NULL key columns or
  `NULLS NOT DISTINCT` (PostgreSQL 15+).** It enforces integrity and lets the
  planner stop at one row; by default NULL is the one value a unique index lets
  repeat. *[Effective MySQL ch. 4; MySQL Cookbook ch. 16, 16.1;
  PG Unique Indexes]*
- **Index the exact expression a predicate uses (`lower(email)`), or a generated
  column holding it, including filtered JSON fields.** *[PG-Indexing, Creating
  The Best Index For Your Queries; HPM4 ch. 6; MySQL Cookbook ch. 9, 9.5 (dated)]*
- **In PostgreSQL, use a partial index for a predicate most queries repeat
  (`WHERE deleted_at IS NULL`), and a partial unique index for "one active row
  per key".** The planner uses it only when the query's WHERE implies the
  index's. *[PG-Indexing, Creating The Best Index For Your Queries; Review lessons]*
- **Treat every index as a write cost, and drop duplicate, prefix-redundant,
  and unused ones from workload evidence.** `(a)` beside `(a, b)` is redundant;
  hide an index (MySQL invisible) before dropping, and never drop primary or
  unique keys. *[PG-Indexing, How Postgres uses indexes; Effective MySQL ch. 4,
  8; HPM4 ch. 7]*
- **Check selectivity against the real distribution, including outlier
  tenants.** One tenant that owns most rows can make an index useless.
  *[HPM4 ch. 7]*
- **Do not expect `LIKE '%term'` to use a B-tree.** Use a trigram index
  (`pg_trgm`), full-text search, or a search engine. *[Effective MySQL ch. 4;
  PG-Indexing (caveats)]*
- **Make join columns identical in type, signedness, charset, and collation.**
  A mismatch forces an implicit conversion that can stop index use. Key and type
  choices belong in [data modeling](../data/data-modeling.md). *[Effective MySQL
  ch. 8; HPM4 ch. 6]*
- **Build PostgreSQL indexes on live tables with `CREATE INDEX CONCURRENTLY`
  outside a transaction, and rebuild any INVALID index a failed build leaves.**
  A plain build blocks writes; for large MySQL changes see [Database
  operations](../data/database-operations.md). *[pganalyze-PG-Perf, Determining
  missing indices based on EXPLAIN plans, and caveats; Effective MySQL ch. 1]*

## Diagnosing slow queries

- **Rank queries by total time (calls times mean), not the slowest run.** Use
  `pg_stat_statements` (`total_exec_time` since PostgreSQL 13, not the book's
  `total_time`) or a slow-log digest; a fast query run constantly outweighs a
  rare report. *[pganalyze-PG-Perf, Using pg_stat_statements; PG13
  Cookbook ch. 8, 10; Effective MySQL ch. 7]*
- **Reproduce a reported slow query first, timing writes as the matching
  SELECT.** One slow run can be a lock wait or a resource spike.
  *[Effective MySQL ch. 1]*
- **Use `EXPLAIN (ANALYZE, BUFFERS)` in PostgreSQL (BUFFERS is implied from
  18) and `EXPLAIN ANALYZE` in MySQL 8.0.18+, and wrap writes in `BEGIN ...
  ROLLBACK`.** ANALYZE executes the statement and takes its locks.
  *[pganalyze-PG-Perf, Determining missing indices based on EXPLAIN plans, and
  caveats; PG13 Cookbook ch. 10; PG EXPLAIN]*
- **Start at the most expensive node, and compare rows examined with rows
  returned.** A large Seq Scan with high "Rows Removed by Filter", or MySQL
  `type=ALL` with large `rows`, points to a missing index. *[pganalyze-PG-Perf,
  Determining missing indices based on EXPLAIN plans; HPM4 ch. 8; Effective
  MySQL ch. 9]*
- **EXPLAIN with real parameter values from a slow-query sample.** Plans change
  with values; a normalised `$1` text says nothing about selectivity.
  *[pganalyze-PG-Perf, Analyzing the performance of a specific slow query; PG13
  Cookbook ch. 10; Effective MySQL ch. 4]*
- **Keep a slow-query log and `auto_explain` on in production behind duration
  thresholds, never logging every statement.** Later re-created plans can
  differ; sample or disable per-node timing on busy systems. *[pganalyze-PG-Perf,
  Understanding the Postgres Logging System; PG13 Cookbook ch. 8; Effective
  MySQL ch. 6-7]*
- **Run ANALYZE after bulk loads, restores, and upgrades, and when plans go bad
  after big data changes.** Stale statistics mislead the planner; PostgreSQL
  18's pg_upgrade keeps most statistics but not extended ones. *[HPM4 ch. 7;
  PG13 Cookbook ch. 11 (dated)]*
- **Fix disk spills with a better index or narrower query; raise sort memory
  only per session.** It is allocated per operation per connection.
  *[PG13 Cookbook ch. 8; Effective MySQL ch. 6]*
- **Use index and join-order hints only as a last resort, with a comment saying
  why.** Hints do not adapt as data and indexes change. *[Effective MySQL ch. 4;
  HPM4 ch. 8]*
- **Do not stop at "add an index".** Check stale statistics, N+1 loops, lock
  contention, bad row estimates, and views stacked on views. *[pganalyze-PG-Perf
  (caveats); Effective MySQL ch. 8]*

## Writes, upserts, and transactions

- **Upsert in one statement on a unique key: `INSERT ... ON CONFLICT`
  (PostgreSQL) or `ON DUPLICATE KEY UPDATE` with a row alias (`VALUES (...) AS
  new ... new.col`; `VALUES(col)` there is deprecated).** Avoid MySQL REPLACE:
  it deletes and reinserts, firing delete triggers and cascades. *[SQL Cookbook
  ch. 4, 4.11; MySQL Cookbook ch. 16, 16.2 (caveats); MySQL Upsert]*
- **Read a generated id from `RETURNING` or the driver's insert id, never
  `MAX(id)`.** *[MySQL Cookbook ch. 13, 13.4, 13.11]*
- **Lock rows you read and then modify with `SELECT ... FOR UPDATE`, or make the
  claim one conditional UPDATE and check rows affected.** A plain SELECT takes
  no lock; use `SKIP LOCKED` for queues. *[MySQL Cookbook ch. 17 (caveats);
  HPM4 ch. 1]*
- **Keep transactions short, never open across user input or external calls.**
  They hold locks and block cleanup of old row versions. *[HPM4 ch. 5]*
- **Retry the whole transaction on deadlock or serialization errors, and lock
  rows in a consistent order.** *[HPM4 ch. 1]*
- **Before a mass UPDATE or DELETE, run its WHERE as a SELECT and check the
  count.** In a correlated UPDATE, restrict the outer WHERE too, or unmatched
  rows get NULL. *[SQL Cookbook ch. 4, 4.8, 4.10, 4.14]*
- **Name the target columns in every INSERT.** Positional inserts corrupt data
  when columns change. *[SQL Cookbook ch. 4, 4.1, 4.4]*
- **Load untrusted bulk data into a staging table, validate it with set-based
  SQL, then copy it; check warnings and counts after every load.**
  *[MySQL Cookbook ch. 11, 11.1; ch. 12, 12.2]*

## Reporting and analytical SQL

- **Prefer window functions to self-joins for running totals, ranks, and
  per-group detail, and confirm with EXPLAIN.** *[SQL Cookbook appx. A; ch. 12,
  12.18]*
- **End a window's ORDER BY with a unique tiebreaker and state the frame; for
  "top N", pick ROW_NUMBER or DENSE_RANK by how ties must behave.** The default
  frame groups peers, so totals jump at ties. *[SQL Cookbook ch. 7, 7.6; ch. 11,
  11.5; appx. A]*
- **Outer join facts to a generated series when every period must appear.**
  *[SQL Cookbook ch. 9, 9.10; ch. 10, 10.5]*
- **Write nested derived tables as named CTEs; give recursive CTEs a stop
  predicate.** *[SQL Cookbook ch. 13; appx. B]*
- **Sample large tables with TABLESAMPLE (PostgreSQL) or a random keyed range,
  not `ORDER BY random()`, which sorts the whole table.** *[SQL Cookbook ch. 1
  (caveats); MySQL Cookbook ch. 15 (caveats)]*

## Engine notes

- **PostgreSQL: default to B-tree; GIN for JSONB containment, GIN or GiST for
  full text, GiST for geometry and ranges, BRIN only when physical order tracks
  the value.** Prefix `LIKE` under a non-C collation needs `text_pattern_ops`.
  *[PG-Indexing, Data types, operators and index types; BRIN indexes]*
- **PostgreSQL: every UPDATE and DELETE leaves a dead row version.** Keep
  frequently updated rows narrow, do not index frequently updated columns
  without need (it blocks HOT updates), and never disable autovacuum.
  *[PG13 Cookbook ch. 2; pganalyze-PG-Perf (caveats)]*
- **MySQL: read `key`, `rows`, `type`, `key_len`, and Extra.** `key_len` shows
  how many composite columns are used; "Using filesort" flags a missing sort
  index. *[Effective MySQL ch. 9]*
- **MySQL InnoDB: do not append the primary key to secondary indexes;** each
  entry already stores it. *[Effective MySQL ch. 5; HPM4 ch. 7]*
- **MySQL: run strict SQL mode, expect REPEATABLE READ, and remember DDL
  commits implicitly.** Non-strict mode truncates silently, and mixed DDL/DML
  migrations are not atomic. *[MySQL Cookbook ch. 12, 12.1; ch. 17, 17.2; HPM4
  ch. 1]*

## Tensions

- **Keyset vs OFFSET pagination.** Keyset by default; OFFSET only for small,
  bounded admin pages that jump to page numbers. *[HPM4 ch. 8; SQL Cookbook ch. 11]*
- **Subquery vs join.** Effective MySQL advises rewriting IN subqueries as
  joins; MySQL 5.6+ and 8.0 transform many into semi-joins. Write the clearest
  form and rewrite only when plans differ. *[Effective MySQL ch. 8 (dated)]*
- **Join decomposition vs N+1.** HPM4 splits some joins into one query per
  table with IN-lists, as a measured choice; per-row loops stay banned.
  *[HPM4 ch. 8; Effective MySQL ch. 8]*
- **Foreign keys vs online schema-change tooling.** Some teams drop FKs for
  gh-ost; this library keeps FK, unique, and check constraints by default.
  *[HPM4 ch. 6; MySQL Cookbook ch. 14; Review lessons]*
- **Selective-first vs equality-first column order.** Order by query use;
  selectivity only breaks ties. *[HPM4 ch. 7; PG-Indexing (dated)]*
- **Covering indexes vs write cost.** Cover only queries ranking high by total
  time; wide indexes slow writes and can block HOT updates. *[Effective MySQL
  ch. 5; pganalyze-PG-Perf (caveats)]*
- **MERGE vs native upsert.** PostgreSQL has MERGE only from 15, and MERGE is
  not race-free on every engine; prefer native upserts on a unique index.
  *[SQL Cookbook ch. 4 (dated)]*
- **Prepared statements vs custom plans.** Preparing cuts planning cost, but
  PostgreSQL may switch to a generic plan that regresses on skewed values;
  check `plan_cache_mode`. *[PG13 Cookbook ch. 10 (caveats)]*

## Sources

- **SQL Cookbook**: SQL Cookbook, 2nd Edition (Anthony Molinaro, Robert de Graaf; O'Reilly, 2020)
- **MySQL Cookbook**: MySQL Cookbook, 3rd Edition (Paul DuBois; O'Reilly)
- **Effective MySQL**: Effective MySQL: Optimizing SQL Statements (Ronald Bradford; McGraw-Hill, 2011)
- **HPM4**: High Performance MySQL, 4th Edition (Silvia Botros, Jeremy Tinley; O'Reilly, 2021)
- **PG-Indexing**: Effective Indexing in Postgres: Creating the Best Index for your Queries (Lukas Fittl; pganalyze eBook)
- **pganalyze-PG-Perf**: Best Practices for Optimizing Postgres Query Performance (Lukas Fittl; pganalyze eBook)
- **PG13 Cookbook**: PostgreSQL 13 Cookbook (Vallarapu Naga Avinash Kumar; Packt, 2021)
- **MySQL Row Constructors**: Row Constructor Expression Optimization, MySQL 8.4 Reference Manual (<https://dev.mysql.com/doc/refman/8.4/en/row-constructor-optimization.html>)
- **MySQL Upsert**: INSERT ... ON DUPLICATE KEY UPDATE Statement, MySQL 8.4 Reference Manual (<https://dev.mysql.com/doc/refman/8.4/en/insert-on-duplicate.html>)
- **MySQL FK**: FOREIGN KEY Constraints, MySQL 8.4 Reference Manual (<https://dev.mysql.com/doc/refman/8.4/en/create-table-foreign-keys.html>)
- **PG EXPLAIN**: EXPLAIN, PostgreSQL 18 Documentation (<https://www.postgresql.org/docs/current/sql-explain.html>)
- **PG Unique Indexes**: Unique Indexes, PostgreSQL 18 Documentation (<https://www.postgresql.org/docs/current/indexes-unique.html>)
- **Review lessons**: rules distilled from the maintainer's code-review findings
