# Software architecture fundamentals

> **Load when:** choosing or changing how a system is structured (monolith, modular monolith,
> layered, ports and adapters, microkernel, service-based, or distributed); deciding where a
> module, layer, or boundary goes and which way its dependencies point; adopting a framework,
> database, or platform; stating quality attributes such as scalability or deployability; writing
> or reviewing an architecture decision record or design doc; adding automated architecture checks
> (dependency cycles, layer rules); or drawing an architecture diagram.
> **See also:** [Code and module design](../core/code-design.md),
> [Design patterns](../design/design-patterns.md), [DDD](../architecture/domain-driven-design.md),
> [Microservices](../architecture/microservices.md), [Event-driven
> architecture](../architecture/event-driven-and-messaging.md), [Scalability and system
> design](../architecture/scalability-and-system-design.md), [Distributed
> systems](../distributed/distributed-systems.md), [Engineering
> process](../core/engineering-process.md), [CI/CD](../devops/ci-cd.md)

## Top rules

1. **Name what every option gives up before recommending it, and pick the least-bad fit for the
   stated context.** No structure maximizes every quality; a choice with no listed downside has
   not been analyzed. *[FoSA ch. 1, 4; SA Hard Parts ch. 1; Architect Elevator ch. 8;
   ArchPatterns ch. 8]*
2. **Point source dependencies inward, from details (web, UI, database, frameworks, queues) to
   policy (business rules).** Inner code never names an outer type, table, or framework object;
   when the core must call out, it owns an interface that the outer side implements.
   *[Clean Architecture ch. 15, 17, 22; PoEAA ch. 1]*
3. **Start as one deployable with enforced internal module boundaries, and split into services
   only when parts need different scalability, availability, or release cadence.** Every process
   boundary is a permanent cost in latency, failure handling, and operations.
   *[FoSA ch. 8, 18; Clean Architecture ch. 16; PoEAA ch. 1, 7]*
4. **Partition the top level by domain or feature, not by technical layer.** Change arrives along
   business workflows; the repository should show the use cases, not the framework.
   *[FoSA ch. 8; Clean Architecture ch. 21, 34; ArchPatterns ch. 9]*
5. **Enforce structural rules in CI, not in prose.** Fail the build on dependency cycles and on
   forbidden imports such as "controllers never call repositories", and make only each module's
   entry interface public. *[FoSA ch. 6; SA Hard Parts ch. 1; Clean Architecture ch. 14, 34]*
6. **Record each hard-to-reverse decision as an ADR in the repository, with context, the
   alternatives, the decision, its consequences, and how compliance is checked.** The code shows
   how; only the record keeps why. Re-verify every ADR and design-doc claim a change touches.
   *[FoSA ch. 1, 19; SA Hard Parts ch. 1; Architect Elevator ch. 8; Review lessons]*
7. **State quality attributes as measurable targets and keep only the top few.** "Fast" is not a
   requirement; "p99 under 300 ms at 2,000 concurrent users" is. A design that serves every
   "-ility" serves none well. *[FoSA ch. 5, 6; SA Hard Parts ch. 1]*
8. **Keep business rules runnable in a unit test with no web server, database, or framework.**
   That is the practical proof that a boundary is real. *[Clean Architecture ch. 20, 21, 22]*
9. **Enforce stated invariants in the database even though SQL stays in the adapter layer.**
   "Only one", "never twice", and "at most N" need a unique or partial unique index, a constraint,
   an upsert, or a lock; an in-process check is not enforcement. *[Review lessons; Clean
   Architecture ch. 30]*
10. **Parse external input once, at the entry boundary, and route each cross-cutting concern
    through one project helper.** Env vars, flags, query params, and bodies are parsed into typed
    values that reject NaN, empty strings, malformed ids, and out-of-range values; dates, config,
    and similar concerns get one substitution point instead of scattered raw calls.
    *[Architect Elevator ch. 17; ArchPatterns ch. 7; Clean Architecture ch. 29; Review lessons]*

## Trade-off analysis

