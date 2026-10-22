# Object-oriented design patterns and SOLID

> **Load when:** choosing, applying, reviewing, or removing a GoF design pattern (factory, builder,
> singleton, adapter, facade, decorator, proxy, composite, strategy, state, observer, command,
> template method, visitor, and the rest), designing class hierarchies, interfaces, or object
> wiring, checking code against SOLID or composition-over-inheritance, or picking enterprise
> application patterns (transaction script vs domain model, active record vs data mapper, unit of
> work, value objects, MVC, remote facade and DTOs).
> **See also:** [Code and module design](../core/code-design.md), [Refactoring and legacy
> code](../core/refactoring-and-legacy-code.md), [Software architecture
> fundamentals](../architecture/architecture-fundamentals.md), [Domain-driven
> design](../architecture/domain-driven-design.md), [Unit, integration, and test-driven
> development](../testing/testing.md), [SQL and query
> performance](../data/sql-and-query-performance.md), [Concurrency and
> parallelism](../concurrency/concurrency.md), [Front-end components and
> state](../frontend/components-and-state.md)

## Top rules

1. **Add a pattern only when you can name the concrete variation or pain it removes in this code
   now.** Every pattern adds classes and indirection; speculative flexibility is needless
   complexity. Refactor toward the pattern when the change actually arrives, and take it out again
   when the flexibility it bought is never used. *[GoF 1.8; HFDP ch. 13; DIDP Features of Good
   Design; APPP ch. 9, 22, 32]*
2. **Prefer composition and delegation to class inheritance for reusing behaviour.** Inherited
   behaviour is fixed at compile time and coupled to the parent's internals; composed objects can
   be swapped at run time and change independently. Subclass only for a true behavioural is-a.
   *[GoF 1.6; HFDP ch. 1; DIDP Favor Composition Over Inheritance]*
3. **Declare fields, parameters, and return types with the narrowest interface the caller needs,
   and name concrete classes in one place only.** Clients that know only the abstraction survive
   implementation swaps; the concrete choice lives in a factory or the composition root.
   *[GoF 1.6; HFDP ch. 1, 4; DIDP Program to an Interface; APPP ch. 11]*
4. **Make every override substitutable for its base type.** Accept at least what the base accepts,
   guarantee at least what it guarantees, throw no new exception kinds, and never stub out an
   inherited method with "not supported"; a caller that type-checks a subtype is the symptom.
   *[DIDP LSP; APPP ch. 10; GoF 1.6]*
5. **Choose between look-alike patterns by intent, and name the class after that intent.**
   Adapter converts an interface, Facade simplifies one, Decorator keeps it and adds behaviour,
   Proxy keeps it and controls access; a pattern name that does not match the code misleads every
   reviewer. *[GoF Discussion of Structural Patterns; HFDP ch. 7, 11; DIDP Relations; Review
   lessons]*
6. **Do not use Singleton or a global registry for application objects.** Create one instance at
   the composition root and inject it; "exactly one" is a wiring decision, and a cross-process "only
   one" must be enforced by the database or a lock, not by a class. *[GoF Singleton; HFDP ch. 5;
   DIDP Singleton; APPP ch. 24; PoEAA Registry; Review lessons]* (updated: see Tensions)
7. **In languages with first-class functions, pass a function for single-method Strategy,
   Command, or Template Method hooks.** One class per variant is ceremony until the interface needs
   a second method such as `undo()`. *[HFDP ch. 6; DIDP Strategy]*
8. **Give every request through a chain, observer list, or dispatcher a defined outcome and no
   hidden order dependence.** Add a terminal handler for unhandled requests, and never rely on the
   order in which observers are notified. *[GoF Chain of Responsibility; HFDP ch. 2; DIDP Chain of
   Responsibility, Observer]*
9. **Keep SQL and third-party API types out of domain objects.** Concentrate them in gateways,
   mappers, or adapters whose interfaces the domain owns, so a schema or vendor change touches one
   layer. *[PoEAA ch. 3; APPP ch. 34; DIDP Adapter]*

## Deciding whether to use a pattern

