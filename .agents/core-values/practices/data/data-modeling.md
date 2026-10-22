# Relational and analytical data modeling

> **Load when:** designing or changing a database schema (tables, keys, constraints, nullability,
> naming, migrations), reviewing DDL or an ERD, modeling history, hierarchies, many-to-many links,
> or multi-tenant data, or designing warehouse fact and dimension tables, slowly changing
> dimensions, or semi-structured ingestion.
> **See also:** [SQL and query performance](../data/sql-and-query-performance.md), [Database
> operations, internals, and high availability](../data/database-operations.md), [NoSQL data
> stores](../data/nosql.md), [Domain-driven design](../architecture/domain-driven-design.md),
> [Event-driven architecture and messaging](../architecture/event-driven-and-messaging.md),
> [Concurrency and parallelism](../concurrency/concurrency.md), [Application and API
> security](../security/application-security.md), [HTTP and REST API design](../api/api-design.md)

## Top rules

1. **Make every table represent exactly one subject, and treat Third Normal Form as the floor.**
   Every non-key column depends on the key, the whole key, and nothing but the key; tables below 3NF
   breed update, insert, and delete anomalies. *[DBMM ch. 7, app. G; BDDS ch. 7; DMwS ch. 9]*
2. **Declare a primary key on every table and keep every other candidate key as a UNIQUE
   constraint.** Without a key, rows cannot be referenced and the grain is a guess; a surrogate PK
   without a unique natural key lets duplicates in. *[DBMM ch. 8; BDDS ch. 7; DMwS ch. 5]*
3. **Enforce every stated invariant in the database, not in application code.** "Only one", "never
   twice", "at most N", "required", and "must exist" become NOT NULL, CHECK, FOREIGN KEY, UNIQUE,
   partial unique or exclusion constraints, or a `SELECT ... FOR UPDATE` / advisory-lock write path;
   a check-then-insert in code races. *[DBMM ch. 11; BDDS ch. 6, 10; DDIA ch. 7; Review lessons]*
4. **Put the tenant column on every user- or org-owned table and inside its keys.** Unique
   constraints, foreign keys, and indexes include the tenant id, and every query, update, and delete
   filters on it; a globally unique row id alone never authorizes access. *[Review lessons]*
5. **Never store a list in a column or a numbered column group (`phone1`, `phone2`).** Move
   repeating values to a child table keyed by the parent; packed values cannot be indexed,
   constrained, or counted. *[DBMM ch. 7; BDDS ch. 7]*
6. **Do not store values the database can derive or copy from another table.** Totals,
   concatenations, and convenience copies drift from their inputs; derive them in a view or query,
   and denormalize only after measuring, with the copy maintained by the engine or in the same
   transaction. *[DBMM ch. 6, 7, 15; BDDS ch. 8, 10]*
7. **Resolve every many-to-many relationship with a linking table that owns the facts of the
   association.** Quantity and price-at-order-time live on the order line, not on the order or the
   product. *[DBMM ch. 10; BDDS ch. 9; DMwS ch. 8]*
8. **Model time explicitly.** Store instants as timezone-aware timestamps through one date helper,
   keep history with effective-dated rows where the past matters, and never overwrite facts you may
   need to reconstruct. *[BDDS ch. 9; DBMM ch. 9; Review lessons]*
9. **Make every schema change backward and forward compatible.** Old and new code run together
   during deploys and the database holds rows written years apart: add columns nullable or with a
   default, and remove or rename only through expand-and-contract. *[DDIA ch. 4, 12]*
10. **In a warehouse, declare each fact table's grain at the atomic level before anything else, and
    never mix grains in one table.** Mixed grains double-count; atomic facts serve any later rollup.
    *[DMwS ch. 7]*

## Tables and normalization

- **Split multipart columns into one column per item you filter, sort, or group by.** A full name or
  one-line address blocks queries by city or surname; free text such as notes stays whole.
  *[DBMM ch. 7; BDDS ch. 7]*
- **Do not encode meaning inside identifiers or codes.** A category prefix in an id is a hidden
  column that must be parsed and rewritten on every rename; store the category as its own column.
  *[DBMM ch. 7]*