- **Judge a design as fit or unfit for a written purpose, never as good or bad in general.** Write
  the context down first, including constraints nobody stated. *[Architect Elevator ch. 8]*
- **Do not answer an organization-specific question with a generic pattern.** Name the conditions
  that made a style popular and check whether they hold here. *[SA Hard Parts ch. 1]*
- **Spend analysis on decisions that are expensive to reverse.** Service boundaries, data
  placement, and communication style deserve explicit trade-off work; settle why an approach wins
  before choosing the tool that builds it. *[SA Hard Parts ch. 1; Architect Elevator ch. 9]*
- **Untangle before you weigh.** Find the entangled parts and how each pair is coupled, then trace
  a change through them. *[SA Hard Parts ch. 2]*
- **Treat each flexibility mechanism as an option with a stated price.** Buy options where
  uncertainty is high and the horizon long, take near-free ones (a mainstream runtime, a standard
  ORM) by default, and add no "just in case" abstraction without naming what it hedges.
  *[Architect Elevator ch. 9; Clean Architecture ch. 25]*
- **Decide at the last responsible moment, then check the decision against what implementers
  find.** Deferring out of fear blocks the team. *[FoSA ch. 19; Architect Elevator ch. 9]*
- **Give every decision a business reason as well as a technical one.** Without a recorded reason
  the same decision is re-argued repeatedly. *[FoSA ch. 19]*
- **Use a small quantitative model for rare but severe risks.** Score likelihood and impact
  separately, compare the cost of redundancy with the downtime it avoids, and rerun with other
  probabilities to see whether the answer flips. *[Architect Elevator ch. 6; FoSA ch. 20]*
- **Define service, component, coupling, sync, async, orchestration, and choreography in the ADR
  or design doc before arguing about them.** *[SA Hard Parts ch. 1]*
- **Judge a structure by the cost of the next change.** Surface structural risk explicitly instead
  of trading it away under deadline pressure; a rewrite with the same habits rebuilds the same
  mess. *[Clean Architecture ch. 1, 2; Architect Elevator ch. 3]*

## Quality attributes

- **Count something as an architecture characteristic only if it is not domain logic, needs
  special structure, and is critical to success.** Hashing data sent to a payment processor is
  hygiene; processing card payments in-house needs an isolated component. *[FoSA ch. 4]*
- **Translate each business goal into the set of characteristics it implies.** "Time to market"
  means deployability, testability, and agility; "finish the nightly run on time" adds
  availability, resumability, and auditability to performance. *[FoSA ch. 5]*
- **Size for the realistic burst from domain knowledge, not the average,** and list implicit needs
  such as security and availability that nobody wrote down. *[FoSA ch. 4, 5]*
- **Break composite terms into objective measures with one shared definition.** "Agility" becomes
  deployability, test cycle time, and lead time. *[FoSA ch. 6; SA Hard Parts ch. 1]*
- **Specify latency as percentiles and maximum, as a function of load.** A mean hides the slow
  tail; a scalability target says how latency may degrade as concurrency rises, without a cliff.
  *[FoSA ch. 6; SA Hard Parts ch. 1]*
- **State the expected size of every collection the design exposes, and cap or paginate it.** Ask
  what happens at ten thousand rows and at ten times the load. *[Review lessons]*
- **Scope operational characteristics to each independently deployable unit with its data (an
  architecture quantum).** Parts needing very different scale or availability belong in separate
  quanta. *[FoSA ch. 7; SA Hard Parts ch. 2]*

## Dependency direction and boundaries

- **Arrange code as entities, use cases, adapters, and frameworks or drivers, treating the rings
  as a schema rather than a fixed count.** Entities hold core rules, use cases orchestrate one
  application action, adapters convert formats. *[Clean Architecture ch. 20, 22]*
- **Put the interface on the side that uses it.** The use case declares `OrderStore` or
  `Notifier`; the database or email module implements it. *[Clean Architecture ch. 11, 17, 22]*
- **Pass plain, dependency-free data across boundaries.** ORM rows, framework request objects,
  and entities never cross outward; give each use case its own request and response models and the
  UI its own view model, even if they look identical. *[Clean Architecture ch. 16, 20, 22]*
