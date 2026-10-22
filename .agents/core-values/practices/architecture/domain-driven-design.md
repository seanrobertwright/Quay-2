# Domain-driven design

> **Load when:** modeling business logic in code (entities, value objects, aggregates, factories,
> repositories, domain services, domain events), naming types and methods after business terms,
> deciding where a business rule or invariant lives, drawing bounded-context or service boundaries,
> integrating with another team's, a legacy, or a third-party model, or deciding how much modeling
> a subsystem deserves.
> **See also:** [Software architecture fundamentals](../architecture/architecture-fundamentals.md),
> [Microservices](../architecture/microservices.md), [Event-driven architecture and
> messaging](../architecture/event-driven-and-messaging.md), [Code and module
> design](../core/code-design.md), [Object-oriented design patterns and
> SOLID](../design/design-patterns.md), [Relational and analytical data
> modeling](../data/data-modeling.md), [Refactoring and legacy
> code](../core/refactoring-and-legacy-code.md), [Unit, integration, and test-driven
> development](../testing/testing.md), [HTTP and REST API design](../api/api-design.md),
> [Distributed systems](../distributed/distributed-systems.md)

## Top rules

1. **Match the modeling effort to the business complexity.** Use rich tactical DDD only in the
   core domain where the business rules are the hard part; CRUD screens, generic subdomains, and
   throwaway tools get simple code or a bought component.
   *[DDD ch. 4, 15; DDDD ch. 1, 3; DDDQ ch. 6]*
2. **Name code with the domain experts' terms, one meaning per term per context.** Classes,
   methods, events, modules, and tests use the ubiquitous language; when a term changes, rename the
   code in the same change and sweep every sibling use. *[DDD ch. 2; DDDD ch. 2; DDDQ ch. 2;
   Review lessons]*
3. **Keep business rules in the domain layer, free of UI, persistence, and framework code.**
   Application services load, call one domain operation, and save; a second entry point (API,
   queue, CLI) must never re-implement a rule. *[DDD ch. 4; DDDD ch. 2; DDDQ ch. 3]*
4. **Draw each aggregate around the invariants that must hold at commit, keep it small, and
   change only one aggregate per transaction.** Large clusters fail under concurrent edits and load
   slowly; other aggregates update through domain events. *[DDD ch. 6; DDDD ch. 5; DDDQ ch. 3]*
5. **Reference other aggregates by typed id only, and route every change through the root.**
   Object references across aggregates invite multi-aggregate writes and huge loads; outside code
   never holds an aggregate's internals. *[DDDD ch. 5; DDD ch. 6; DDDQ ch. 3]*
6. **Back every cross-aggregate or set-level invariant with the database.** "Unique email", "only
   one active plan", or "at most N seats" cannot be checked inside one aggregate under concurrency;
   enforce it with a unique or partial unique index, a constraint, `onConflict`, or a lock, and keep
   the domain check as the readable statement of the rule. *[DDD ch. 6; DDDD ch. 5; Review lessons]*
7. **Make illegal states unconstructible.** Value objects and factories either return a fully
   valid object or fail; parse external input into value objects at the boundary, rejecting NaN,
   empty strings, malformed ids, and out-of-range values. *[DDD ch. 6; DDDQ ch. 3; Review lessons]*
8. **Give each bounded context one model, one owning team, and its own code and schema.** Never
   build one unified enterprise model; the same word may mean different things in two contexts.
   *[DDD ch. 14; DDDD ch. 2; DDDQ ch. 5]*
9. **Translate at every context boundary.** Put an anticorruption layer in front of legacy,
   external, or shared-database models; conform to an upstream model only as a recorded decision.
   *[DDD ch. 14; DDDD ch. 4; DDDQ ch. 5]*
10. **Carry the tenant id on every aggregate root and in every repository query.** Repository
    signatures take the tenant id and scope loads, updates, and deletes by tenant plus id;
    `findById(id)` on tenant-owned data is a cross-tenant leak. *[DDDD ch. 5; Review lessons]*

## Ubiquitous language and naming