- **Test every non-key column by asking whether this row's key alone determines its value.** If
  another column determines it, move it to the table keyed by that column.
  *[DBMM ch. 8, app. G; BDDS ch. 7]*
- **Classify each table as an entity, a link (association), or a lookup (domain), and split any
  table that is more than one.** Mixed tables usually fail 2NF and do not map cleanly onto code.
  *[BDDS ch. 8]*
- **Separate a thing from its occurrences and a header from its details.** A course and its
  offerings, an order and its line items: the parent is then one countable, auditable row that can
  recur without copying its shared data. *[BDDS ch. 14; DMwS ch. 8]*
- **Model subtypes as a supertype table plus subtype tables that share its primary key.** Two
  near-identical tables are an unrecognized subtype; choose separate tables, roll-up, or roll-down
  by who maintains and queries the subtype data, and add a CHECK when exactly one of several columns
  may be set. *[DBMM ch. 7; DMwS ch. 8, 11]*
- **Normalize past 3NF only when the anomaly it prevents is likely in this application.** Each step
  adds joins on every read. *[BDDS ch. 7; DMwS ch. 9]*
- **Never build a generic entity-attribute-value table (`entity, name, value`) or one shared lookup
  table for every domain.** Both lose types and constraints and become a chokepoint; use one lookup
  table per domain, and a typed document column for truly open-ended attributes. *[BDDS ch. 10]*
- **Give every column a real type; never fall back to a string because the contents are unclear.**
  Resolve the type or split the field into separately typed columns. *[BDDS ch. 6, 7]*
- **Refer to shared entities by id, never by repeated human-readable text.** Names change; ids do
  not. *[DDIA ch. 2; DBMM ch. 7]*
- **Do not shape tables like a spreadsheet, a report, or the legacy schema.** Store normalized rows
  and pivot in the query layer; mine an old schema for requirements, not structure.
  *[DBMM ch. 6, 14]*
- **Recheck every single-valued column and every one-to-one link when requirements say "except",
  "unless", "sometimes", or "usually".** Those words predict a 1:N relationship; design it in rather
  than retrofitting it. *[BDDS ch. 10]*
- **Write a few realistic sample rows for each proposed table before committing it.** Sample data
  exposes multivalued fields, false keys, and attributes that belong on a link table.
  *[DBMM ch. 7, 8, 10]*

## Keys and identifiers

- **Accept a candidate key only if it is unique, never null in any part, minimal, and stable.**
  Reject any column that fails one test; never change a primary key value once assigned.
  *[DBMM ch. 8; BDDS ch. 10]*
- **Default to a single-column surrogate primary key plus UNIQUE constraints on the natural keys.**
  Use a natural key as the PK only when it is stable and truly unique (ISO codes, a linking table's
  parent keys); a warehouse loading keys from several sources uses a surrogate.
  *[DBMM ch. 8; BDDS ch. 10; DMwS ch. 5]*
- **Generate ids as bigint identities or time-ordered UUIDs (UUIDv7), not random UUIDv4 values in a
  clustered index.** Random keys scatter inserts across the index; sequences may have gaps, so never
  treat them as counts. *[DMwS ch. 5]* (updated: UUIDv7, RFC 9562, postdates the sources)
- **Never use government ids, passwords, or other sensitive or possibly absent values as keys.**
  They breach privacy rules and fail the not-null test. *[DBMM ch. 8]*
- **Treat ids as opaque.** Allow equality comparisons only, never arithmetic or ordering by meaning;
  use distinct domain types in code so two kinds of id cannot be swapped. *[DBMM ch. 9]*
- **Mark non-key columns UNIQUE whenever a business fact demands it.** Example: one manager per
  department; for a repeated attribute, the choice between unique (person, number) and unique
  (person, type) is the business rule. *[DBMM ch. 9; BDDS ch. 9]*

## Relationships and referential integrity

- **Give a foreign key the same name, type, and specification as the key it references.** Mismatched
  names hide broken links; a different name is justified only for a role such as `manager_id`.
  *[DBMM ch. 10; BDDS ch. 8; DMwS ch. 10]*
- **Add distinguishing columns (date, term, sequence) to a linking table when the same pair can
  recur.** Otherwise a retaken course or a repeat booking collides with the existing key.
  *[BDDS ch. 7, 9]*