- **Start with plain code and refactor into a pattern on a named signal.** A switch on mode or
  status repeated across methods points to State; scattered `new ConcreteX()` points to a factory;
  a growing algorithm conditional points to Strategy. *[HFDP ch. 13; GoF 6 Conclusion; APPP ch. 32]*
- **Take the first bullet.** Write code as if it will not change; when a change of a given kind
  arrives, add the abstraction that protects against further changes of that kind, and only that
  kind. *[APPP ch. 9; HFDP ch. 13]*
- **Read a pattern's consequences before adopting it.** Intent and applicability confirm the match;
  consequences and implementation notes list the liabilities your design must live with.
  *[GoF 1.8; HFDP ch. 13]*
- **Write down the complexity a pattern adds in the PR or design note.** "More classes and
  interfaces" is a cost on nearly every pattern; state what variation pays for it.
  *[DIDP Pros and Cons; APPP ch. 22]*
- **Adapt a pattern to local constraints and document how your version differs from the classic.**
  Patterns are blueprints, not code to paste; a recorded deviation keeps the vocabulary accurate.
  *[DIDP What's a Design Pattern?; HFDP ch. 13; PoEAA Preface]*
- **Do not stack patterns onto a problem to show coverage.** A design built by combining every
  applicable pattern is overkill; wrapping a whole main loop in Template Method made one program
  bigger and bought nothing. *[HFDP ch. 12; APPP ch. 22]*
- **Watch for the Golden Hammer.** Reaching for the same familiar pattern on every problem is an
  anti-pattern; name the alternative you rejected. *[HFDP ch. 13]*
- **Keep the claims in names, comments, and docs true to the code.** A docstring that promises
  notification order, "never throws", or "at most one instance" must match the implementation;
  recheck it whenever the pattern's wiring changes. *[Review lessons; DIDP Why Should I Learn
  Patterns?]*
- **After fixing a defect in one implementation of an interface, sweep its siblings.** The same bug
  in one strategy, handler, decorator, or adapter usually exists in the others; fix them in the
  same change. *[Review lessons]*

## Core object-oriented principles

- **Find what varies and wrap it behind its own abstraction.** Start with an extracted method;
  promote it to a class once it grows its own fields and helpers. *[GoF 1.7; HFDP ch. 1; DIDP
  Encapsulate What Varies]*
- **When a class varies along two independent dimensions, give each dimension its own type and
  delegate.** One subclass per combination multiplies the class count. *[DIDP Favor Composition;
  GoF Bridge]*
- **Do not reject a strategy, state, or policy class because it has no real-world counterpart.**
  Such objects make designs flexible; a one-for-one model reflects only today's requirements.
  *[GoF 1.6; APPP ch. 26]*
- **Partition classes by behaviour and messages, not by nouns in the spec.** Noun-driven splits
  produce vapor classes that only forward calls around a hidden god class. *[APPP ch. 20]*
- **Call methods only on `this`, parameters, objects you created, and your own fields (Law of
  Demeter).** Ask the collaborator to do the work instead of chaining `a.getB().getC().run()`;
  fluent builders and pipelines over values are fine. *[HFDP ch. 7]*
- **Let high-level components decide when low-level ones run (Hollywood Principle).** Low-level
  code plugs in as hooks or callbacks and never calls up into the high-level flow; a cycle of up,
  down, and sideways calls is dependency rot. *[HFDP ch. 8]*
- **State intended run-time relationships explicitly.** The class hierarchy does not show who owns
  whom or who observes whom; document ownership versus acquaintance in the type or a comment.
  *[GoF 1.6]*

## SOLID

Module- and component-level principles (package cohesion, acyclic dependencies, stability metrics)
live in [Code and module design](../core/code-design.md). The class-level rules:

- **Single responsibility: split a class when two different actors or rates of change drive it.**
  Business rules and persistence, or computation and rendering, change for unrelated reasons;
  do not split responsibilities that never change separately. *[APPP ch. 8; HFDP ch. 9; DIDP SRP]*
- **Open/closed: add a variant as a new class or function behind an existing interface, but only at
  extension points that have actually moved.** Closure everywhere produces unreadable layers;
  choose extension points from observed change. *[APPP ch. 9; HFDP ch. 3; DIDP OCP]*
