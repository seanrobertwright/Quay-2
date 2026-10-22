# Apache Kafka

> **Load when:** writing, reviewing, or configuring Kafka producers, consumers, topics, Kafka
> Streams topologies, ksqlDB queries, Kafka Connect pipelines, or schema-registry serdes;
> choosing keys, partition counts, retention, compaction, acks, offset commits, or
> exactly-once settings; tuning, benchmarking, securing, monitoring, or upgrading a Kafka
> cluster; or debugging lost, duplicated, reordered, or lagging messages.
> **See also:** [Event-driven architecture and messaging](../architecture/event-driven-and-messaging.md),
> [Distributed systems](../distributed/distributed-systems.md), [Testing](../testing/testing.md),
> [Observability and reliability](../operations/observability-and-reliability.md),
> [Application and API security](../security/application-security.md), [Java](../languages/java.md),
> [Performance and load testing](../testing/performance-and-load-testing.md), [Kubernetes](../devops/kubernetes.md)

Architecture choices (commands vs events, outbox and CDC, sagas, schema governance) live in
the event-driven sibling; this file covers building them on KRaft-mode Kafka 3.x and 4.x.
"(updated)" marks advice changed for current Kafka. Whitepaper citations shorten sections:
"Durability" = "Optimizing for Durability"; "Monitoring" = "Benchmarking, Monitoring, ...".

## Top rules

1. **Key every record by the entity whose events must stay ordered or be processed
   together, and keep that key fixed for the entity's life.** Kafka orders only within a
   partition; null keys scatter related events. *[KiA ch. 4, 7; Learning Kafka ch. 4;
   MKSK ch. 1; DEDS ch. 4, 15]*
2. **For data that must not be lost, use `acks=all`, idempotence on, replication factor 3,
   and `min.insync.replicas=2` on the topic.** `acks=all` waits only for the current ISR,
   which can shrink to the leader; `min.insync.replicas` still defaults to 1. *[Kafka-BP
   Durability; Optimizing Kafka Durability; DEDS ch. 4]* (updated: `acks=all` and
   idempotence are producer defaults since 3.0)
3. **Commit offsets only after processing finishes, with auto-commit off for
   must-not-lose flows.** Auto-commit can mark fetched-but-unprocessed records done, and a
   crash then skips them silently. *[KiA ch. 5; Kafka-BP Durability; Learning Kafka ch. 5;
   Optimizing Kafka Durability]*
4. **Treat delivery as at-least-once and make every side effect idempotent, enforced in
   the sink.** Use a unique index, upsert, or `ON CONFLICT` on a business key; an
   in-memory "seen" set is not enforcement. *[KiA ch. 5; Learning Kafka ch. 3; DEDS ch. 12;
   Review lessons]*
5. **Create topics explicitly with reviewed partitions, replication, and config; disable
   `auto.create.topics.enable` in production.** A typo otherwise creates a silent
   one-partition, one-replica topic. *[KiA ch. 7; Kafka-BP Topic Management; Learning Kafka
   ch. 2; Optimizing Kafka Durability]*
6. **Size partitions from measured throughput and the most consumers or stream tasks you
   will ever run, and never plan to change the count in place.** Counts cannot shrink, and
   adding partitions remaps keys, breaking order and co-partitioning. *[KiA ch. 5, 7;
   Kafka-BP Throughput; Learning Kafka ch. 7; MKSK ch. 1-2]*
7. **Give every payload a registered schema (Avro, Protobuf, or JSON Schema) with an
   enforced compatibility mode, checked in CI.** Kafka stores bytes and validates nothing;
   the schema is the contract with consumers you may not know. *[KiA ch. 3, 11; Kafka-BP
   Schema Registry and Avro; MKSK ch. 3; DEDS ch. 13]*
8. **Decide the poison-record policy before the first bad record arrives.** Configure the
   deserialization and production exception handlers or a dead-letter topic, logging topic,
   partition, and offset; one bad record must neither stall a partition nor vanish.
   *[MKSK ch. 3, 7, App. A; DEDS ch. 13]*
