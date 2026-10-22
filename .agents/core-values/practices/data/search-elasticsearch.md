# Search and Elasticsearch

> **Load when:** writing, reviewing, or debugging code that indexes into,
> queries, or operates Elasticsearch or OpenSearch: mappings, analyzers, query
> DSL, relevance, autocomplete, facets, pagination, reindexing and aliases,
> syncing an index from a primary database, or cluster sizing and upkeep.
> **See also:** [NoSQL data stores](../data/nosql.md),
> [Relational and analytical data modeling](../data/data-modeling.md),
> [Event-driven architecture and messaging](../architecture/event-driven-and-messaging.md),
> [HTTP and REST API design](../api/api-design.md),
> [Database operations](../data/database-operations.md),
> [Front-end components and state](../frontend/components-and-state.md)

*The sources target Elasticsearch 1.x to 7.0. Rules are stated in current (8.x
and 9.x) terms; where a source's API was renamed or removed, the rule uses the
replacement.*

## Top rules

1. **Keep the system of record elsewhere and treat the index as a rebuildable
   projection.** There are no multi-document transactions; commit to the
   database first, then replicate with `version_type=external` so late or
   duplicate sync writes are rejected. *[AdvES7 ch. 1; ES-TDG ch. 3, ch. 40]*
2. **Map every production index explicitly and set `dynamic: strict` at the
   root.** The first value seen fixes a field's type forever; changing a type
   or analyzer later means a new index and a reindex. *[AdvES7 ch. 4;
   ES-Blueprints ch. 1; ES-Indexing ch. 3; ES-TDG ch. 6, ch. 10]*
3. **Map ids, codes, enums, tags, and anything you filter, sort, or aggregate
   on as `keyword`; map prose as `text`; add a `keyword` sub-field when you
   need both.** Never turn on `fielddata` for text, and never run `term`,
   `terms`, `prefix`, or `wildcard` against a `text` field. *[AdvES7 ch. 4,
   ch. 6; ES-Blueprints ch. 6; ES-Indexing ch. 3; ES-TDG ch. 8, ch. 34]*
4. **Read and write only through aliases over versioned physical indices
   (`orders_v3`).** A mapping fix then becomes build-new, reindex, and one
   atomic `_aliases` swap with no downtime or code change. *[AdvES7 ch. 2;
   ES-TDG ch. 10, ch. 43]*
5. **Put a tenant filter in `bool.filter` on every search, count,
   update-by-query, and delete-by-query over tenant-owned data, added by one
   shared query builder.** A filtered alias or a globally unique `_id` is not
   a tenant check. *[Review lessons; AdvES7 ch. 2; ES-TDG ch. 43]*
6. **Never pass search-box text to `query_string` or `q=`; use `match`,
   `multi_match`, or `simple_query_string`.** Lucene syntax throws on stray
   characters and lets users hit any field or run heavy wildcards.
   *[AdvES7 ch. 6; ES-Blueprints ch. 6; ES-TDG ch. 5]*
7. **Put yes/no conditions in filter context and only relevance-bearing text in
   `must`/`should`.** Filters skip scoring, can be cached, and keep structural
   matches from distorting rank. *[AdvES7 ch. 6; ES-Blueprints ch. 2;
   ES-TDG ch. 7]*
8. **Do not page deeply with `from`/`size`; use `search_after` on a
   point-in-time with a unique tiebreaker in the sort.** Deep offsets cost every
   shard and are capped by `index.max_result_window`. *[AdvES7 ch. 6;
   ES-Blueprints ch. 2; ES-TDG ch. 9]*
9. **Write in bulk, sized by bytes, and inspect every item in the response.**
   A 200 can carry per-item failures; retry only rejected items with backoff.
   *[AdvES7 ch. 3; ES-Indexing ch. 6; ES-TDG ch. 3, ch. 44]*