- **Open/closed is no excuse to route around a bug.** Fix the defect in the class that has it
  rather than subclassing past it. *[DIDP OCP]*
- **Liskov: judge a subtype by what clients assume, not by a real-world is-a.** A square that
  couples width to height breaks callers that set them separately; factor a common base instead of
  deriving one from the other. *[APPP ch. 10; DIDP LSP]*
- **Liskov: check overrides against the full contract.** Parameter types same or wider, return
  types same or narrower, preconditions no stricter, postconditions no weaker, invariants kept, and
  no meddling with the parent's private state; compilers check only the type rules.
  *[DIDP LSP; APPP ch. 10]*
- **Liskov: put each base-type contract in a test that every subtype must pass.** Contract tests
  catch substitution breaks that type checkers and dynamic languages miss. *[APPP ch. 10; DIDP LSP]*
- **Liskov: put the narrower capability at the base.** If a subtype must disable a method, invert
  the hierarchy, for example a read-only base and a writable subtype that adds saving.
  *[DIDP LSP; APPP ch. 10]*
- **Interface segregation: give each client an interface with only the methods it calls.** A fat
  interface makes one client's change ripple into unrelated clients and forces stub methods; one
  object can implement several small interfaces. *[APPP ch. 12; DIDP ISP]*
- **Dependency inversion: let the policy module own the interface, named in its terms, and have
  infrastructure implement it.** Business code calls "save report", not a sequence of file calls;
  the interface changes only when its client needs it to. *[APPP ch. 11; DIDP DIP; HFDP ch. 4]*
- **Depend on concrete types only when they are stable.** Strings and value types are fine; hide
  volatile application classes and external services behind interfaces. *[APPP ch. 11; HFDP ch. 4]*
- **Route cross-cutting services such as the clock through one injected instance, not static
  calls.** A single clock or date helper behind an interface keeps zone handling consistent and
  lets tests pin the time; static service calls cannot be swapped in tests.
  *[Review lessons; APPP ch. 37]*
- **Apply SOLID as review lenses, not a checklist, and record why you break one on purpose.** The
  "never derive from a concrete class" guideline is an aspiration; volatility decides.
  *[DIDP SOLID introduction; HFDP ch. 4; APPP ch. 11]*

## Creational patterns

- **Put creation that varies in one factory instead of repeating type-switch `new` logic.** Every
  client then has one point of change when the set of concrete types changes. *[HFDP ch. 4; GoF
  Designing for Change]*
- **Do not add factories by default.** Add one to hide a volatile concrete type, swap a family of
  implementations, pool or reuse instances, or fake creation in tests. *[APPP ch. 29; GoF
  Discussion of Creational Patterns; DIDP Factory Method]*
- **Start with plain construction or a factory method and move to Abstract Factory, Builder, or
  Prototype only when a need appears.** *[GoF Discussion of Creational Patterns; DIDP Factory
  Method Relations]*
- **Use Abstract Factory only for product families whose membership is stable.** Adding a product
  kind changes the factory interface and every concrete factory; pick the concrete factory once at
  startup and inject it. *[GoF Abstract Factory; HFDP ch. 4; DIDP Abstract Factory]*
- **Select factory products with an enum or type, and parse external keys at the boundary.** A
  free-form string key fails only at run time; a config or request value is validated into the enum
  before it reaches the factory, and a registry backed by a plain object uses an own-property check
  such as `Object.hasOwn`, never `in`, so inherited keys cannot resolve. *[HFDP ch. 4; Review
  lessons]*
- **Use a factory or builder to guarantee required wrappers.** If every instance needs a decorator,
  proxy, or instrumentation, apply it in creation code so clients cannot hold an unwrapped object.
  *[HFDP ch. 3, 11, 12]*
- **Use Builder for multistep or recursive construction, and never expose the half-built product.**
  For simple optional fields, prefer named or default arguments or an options object (updated).
  *[GoF Builder; DIDP Builder; HFDP Appendix]*