- **Use one vocabulary in talk, docs, tests, and code, taken from the model.** Do not keep a
  separate business vocabulary that developers translate; translation loses meaning.
  *[DDD ch. 2; DDDQ ch. 2]*
- **Name operations for their business intent, not their mechanics.** Prefer `commitTo(sprint)`
  or `scheduleRelease()` over `setStatus()` or `processData()`; reject developer shorthand.
  *[DDD ch. 10; DDDD ch. 1, 5]*
- **Keep the plain name inside a context (`Policy`, not `UnderwritingPolicy`).** The context
  already scopes the term; a context prefix on class names means the boundary is not working.
  *[DDDD ch. 2]*
- **Treat an awkward sentence as a design smell.** If a requirement is hard to say with the
  model's terms, or an expert is confused by a term, a concept is missing or wrong; fix the model,
  not the explanation. *[DDD ch. 1, 2; DDDQ ch. 2]*
- **Model the experts' concrete concepts, not speculative generic ones.** A `ScrumElement` with
  a `typeName` field, or a 3D path where experts think in fixes, diverges from the language and
  breeds special cases. *[DDDD ch. 5; DDDQ ch. 1]*
- **Add a field or type only when a current scenario needs it.** Delete concepts that stop
  mattering as the model develops; extra ones hide the rules. *[DDD ch. 1; DDDQ ch. 1]*
- **Keep a short glossary or context document and update it with the code.** Archive docs that
  drifted; small diagrams per aspect beat one large diagram. When a change renames a term, audit
  every comment, docstring, and doc that uses it before merging. *[DDD ch. 2; DDDQ ch. 2; DDDD
  ch. 2; Review lessons]*
- **Review names, not only behavior.** Working code can still misname the model; check method,
  variable, and test names for model fidelity in review. *[DDDQ ch. 2; DDD ch. 2]*

## Isolating the domain

- **Make the domain depend on nothing technical.** Define repository and gateway interfaces
  (ports) in the domain; implement them in infrastructure adapters. This inverts the books'
  original layer order, which put infrastructure below the domain. *[DDD ch. 4; DDDD ch. 2;
  DDDQ ch. 3]*
- **Keep application services thin: they own the transaction and orchestrate, nothing more.**
  No `if` on business state in a controller, handler, or application service; push the rule into
  the aggregate or a domain service. *[DDD ch. 4; DDDQ ch. 3; DDDD ch. 2]*
- **Do not call persistence or remote services from the middle of domain logic.** Load what the
  operation needs first, run the domain operation, then save. *[DDDD ch. 2]*
- **Organize modules by domain concept, not by technical kind.** `billing/invoice` beats
  `controllers/`, `services/`, `dtos/` spread across the tree; tight coupling between modules
  signals a missing or tangled concept. *[DDD ch. 5; DDDQ ch. 3]*
- **Do not let a framework split one concept across tier packages.** An entity, its DTO, its
  service, and its repository scattered by layer hide the model; accept it only for a real
  distribution need. *[DDD ch. 5, 6]*
- **Prefer frameworks that leave plain domain objects alone.** Where a framework is hostile,
  keep DDD's principles and drop its specific forms; never hand-edit generated code mixed into
  domain code. *[DDD ch. 6, 10; DDDQ ch. 6]*
- **Choose a Smart UI or transaction script only deliberately, and never mix it with a domain
  model in the same context.** It is a valid fast path for simple apps but gives up any route to
  a rich model. *[DDD ch. 4]*

## Entities and value objects

- **Make an object an entity only when its identity must survive state changes, storage, and
  transport.** Define what "the same thing" means and give it a guaranteed-unique, system-
  generated id; never use names, birth dates, or sensitive personal numbers as identity. *[DDD
  ch. 5; DDDQ ch. 3]*
- **Keep entities spare.** Move non-identity attributes and computations into value objects.
  *[DDD ch. 5; DDDQ ch. 3]*
- **Model descriptors and measures as immutable value objects compared by attributes.** Money,
  Address, DateRange, and Quantity get their own types and operations; change a value by building
  a new one. *[DDD ch. 5; DDDQ ch. 3; DDDD ch. 5]*