10. **When a document "is there but not found", run `_analyze` on the stored
    text and the query text before changing anything.** Most empty-result bugs
    are tokenization mismatches. *[ES-Indexing ch. 4; ES-Blueprints ch. 6;
    ES-TDG ch. 6]*

## Mappings and field types

- **Use `dynamic: false` only when you accept silently unsearchable fields; for
  open-ended sub-objects use dynamic templates (most specific first) that map
  unknown strings to `keyword`.** This stops text+keyword doubling and type
  guesses. *[AdvES7 ch. 4; ES-Indexing ch. 3; ES-TDG ch. 10]*
- **Map dates as `date` with an explicit `format`, and disable date detection
  where free text arrives.** A string date compares lexically and breaks ranges
  and histograms without an error. *[ES-Blueprints ch. 2, ch. 5;
  ES-Indexing ch. 3; ES-TDG ch. 10]*
- **Never create a field per key (per user, IP, or attribute name); model
  key/value data as nested name/value pairs or the `flattened` type.** Every
  field grows the cluster state on every node; the
  `index.mapping.total_fields.limit` setting is the guard. *[ES-TDG ch. 43;
  ES-Blueprints ch. 4]*
- **Map arrays of objects as `nested` when a query must match several fields of
  the same element, and use `inner_hits` to see which matched.** Plain object
  arrays flatten, so "Alice, 28" matches an Alice of 31 beside someone of 28.
  *[AdvES7 ch. 7; ES-Blueprints ch. 4; ES-TDG ch. 41]*
- **Denormalize by default; use nested for small, rarely changing child sets
  and `join` only when children vastly outnumber parents.** Any nested change
  rewrites the parent; `join` needs routing to the parent's shard, is several
  times slower, and does not cascade deletes. *[AdvES7 ch. 7; ES-Blueprints
  ch. 4; ES-Indexing ch. 2; ES-TDG ch. 40, ch. 42]*
- **Use a lowercase or ASCII-folding `normalizer` on keyword fields that need
  case-insensitive exact match, sort, or facets.** It yields one token, so the
  field stays aggregatable. *[AdvES7 ch. 5; ES-Blueprints ch. 6]*
- **Decide separately whether each field is searchable and whether it is
  returned; set `index: false` on fields never queried.** Each indexed field
  builds its own inverted index. *[ES-Indexing ch. 1, ch. 6;
  ES-Blueprints ch. 2]*
- **Keep `_source` enabled; exclude specific large or sensitive fields instead
  of disabling it.** Without it you lose reindex, update, update-by-query, and
  highlighting, and it cannot be turned back on. *[AdvES7 ch. 4;
  ES-Indexing ch. 1]*
- **Disable `norms` and lower `index_options` only on fields that are never
  scored or phrase-queried.** Neither can be restored without a reindex.
  *[ES-Indexing ch. 6]*

## Writing queries

- **Once a `bool` has `must` or `filter`, `should` only boosts; set
  `minimum_should_match` when one `should` must match.** *[ES-Blueprints ch. 2]*
- **Read `term`/`terms` on a multi-valued field as "contains", not "equals";
  index a value count when exact set equality matters.** *[ES-TDG ch. 12]*
- **Pick the `multi_match` type from the data: `best_fields` for competing
  fields, `most_fields` for one text indexed several ways, `cross_fields` or a
  `copy_to` field for one entity split across fields.** Never mix exact-value
  fields into a multi_match over analyzed text. *[ES-TDG ch. 14]*
- **Weight named fields (`title^3`) instead of querying a catch-all field.**
  A catch-all loses per-field analysis and the title signal. *[ES-Blueprints
  ch. 2, ch. 3; ES-Indexing ch. 8]*
- **Avoid leading wildcards and unbounded regexps; bound prefix and fuzzy
  expansion with `prefix_length` and a small `max_expansions`.** They walk the
  term dictionary. *[ES-TDG ch. 16, ch. 24]*