- **Use Prototype when subclasses would differ only in configuration, and state deep versus shallow
  copy explicitly.** Test circular references; prefer the platform's structured-clone or record copy
  over hand-written cloning. *[GoF Prototype; DIDP Prototype; HFDP Appendix]*
- **If a single instance is unavoidable, use the platform's thread-safe once-only idiom.** A module
  instance, a static holder, an enum, or `lazy`, not the double-checked locking HFDP teaches
  (updated); beware class loaders and deserialization creating extra copies. *[HFDP ch. 5; DIDP
  Singleton; GoF Singleton]*

## Behavioral patterns

- **Replace an algorithm-selecting conditional with Strategy only when callers really choose among
  several variants.** Two rarely changing branches stay a conditional; callers must understand the
  differences to pick one. *[GoF Strategy; DIDP Strategy; PoEAA ch. 2]*
- **Make shared strategy and state objects stateless, passing per-call data from the context.**
  A shared object that keeps state between calls leaks data across users and requests.
  *[GoF Strategy, State; HFDP ch. 10]*
- **Choose Template Method for one likely variation and Strategy for several interchangeable ones.**
  If you use Template Method, make the template final, keep required steps few, and provide
  optional steps as hooks with defaults. *[APPP ch. 22; HFDP ch. 8; GoF Template Method; DIDP
  Template Method]*
- **Use State when behaviour depends on state across many operations and the states change
  often.** Clients never set the context's state directly; put fixed transitions in the context
  and data-dependent ones in the states. *[GoF State; HFDP ch. 10; DIDP State]*
- **Pick the state-machine implementation by size.** A switch for a tiny machine, a transition
  table when the rules should be data, State classes when actions are rich.
  *[APPP ch. 36; GoF State]*
- **Make subject state consistent before notifying observers, and notify last.** Observers read
  the subject during update; a subclass that changes state after an inherited notifying call
  exposes half-updated state. *[GoF Observer]*
- **Guard Observer against cascades and leaks.** Batch related changes into one notification, let
  observers subscribe to specific events, and unsubscribe in the same scope that subscribed
  (disposables, abort signals, effect cleanup) or hold observers weakly. *[GoF Observer; DIDP
  Observer; Review lessons]*
- **Push immutable event payloads or let observers pull, but choose deliberately.** Pushing every
  field grows the update signature; pulling couples observers to getters and races with later
  changes. *[GoF Observer; HFDP ch. 2]*
- **Drop stale notifications in async observers.** Tag each request with an id and ignore
  responses that arrive after a newer one, and cancel timers when the observer is torn down.
  *[Review lessons]*
- **Use Command to queue, log, schedule, retry, or undo a request, and keep commands dumb.** A
  command delegates to a receiver; composite actions are macro commands built at run time.
  *[GoF Command; HFDP ch. 6; DIDP Command]*
- **Record the prior state a command needs before it executes, and keep history in a stack.**
  Undo restores what was there, not a default; copy a command before storing it if its state
  changes later. *[GoF Command; HFDP ch. 6; DIDP Command]*
- **Persist logged commands or mementos in an explicit, versioned schema.** Native object
  serialization is brittle and a deserialization attack surface. *[HFDP ch. 6 (updated)]*
- **Have each chain handler decide separately whether to handle and whether to pass on.** Keep
  chains immutable unless they must change, and log which handler took the request.
  *[DIDP Chain of Responsibility; HFDP Appendix]*
- **Use Mediator when components are too interconnected to change alone, and split it before it
  becomes a god object.** *[GoF Mediator; DIDP Mediator; HFDP Appendix]*
- **Prefer Facade when a policy should be visible and conventional, Mediator when it should be
  applied to objects that do not know about it.** A facade works only while no caller bypasses it.
  *[APPP ch. 23; GoF Mediator]*
- **Never mutate a collection during iteration unless the iterator documents that it is safe.**
  Collect changes and apply them after the loop; do not assume an order the collection does not
  promise. *[GoF Iterator; HFDP ch. 9]*
- **Make mementos immutable and opaque, created by the owner, and cap the history.** Large or
  unbounded snapshots exhaust memory; freeze or copy them in dynamic languages.
  *[GoF Memento; DIDP Memento; HFDP Appendix]*