- **Keep all SQL and table knowledge in the data adapter, behind gateway methods named for the
  application's intent.** `findOverdueInvoices(tenantId, asOf)` stubs easily; a query builder
  handed to the core does not. Every gateway method on owned data takes the tenant key and
  filters by it. *[Clean Architecture ch. 22, 23; PoEAA ch. 3; Review lessons]*
- **Split each hard-to-test edge into a humble object that only moves data and a testable partner
  that holds the logic.** Presenters compute display values; views copy them out. *[Clean
  Architecture ch. 23]*
- **Do all concrete wiring in one composition root at the outermost layer, using constructor
  injection.** One root per environment or variant makes configuration a plugin concern; no
  service-locator globals. *[Clean Architecture ch. 11, 26]*
- **Keep framework annotations, base classes, and container imports out of business code.** Wrap a
  framework that demands inheritance in adapters, and record full adoption as a decision. *[Clean
  Architecture ch. 21, 32]*
- **Before adopting a framework, database, or platform, write down its exit cost and base
  assumptions.** Check data export and extractable logic, and prefer standard capabilities to
  proprietary ones that pin you to a version. *[Clean Architecture ch. 32; Architect Elevator
  ch. 12, 16]*
- **Draw a boundary wherever two parts change for different reasons or at different rates.**
  Typical lines run between UI and rules, rules and storage, rules and the DI framework. *[Clean
  Architecture ch. 17; Architect Elevator ch. 3]*
- **Find leaked domain logic by imagining a second, very different front end or store.** Anything
  you would copy to add a CLI beside the web app belongs behind a domain method. *[PoEAA ch. 1;
  Clean Architecture ch. 20]*
- **Never special-case one implementation by name.** No `if (vendor === "acme")` in the core;
  demand substitutable contracts or isolate the variation in a configured adapter. *[Clean
  Architecture ch. 9; FoSA ch. 12]*
- **Choose full, partial, or no boundary deliberately, and revisit it when friction appears.**
  Cheaper placeholders are a one-way strategy interface, a facade, or a full boundary shipped as
  one unit; guard each so it does not erode. *[Clean Architecture ch. 24, 25]*

## Code organization and layers

- **Separate presentation, domain, and data access even in a small program.** Separate functions
  are enough in a script; never mix the three. *[PoEAA ch. 1; SAP-Richards ch. 1]*
- **Prefer package-by-component or ports and adapters to plain package-by-layer.** Each feature
  sits behind one public interface with its logic and persistence inside; adapters never call
  each other and route around the domain. *[Clean Architecture ch. 34]*
- **Use visibility controls (package-private, `internal`, module `exports`) so the compiler
  enforces the architecture,** and add build-time checks for what it cannot express. *[Clean
  Architecture ch. 34]*
- **When layering, keep layers closed by default and document which are open and why.** Put
  shared utilities in an open layer below the business layer so presentation cannot reach them.
  *[SAP-Richards ch. 1; FoSA ch. 10]*
- **Forbid shortcuts that skip the layer holding authorization.** A controller calling a
  repository directly bypasses service-layer checks; each entry point checks the permission the
  data it reads requires, not only the one the action requires. *[Clean Architecture ch. 34;
  PoEAA ch. 2; Review lessons]*
- **Measure pass-through requests.** About a fifth of requests doing no work in a layer is normal;
  if around four in five do, open selected layers or pick another style. *[FoSA ch. 10;
  SAP-Richards ch. 1]*
- **Slice vertically by use case as well as horizontally by layer.** Adding a use case should not
  edit existing ones. *[Clean Architecture ch. 16]*
- **Keep the service layer thin, and declare each operation's transaction scope and required
  authorization in one place.** *[PoEAA ch. 2; Clean Architecture ch. 20]*
- **Write use cases so nothing reveals whether delivery is web, CLI, or a queue consumer.** A
  second entry point reuses the use case, never re-implements its rules. *[Clean Architecture
  ch. 20, 31]*