- **Round `now` in date ranges (`now/m`, `now/d`) unless precision matters.**
  An unrounded `now` defeats the request and query caches. *[ES-TDG ch. 12]*
- **Set a `timeout` on user-facing searches and check `timed_out` and
  `_shards.failed` before presenting results as complete.** Searches have no
  timeout by default. *[AdvES7 ch. 6]*
- **Read `hits.total` as `{value, relation}` and leave `track_total_hits`
  bounded unless the UI truly needs an exact count; any label or docstring
  promising an exact count or an order must match the request.** *[AdvES7
  ch. 1, ch. 6; Review lessons]*
- **After fixing a query bug, grep every query builder for the same pattern and
  fix the siblings in the same change.** *[Review lessons]*

## Security, tenancy, and input handling

- **Apply tenant scoping in one query-building function and test that every
  read and bulk-mutation path goes through it; after a get-by-id, verify the
  tenant field before returning.** *[Review lessons; ES-TDG ch. 43]*
- **Do not treat filtered aliases as a security boundary; use document- and
  field-level security or the application layer.** A routed, filtered alias
  per tenant is a routing convenience, not access control. *[AdvES7 ch. 2;
  ES-TDG ch. 43]*
- **Parse search parameters at the handler boundary: integer `page` and `size`
  in range, `size` capped, sort and field names from an allowlist.** Reject NaN
  and empty values with a clear error. *[Review lessons; ES-TDG ch. 5]*
- **Escape user text before placing it in `regexp`, `wildcard`, or
  `query_string` syntax.** *[Review lessons; ES-TDG ch. 5]*
- **Set the highlighter `encoder: html` (or escape on render) whenever
  fragments are rendered as HTML, and allow only safe URL schemes in links
  built from hits.** The default encoder passes stored markup through.
  *[AdvES7 ch. 6; Review lessons]*
- **Keep the cluster's HTTP port off the public internet and away from
  browsers; never enable `http.cors` with `*`.** Proxy search through the app.
  *[Review lessons]*
- **Run with TLS and authentication on (set up automatically on first start
  since 8.0), give each service a least-privilege API key, and load credentials
  from a secret store, including for reindex-from-remote.**
  *[ES Docs, Automatic security setup; Review lessons]*
- **Create one thread-safe client per process, rebuild it after a fork, set
  request timeouts and bounded retries, and pin it to the server's major
  version.** In Java use the Java API Client: the transport client is gone and
  the high-level REST client was deprecated in 7.15. *[AdvES7 ch. 11, ch. 12;
  ES Docs, Java API Client; Review lessons]*

## Analysis

- **Build analyzers as character filters, one tokenizer, then token filters,
  chosen per field by how users query it; strip HTML first.** Raw markup
  pollutes the index. *[AdvES7 ch. 5; ES-Blueprints ch. 1; ES-Indexing ch. 4]*
- **Use compatible, not necessarily identical, index and search analyzers.**
  Edge n-gram fields index with n-grams but search with a plain analyzer.
  *[ES-Indexing ch. 4; ES-TDG ch. 16]*
- **Pin custom analyzers with `_analyze` assertions in tests on real samples.**
  Stemmers, synonyms, and phonetic filters emit surprising tokens.
  *[ES-Blueprints ch. 6; ES-TDG ch. 6, ch. 23]*
- **Fold accents and normalize Unicode on loosely typed text, keeping an
  unfolded field for precision.** *[ES-Indexing ch. 4; ES-TDG ch. 20]*
- **Keep each language in its own field or index with its own analyzer; take a
  query's language from UI locale, not detection.** Mixed languages distort
  stems and IDF. *[ES-TDG ch. 18]*
- **Start with the recommended stemmer and protect specific words with keyword
  markers; prefer dictionary stemmers only when false matches cost more than
  latency.** *[ES-TDG ch. 21; ES-Blueprints ch. 6]*