9. **Rely on exactly-once only inside Kafka.** Transactions and Streams `exactly_once_v2`
   cover topic-to-topic work; database, HTTP, and email effects still need their own
   idempotency. *[KiA ch. 2, 12; DEDS ch. 12; Kafka-BP Durability]*
10. **Alert from day one on sustained consumer-lag growth and on any under-replicated or
    under-min-ISR partition.** Kafka does not re-create lost replicas by itself. *[KiA ch.
    6, 9; Kafka-BP Monitoring; Optimizing Kafka Monitoring; MKSK ch. 12]*

## Producers

- **Handle every send result with the returned future or a callback that logs and counts
  failures, and flush and close the producer on shutdown.** Buffered records die with the
  process. *[KiA ch. 4; Learning Kafka ch. 4]*
- **Keep send callbacks short and non-blocking.** They run on the single I/O thread; low
  `io-ratio` plus low `io-wait-ratio` means user code is starving sends. *[Kafka-BP
  Producers; Optimizing Kafka Monitoring]*
- **Never use `acks=0` or `acks=1` for business data.** `acks=0` confirms nothing; `acks=1`
  loses acknowledged writes when the leader dies early and turns idempotence off. Reserve
  them for measured, loss-tolerant telemetry topics. *[KiA ch. 4; Kafka-BP Latency;
  Learning Kafka ch. 4; Optimizing Kafka Latency]* (updated: the whitepapers suggest
  `acks=1` for speed; current practice gets throughput from batching instead)
- **Verify idempotence is in effect, and keep it on rather than dropping to one in-flight
  request for ordering.** Explicit `acks=1`, `retries=0`, or more than 5 in flight disable
  or conflict with it; with it, order holds for up to 5 in flight. *[KiA ch. 4; Kafka-BP
  Durability; Optimizing Kafka Durability; DEDS ch. 4]* (updated)
- **Bound delivery with `delivery.timeout.ms` set to how long the message stays useful,
  and leave retries effectively unlimited inside it.** *[Kafka-BP Durability; Optimizing
  Kafka Durability]*
- **Treat a send error as an unknown outcome, and never hand-roll resends over an
  idempotent producer.** The write may have committed; a manual resend gets a new sequence
  number the broker cannot dedupe. *[Learning Kafka ch. 3; Kafka-BP Durability; Optimizing
  Kafka Durability]*
- **Catch the producer's fatal errors, then close, recreate, and alert.** After a fatal
  idempotence or authorization error it refuses every further send. *[Kafka-BP
  Durability; Optimizing Kafka Durability]*
- **Size `buffer.memory` for producers that write many partitions.** A full buffer blocks
  `send()` for up to `max.block.ms`, which looks like a hang. *[Kafka-BP Throughput;
  Optimizing Kafka Throughput]*
- **Never update a database and produce an event as two independent steps.** Use an
  outbox, CDC, or a Kafka-backed state store in a transaction; the event-driven sibling
  covers the choice. *[DEDS ch. 7, 12]*
- **Send a reference instead of a large blob.** Messages near the roughly 1 MB default
  strain memory and page cache. *[KiA ch. 1]*

## Consumers and offsets

- **Commit the next offset to read (processed + 1), synchronously where consistency
  matters, asynchronously with a logging callback where latency matters.** *[KiA ch. 5]*
- **Give each independent application its own stable, configured `group.id`, shared only
  by its instances; never join a live group for an ad hoc test.** Unrelated members split
  the data, a random id loses the saved position, and a newcomer steals partitions.
  *[KiA ch. 5; Learning Kafka ch. 3, 5, 6]*
- **Set `auto.offset.reset` deliberately for every new group.** The default `latest`
  silently skips everything already in the topic. *[KiA ch. 5; Learning Kafka ch. 5]*
- **Keep poll-loop work bounded.** Lower `max.poll.records` or raise `max.poll.interval.ms`
  when a batch can be slow; slow handlers and GC pauses cause rebalance storms. *[Kafka-BP
  Availability; Optimizing Kafka Availability]* (updated: `session.timeout.ms` is 45 s
  since 3.0; on 4.x, evaluate `group.protocol=consumer`, where the broker owns timeouts
  and rebalances are incremental)