- **Test business rules through a use-case-level testing API, not through the GUI or one test
  class per production class.** Privileged test hooks ship only in test builds. *[Clean
  Architecture ch. 28; SAP-Richards ch. 1]*

## Modularity, coupling, and components

- **Treat coupling as a dose to set per interaction, not an evil to remove.** A booking service
  should not wait on email delivery, but a mail sender may depend directly on its mail server.
  *[SA Hard Parts ch. 2; ArchPatterns ch. 7]*
- **Keep strong coupling inside a module and weaken it as distance grows.** Named constants beat
  magic values and constructors beat order-dependent setup; values that must change together
  across separate databases are the worst case. *[FoSA ch. 3]*
- **Allow no cycles in the module graph.** Break one by inverting an edge with an interface or by
  extracting the shared part into a module both depend on. *[Clean Architecture ch. 14; FoSA
  ch. 6; SA Hard Parts ch. 1]*
- **Depend toward stability, and make heavily depended-on modules abstract.** Concrete code with
  many dependents resists change; abstractions nobody implements are clutter. *[Clean
  Architecture ch. 14; FoSA ch. 3]*
- **Group what changes together for the same reason; split what is not used together.** Give a
  module one actor, the group of stakeholders who request its changes. *[Clean Architecture ch. 7,
  13]*
- **Let the component structure emerge and keep iterating it.** Split a component whose parts need
  different characteristics. *[FoSA ch. 8; Clean Architecture ch. 14]*
- **Do not design one "manager" component per table.** That is an object-relational mapping, not
  an architecture; plain CRUD deserves a CRUD framework. *[FoSA ch. 8]*
- **Confirm duplication is real before merging it.** Look-alike code serving different actors will
  diverge; across deployables or bounded contexts, prefer a small copy to a shared dependency.
  *[Clean Architecture ch. 7, 16; Architect Elevator ch. 35; FoSA ch. 16, 17]*

## Choosing a style

- **Choose the style explicitly, before structure grows by habit, and record why.** Weigh team
  skills, budget, deadline, and data placement alongside attribute ratings, and track the chosen
  style's weak attributes as risks. *[SAP-Richards Introduction, Appendix A; FoSA ch. 18]*
- **Count each complexity booster as a recurring cost.** Distribution, explicit threading,
  object-relational mismatch, multiple platforms, and extreme throughput each cost effort for the
  system's whole life. *[PoEAA ch. 1]*
- **Default to a layered monolith when no requirement points elsewhere, and keep reuse low and
  inheritance shallow so it can migrate later.** Splitting its layers into deployables does not buy
  deployability or scale. *[SAP-Richards ch. 1; FoSA ch. 10]*
- **In a modular monolith, separate tables by domain to match the modules,** decoupled enough that
  one could become a service. *[FoSA ch. 18; Clean Architecture ch. 16, 33]*
- **Consider coarse domain services (service-based architecture) before microservices.** Most
  transactions stay inside one service. *[FoSA ch. 13]*
- **Use a microkernel for per-customer, per-jurisdiction, or per-device variation.** Keep the core
  free of special cases and plug-ins independent of each other; wrap third-party plug-ins in an
  adapter to your contract. *[FoSA ch. 12; SAP-Richards ch. 3]*
- **Compose styles locally and give each a named job,** for example request/response for commands
  and events for state propagation. *[SAP-Richards ch. 3; ArchPatterns ch. 1]*
- **Choose an asynchronous event-driven design only after budgeting for lost cross-handler
  atomicity, unordered delivery, correlation, compensation, and event test harnesses.** Current
  practice adds idempotent consumers and a transactional outbox, since delivery is at least once.
  *[ArchPatterns ch. 1, 8, 9; SAP-Richards ch. 2; FoSA ch. 14]*

## Distribution boundaries

- **Scale by running identical copies of one process, not by distributing objects.** Accept a
  process boundary only where it is forced or proven necessary, and budget central logging,
  OpenTelemetry tracing, eventual consistency, and contract versioning with it. *[PoEAA ch. 7;
  FoSA ch. 9]*
