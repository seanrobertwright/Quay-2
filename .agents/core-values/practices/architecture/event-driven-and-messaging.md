# Event-driven architecture and messaging

> **Load when:** writing or changing code that publishes or consumes messages or events (queues,
> topics, pub/sub, change-data capture, stream processors, webhook or job workers), choosing
> between a synchronous call and messaging, making a consumer idempotent, publishing an event
> alongside a database write (outbox, CDC), designing or evolving a message schema, or handling
> ordering, retries, dead letters, request-reply, sagas, event sourcing, or CQRS read models.
> **See also:** [Apache Kafka](../messaging/kafka.md), [Distributed
> systems](../distributed/distributed-systems.md),
> [Microservices](../architecture/microservices.md),
> [Domain-driven design](../architecture/domain-driven-design.md), [Scalability and system
> design](../architecture/scalability-and-system-design.md), [Relational and analytical data
> modeling](../data/data-modeling.md), [Observability and
> reliability](../operations/observability-and-reliability.md), [Application and API
> security](../security/application-security.md), [Unit, integration, and test-driven
> development](../testing/testing.md), [Concurrency and parallelism](../concurrency/concurrency.md)

## Top rules

1. **Make every consumer idempotent, and enforce it in the database.** At-least-once delivery,
   lost acknowledgements, and crash-before-commit all redeliver; record the message id in a
   unique-keyed table in the same transaction as the effect, or write idempotent state
   assignments ("set to X") instead of increments. *[EIP ch. 10; DDIA ch. 11; KiA ch. 5; DEDS
   ch. 12; Review lessons]*
2. **Never update a database and publish a message as two independent steps.** A crash between
   them loses or duplicates the event and the copies drift; write an outbox row in the same local
   transaction and relay it, or publish the store's change log (CDC). *[DDIA ch. 11; DEDS ch. 7;
   EIP ch. 10]*
3. **Classify each interaction as a command, an event, or a query before picking a protocol.**
   Events are past-tense facts with no expected reply; an "event" the sender needs someone to act
   on is a disguised command and hides coupling. *[DEDS ch. 5; EIP ch. 5]*
4. **Treat the message schema as a public API.** Use an evolvable format (Avro, Protobuf, JSON
   Schema) with a version or format indicator, add fields only with defaults, and fail the build on
   an incompatible change. *[DEDS ch. 13; KiA ch. 11; EIP ch. 5; DDIA ch. 4]*
5. **Parse and validate every message at the consumer boundary, and divert what fails.** A message
   is external input: reject malformed ids, NaN, and out-of-range values, then send unparseable or
   invalid messages to a monitored dead-letter channel; never requeue them forever or drop them
   silently. *[EIP ch. 4; DEDS ch. 13; Review lessons]*
6. **Get ordering from a key, not from luck.** Order exists only within one partition or one
   single-threaded consumer, so key every message by the entity whose updates must stay ordered;
   never rely on a load-balanced queue or on timestamps to reconstruct order. *[DDIA ch. 11; KiA
   ch. 7; DEDS ch. 4; EIP ch. 5]*
7. **Use sagas with compensation for business transactions that span services.** Broker
   transactions cannot undo work another service committed and do not cover HTTP calls or external
   stores; avoid XA two-phase commit across technologies. *[DEDS ch. 12; DDIA ch. 9]*
8. **Carry the tenant id in every message and scope every consumer write by it.** A globally unique
   entity id in the payload is not enough; the handler's update, delete, and dedup key all include
   the tenant column. *[Review lessons]*
9. **Choose messaging only when asynchrony earns its cost.** It brings reordering, duplicates,
   eventual consistency, and harder testing; keep synchronous calls inside one bounded context and
   use events between independently released parts. *[EIP Introduction; DEDS ch. 5, 8]*
10. **Monitor the lag and the error channels from day one.** Alert on consumer lag, dead-letter
    arrivals, and messages-in versus messages-out; indirection makes failures invisible otherwise.
    *[EIP ch. 4, 11; DDIA ch. 1, 11; KiA ch. 9]*