- **Own the synonym list, apply it at search time with `synonym_graph` from a
  reloadable set, and keep an unsynonymized field.** Index-time synonyms bloat
  the index and need a reindex to change. *[ES-Blueprints ch. 6;
  ES-Indexing ch. 8; ES-TDG ch. 23]*

## Relevance tuning

- **Instrument before tuning: click-through on top results, reformulations, and
  bounce-backs; change one thing at a time.** Simple queries give most of the
  quality. *[ES-TDG ch. 17]*
- **Diagnose scores with `explain`, `_validate?explain`, and the Profile API.**
  *[AdvES7 ch. 6; ES-Blueprints ch. 3; ES-TDG ch. 7]*
- **Judge relevance on realistic volumes or one primary shard; never add DFS to
  production queries.** IDF is per shard. *[ES-TDG ch. 13]*
- **Blend popularity, recency, or distance with `function_score`, a damping
  modifier such as `log1p`, and `max_boost`, on comparable scales.** Sorting by
  the signal or a raw multiplier swamps text relevance. *[ES-TDG ch. 17;
  ES-Blueprints ch. 3; AdvES7 ch. 6]*
- **Add phrase, proximity, and synonym matches as optional `should` signals over
  a broad `must`, and demote with a `boosting` query rather than excluding.**
  *[ES-TDG ch. 15; ES-Blueprints ch. 3; ES-Indexing ch. 8]*
- **Apply expensive scoring only to top hits with `rescore`.** *[AdvES7 ch. 6;
  ES-TDG ch. 15]*
- **Seed `random_score` with a field and the user's session, and set
  `preference` to the session id.** Order then stays stable across pages and
  replicas. *[ES-TDG ch. 9, ch. 17; ES-Blueprints ch. 3]*

## Pagination, autocomplete, and highlighting

- **Compute `from = (page - 1) * size` and cap page depth below
  `max_result_window`.** Deep pagers are usually bots. *[ES-Blueprints ch. 1;
  ES-TDG ch. 9]*
- **Use PIT plus `search_after` for consistent or deep paging and exports, never
  combine it with `from`, and close the PIT when done.** Use scroll only in
  legacy export code, and clear it. *[AdvES7 ch. 6; ES-Blueprints ch. 2]*
- **Build autocomplete from a completion field (always passing contexts when
  defined), `search_as_you_type`, or index-only edge n-grams; never prefix
  queries per keystroke.** *[AdvES7 ch. 6; ES-Blueprints ch. 2, ch. 6;
  ES-Indexing ch. 8; ES-TDG ch. 16]*
- **Debounce search-as-you-type and drop stale responses with a request id or
  abort signal.** *[Review lessons]*
- **Return highlight fragments with explicit size and count instead of whole
  bodies.** *[ES-Blueprints ch. 1; AdvES7 ch. 6]*

## Aggregations and facets

- **Send `size: 0` when only buckets are needed and bound analytics queries,
  usually by time range.** *[ES-Blueprints ch. 2, ch. 5]*
- **Aggregate only on doc-values fields (keyword, numeric, date), never on text
  or n-grammed fields.** *[ES-TDG ch. 34; AdvES7 ch. 4; ES-Blueprints ch. 6]*
- **Place facet filters by UI need: query filters narrow hits and counts, a
  filter aggregation narrows counts, `post_filter` narrows hits only.**
  *[ES-TDG ch. 30; ES-Blueprints ch. 2; AdvES7 ch. 8]*
- **Treat `terms`, `cardinality`, and percentiles as approximate; check
  `doc_count_error_upper_bound` and raise `shard_size` or `precision_threshold`
  when accuracy matters.** *[AdvES7 ch. 8; ES-TDG ch. 32]*
- **Walk every bucket with `composite` and `after_key`, not a huge `terms`
  size.** *[AdvES7 ch. 8]*
- **Cap nested `terms` sizes and use `breadth_first` when buckets far outnumber
  documents per bucket.** *[ES-TDG ch. 34; ES-Blueprints ch. 5]*