- **Choose a deletion rule for every foreign key deliberately, defaulting to RESTRICT.** Cascade
  only when children cannot exist without the parent, SET NULL only on a nullable key, and never
  cascade a self-referencing hierarchy. *[DBMM ch. 10]*
- **Record each side's participation as mandatory or optional with a (min, max) count.** Mandatory
  becomes a NOT NULL foreign key; a maximum such as "at most two loans" needs a constraint, trigger,
  or locked transaction. *[DBMM ch. 10, 11]*
- **Enforce "every parent has at least one child" with a deferred constraint trigger or a single
  write path that creates both in one transaction.** A plain foreign key cannot express it, and a
  middle-tier check alone cannot see concurrent writers. *[BDDS ch. 6; Review lessons]*
- **Store a hierarchy as a parent reference on each child and query it with a recursive CTE.** Add a
  closure table or materialized path when reads dominate; in a warehouse, flatten ragged hierarchies
  into a bridge table of paths. *[BDDS ch. 9; DMwS ch. 16]*

## Columns, domains, and nulls

- **Write a specification for every column before implementing it.** Cover type, length,
  nullability, default, range, edit rule, and who supplies the value; this data dictionary drives
  the DDL, the boundary parser, and the UI. *[DBMM ch. 9; BDDS ch. 8]*
- **Use NULL only for "missing or unknown", never for zero, blank, or "not applicable".** When "not
  applicable" matters, split out a subtype or add a CHECK tied to a discriminator column; never
  store "N/A" strings in a typed column. *[DBMM ch. 3, 9]*
- **Make columns NOT NULL when the business rule makes them mandatory or when they feed
  arithmetic.** One null quantity silently turns a total into null; decide from the rule, not from
  today's data. *[DBMM ch. 3; DMwS ch. 5]*
- **Use a default only when it means something, and never offer "Other" as an allowed value.** A
  placeholder date is a lie stored as data; "Other" signals a domain that needs refining.
  *[DBMM ch. 9]*
- **Build fixed domains and sanity bounds into CHECK constraints (`quantity >= 1`, `price >= 0`).**
  Rules that will not change need no flexibility. *[BDDS ch. 6]*
- **Use a lookup table with a foreign key for any allowed-value list that may change.** Changing the
  list becomes a data edit, and the UI reads the same list instead of hard-coding a copy.
  *[DBMM ch. 11; BDDS ch. 6, 8]*
- **Store changeable parameters (thresholds, rates) as typed data, per entity when they vary per
  entity.** Avoid name/value settings tables, which lose types; turn a family of similar rules into
  columns such as `reorder_point`. *[BDDS ch. 6]*
- **Define recurring column kinds (money, phone, postal code) once and reuse the definition
  everywhere.** Use a domain type or one shared column definition so every instance agrees.
  *[DBMM ch. 9]*
- **Enforce immutability for columns that must not change after insert, such as creation facts and
  keys.** Use a trigger, a column privilege, or an append-only table. *[DBMM ch. 9]*
- **Store instants as `timestamptz` and calendar dates as DATE, never as timezone-less strings.**
  Route all parsing and "today" calculations through one date helper. *[DBMM ch. 9; Review lessons]*
- **Use declared length and precision to document intent, and put units in amount column names.**
  Write `char(3)` for an ISO currency code and `discount_percent`, `balance_usd`. *[DMwS ch. 5, 10]*

## Where invariants are enforced

- **Classify every business rule as database-oriented or application-oriented, and implement every
  database-oriented one as a constraint.** Tick each specified constraint off as it lands in DDL;
  specified constraints are often lost between design and code. *[DBMM ch. 11; BDDS ch. 10]*
- **Use the database as the final authority, the service tier for complex cross-table rules, and the
  UI for cheap early feedback.** The redundancy is deliberate; the database catches what a buggy
  client lets through. *[BDDS ch. 6, 10]*
- **Still parse every external input at the boundary.** Reject NaN, empty strings, malformed UUIDs,
  and out-of-range values with a clear message before they reach SQL; the schema is the last line of
  defense, not the only one. *[Review lessons]*
- **Use a UNIQUE constraint, never check-then-insert, for uniqueness.** It holds under weak
  isolation, where a read-then-write check suffers write skew. *[BDDS ch. 6; DDIA ch. 7]*