## Choosing the interaction style

- **Before adding a broker, write down the coupling or availability problem it solves and the
  channels it adds.** One logical call can need request, reply, and error channels plus a
  correlation id; stay single-process until that cost pays. *[EIP Introduction; DEDS ch. 8, 15]*
- **Do not integrate independently owned services through a shared database schema.** It couples
  every service to every schema change; share an immutable stream of facts and let each consumer
  build private views. *[EIP ch. 2; DEDS ch. 8, 9]*
- **Pick the broker style to fit the work.** Use a work queue (AMQP, SQS, JMS-style) for
  independent, expensive tasks where order does not matter; use a partitioned log for ordered,
  high-volume streams that need replay or several independent consumers. Kafka share groups
  (KIP-932, added after these books) give queue-style, at-least-once consumption of a topic but
  no ordering across batches, so treat them as a work queue. *[DDIA ch. 11]*
- **Do not use a log-based broker for random lookups, rare batch-only jobs, total order across a
  high-volume stream, or large blobs.** Query a derived view, use a batch tool, or store the blob
  and send a reference. *[KiA ch. 1; DEDS ch. 4]*
- **Use point-to-point for work that must be done once and publish-subscribe for facts every
  interested party needs.** Commands and documents usually go point-to-point; events go to topics.
  *[EIP ch. 4, 5]*
- **Decide per stream whether events notify or transfer state.** Notification keeps one
  authoritative copy and makes consumers call back; event-carried state lets consumers keep fast
  local copies at the cost of managing them; document the choice. *[DEDS ch. 5; EIP ch. 5]*

## Delivery guarantees and duplicates

- **Name the business cost of a lost and of a duplicated message for each flow, then pick the
  guarantee.** At-least-once plus dedup for payments and audit; at-most-once only where losing a
  sample is harmless, such as high-frequency telemetry. *[KiA ch. 1, 3; EIP ch. 4]*
- **Assume "exactly-once" stops at the broker's edge.** Broker transactions cover read-process-write
  inside the broker; any database write, email, payment, or HTTP call downstream is at-least-once
  and needs its own idempotency. *[KiA ch. 2, 12; DDIA ch. 11; DEDS ch. 12]*
- **Deduplicate with a key that survives retries end to end.** Generate a request id at the client,
  carry it through every hop, and enforce uniqueness where the effect is recorded; a stable
  business key works when one exists. *[DDIA ch. 12; DEDS ch. 12]*
- **Keep dedup records at least as long as the sender can redeliver.** A dedup window shorter than
  the retry or replay window lets old duplicates through. *[EIP ch. 10]*
- **Commit the consumer offset or acknowledgement only after the effect is durable.** Auto-ack
  before processing loses messages silently on a crash; acking after a commit means a crash only
  causes a duplicate, which the idempotent handler absorbs. *[EIP ch. 10; KiA ch. 5]*
- **Never give one field two meanings.** Keep message id, correlation id, sequence number, and
  business keys separate, so that allowing amendments to an order does not break dedup. *[EIP
  ch. 7, 10]*
- **Keep external side effects out of retried blocks.** An email sent inside a transaction that
  retries goes out once per attempt; emit it from a separate idempotent step. *[DDIA ch. 7]*

A minimal inbox check, enforced by the database rather than by in-process memory:

```sql
-- same transaction as the handler's effect
INSERT INTO processed_messages (tenant_id, message_id) VALUES ($1, $2)
ON CONFLICT DO NOTHING;  -- zero rows inserted: duplicate, skip the effect
```

## Publishing reliably

- **Write the event to an outbox table in the same transaction as the state change.** A relay or
  CDC connector publishes the rows after commit; this replaces XA across a database and a broker.
  *[DDIA ch. 11; DEDS ch. 7; EIP ch. 10]*