- **Pass an explicit `time_zone` to date histograms and ranges, and build bounds
  through the project's single date helper.** Zone-less values are UTC.
  *[Review lessons]*
- **Precompute frequently queried derived values at index time.** Scripts run
  per matching document per request. *[ES-Blueprints ch. 5]*
- **Treat circuit-breaker trips as a query bug; never raise limits to pass.**
  *[ES-TDG ch. 34]*

## Writes, sync, and concurrency

- **Start bulk at about 5-15 MB, grow while throughput improves, then add
  concurrency; end NDJSON with a newline; on 429 resend only rejected items.**
  Enlarging queues hides saturation. *[ES-Indexing ch. 6; ES-TDG ch. 3,
  ch. 44, ch. 46; AdvES7 ch. 3]*
- **Enforce "at most one document per key" with a deterministic `_id` from the
  natural key plus `op_type=create`.** `_id` is the only uniqueness the engine
  enforces. *[AdvES7 ch. 3, ch. 17; Review lessons]*
- **Use `if_seq_no`/`if_primary_term` on read-modify-write and
  `retry_on_conflict` only for commutative changes.** *[ES-TDG ch. 3]*
- **Accept near-real-time visibility: never refresh per write; use
  `refresh=wait_for` only where read-your-write is required.** *[ES-TDG ch. 11]*
- **Leave disk headroom on update-heavy indices and watch the deleted-docs
  ratio in `_cat/segments`.** Updates and deletes are tombstones reclaimed only
  by merges. *[AdvES7 ch. 3; ES-Indexing ch. 6]*
- **Make update-by-query, delete-by-query, and reindex safe to re-run.** They
  stop on the first conflict with no rollback. *[AdvES7 ch. 3]*
- **For one-off bulk loads, set `refresh_interval: -1` and replicas 0, then
  restore both and wait for green.** Prefer auto or time-ordered ids over random
  UUIDs. *[ES-Indexing ch. 6; ES-TDG ch. 46]*
- **Test ingest pipelines with `_simulate`, guard optional fields with
  `ignore_missing` or null-safe conditions, and add `on_failure` handlers.**
  *[AdvES7 ch. 9]*

## Index lifecycle, aliases, and reindexing

- **With one alias over several indices, mark exactly one `is_write_index`.** *[AdvES7 ch. 2]*
- **Create the destination index with mappings before `_reindex`, slice large
  jobs, and re-run for documents changed during the copy.** Reindex copies
  documents only. *[AdvES7 ch. 3; ES-TDG ch. 10]*
- **Fix static settings before creation, and use composable templates for
  shared settings.** Templates affect only new indices. *[AdvES7 ch. 2;
  ES-Blueprints ch. 8]*
- **Store time-series data in data streams under ILM and retire it by dropping
  whole backing indices, never by delete-by-query.** *[ES-Blueprints ch. 8;
  ES-TDG ch. 43; AdvES7 ch. 2]*
- **Force-merge only indices that no longer receive writes, off peak.**
  *[AdvES7 ch. 2; ES-Blueprints ch. 8; ES-Indexing ch. 6; ES-TDG ch. 43]*
- **Change primary counts only by split or shrink by integer factors, after
  blocking writes and reaching green.** *[AdvES7 ch. 2]*
- **Put many small tenants in a shared index with tenant routing and filtering;
  move a large tenant to its own index by alias swap.** *[ES-TDG ch. 43]*

## Cluster sizing and operations

- **Start with one primary, aim for shards of 10-50 GB and under 200 million
  documents, and size by loading one shard on production-like hardware.**
  Oversharding costs every query. *[ES-TDG ch. 43; ES-Indexing ch. 5;
  AdvES7 ch. 2; ES Docs, Size your shards]*
- **Run at least one replica across two data nodes and three master-eligible
  nodes.** Replicas add read capacity, not write capacity. *[ES-Indexing ch. 5;
  ES-TDG ch. 43, ch. 45]*