- **Match chattiness to boundary cost.** Network calls need coarse requests that return only the
  fields the caller needs. *[Clean Architecture ch. 18; PoEAA ch. 7; FoSA ch. 9]*
- **Give every outbound call a deliberate timeout and a failure path,** authenticate internal
  calls too, and disable automatic redirects on clients that carry a token. *[FoSA ch. 9;
  ArchPatterns ch. 10; Review lessons]*
- **Give each service sole ownership of its data; never integrate through a shared schema.**
  *[FoSA ch. 17; ArchPatterns ch. 9]*
- **When services need a shared transaction, move the boundary before reaching for a saga.** If
  a saga remains, run it on a durable workflow engine with idempotent, compensating steps.
  *[FoSA ch. 17; SAP-Richards ch. 2, 4; ArchPatterns ch. 10]*
- **Do not mistake a service split for decoupling.** Services that share data records or need a
  coordinated change per feature are still coupled. *[Clean Architecture ch. 27]*
- **Keep gateways and brokers free of business logic.** Logic there turns the broker into a
  service bus that every service is coupled to. *[FoSA ch. 17; SAP-Richards ch. 4]*
- **Put a queue between parts whose throughput differs widely.** A synchronous call binds both
  sides to the weaker one's limits. *[FoSA ch. 7; ArchPatterns ch. 10]*

## State and transactions

- **Push logic into immutable, side-effect-free code and confine mutation to a small guarded
  part.** *[Clean Architecture ch. 6; PoEAA ch. 5]*
- **Fit each business transaction into one database transaction whenever possible,** and treat
  the optimistic-versus-pessimistic choice as a product decision. *[PoEAA ch. 5]*
- **Keep application servers stateless between requests;** session data goes in an external store
  or a signed token. *[PoEAA ch. 6; ArchPatterns ch. 7]*
- **Model operational (transactional) and analytical data separately, with their own shapes and
  stores,** and keep both usable through any re-architecture. *[SA Hard Parts ch. 1]*

## Decision records and design docs

- **Write an ADR for decisions that affect structure, quality attributes, dependencies,
  interfaces, or construction technique.** Skip choices any competent team would make by default.
  *[FoSA ch. 19; Architect Elevator ch. 8]*
- **Use numbered Markdown ADRs in the repo:** Title, Status, Context (problem and alternatives),
  Decision ("We will..."), Consequences (trade-offs), Compliance (ideally an automated check).
  Supersede instead of editing, with links both ways. *[FoSA ch. 19; SA Hard Parts ch. 1]*
- **Keep one source for each decision and link to it;** write standards as ADRs that state why
  they exist. *[FoSA ch. 19]*
- **Require an ADR with every design submitted for review, and ask why until each assumption is
  written down;** recheck assumptions that may no longer hold. *[Architect Elevator ch. 7]*
- **Cite code by symbol name in architecture docs, never by line number, and never type counts by
  hand.** *[Review lessons]*
- **When a change alters structure, update every ADR, diagram, and README sentence that describes
  it in the same change.** *[Review lessons]*

## Governance and fitness functions

- **Encode checkable architecture rules as fitness functions that run on every change.** Use
  ArchUnit, NetArchTest, dependency-cruiser, eslint-plugin-boundaries, or import-linter for cycles
  and layer rules, plus holistic checks where characteristics interact. Keep the set short and
  explain each rule before enforcing it. *[FoSA ch. 6; SA Hard Parts ch. 1]*
- **Use a fitness function for domain-independent structure and a unit test for domain rules.**
  *[SA Hard Parts ch. 1]*
- **Never relax a correctness rule globally; scope each suppression to the file that needs it.**
  *[Review lessons]*
- **After fixing an architecture violation, search for the same shortcut and fix every instance
  in the same change.** *[Review lessons]*
- **Make the compliant path the easiest one,** and standardize interfaces and connectors rather
  than end products. *[Architect Elevator ch. 15, 32]*
- **Treat configuration that decides structure or execution order as code:** versioned,
  validated before merge, and tested. *[Architect Elevator ch. 11, 14]*

## Diagrams