- **Never dual-write from application code to a database and a cache, search index, or
  warehouse.** Make one store the system of record and derive the rest from its ordered change log;
  bootstrap a new view from a snapshot tied to a log position, then follow the stream. *[DDIA
  ch. 11, 12]*
- **Use CDC on a legacy database as the seam for incremental migration.** It exposes changes
  without touching legacy code, catches every change that polling would miss, and needs a cleanup
  stage before other services consume it. *[DEDS ch. 7; KiA ch. 3, 8]*
- **Land raw external events in the log before transforming them.** With the original retained,
  a bug in parsing or enrichment is fixed by correcting the code and replaying. *[KiA ch. 3, 8;
  DEDS ch. 7]*
- **Never send a request and wait for its reply inside the same transaction.** The request is not
  sent until commit, so the reply can never arrive. *[EIP ch. 10]*

## Ordering, partitioning, and concurrency

- **Keep mutually ordered events on one key, topic, and partition.** Re-sequencing across topics
  by timestamp in the consumer is error-prone. *[KiA ch. 7; DDIA ch. 11; DEDS ch. 4]*
- **Serialize per-entity logic by partition instead of distributed locks.** Routing every write that
  could conflict (a username, a seat, an account balance) to one partition and one single-threaded
  processor makes check-then-act race-free and scales with partitions. *[DDIA ch. 12; KiA ch. 12;
  DEDS ch. 15]*
- **Assign one writer service per entity type, or at least per state transition.** One owner keeps
  validation, versioning, and schema rollout in one place and removes write collisions. *[DEDS
  ch. 11]*
- **Give mutable entities a version and reject writes based on a stale version.** Optimistic
  concurrency works the same in synchronous and asynchronous flows. *[DEDS ch. 11]*
- **Replace multi-partition atomic commit with one logged request plus deterministic fan-out.**
  Append the whole request with its client request id, derive per-partition instructions from it,
  and dedup downstream by that id. *[DDIA ch. 12]*
- **Never let two services mutate the same entity concurrently without a defined merge.** Serialize
  the steps for money-handling flows; use commutative, CRDT-style operations only where a merge
  is safe. *[DEDS ch. 11; DDIA ch. 5]*
- **Break publish-subscribe feedback loops with a message history or origin header.** A service
  that subscribes to its own change events will otherwise re-apply and republish forever. *[EIP
  ch. 11]*

## Failures, retries, and flow control

- **Separate messages the consumer cannot understand from business-rule failures.** Unparseable or
  schema-invalid messages go to an invalid-message or dead-letter channel; a valid command that
  breaks a rule goes through normal error handling and, where needed, a reply. *[EIP ch. 4; DEDS
  ch. 13]*
- **Keep processing after a poison message.** One corrupt record must not stall its partition;
  divert it with the reason, then reprocess the error channel after the fix. *[DEDS ch. 13]*
- **Retry only transient errors, with a bounded count and exponential backoff and jitter.**
  Retrying overload makes it worse and retrying a constraint violation never succeeds. *[DDIA
  ch. 7]*
- **Give every router and dispatcher an explicit default route for unmatched messages.** Without it
  a message that matches no rule vanishes; send it to the invalid-message channel. *[EIP ch. 7, 10]*
- **Set a relative time-to-live on messages whose value decays, and give requestors a timeout
  path.** A stale quote can be worse than none, and an expired request leaves the sender unable to
  tell whether it was received. *[EIP ch. 5]*
- **Take timestamps in UTC from the project's one date helper, never from the consumer's local
  clock.** Comparing a producer's wall-clock time with a consumer's clock produces skew bugs.
  *[EIP ch. 5; DDIA ch. 8; Review lessons]*
- **Decide what happens when producers outpace consumers: drop, buffer to a known bound, or apply
  backpressure.** A log consumer that falls behind retention loses data without any error. *[DDIA
  ch. 11; EIP ch. 10]*
- **Bound every piece of state a stateful component keeps.** Aggregators purge closed-aggregate
  lists on a schedule and resequencers cap their buffers; ask what happens at ten thousand stuck
  entries. *[EIP ch. 7; Review lessons]*