- **Wrap ids in value types (`OrderId`, `TenantId`), not raw strings or numbers.** The compiler
  then stops an `OrderId` being passed where a `CustomerId` belongs. *[DDDD ch. 5]*
- **Group fields that travel together into one value object.** Loose `street`, `city`,
  `postcode` fields become an `Address`. *[DDD ch. 5; DDDQ ch. 3]*
- **Validate in the value object's constructor or factory, once.** A value object that exists is
  valid, so callers never re-check it. *[DDDQ ch. 3; DDD ch. 6; Review lessons]*
- **Route dates and times through one project date helper or injected clock.** Value objects such
  as `DateRange` and event timestamps are built from it, never from raw string parsing or the
  process-local zone. *[Review lessons]*
- **Constrain associations.** Pick one traversal direction, add qualifiers that reduce
  multiplicity, and delete associations nothing needs. *[DDD ch. 5; DDDQ ch. 3]*
- **Put behavior on the object that owns the data, not on public setters plus a helper.** A model
  of getters and setters with rules in `*Service` or `*Utils` classes is anemic. *[DDD ch. 5;
  DDDD ch. 5; DDDQ ch. 3]*
- **In functional or type-driven code, use immutable records plus pure functions that return new
  state and events.** Separating data from behavior is normal there; keep the invariants in smart
  constructors and explicit state types. *[DDDD ch. 5]*

## Aggregates

- **Start each aggregate as a single root entity and grow it only for a true invariant.** Ask
  experts which other aggregates must react to a change and how soon; merge only those needing
  immediate consistency and update the rest by event. *[DDDD ch. 5; DDD ch. 6]*
- **Never put an unbounded collection inside a root.** Thousands of line items, comments, or
  sprints become separate aggregates that reference the parent by id. *[DDDD ch. 5]*
- **Keep high-contention data out of a shared aggregate.** Locking one large root blocks
  unrelated users; split at the contention point. *[DDD ch. 6; DDDD ch. 5]*
- **Enforce the aggregate's invariants at the end of every operation on the root.** Internal
  entities are reached only through the root; hand out copies of values or references that live
  for one operation. *[DDD ch. 6; DDDQ ch. 3]*
- **Check a version column in the WHERE clause of every aggregate update.** This optimistic lock
  makes the root a consistency boundary under concurrent edits; it updates the books' advice to
  lock the whole root, and does not block readers. *[DDD ch. 6; DDDD ch. 5]*
- **Treat the allowed delay between aggregates as a business decision.** Ask how the process
  would run on paper; push back on "everything must be immediately consistent". *[DDDD ch. 5]*
- **Record any multi-aggregate transaction as an explicit, commented exception.** It is
  tolerable as a stepping stone, never as the default. *[DDDD ch. 5]*
- **Make every docstring about an aggregate match its code exactly.** Claims such as "at most
  one", "never throws", or "events in order" need an enforcing test or constraint.
  *[Review lessons]*

## Factories and repositories

- **Make creation atomic.** A constructor or factory returns a complete, valid aggregate or fails
  with the one error convention the codebase uses; callers never assemble half-built objects.
  *[DDD ch. 6; DDDQ ch. 3]*
- **Use a plain constructor for simple objects, a factory for complex assembly or abstract
  result types.** A factory couples to what it builds, so add one only when it pays. *[DDD ch. 6;
  DDDQ ch. 3]*
- **Separate reconstitution from creation.** Loading keeps the stored identity and must repair or
  flag stored data that breaks current invariants, not throw and lose it. *[DDD ch. 6; DDDQ ch. 3]*
- **Provide repositories only for aggregate roots, with a collection-like interface in domain
  terms.** Add, remove, find by id or by domain criteria, returning fully built aggregates; no
  generic repository over every table, and no query for an aggregate's internals. *[DDD ch. 6;
  DDDQ ch. 3]*
- **Inject repositories through an interface the domain defines.** Never reach them through
  static or global access; keep an in-memory implementation for fast domain tests. *[DDD ch. 6;
  DDDQ ch. 3]*