- **Use Visitor only when element types are stable and operations keep growing.** In languages
  with sum types and exhaustive matching, prefer a sealed type and a `switch` the compiler checks.
  *[GoF Visitor; DIDP Visitor; APPP ch. 35; HFDP Appendix]*
- **Return a Null Object or Special Case instead of null when callers would all repeat the same
  check.** Return an empty collection rather than a dedicated null collection class.
  *[HFDP ch. 6; APPP ch. 25, 26; PoEAA ch. 18]*

## Structural patterns

- **Wrap an incompatible legacy or third-party class in an Adapter and keep all translation there;
  if you own the class and the change is cheap, change it instead.** Prefer a wrapping adapter so
  it works for the adaptee's subclasses. *[GoF Adapter; HFDP ch. 7; DIDP Adapter; APPP ch. 33]*
- **When an adapter cannot support an operation, fail loudly with an "unsupported" error and
  document it.** A silent no-op hides the gap; better still, narrow the target interface.
  *[HFDP ch. 7, 9]*
- **Put a narrow Facade over a complex subsystem or framework, and still let advanced clients reach
  the subsystem.** Route ordinary calls through it so an upgrade touches one place; split a facade
  that grows into a god object. *[GoF Facade; HFDP ch. 7; DIDP Facade]*
- **Use Decorators for optional, combinable responsibilities instead of a subclass per
  combination.** Keep the base type thin, write each decorator so its result does not depend on
  its position, and assemble the stack in one readable place. *[GoF Decorator; HFDP ch. 3; DIDP
  Decorator]*
- **Never rely on identity or concrete-type checks across a decorator.** A wrapped object is not
  the inner object, and a decorator must not inspect the rest of the chain. *[GoF Decorator;
  HFDP ch. 3]*
- **Give each Proxy one access concern: remote, lazy, cache, or permission.** Hand it out through
  a factory so callers never hold the real subject. *[GoF Proxy; HFDP ch. 11; DIDP Proxy]*
- **Never make a remote proxy look fully local.** Surface network failure in the interface's
  contract, give outbound clients that carry credentials a timeout and disabled redirects, and keep
  arguments serializable. *[HFDP ch. 11; PoEAA ch. 7; Review lessons]*
- **Use Composite only when the domain is truly a tree and callers should treat leaves and groups
  alike.** Decide transparency versus safety deliberately, and prefer the safe form with a sum or
  sealed type where the language makes it cheap. *[GoF Composite; HFDP ch. 9; DIDP Composite]*
- **Maintain parent and child links only inside add and remove.** Then the two sides cannot drift
  out of step. *[GoF Composite]*
- **Prefer Adapter to Bridge; use Bridge only with evidence that two dimensions vary
  independently.** Bridge is designed up front and considerably more complex. *[APPP ch. 33;
  DIDP Bridge; GoF Bridge]*
- **Use Flyweight only after measuring a memory problem, and keep shared state immutable.** Every
  precondition must hold: very many objects, mostly extrinsic state, and no identity dependence.
  *[GoF Flyweight; DIDP Flyweight]*

## Enterprise application patterns

- **Pick the domain-logic style by complexity.** Transaction Script for simple logic, Domain Model
  when rules are complex and changing; refactor from script to model once duplication and
  conditionals pile up. *[PoEAA ch. 2]*
- **Choose one primary persistence pattern.** Active Record when classes map one-to-one onto
  tables; Data Mapper (normally a mature ORM) when the model diverges from the schema or must be
  tested without a database. *[PoEAA ch. 3]*
- **Track changes in a Unit of Work and commit them together, and load each row at most once per
  unit with an Identity Map.** Scattered `save()` calls and duplicate in-memory copies cause lost
  and conflicting updates. *[PoEAA ch. 3]*
- **Put finders on injectable finder or repository objects, not static methods, and carry the
  tenant id in every finder and update.** Static finders cannot be stubbed; a lookup by id alone
  can return another tenant's row. *[PoEAA ch. 3; Review lessons]*