- **Treat every check-then-write invariant (no double booking, balance stays non-negative) as
  exposed to write skew.** Use serializable isolation, an exclusion constraint, or lock the rows the
  check reads; `FOR UPDATE` cannot lock rows that do not exist yet. *[DDIA ch. 7]*
- **Replace read-modify-write in application code with atomic updates (`SET n = n + 1`), row locks,
  or version-checked compare-and-set.** ORM load-modify-save silently loses concurrent updates.
  *[DDIA ch. 7]*
- **Claim a shared record with an atomic conditional update and a lease expiry.**
  `UPDATE ... SET locked_by = :me WHERE id = :id AND locked_by IS NULL`, then check the row count;
  put one claim column on the aggregate root rather than locking every row. *[BDDS ch. 9]*
  (updated: the source clears stale claims by hand; the atomic claim and lease are current practice)
- **Make schema comments and docstrings match the constraints exactly.** A comment saying "at most
  one per user" with no unique index is a bug report; fix the constraint or the prose.
  *[Review lessons]*
- **After adding a missing constraint, sweep every sibling table with the same pattern and fix them
  in the same change.** The same gap usually exists on several tables. *[Review lessons]*

## Multi-tenancy, privacy, and access

- **Include the tenant id in composite foreign keys so a child row cannot reference another tenant's
  parent.** Scope unique constraints per tenant (`UNIQUE (org_id, slug)`) and lead indexes with the
  tenant column. *[Review lessons]*
- **Use row-level security, column grants, and views as a backstop, never as a replacement for
  tenant filters in queries.** Roles and credentials live in [Database
  operations](../data/database-operations.md). *[BDDS ch. 29; Review lessons]*
- **Classify PII, health, and payment data and its residency rules before choosing where it is
  stored.** Collect only what the purpose needs and plan its purge. *[BDDS ch. 1; DDIA ch. 12]*
- **Plan real erasure for data in append-only tables, event logs, and backups.** A "deleted" marker
  erases nothing; use excision, rewriting, or per-subject keys you can destroy (crypto-shredding).
  *[DDIA ch. 11, 12]*

## History, audit, and deletion

- **Decide table by table, early, which data is temporal.** Adding effective dates later forces a
  date parameter onto every query; temporalizing everything inflates storage. *[BDDS ch. 9]*
- **Store values that change over time (prices, rates, assignments) with effective-from and
  effective-to columns in their own table.** Use half-open intervals `[from, to)` and enforce
  non-overlap with an exclusion constraint, `WITHOUT OVERLAPS` keys (PostgreSQL 18+), or
  system-versioned temporal tables. *[BDDS ch. 9]* (updated: the source uses closed intervals)
- **Where history matters, end-date the current row and insert a new one instead of updating or
  deleting.** *[BDDS ch. 9]*
- **Implement soft delete with partial unique indexes and filtered views.** Otherwise a "deleted"
  row still blocks its unique key and leaks into reads. *[DBMM ch. 10]*
- **Keep an audit trail of significant actions: who, what, when, and old and new values where
  accountability requires it.** Include reads of sensitive records; a `created_by` on each version
  of an append-only table covers most of it. *[BDDS ch. 9]*

## Schema evolution and migrations

- **Assume data outlives code.** New code must read old rows and old code must tolerate new columns
  during a rolling deploy; avoid language-native serializers for anything persisted. *[DDIA ch. 4]*
- **Add columns as nullable or with a default, and backfill in batches.** A single full-table UPDATE
  is slow and can block writers. *[DDIA ch. 2, 4]* (updated: many engines now add such columns
  instantly)
- **When code reads, modifies, and writes back a record, preserve fields it does not recognize.** An
  older version that re-encodes into a fixed model deletes fields added by newer code.
  *[DDIA ch. 4]*
- **Make large restructurings by building the new shape alongside the old one, moving readers over,
  then dropping the old shape.** Keep rollback possible at each step. *[DDIA ch. 12]*
- **Ship schema changes as versioned, forward-only migrations in the same repository as the code.**
  Keep rebuild-from-scratch scripts (schema, lookup seeds, per-use-case test data) for development
  and test isolation, created in foreign-key dependency order. *[BDDS ch. 27]* (updated: the source
  predates migration tooling as the norm)