- **Leave transaction control to the application service, not the repository.** The caller knows
  the unit of work. *[DDD ch. 6]*
- **Know the cost of every repository query and ask what happens at 10k rows.** Never load all
  aggregates to filter or count in memory; paginate, cap, add the index the query needs, or serve
  it from a read model. *[DDD ch. 6; Review lessons]*
- **Keep the schema close to the model when the database only serves this context.** Name tables
  and columns after model terms; do not let outside processes read or write it directly.
  *[DDD ch. 6]*

## Domain events and eventual consistency

- **Name events as past-tense business facts and commands as imperatives.** `OrderPlaced`,
  `PlaceOrder`; never a generic `OrderUpdated` carrying the full state. *[DDDD ch. 6, 7]*
- **Give every event a standard envelope.** Event id, occurred-at time from the project clock,
  tenant id, aggregate id, and the inputs of the command that caused it. *[DDDD ch. 6;
  Review lessons]*
- **Save the aggregate and its events in the same transaction, then publish after commit.** This
  is now called the transactional outbox; a relay or change-data capture delivers the rows.
  *[DDDD ch. 6]*
- **Make every handler idempotent.** Assume at-least-once delivery: de-duplicate by event id or
  make reapplying produce the same result, enforced by a unique key on processed ids. *[DDDD ch. 4;
  Review lessons]*
- **Make consumers handle causal order.** Carry a sequence or causal id and hold an event until
  its cause is applied; drop late events only when a later one supersedes them. *[DDDD ch. 6]*
- **Model business-significant time passing as an event ("Fiscal year ended").** A scheduler
  emits the fact; handlers then issue commands. *[DDDD ch. 6]*
- **Adopt event sourcing only for aggregates whose history is a business need.** Store an
  append-only ordered stream per aggregate, snapshot for load speed, and expect separate read
  models (CQRS) for queries. *[DDDD ch. 6]*

## Making concepts explicit

- **Hunt for the missing concept behind awkward code.** Expert terms with no class, logic
  assembled ad hoc in several places, and contradictions between experts each point at a type to
  add. *[DDD ch. 9; DDDQ ch. 4]*
- **Extract a buried constraint into a named method or object.** Do it when the rule needs data
  its host otherwise does not, repeats across classes, or is discussed often. *[DDD ch. 9;
  DDDQ ch. 4]*
- **Express complex predicates as composable specifications.** One `OverdueInvoice` rule can
  validate, select from a repository, and gate creation; do not grow boolean methods on the
  entity. *[DDD ch. 9; DDDQ ch. 4]*
- **Model a varying business policy as a strategy object.** Named policies replace conditionals
  spread through calculations. *[DDD ch. 12; DDDQ ch. 4]*
- **Make a process a domain service only when experts name it.** A domain service is stateless,
  named with a domain verb, and typed with domain objects; keep domain, application, and
  infrastructure services in their own layers. *[DDD ch. 5, 9; DDDQ ch. 3, 4]*
- **Push logic into side-effect-free functions on value objects and keep commands small.**
  Separate commands from queries so most rules are testable without setup. *[DDD ch. 10]*
- **Refactor toward deeper insight when understanding changes.** Do not wait for a full cost
  case, but do not refactor the model right before a release. *[DDD ch. 13; DDDQ ch. 4]*

## Bounded contexts

- **Split a term that means different things to different business functions.** Underwriting,
  claims, and inspection policies are three types in three contexts, not one overloaded class.
  *[DDDD ch. 2; DDD ch. 14]*
- **Place boundaries where departments, expert groups, or definitions of a term differ.** Each
  business function brings its own vocabulary. *[DDDD ch. 2, 7]*
- **Test every candidate concept with "is this in this context's language?"** Push users,
  permissions, payments, and the like out to their own contexts. *[DDDD ch. 2]*
- **Keep "in context" separate from "in scope".** A concept can belong to the language yet be
  deferred; record the deferral. *[DDDD ch. 2]*
- **Assign one owning team per context.** One team may own several contexts; several teams never
  share one. In a monorepo, enforce it with module boundaries, dependency rules, and code-owner
  files. *[DDDD ch. 2; DDDQ ch. 5]*