## Schemas and contracts

- **Store schemas in a registry or repository, not in a README.** The broker validates nothing, and
  you often do not know every consumer of a topic. *[KiA ch. 3, 11; DEDS ch. 13]*
- **Never use language-native serialization between independently deployed services.** It blocks
  other languages, versions poorly, and decoding untrusted bytes can execute code. *[DEDS ch. 13;
  DDIA ch. 4]*
- **Evolve additively: new fields are optional with defaults; moving or removing a field is
  breaking.** To move a field, carry it in both places until a breaking release. *[DEDS ch. 13; KiA
  ch. 11; DDIA ch. 4]*
- **Choose the compatibility mode on purpose and roll out in its order.** Backward means upgrade
  consumers first, forward means upgrade producers first; use transitive modes when consumers may
  replay old data. *[KiA ch. 11]*
- **Check compatibility in CI before a producer deploys.** A breaking change then fails the build
  instead of a consumer in production. *[KiA ch. 11; Review lessons]*
- **Ship a breaking change on a new topic or channel with an upgrade window.** Run old and new side
  by side until consumers migrate, and up-convert history with a stream job when it must be
  replayed. *[KiA ch. 11; DEDS ch. 13]*
- **Preserve unknown fields when a consumer re-encodes and republishes a message.** Decoding into a
  fixed model and writing it back deletes fields added by newer producers. *[DDIA ch. 4]*
- **Give each bounded context its own published language and translate at the edges.** Use
  layered translators instead of bending one service to another's internal format. *[EIP ch. 3;
  DEDS ch. 5]*
- **Make docs and docstrings match the delivery semantics actually implemented.** A comment that
  promises "exactly once", "in order", or "never twice" must name the mechanism that enforces it.
  *[Review lessons]*

## Message and channel design

- **Put a standard envelope on every message.** Message id, type and schema version, occurred-at
  time in UTC, tenant id, entity id, correlation id, and causation id belong in headers, not mixed
  into the business body. *[EIP ch. 5, 11; Review lessons]*
- **Record what you received: whole facts as whole facts, deltas as deltas.** Do not inflate a
  partial event by looking up state, and do not split a whole fact into sub-events; combine on
  read. *[DEDS ch. 7]*
- **Do not broadcast a mutable document to several consumers.** Publish-subscribe makes copies that
  will diverge unless they are read-only. *[EIP ch. 5]*
- **For large payloads, store the data and send a claim-check reference.** Decide how the stored
  blob is cleaned up: on read, by expiry, or kept in a system of record. *[EIP ch. 8; KiA ch. 1]*
- **Carry one data type per channel and keep channels one-way.** Mixed types confuse receivers, and
  a component reading and writing one channel consumes its own output. *[EIP ch. 4, 5]*
- **Split topics by consumer interest and volume.** A consumer should not discard most of a
  firehose to find its few messages. *[KiA ch. 7]*
- **Provision channels at deploy time with a hierarchical naming scheme.** Name by domain, entity,
  and purpose, create them through reviewed config, and disable ad hoc auto-creation so a typo
  cannot spawn a channel. *[EIP ch. 3, 4; KiA ch. 7]*

## Endpoint code structure

- **Hide the messaging API behind a thin gateway with typed domain methods.** Business logic then
  tests without a broker and the transport can change. *[EIP ch. 10]*
- **Expose one service implementation through an adapter per transport.** A message listener and an
  HTTP handler call the same service; duplicated implementations drift. *[EIP ch. 10]*
- **Keep the broker a dumb pipe.** Schemas, business logic, and transformation stay with the owning
  service, not in a central bus. *[DEDS ch. 3, 11]*
- **After fixing a handler bug, sweep every sibling handler for the same pattern.** Missing dedup,
  missing tenant scope, and early acks usually repeat across all consumers. *[Review lessons]*

## Request-reply and correlation