- **Shut down cleanly: set a stop flag, call `wakeup()` from another thread, and `close()`
  in `finally`.** A killed consumer holds partitions until its session expires, then
  replays. *[KiA ch. 5; Learning Kafka ch. 5]*
- **Run at least two instances of every consumer service in one group.** Assignment gives
  failover, and per-key order survives rolling restarts. *[DEDS ch. 4]*
- **On compacted topics, expect several values per key and treat a null value as a
  delete.** Compaction is asynchronous and tombstones arrive like other records. *[KiA ch.
  5, 7; DEDS ch. 4]*
- **Carry the tenant id in multi-tenant events and in every WHERE clause the handler
  issues.** A unique entity id alone lets a bad or replayed event touch another tenant.
  *[Review lessons]*
- **Give outbound HTTP calls from a handler a timeout, and disable redirects when they
  carry a token.** A hung call stalls the partition past the poll interval. *[Review
  lessons]*

## Keys, partitions, and topics

- **Design keys to spread load evenly, and watch partition sizes for hot keys.** Skew caps
  throughput at the hottest partition; more partitions do not help. Use one partition only
  when global order is required. *[KiA ch. 1, 4; Kafka-BP Throughput; DEDS ch. 4]*
- **Use per-key partitioning instead of distributed locks for read-check-update logic.**
  Keyed by account, a balance check before a debit runs in one task, race-free. *[KiA ch.
  12; DEDS ch. 15]*
- **When ordering and erasure need different ids, use a composite key and a partitioner
  that hashes only the ordering part.** A tombstone on the composite key then erases one
  person's data. *[DEDS ch. 13]*
- **Write a custom partitioner only for a real routing need; make it deterministic, total,
  never throwing, documented in the topic contract, and integration-tested.** *[KiA ch. 4,
  7; Learning Kafka ch. 4]*
- **To change a keyed topic's partition count, create a new topic and migrate.** *[MKSK
  ch. 2]*
- **Set replication factor 3 explicitly on every topic, including internal ones (offsets,
  transaction log, Streams changelog and repartition, ksqlDB internal), with the broker
  default at 3 as a backstop.** *[Kafka-BP Topic Management; Optimizing Kafka Durability;
  MKSK ch. 1, App. A-B]* (updated: Streams `replication.factor` inherits the broker since
  3.0)
- **Split topics by event type and consumer interest, not one firehose.** No consumer
  should discard most of what it reads, and each topic gets its own partitions and
  retention. *[KiA ch. 7; Learning Kafka ch. 1]*
- **Use a compacted topic for latest-value-per-key state and delete retention for
  history; derive the compacted one from the history topic when both are needed.** *[KiA
  ch. 7-8; Learning Kafka ch. 3; DEDS ch. 4]*
- **Set retention per topic from the replay window the business needs; it is the recovery
  SLA for logic bugs.** The 7-day default is arbitrary. *[KiA ch. 8; Learning Kafka ch. 3]*
  (updated: tiered storage is production-ready since 3.9 for long retention)
- **Set per-topic overrides for goals one topic needs, and broker settings only for goals
  every topic shares.** A durable topic and a loss-tolerant telemetry topic can then share
  a cluster. *[Optimizing Kafka Introduction]*