- **Alert on yellow and red health; in tests block on `wait_for_status`.**
  *[ES-Indexing ch. 5; ES-TDG ch. 44]*
- **Let the node size its heap; never exceed half of RAM or about 31 GB, and
  disable swap.** *[AdvES7 ch. 1; ES-Indexing ch. 6; ES-TDG ch. 45]*
- **Raise open files to about 65,536 and `vm.max_map_count` to 1,048,576, also
  on container hosts.** That is the current advice; the bootstrap check fails
  below the books' 262,144. *[AdvES7 ch. 1, ch. 13;
  ES-Indexing ch. 6; ES-TDG ch. 45; ES Docs, Bootstrap checks]*
- **Set cluster name, node names, external data paths, and seed hosts
  explicitly; set `cluster.initial_master_nodes` only for the first bootstrap,
  then remove it from every node.** Left in, a later misconfiguration can
  bootstrap a second cluster. *[ES-TDG ch. 45; AdvES7 ch. 1; ES Docs, Important Elasticsearch configuration]*
- **Alert on old-GC time, breaker trips, thread-pool rejections, and slowlog
  entries over thresholds you set.** *[ES-TDG ch. 44, ch. 46]*
- **Schedule snapshots with SLM; restore under a new name to verify.** Replicas
  are not backups. *[ES-Indexing ch. 7; ES-TDG ch. 46; ES-Blueprints ch. 8]*
- **Upgrade from the last minor of each major; reindex old indices first.** *[AdvES7 ch. 1]*

## Tensions

- **Elasticsearch as primary store vs derived projection.** House position:
  keep a transactional system of record. ES-only storage suits logs and
  regenerable data. *[AdvES7 ch. 1; ES-TDG ch. 40]*
- **Identical vs compatible analyzers.** House position: compatible; differ
  deliberately for edge n-grams and search-time synonyms. *[ES-Indexing ch. 4;
  ES-TDG ch. 16, ch. 23]*
- **Index-time vs search-time synonyms.** House position: search-time
  `synonym_graph` from a reloadable set; index-time expansion only when
  measured query cost demands it. *[ES-TDG ch. 23; ES-Blueprints ch. 6]*
- **Nested vs join.** House position: denormalize, then nested; `join` only
  when children are many and change independently. *[AdvES7 ch. 7;
  ES-Blueprints ch. 4; ES-TDG ch. 41, ch. 42]*
- **Default shard counts vs measured sizing.** House position: measure; the
  old five-primary default is obsolete. *[ES-Blueprints ch. 1; ES-TDG ch. 43]*
- **Per-tenant filtered aliases vs "aliases are not security".** House
  position: use routed aliases for placement, and enforce tenancy in the
  query builder or document-level security. *[ES-TDG ch. 43; AdvES7 ch. 2;
  Review lessons]*
- **Ingest speed vs search quality.** House position: apply refresh-off,
  norms-off, and reduced `index_options` per field and per phase, and revert.
  *[ES-Indexing ch. 6; ES-TDG ch. 46]*

## Sources

- **AdvES7**: Advanced Elasticsearch 7.0 (Wai Tak Wong, Packt, 1st ed., 2019)
- **ES-Blueprints**: Elasticsearch Blueprints (Vineeth Mohan, Packt, 1st ed., 2015)
- **ES-Indexing**: Elasticsearch Indexing (Huseyin Akdogan, Packt, 1st ed., 2015)
- **ES-TDG**: Elasticsearch: The Definitive Guide (Clinton Gormley and Zachary Tong, O'Reilly, 2015)
- **ES Docs**: Elastic documentation, current release (pages: Bootstrap
  checks; Important Elasticsearch configuration; Size your shards; Automatic
  security setup; Java API Client), <https://www.elastic.co/docs/>
- **Review lessons**: rules distilled from the maintainer's code-review findings