- **Put a return address in each request instead of hard-coding the reply destination.** The
  requestor chooses where replies land, so one replier serves many requestors. *[EIP ch. 5]*
- **Correlate replies by a unique request id copied into the reply, never by arrival order.**
  Discard a reply whose id no longer matches a pending request, as with stale async responses in a
  UI. *[EIP ch. 5; Review lessons]*
- **Design for void, result, error, and no reply at all.** Every request needs a timeout path.
  *[EIP ch. 5]*

## Workflows and sagas

- **Use choreography for simple reactions across teams and a durable orchestrator for
  long-running, compensating workflows.** Choreography keeps services independent; an orchestrator
  makes the whole flow visible and changeable in one place. *[DEDS ch. 5; EIP ch. 7]*
- **Give each process instance a unique id correlated on every message, and keep the definition
  separate from instances.** A central process manager is overkill for linear flows. *[EIP ch. 7]*
- **Specify every aggregator's correlation key, completeness condition, and combine step.**
  Waiting for all needs a timeout and error path; pass the expected count when it is known.
  *[EIP ch. 7; DEDS ch. 15]*
- **Validate a command synchronously before it becomes a fact, or emit a tentative event followed
  by a confirmation.** Consumers cannot reject an event already in the log. *[DDIA ch. 11]*
- **Find every place a step reads a view that lags the write it depends on.** A confirmation link
  that hits an un-updated view needs a blocking read with a timeout or a "view updated" event.
  *[DEDS ch. 11, 15; DDIA ch. 5]*
- **Protect integrity before timeliness.** Stale reads heal by waiting; lost or duplicated money
  does not; use compensation for loose constraints only with business sign-off. *[DDIA ch. 12]*
- **Put uniqueness and "at most one" rules in a unique index or a single-partition decision, not in
  an in-process guard.** Concurrent consumers defeat memory checks. *[DDIA ch. 12; Review lessons]*

## Event sourcing, CQRS, derived views, and stream time

- **When you event-source, store immutable user-intent events and derive views with deterministic
  code.** Snapshots only speed loading; the events stay the source of truth. *[DDIA ch. 11; DEDS
  ch. 7]*
- **Build each read model so it can be dropped and rebuilt from the log.** Then a view can change
  shape or move to another store without a data migration; keep it lean, holding only fields the
  service uses, so rebuild time stays acceptable. *[DEDS ch. 7, 9, 10; DDIA ch. 11]*
- **Release a changed view by building it in parallel and switching once it catches up.** The same
  pattern replaces lambda-style dual pipelines with one replayable stream. *[DEDS ch. 10; KiA ch. 8;
  DDIA ch. 12]*
- **Provide read-your-own-writes on async views.** Block the read until the write's position has
  reached the view, with a timeout. *[DEDS ch. 7, 15; DDIA ch. 11]*
- **Keep retention long enough to replay past a bug, and make consumers safe to rerun from an
  earlier position.** Journal incoming commands when you need to reprocess past corrupted logic.
  *[KiA ch. 3, 5; DEDS ch. 7]*
- **Window by event time, not processing time, and choose a late-event policy.** Drop and count, or
  publish corrections; processing-time windows spike after restarts and replays. *[DDIA ch. 11]*

## Security and privacy

- **Authenticate clients, authorize per channel, and encrypt in transit from the first
  deployment.** Anyone who can reach an open broker can read every topic and inject false events.
  *[KiA ch. 10; DEDS ch. 4]*
- **Never use message selectors or filters as access control.** Brokers authorize channels, not
  filters; put restricted data on its own channel. *[EIP ch. 10]*
- **Strip sensitive fields before a message leaves the trust boundary.** Use a claim check with
  single-use or expiring keys for outside parties. *[EIP ch. 8]*
- **Keep credentials out of client config in source control.** Load broker passwords and keys from
  a secret manager or owner-only files. *[KiA ch. 10; Review lessons]*