- **Load the subgraph each use case needs in one query.** Lazy placeholders read in a loop are the
  N+1 problem; see [SQL and query performance](../data/sql-and-query-performance.md).
  *[PoEAA ch. 3, 11]*
- **Make value objects immutable with field-based equality, and model money as amount plus
  currency in integer minor units or fixed decimal.** Allocate splits so no cents are lost; never
  add different currencies. *[PoEAA ch. 18]*
- **Lock an aggregate as a unit and make locking implicit in the mapper or base type.** Application
  code cannot forget a lock it never has to take; version-column details are in [Database
  operations](../data/database-operations.md). *[PoEAA ch. 5, 16]*
- **Keep domain logic out of controllers and views (MVC).** The controller translates input into
  model calls and picks a view; the model never depends on views. *[PoEAA ch. 4; HFDP ch. 12]*
- **Put a coarse-grained Remote Facade and plain DTOs at any process boundary, never domain
  objects.** Each remote call costs far more than a local one, so batch the data a use case needs
  into one call. *[PoEAA ch. 7, 15]*

## Tensions

- **Singleton as a tool vs Singleton as an anti-pattern.** GoF, HFDP, and DIDP teach it; this
  library treats it as global state that hides dependencies and blocks test isolation, and uses
  one instance registered at the composition root or DI container. A language-level singleton wins
  only for stateless, process-wide infrastructure. *[GoF Singleton; HFDP ch. 5; DIDP Singleton;
  APPP ch. 24]*
- **Design for change vs YAGNI.** GoF urges anticipating change; APPP and HFDP say add flexibility
  only for change that has happened or is clearly coming. This library refactors toward patterns
  when variation appears, and invests up front only in seams that are expensive to move later
  (public APIs, persistence schemas, service boundaries). *[GoF 1.6; APPP ch. 9; HFDP ch. 13]*
- **Template Method vs composition over inheritance.** Every source recommends both. This library
  prefers passed-in steps (Strategy or functions) and uses Template Method only where a framework
  already expects subclassing. *[GoF Template Method; HFDP ch. 8; DIDP Template Method; APPP
  ch. 22]*
- **Composite transparency vs safety.** GoF and HFDP's main examples choose transparency. This
  library prefers safety where sum or sealed types exist, and transparency when clients genuinely
  must treat every node uniformly. *[GoF Composite; HFDP ch. 9]*
- **Observer push vs pull.** HFDP calls pull more correct. This library pushes immutable event
  payloads by default, because pull races with later changes, and pulls only when payloads would
  be large and most observers ignore them. *[HFDP ch. 2; GoF Observer]*
- **Visitor vs pattern matching.** The books predate mainstream sum types. Use exhaustive matching
  where available; keep Visitor for languages without it or for open plug-in operations.
  *[GoF Visitor; DIDP Visitor; APPP ch. 35]*
- **Open/closed by subclassing vs editing.** DIDP suggests subclassing a tested class rather than
  editing it. This library edits code that tests protect and extends through composition.
  *[DIDP OCP; APPP ch. 9]*
- **Thin vs rich Service Layer.** Fowler prefers thin services over a dominant domain model; many
  CRUD codebases do well with thicker services. Follow domain complexity and the project's
  convention; see [Domain-driven design](../architecture/domain-driven-design.md). *[PoEAA ch. 2]*

## Sources

- **GoF**: Design Patterns: Elements of Reusable Object-Oriented Software (Erich Gamma, Richard
  Helm, Ralph Johnson, John Vlissides, 1994)
- **HFDP**: Head First Design Patterns (Eric Freeman, Elisabeth Robson, with Kathy Sierra and Bert
  Bates, 2nd ed., 2020)
- **DIDP**: Dive Into Design Patterns (Alexander Shvets, Refactoring.Guru, 2021)
- **APPP**: Agile Principles, Patterns, and Practices in C# (Robert C. Martin, Micah Martin, 2006)
- **PoEAA**: Patterns of Enterprise Application Architecture (Martin Fowler, with David Rice,
  Matthew Foemmel, Edward Hieatt, Robert Mee, Randy Stafford, 2002)
- **Review lessons**: rules distilled from the maintainer's code-review findings