- **Name topics with letters, digits, dots, underscores, or hyphens only, under 249
  characters.** *[KiA ch. 2, 7]* (updated: also never mix dots and underscores in one
  name; Kafka's topic tool warns that they collide in metric names)
- **Restrict internal topics with ACLs, and give each entity topic a single writer while
  others write requests to a command topic.** Convention alone lets teams couple to
  internals. *[DEDS ch. 11, 13]*

## Schemas and serialization

- **Pair key and value serdes explicitly and agree them across teams; never use
  language-native serialization between services.** *[KiA ch. 4-5; DEDS ch. 13]*
- **Add fields with defaults; treat moving or removing a field as breaking.** *[KiA ch.
  11; DEDS ch. 13]*
- **Match rollout order to the compatibility mode: BACKWARD upgrades consumers first,
  FORWARD producers first; use transitive modes when consumers replay old data.** *[KiA
  ch. 11]*
- **Ship a breaking change on a new topic with a dual-schema window, back-populating
  history with a stream job when consumers replay.** *[KiA ch. 11; DEDS ch. 13]*
- **Deserialize into a projection holding only the fields the handler uses.** Smaller
  records cut memory, state size, and breakage from upstream changes. *[MKSK ch. 3; DEDS
  ch. 10]*
- **Store event timestamps as UTC epoch values and parse them through the project's one
  date helper.** Never read a zone-less timestamp as process-local time. *[Review lessons]*

## Exactly-once and transactions

- **For consume-process-produce, commit offsets with `sendOffsetsToTransaction`, and set
  downstream consumers to `isolation.level=read_committed`.** Consumer-side commits break
  atomicity; other readers see aborted data. *[Kafka-BP Durability; Optimizing Kafka
  Durability; DEDS ch. 12]*
- **Commit transactions per batch or interval, not per message.** Per-message commits
  multiply the transaction overhead. *[DEDS ch. 12]*
- **Prefer transactions for derived streams without natural keys; use business-key dedup
  at the edges.** *[DEDS ch. 12]*
- **For external sinks, store the consumer offset in the same transaction as the output.**
  *[Learning Kafka ch. 3, 6]*
- **Claim "exactly-once" in a docstring or PR only when config and every sink deliver
  it.** *[Review lessons]*

## Kafka Streams and ksqlDB

- **Use the DSL; embed Processor API steps only for headers, punctuation, forwarding
  control, or direct state access.** *[KiA ch. 12; MKSK ch. 7]* (updated: use
  `process()`/`processValues()`; `transform()` and the old Processor API were deprecated
  in 3.3 and removed in 4.0)
- **Choose `processing.guarantee` per application: `exactly_once_v2` when duplicates
  corrupt results.** *[Kafka-BP Durability; MKSK App. A]* (updated: `exactly_once` is
  removed in 4.0)
- **Tune the embedded clients through the Streams producer and consumer config
  prefixes, and set `topology.optimization=all`.** *[Kafka-BP Throughput; Optimizing
  Kafka Latency; MKSK App. A]*
- **Filter before any key change, and prefer `mapValues`/`groupByKey` when the key stays.**
  Key-changing operators add a hidden repartition topic; flag each in review. *[MKSK ch.
  3-5]*
- **Check co-partitioning before every join: same key, partitioner, and partition count.**
  Only the count is checked at startup. *[MKSK ch. 4, 11; DEDS ch. 14-15]*
- **Use a GlobalKTable only for small, static reference data, and replace per-record
  remote lookups with a local join on a CDC-fed table.** *[KiA ch. 12; MKSK ch. 4;
  Kafka-BP Latency]*
- **Supply a subtractor when aggregating a KTable.** Without one, updated or deleted rows
  never leave the aggregate. *[MKSK ch. 4]*
- **Pick event-time semantics deliberately and define the extractor's behaviour for
  missing timestamps.** `LogAppendTime` silently turns event time into ingest time. *[KiA
  ch. 4; MKSK ch. 5]*
- **Set an explicit grace on every window, sized to measured lateness, and window
  retention just above size plus grace.** *[MKSK ch. 5-6, 11]* (updated: use
  `ofSizeAndGrace`)
- **Treat each windowed emission as a partial update; suppress until close only when
  consumers need finals, with a bounded buffer.** *[MKSK ch. 5]*
- **Bound every state store with tombstones, window retention, or TTL punctuation, and ask
  what happens at ten million keys.** *[MKSK ch. 6-7; Review lessons]*
- **Start with named, change-logged RocksDB stores, `state.dir` outside /tmp, and every
  iterator closed with try-with-resources.** *[MKSK ch. 4-6, App. A]*
- **Set `num.standby.replicas` to at least 1 for meaningful state, with cooperative
  rebalancing and static membership for often-bounced instances.** *[Kafka-BP
  Availability; MKSK ch. 6; DEDS ch. 6]*
- **Route interactive queries by key metadata via a reachable `application.server`,
  falling back to standbys.** *[MKSK ch. 4, 6]*
- **Reset only after every instance is stopped and the group is Empty, then wipe local
  state.** *[MKSK ch. 12]*
- **Use ksqlDB only for naturally SQL logic, headless in production from versioned query
  files; never `DROP ... DELETE TOPIC` by accident.** *[MKSK ch. 8, 10, 12]* (updated:
  confirm ksqlDB is still supported before starting a new project on it)

## Performance tuning and benchmarking

- **Write down each topic's service goal (throughput, latency, durability, availability)
  before changing configs.** *[Kafka-BP Service Goals; Optimizing Kafka Introduction]*
- **Benchmark defaults first, then change one parameter at a time.** *[Kafka-BP
  Benchmarking; Optimizing Kafka Benchmarking; Intel Kafka Benchmarks 1]*
- **Report sustained throughput and p99 end-to-end latency together, as the median of
  three or more runs, with the full configuration recorded.** *[Intel Kafka Benchmarks KPI;
  Process/Methodology]*
- **Benchmark at RF 3 with `acks=all`, realistic payloads, and separate load nodes.** *[Kafka-BP
  Benchmarking; Intel Kafka Benchmarks Process/Methodology]*
- **For throughput, raise `batch.size` and `linger.ms` together and use lz4 or zstd, not
  gzip; keep topic `compression.type` at `producer`.** *[Kafka-BP Throughput; Optimizing
  Kafka Throughput; Learning Kafka ch. 3]*
- **For consumer throughput raise `fetch.min.bytes`; for low latency keep it at 1 and
  linger short.** *[Kafka-BP Throughput; Latency]* (updated: `linger.ms` defaults to 5
  since 4.0)
- **Benchmark with TLS on and off, on a supported LTS JDK.** TLS costs CPU and p99.
  *[Intel Kafka Benchmarks 1.2, 3]* (updated: Kafka 4.x brokers need Java 17 or later,
  clients 11 or later)
- **Rely on replication, not forced fsync, for durability.** *[Optimizing Kafka
  Durability; DEDS ch. 4]*

## Testing

- **Unit-test with `MockProducer`, `MockConsumer`, `TopologyTestDriver`, and a mock
  registry; integration-test partitioners, serdes, and config against a real broker in
  Testcontainers.** *[KiA App. B; Kafka-BP Optimizations and Tuning; MKSK ch. 12]*
- **Assert topology outputs as lists for streams and as maps (latest value per key) for
  tables.** *[MKSK ch. 12]*
- **Extract lambda bodies into named, tested methods; test ksqlDB with
  `ksql-test-runner`.** *[MKSK ch. 12]*
- **Test the replay path: rerun a consumer from an earlier offset over handled records
  and assert the sink state is unchanged.** *[KiA ch. 3; DEDS ch. 7]*

## Security

- **Design TLS, SASL, and least-privilege ACLs from the start, one service account per
  application and never a personal or super-user key; migrate via a second secure
  listener.** *[KiA ch. 10; Kafka-BP Security; DEDS ch. 4]*
- **Keep credentials out of source; protect keystores and keytabs (0600) or use a secret
  manager, and run a secret scan in pre-commit.** *[KiA ch. 10; Kafka-BP Connecting to a
  Cluster; Review lessons]*
- **Encrypt data at rest with volume encryption or payload encryption in the serializer.**
  Brokers write log segments in plaintext; TLS covers only transit. *[KiA ch. 10; Intel
  Kafka Benchmarks Overview]*
- **Apply bandwidth and request-rate quotas per client on shared clusters.** *[KiA ch.
  10; DEDS ch. 4]*
- **Before retaining personal data indefinitely, map each person to every key holding
  their data and erase by compacted-topic tombstone or crypto-shredding.** *[DEDS ch. 13]*

## Operations and monitoring

- **List several brokers in `bootstrap.servers` and parse client config at startup,
  rejecting empty or non-numeric values.** *[KiA ch. 4; MKSK App. A; Review lessons]*
- **When clients bootstrap then fail, check `advertised.listeners`.** *[KiA ch. 9]*
- **Never enable unclean leader election on topics whose data matters, and set
  `broker.rack`.** *[KiA ch. 6; Optimizing Kafka Durability]*
- **Upgrade by rolling restarts, one node at a time.** *[KiA ch. 6; Learning Kafka ch. 7]*
  (updated: in KRaft, roll controllers one at a time, then finalize with `kafka-features.sh
  upgrade`; ZooKeeper clusters must migrate to KRaft on 3.x before 4.x)
- **After adding a broker, reassign partitions with a throttle.** *[KiA ch. 6; Learning
  Kafka ch. 7]*
- **Back up by replicating to a second cluster with MirrorMaker 2 and a topic allowlist,
  never by copying partition directories.** *[KiA ch. 6; Learning Kafka ch. 7]*
- **On Kubernetes, use StatefulSets with persistent volumes for brokers and stateful
  apps.** *[KiA ch. 6, 8; MKSK ch. 12]*
- **Collect client-side metrics and alert on throttle time.** Broker metrics cannot show
  per-client throttling or lag. *[Kafka-BP Monitoring]*
- **After fixing a client bug, grep for every producer and consumer with the same config
  or pattern and fix them in the same change.** *[Review lessons]*

## Tensions

- **Auto-commit "good enough" vs commit after processing.** Kafka-BP calls auto-commit
  fine for most cases. This library commits explicitly after processing for any flow that
  must not lose data. *[Kafka-BP Durability; KiA ch. 5; Learning Kafka ch. 5]*
- **Exactly-once everywhere vs idempotent edges.** DEDS argues transactions make consumer
  idempotence unnecessary. House position: transactions inside the Kafka graph,
  idempotent effects at every external boundary. *[DEDS ch. 12; KiA ch. 2]*
- **At-least-once vs exactly-once as the Streams default.** Choose per application;
  default to `exactly_once_v2` for money and counts. *[MKSK App. A; Kafka-BP Durability]*
- **Add partitions in place vs migrate.** Migrate for keyed or stateful topics; add in
  place only for unkeyed ones. *[MKSK ch. 2; Learning Kafka ch. 7]*
- **Kafka as event store vs distribution layer.** DEDS treats Kafka as the source of
  truth; Kafka lacks per-entity expected-version appends, so use an event store or outbox
  when per-aggregate optimistic concurrency is required. *[DEDS ch. 7, 11]*
- **gzip lowest p99 vs gzip slowest.** One vendor benchmark found gzip had the lowest
  p99. Default to lz4 or zstd and benchmark on real payloads. *[Intel Kafka Benchmarks 4.1;
  Kafka-BP Throughput]*
- **Persistent vs in-memory state stores.** Start persistent; use in-memory only after
  measuring and with standbys. *[MKSK ch. 4]*

## Sources

- **KiA**: Kafka in Action (Dylan Scott, Viktor Gamov, Dave Klein; Manning, 1st edition, 2022)
- **Kafka-BP**: Best Practices for Developing Apache Kafka Applications on Confluent Cloud
  (Yeva Byzek, Confluent white paper, 2020)
- **Optimizing Kafka**: Optimizing Your Apache Kafka Deployment: Levers for Throughput,
  Latency, Durability, and Availability (Yeva Byzek, Confluent white paper, 2020)
- **Intel Kafka Benchmarks**: A Guide to Kafka Optimizations and Benchmarks (Debashis
  Paul, Roberto Baturoni; Intel white paper, 2022)
- **Learning Kafka**: Learning Apache Kafka (Nishant Garg, Packt, 2nd edition, 2015)
- **MKSK**: Mastering Kafka Streams and ksqlDB (Mitch Seymour, O'Reilly, 1st edition, 2021)
- **DEDS**: Designing Event-Driven Systems (Ben Stopford, O'Reilly/Confluent, 1st edition,
  2018)
- **Review lessons**: rules distilled from the maintainer's code-review findings