- **Document every deliberate rule break: why, which principle, the exact change, and its effects.**
  This makes the change reversible and stops others repeating a failed experiment. *[DBMM ch. 15]*

## Naming

- **Use one convention everywhere: unquoted lowercase `snake_case`, no spaces, no reserved words.**
  Quoted identifiers become case-sensitive; names are a public API, so choose them once and keep
  them stable. *[BDDS ch. 8, 10, 18; DMwS ch. 10]*
- **Give the same concept the same column name in every table and every layer.** `customer_id` must
  not become `client_code` downstream. *[BDDS ch. 10; DMwS ch. 10]*
- **Name the primary key `<table>_id`, never a bare `id`, and name constraints for their meaning.**
  Use `pk_<table>`, `ak_<table>_<qualifier>`, and `fk_<child>_<verb>_<parent>`. *[DMwS ch. 10]*
- **Spell names out, keep one attribute per name, and make generic names specific.** No acronyms, no
  "and" or "or" in a name, `home_phone` not `phone`. *[DBMM ch. 7, app. C; DMwS ch. 10]*
- **Encode layer or role in names (`stg_`, `_hist`), never physical object type (`_v`, `_mv`).** A
  view may later become a table without breaking consumers. *[DMwS ch. 10, 12]*

## Analytical and warehouse modeling

- **Serve analytics from a separate warehouse fed from the OLTP database, not from the live
  schema.** The workloads need different shapes, and scans hurt user-facing latency.
  *[BDDS ch. 28; DDIA ch. 3; DBMM ch. 15]*
- **Start a dimensional design with business process, grain, dimensions, and facts, in that order,
  recorded in a bus matrix the business signs off.** *[DMwS ch. 7]*
- **Pick the pattern by its place on the normalization spectrum.** One big table is easy to query
  and hard to maintain, a star schema balances them for reporting, a snowflake schema trades joins
  for less redundancy, and Data Vault buys auditability with many tables. *[DMwS ch. 9, 17]*
- **Layer schemas by trust: raw source data loaded unchanged, a private staging layer, a governed
  normalized layer, and a curated reporting layer.** Rename and transform only downstream, so logic
  changes need no reload, and stamp every raw row with load id, load timestamp, and source so one
  bad batch can be removed. *[DMwS ch. 10, 15]*
- **Declare PK and FK constraints on every warehouse table even when the engine does not enforce
  them, and back each with a uniqueness and orphan test in the load.** Declared keys state the grain
  and let tools build joins; only NOT NULL is enforced on standard Snowflake tables.
  *[DMwS ch. 5, 11, 12]* (updated: Snowflake hybrid tables now enforce PK, UNIQUE, and FK)
- **Set optimizer RELY on a constraint only when an automated test proves the data satisfies it.** A
  violated RELY constraint returns wrong answers, not slow ones. *[DMwS ch. 11, 12]*
- **Choose the fact table type from the process: transaction, periodic snapshot, accumulating
  snapshot, or factless.** Build snapshots from the atomic transaction facts. *[DMwS ch. 14]*
- **Store non-additive measures as their additive parts, and never sum semi-additive measures
  (balances, inventory) across time.** Store price and units, not average unit price.
  *[DMwS ch. 14]*
- **Choose a slowly changing dimension type per attribute, not per table.** Type 1 overwrites, Type
  2 adds a row, Type 3 keeps the prior value; move rapidly changing attributes into a
  mini-dimension. *[DMwS ch. 13]*
- **Key a Type 2 dimension on business key plus valid-from, and test every load for unique,
  non-overlapping intervals per key.** Analytic engines do not enforce it. *[DMwS ch. 13]*