- **Plan physical deletion before retaining personal data indefinitely.** Tombstones do not erase;
  use key-addressable compaction or crypto-shredding and track which keys hold a person's data.
  *[DEDS ch. 13; DDIA ch. 11, 12]*
- **Give outbound HTTP calls from consumers a timeout and disable redirects when they carry a
  token.** A hung webhook call stalls the partition and a redirect can leak the credential.
  *[Review lessons]*

## Observability and testing

- **Trace every message with a correlation id in headers, added by an interceptor or the gateway,
  not by business code.** *[KiA ch. 9; EIP ch. 11]*
- **Send tagged synthetic test messages through the real path and verify the outcome.** Tag them in
  a header, never with magic data values, and keep them out of stateful business totals. *[EIP
  ch. 11]*
- **Run invariant checks in production, such as messages in equals messages out.** *[DDIA ch. 1,
  12]*
- **Test handlers without a broker through the gateway, and partitioning, serdes, and config against
  a real broker in a container.** *[KiA appendix B, ch. 7; EIP ch. 10]*

## Tensions

- **Broker exactly-once vs idempotent consumers.** DEDS argues broker transactions remove the need
  for idempotence; KiA and DDIA keep it. This library uses transactions inside a broker-to-broker
  graph and idempotent effects at every external boundary. *[DEDS ch. 12; KiA ch. 2; DDIA ch. 11]*
- **Choreography vs orchestration.** DEDS leans toward choreography; EIP's process manager and
  current practice favour durable orchestrators (Temporal, Step Functions) for long, compensating
  flows. Choose per workflow: choreography for simple cross-team reactions, an orchestrator when
  someone must see and change the whole flow. *[DEDS ch. 5; EIP ch. 7]*
- **Enterprise canonical model vs bounded contexts.** EIP counts translators and favours one
  canonical model; DEDS and domain-driven design warn it couples every team. This library uses a
  published language per bounded context with registry-checked schemas. *[EIP ch. 8; DEDS ch. 5]*
- **Shared log of facts vs strict API-only encapsulation.** DEDS and DDIA share data through the
  log; microservice orthodoxy shares only through APIs. Use the log for facts many consumers need,
  APIs for queries and commands. *[DEDS ch. 8; DDIA ch. 11]*
- **Kafka as the event store.** DEDS presents it as one; it lacks per-aggregate expected-version
  appends. Use a database or dedicated event store with an outbox for per-aggregate event sourcing,
  and the log for distribution. *[DEDS ch. 7]*
- **Raw events first vs validate before the fact.** KiA lands raw external data untouched; DDIA
  validates commands before they become events. Both hold: retain raw input from outside systems,
  but validate your own users' commands before emitting facts. *[KiA ch. 3; DDIA ch. 11]*
- **Rebuild from offset zero vs snapshots.** Full replay assumes full retention and tolerable time;
  combine snapshots with replay for large views. *[DEDS ch. 10]*
- **Dated mechanisms.** EIP's XA transactions, WS-* standards, and in-memory broker defaults are
  replaced by the outbox, CloudEvents or AsyncAPI descriptions, and log brokers that persist by
  default; Kafka-specific updates (KRaft, idempotent producer defaults, tiered storage) are in the
  Kafka file. *[EIP ch. 4, 10, 14; DEDS ch. 4; KiA ch. 6]*

## Sources

- **EIP**: Enterprise Integration Patterns: Designing, Building, and Deploying Messaging Solutions
  (Gregor Hohpe and Bobby Woolf, Addison-Wesley, 2003)
- **DEDS**: Designing Event-Driven Systems: Concepts and Patterns for Streaming Services with Apache
  Kafka (Ben Stopford, O'Reilly, 1st ed., 2018)
- **KiA**: Kafka in Action (Dylan Scott, Viktor Gamov, and Dave Klein, Manning, 1st ed., 2022)
- **DDIA**: Designing Data-Intensive Applications (Martin Kleppmann, O'Reilly, 1st ed., 2017)
- **Review lessons**: rules distilled from the maintainer's code-review findings