- **Do not confuse a microservice with a context.** Several small services can share one language
  and context, and one context split into chatty services is a distributed monolith; a modular
  monolith with clean context modules is often the better start. *[DDDD ch. 2; DDD ch. 14]*
- **Watch for splinters: two names for one concept, or one name for two.** Confused language is
  the first sign that models have mixed inside one context. *[DDD ch. 14]*
- **Stop growing a big ball of mud.** Blurred language, changes rippling into unrelated areas,
  and tests too slow to run mean the boundary is gone; carve out new work behind a translation
  layer instead. *[DDDD ch. 2, 4]*
- **Integrate continuously inside a context.** Merge several times a day with the full test suite
  on every build; integration between contexts can move more slowly. *[DDD ch. 14; DDDQ ch. 5]*

## Context mapping and integration

- **Keep a context map and name the relationship on every edge.** Partnership, shared kernel,
  customer-supplier, conformist, anticorruption layer, open host service, published language, or
  separate ways; include legacy and external systems. *[DDD ch. 14; DDDD ch. 4; DDDQ ch. 5]*
- **Default to an anticorruption layer against upstream models.** It offers services in your
  language and translates both ways; raw foreign records never reach domain types. *[DDD ch. 14;
  DDDD ch. 4; DDDQ ch. 5]*
- **Treat the ACL as an input boundary.** Parse and validate every foreign payload there, and give
  its outbound HTTP clients a timeout and no automatic redirects when they carry a token.
  *[Review lessons]*
- **Never integrate through a shared database or file drop.** If forced to, isolate the consumer
  behind an anticorruption layer. *[DDDD ch. 4; DDD ch. 6]*
- **Expose a context as an open host service speaking a published language.** Use OpenAPI or
  JSON Schema for HTTP, Protobuf or Avro with a registry for messages, AsyncAPI or CloudEvents for
  event contracts; serve one client's odd needs with a separate translator. *[DDD ch. 14; DDDD ch. 4; DDDQ ch. 5]*
- **Do not mirror aggregates one-to-one as REST resources.** Shape the API around client use cases
  so internal refactors do not break consumers. *[DDDD ch. 4]*
- **Make consumers depend on the event schema, not the publisher's classes.** Parse the attributes
  you need from the payload. *[DDDD ch. 4]*
- **Do not block on another context while serving a blocking request.** Chained synchronous calls
  cascade failures; hand the downstream step to asynchronous messaging. *[DDDD ch. 4]*
- **Keep the upstream id on a local copy (`issuedPolicyId`).** It allows tracing and query-back.
  Choose deliberately between enriched events and thin events plus a secured query. *[DDDD ch. 4]*
- **Keep shared kernels small, change them only by agreement, and run both teams' tests.**
  *[DDD ch. 14; DDDQ ch. 5; DDDD ch. 4]*
- **Turn customer-supplier agreements into consumer-driven contract tests in the supplier's CI.**
  *[DDD ch. 14; DDDQ ch. 5]*
- **Choose separate ways when integration would not pay.** Duplicating a narrow capability beats
  a costly link. *[DDD ch. 14; DDDD ch. 4; DDDQ ch. 5]*
- **Retire legacy in slices behind an anticorruption layer.** Move one capability at a time, test
  old and new in parallel where needed, then delete unused translation code. *[DDD ch. 14]*

## Core domain and investment

- **Classify each area as core, supporting, or generic before modeling.** Core gets deep
  modeling, tests, and review depth; supporting gets modest custom code; generic gets a library,
  service, or the simplest thing that works. *[DDDD ch. 3; DDD ch. 15; DDDQ ch. 5]*
- **Keep generic subdomains in separate modules with nothing business-specific in them.** Money,
  time zones, and notifications stay out of the core. *[DDD ch. 15; DDDQ ch. 5]*
- **Do strategic design before tactical design.** Settle core domain, contexts, and integrations
  before writing entities, and build the first end-to-end slice through the core, not only
  infrastructure. *[DDDD ch. 1; DDD ch. 15]*