- **Detect changed rows with a hash of the tracked attributes that coalesces nulls and joins columns
  with an explicit delimiter.** Without both, nulls hash to null and `'ab'||'c'` collides with
  `'a'||'bc'`. *[DMwS ch. 13]* (updated: the source's recipe concatenates raw columns)
- **Treat schema-on-read as postponed modeling.** Land semi-structured data with load metadata, then
  flatten it into typed relational tables, and always cast and alias extracted paths, because a
  mistyped path returns NULL silently. *[DMwS ch. 15]*
- **In Data Vault, key hubs on true business keys, keep the raw vault insert-only and free of
  business rules, and model every link as many-to-many.** *[DMwS ch. 17]*

## Process and review

- **Sketch an entity-relationship model and a logical design before writing DDL, independent of the
  engine.** Choose physical details after the model is sound, and never drop a constraint because
  the engine seems unable to enforce it. *[BDDS ch. 8, 10; DBMM ch. 14; DMwS ch. 2]*
- **Ask the integrity questions explicitly during requirements.** Which values are allowed, which
  fields are required, must a parent exist first, does cancellation delete or flag? Unasked, they
  become guesses. *[BDDS ch. 4]*
- **Denormalize only as a measured last resort.** First check the design, the query plans, and
  indexes; record every denormalization as a rule break. *[DBMM ch. 15; BDDS ch. 10]*
- **Ask "what happens at 10k rows, and at 100 times today's volume" for every table.** Index every
  foreign key and the columns the expected query pattern filters on, and estimate growth with a
  safety margin. *[BDDS ch. 10; Review lessons]*
- **Before handing over a schema, run an integrity review.** Check keys, multipart, multivalued, and
  derived columns, field specifications, deletion rules, participation, enforced business rules, and
  tenant scoping. *[DBMM ch. 13; Review lessons]*

## Tensions

- **Surrogate keys vs natural keys.** This library defaults to a surrogate PK plus UNIQUE natural
  keys, because stable references and enforced uniqueness both matter. A natural PK wins for stable
  standard codes and for linking tables keyed by their parents.
  *[DBMM ch. 8; BDDS ch. 10; DMwS ch. 5]*
- **Stored derived values vs derive on read.** Derive on read by default. Engine-maintained
  generated columns and materialized views with a defined refresh policy are acceptable once a
  measured need exists; values maintained by application code are not.
  *[DBMM ch. 6, 15; BDDS ch. 8; DMwS ch. 4]*
- **Middle-tier rules vs database constraints.** One source places "every order has a line item"
  only in the middle tier. This library enforces every expressible invariant in the database, using
  deferred constraint triggers or one transactional write path for "at least one" rules.
  *[BDDS ch. 6; Review lessons]*
- **Lookup table vs CHECK or enum.** Use a lookup table when the list may change or the UI must read
  it, and a CHECK for fixed domains. *[BDDS ch. 6; DBMM ch. 11]*
- **Explicit "N/A" values vs NULL.** One source stores "N/A" for inapplicable attributes. This
  library keeps the intent (make meaning explicit) but uses subtypes or a discriminator CHECK, since
  typed columns cannot hold "N/A". *[DBMM ch. 3, 9]*
- **Child tables vs native arrays and JSON columns.** Use child tables for anything filtered,
  joined, constrained, or referenced; arrays and JSON fit only opaque, rarely queried payloads.
  *[DBMM ch. 7; BDDS ch. 10; DDIA ch. 2]*
- **Unenforced declared constraints in a warehouse.** One source recommends declaring constraints
  and RELY almost everywhere. This library declares them but sets RELY only where an automated test
  proves them. *[DMwS ch. 5, 12]*
- **Trees in a graph store vs in SQL.** One source steers hierarchies toward graph or document
  stores. This library keeps them relational with recursive CTEs or closure tables unless the
  relationships themselves dominate the workload. *[BDDS ch. 3, 9]*
- **Singular vs plural table names, and `<table>_id` vs bare `id`.** Sources and ORM defaults
  disagree. Follow the project's convention; a new project picks one and lints for it.
  *[DBMM app. C; BDDS ch. 8; DMwS ch. 10]*

## Sources

- **DBMM**: Database Design for Mere Mortals: A Hands-on Guide to Relational Database Design
  (Michael J. Hernandez, 3rd ed., 2013)
- **BDDS**: Beginning Database Design Solutions: Understanding and Implementing Database Design
  Concepts for the Cloud and Beyond (Rod Stephens, 2nd ed., 2023)
- **DMwS**: Data Modeling with Snowflake (Serge Gershkovich, 1st ed., 2023)
- **DDIA**: Designing Data-Intensive Applications (Martin Kleppmann, 1st ed., 2017)
- **Review lessons**: rules distilled from the maintainer's code-review findings