- **Give every line a defined meaning and label every element.** Solid for synchronous calls,
  dashed for asynchronous; box-only pictures say nothing about behavior. *[FoSA ch. 21; Architect
  Elevator ch. 23]*
- **Keep each diagram to one viewpoint and one level of abstraction,** and draw proposals in
  sketch style. *[Architect Elevator ch. 21, 22]*
- **Treat a module you cannot draw cleanly as a design smell.** *[Architect Elevator ch. 22, 24]*

## Tensions

- **Synchronous by default vs event-first.** This library uses sync inside a quantum and async
  between quanta whose scale or availability differ, or for long-running work. *[FoSA ch. 7, 18;
  ArchPatterns ch. 1]*
- **"The database is a detail" vs "invariants live in the database".** This library keeps SQL in
  the adapter but enforces uniqueness, limits, and serialization with database constraints and
  locks. *[Clean Architecture ch. 30; Review lessons]*
- **Keep options open vs avoid speculative generality.** Price every option; buy expensive ones
  only where uncertainty is named. When the platform is fixed on day one, keep the core
  independent of it rather than delaying the choice. *[Architect Elevator ch. 9; Clean
  Architecture ch. 15]*
- **Full Clean Architecture ceremony vs simple code.** Scale ports, interactors, and per-use-case
  models to system size and lifetime; CRUD apps and scripts start with partial boundaries.
  *[Clean Architecture ch. 24, 25; FoSA ch. 8]*
- **Horizontal rings vs package-by-component.** This library keeps the dependency rule and prefers
  package-by-component with compiler-enforced visibility. *[Clean Architecture ch. 22, 34]*
- **DRY vs duplication between services.** DRY applies inside a module or bounded context; across
  deployables, a small copy beats a shared dependency. *[FoSA ch. 16, 17; Architect Elevator
  ch. 35; SAP-Richards ch. 4]*
- **Shared database vs database per service.** This library defaults to private data per service
  and allows sharing only in a documented service-based design or modular monolith with tables
  separated by domain. *[SAP-Richards ch. 4; FoSA ch. 13, 17; ArchPatterns ch. 9]*
- **Thin vs rich service layer.** Thin when a domain model exists; thicker services are acceptable
  for CRUD-heavy code. *[PoEAA ch. 2]*
- **ADRs in a wiki vs in the repo.** Application ADRs live in the repository so agents read them
  with the code; a wiki suits enterprise-wide decisions. *[FoSA ch. 19]*
- **Dated material.** JDepend, JMS acknowledge modes, Java EE products, and style ratings that
  assume monthly releases are restated with current tools; SA Hard Parts rules come from an
  excerpt of its first two chapters; FoSA chapter numbers follow the 1st edition, not the 2nd.
  *[FoSA ch. 6, 14; SAP-Richards Appendix A; SA Hard Parts ch. 1, 2]*

## Sources

- **FoSA**: Fundamentals of Software Architecture: An Engineering Approach (Mark Richards, Neal
  Ford; O'Reilly, 1st ed., 2020)
- **SAP-Richards**: Software Architecture Patterns (Mark Richards; O'Reilly, 1st ed., 2015)
- **SA Hard Parts**: Software Architecture: The Hard Parts (Neal Ford, Mark Richards, Pramod
  Sadalage, Zhamak Dehghani; O'Reilly, 1st ed., 2021)
- **Clean Architecture**: Clean Architecture: A Craftsman's Guide to Software Structure and Design
  (Robert C. Martin; Prentice Hall, 1st ed., 2018)
- **Architect Elevator**: The Software Architect Elevator (Gregor Hohpe; O'Reilly, 1st ed., 2020)
- **ArchPatterns**: Architectural Patterns (Pethuru Raj, Anupama Raman, Harihara Subramanian;
  Packt, 1st ed., 2017)
- **PoEAA**: Patterns of Enterprise Application Architecture (Martin Fowler, with David Rice,
  Matthew Foemmel, Edward Hieatt, Robert Mee, Randy Stafford; Addison-Wesley, 2002)
- **Review lessons**: rules distilled from the maintainer's code-review findings