- **Mark core code and give changes to it closer review.** A one-page domain vision statement
  and a core module or package make the core visible to people and agents. *[DDD ch. 15]*

## Modeling process and tests

- **Discover a new domain events-first.** List past-tense events on a timeline, then the commands
  that cause them, the aggregates that handle them, and finally the boundaries. *[DDDD ch. 7]*
- **Write scenarios with actors, verbs, and constraints, and ask "who does this, who needs to
  know?"** *[DDDD ch. 2; DDDQ ch. 6]*
- **Turn each scenario into an executable acceptance test in the domain language.** Write it
  before the aggregate unit tests, use realistic data a domain expert can review quickly, and keep
  it in the context's tree. *[DDDD ch. 2, 5, 7]*
- **Unit-test every aggregate operation and every stated invariant.** Tests set preconditions and
  assert postconditions, so callers need not read the implementation. *[DDD ch. 10; DDDD ch. 5]*
- **Record a known-wrong model shipped under a timebox as a modeling-debt issue or ADR.** The
  better design learned in the spike is otherwise lost. *[DDDD ch. 7]*

## Tensions

- **Small aggregates referenced by id vs direct references between roots.** The original book
  allows object references across aggregates. This library takes the later, stricter form: small
  aggregates, id references, one aggregate per transaction, events between them. *[DDD ch. 6;
  DDDD ch. 5; DDDQ ch. 3]*
- **Invariants in the aggregate vs invariants in the database.** DDD places invariants in the
  root; the maintainer's rule places them in the database. Both hold: single-aggregate rules live
  in the root plus a version check, and any rule across aggregates or over a set gets a database
  constraint or lock. *[DDD ch. 6; DDDD ch. 5; Review lessons]*
- **Layers with infrastructure at the bottom vs ports and adapters.** The books draw the domain
  depending on infrastructure. This library inverts it: the domain defines interfaces and
  infrastructure implements them. *[DDD ch. 4; DDDQ ch. 3]*
- **Rich object model vs records plus functions.** The anti-anemia rule is object-oriented. In
  functional or type-driven code, immutable records, pure transition functions, and
  unrepresentable illegal states satisfy the same goal. *[DDDD ch. 5; DDDQ ch. 3]*
- **Full DDD vs Smart UI or CRUD.** Evans calls Smart UI a legitimate choice for simple apps. This
  library agrees: do not impose tactical patterns on data entry or throwaway code. *[DDD ch. 4;
  DDDQ ch. 6]*
- **One repository per context vs a monorepo.** Distilled says each context gets its own source
  repository. This library requires separate modules, schema, and one owner per context, not
  separate repositories. *[DDDD ch. 2]*
- **Context per microservice.** Distilled roughly equates them. This library treats a context as
  a model boundary first; deploy it as one service, several, or a module of a monolith. *[DDDD
  ch. 2; DDD ch. 14]*
- **Given/when/then executable specifications vs unit-test-framework acceptance tests.**
  Distilled estimates executable specifications cost noticeably more to maintain; BDD advocates
  treat them as essential. This library accepts either, provided the scenario text is in the
  domain language and runs in CI. *[DDDD ch. 2, 7]*
- **Dated mechanisms.** EJB-era framework advice, XML schemas as published language, SOAP, Atom
  feed polling, and global repository access are obsolete; the rules above restate them with
  current equivalents (plain-object ORMs, OpenAPI and schema registries, gRPC or brokers,
  injected repositories, the outbox). *[DDD ch. 5, 6, 14; DDDD ch. 4; DDDQ ch. 6]*

## Sources

- **DDD**: Domain-Driven Design: Tackling Complexity in the Heart of Software (Eric Evans,
  Addison-Wesley, 2004)
- **DDDD**: Domain-Driven Design Distilled (Vaughn Vernon, Addison-Wesley, 1st ed., 2016)
- **DDDQ**: Domain-Driven Design Quickly (Abel Avram and Floyd Marinescu, InfoQ, 2006)
- **Review lessons**: rules distilled from the maintainer's code-review findings
