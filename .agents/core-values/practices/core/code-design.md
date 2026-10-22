# Code and module design

> **Load when:** writing, extending, or reviewing any function, class, module,
> or interface; naming things; deciding where code, errors, comments,
> constants, or configuration belong; choosing between two designs; or judging
> whether a change made the code simpler or more complex.
> **See also:** [Refactoring and legacy code](../core/refactoring-and-legacy-code.md),
> [Design patterns and SOLID](../design/design-patterns.md),
> [Unit, integration, and TDD](../testing/testing.md),
> [Debugging](../core/debugging.md),
> [Architecture fundamentals](../architecture/architecture-fundamentals.md),
> [Concurrency](../concurrency/concurrency.md),
> [Application security](../security/application-security.md)

## Top rules

1. **Judge every design choice by whether it leaves the system easier to
   understand and change.** Look for change amplification, cognitive load, and
   unknown unknowns, as a first-time reader sees them. *[APoSD ch. 2; PragProg
   Topic 8; Code Simplicity ch. 6; Agile PPP ch. 5]*
2. **Make modules deep: a small, simple interface over a lot of hidden
   work.** Put each design decision in exactly one module and expose
   operations, not the internal representation. *[APoSD ch. 4, ch. 5; Clean
   Code ch. 17 G8]*
3. **Give each piece of knowledge one authoritative home, but do not merge
   code that only looks alike.** Duplicated rules drift; merged look-alikes
   couple unrelated changes. *[PragProg Topic 9; Code Simplicity ch. 5;
   97 Things Don't Repeat Yourself; 97 Things Beware the Share]*
4. **Name things for their role and intent, use one word per concept, and
   rename when the meaning drifts.** A name that will not come out precise
   means the thing does more than one job. *[Clean Code ch. 2, ch. 17 N1;
   APoSD ch. 14; PragProg Topic 44]*
5. **Make each function do one thing at one level of abstraction, with no flag
   arguments and no hidden side effects.** Split for a cleaner abstraction,
   never for line count alone. *[Clean Code ch. 3; APoSD ch. 9; 97 Things
   Convenience Is Not an -ility]*
6. **Build only what current, evidenced requirements need, and delete what
   nothing uses.** Speculative hooks, options, and fields cost upkeep and are
   usually wrong when the real need arrives. *[Code Simplicity ch. 4; Agile
   PPP ch. 9; 97 Things Improve Code by Removing It]*
7. **Parse external input at the boundary, fail fast on the impossible, and
   never swallow an error.** A crashed program does less damage than one that
   keeps writing corrupt data. *[Review lessons §2 Parse at the boundary;
   PragProg Topic 24; 97 Things Don't Ignore That Error!]*
8. **Enforce invariants with structure, not convention.** Types, exhaustive
   enums, unique indexes, and locks hold; a comment, naming rule, or
   in-process flag does not. *[Clean Code ch. 17 G27; Agile PPP ch. 10;
   Review lessons §2 Invariants live in the database]*
9. **Comment only what the code cannot say, and keep every comment exactly
   true.** A docstring promising an order or "never throws" is contract and
   must match the code. *[APoSD ch. 13; Clean Code ch. 4; Review lessons §1
   Claims audit]*
10. **Follow the conventions of the code you are in, and leave touched code
    slightly cleaner within the task's scope.** *[APoSD ch. 17; Code
    Simplicity ch. 6; Clean Code ch. 1; 97 Things The Boy Scout Rule]*

## Functions and methods

- **Test "does one thing" by trying to extract a piece under a name that does
  not restate the function.** If you can, it does two things. *[Clean Code
  ch. 17 G30, G34; CC Tips ch. 4]*
- **Extract a subtask only when it can be understood without its parent.** If
  readers flip between parent and child to follow either, join them; 10 to 20
  lines is a cue to look, not a limit. *[APoSD ch. 9; Clean Code ch. 3]*
- **Replace boolean or enum selector arguments with separately named
  functions, and at three or more parameters introduce a parameter object.**
  `render(doc, true)` hides intent. *[Clean Code ch. 3, ch. 17 F3, G15;
  97 Things Convenience Is Not an -ility; 97 Things Coding with Reason]*
- **Separate commands from queries, and return results rather than filling
  output arguments.** `if (set(key, v))` should never appear. *[Clean Code
  ch. 3; CC Tips ch. 4]*
- **Put every side effect in the name, or remove it.** A lazily creating
  getter is `getOrCreate`; a password check must not quietly start a session.
  *[Clean Code ch. 3, ch. 17 N7; CC Tips ch. 13]*
- **Make required call order structural** by having each step return what the
  next consumes. *[Clean Code ch. 17 G31; PragProg Topic 33]*
- **Prefer functions that take inputs and return outputs over methods that
  mutate long-lived member state.** A pipeline of transformations shows where
  a bad value came from. *[97 Things Apply Functional Programming Principles;
  PragProg Topic 30]*
- **Name complex conditions and intermediate values.** Use positive predicates
  (`shouldCompact()`, not `!shouldNotCompact()`); compute `level + 1` once.
  *[Clean Code ch. 17 G19, G28, G29, G33; Agile PPP ch. 5]*

## Names

- **Name for the domain role, including units.** `elapsedSeconds`, not `d`; if
  a reader must open the body to learn what a function does, rename it. A
  misleading name is worse than a meaningless one. *[Clean Code ch. 17 N1,
  G20; CC Tips ch. 3; PragProg Topic 44]*
- **Use one word per concept everywhere, and the same field names for the same
  concept across types.** Do not mix get, fetch, and retrieve; use the project
  glossary's terms. *[Clean Code ch. 2; APoSD ch. 14; Code Simplicity ch. 6;
  PragProg Topic 45]*
- **Drop noise words.** `data`, `info`, `result`, number suffixes, and pairs like
  `Account` and `AccountInfo` carry no distinction; `Manager` often marks a
  class with too many jobs. *[APoSD ch. 14; CC Tips ch. 3]*
- **Scale name length with scope.** Single letters only for tiny loops; widely
  used names must be precise and greppable. *[Clean Code ch. 17 N5; APoSD
  ch. 14]*
- **Name booleans as predicates (`isVisible`) and do not encode type or scope
  in names;** follow the project's existing prefix and casing conventions.
  *[APoSD ch. 14; Clean Code ch. 17 N6; Agile PPP ch. 21]*

## Modules and interfaces

- **Pull complexity down into the module rather than up onto its callers.** It
  has more users than authors, so a simple interface beats a simple body.
  *[APoSD ch. 8]*
- **Make the common case the simplest call and the right behavior the
  default.** Put rare options behind a separate method. *[APoSD ch. 4, ch. 5]*
- **Make correct use easy and misuse hard.** Write the calling code or a test
  before the API, then shape it around the values callers naturally pass.
  *[97 Things Make Interfaces Easy to Use Correctly and Hard to Use
  Incorrectly; Agile PPP ch. 4]*
- **Group code by the knowledge it needs, not by execution order.** Read,
  parse, and write stages that all know a file format leak it across three
  modules. *[APoSD ch. 5; Clean Code ch. 17 G22]*
- **Expose operations, not representation, and hide only what callers do not
  need.** Return `param(name)`, not the internal map; never hide when data
  becomes durable or a failure callers must handle. *[APoSD ch. 4, ch. 5,
  ch. 10; 97 Things WET Dilutes Performance Bottlenecks; CC Tips ch. 7]*
- **Make a new module's interface somewhat general and its implementation
  today-sized.** One general method beats several special cases unless it
  pushes extra arguments or loops onto callers. *[APoSD ch. 6]*
- **Do not shatter code into tiny classes, pass-through methods, or shallow
  wrappers.** Keep pieces together when they share knowledge or cannot be
  understood apart, and give each layer a different abstraction. *[APoSD
  ch. 4, ch. 7, ch. 9; Clean Code ch. 12; Agile PPP ch. 20]*
- **Separate general mechanism from special-purpose policy,** and express
  policy as data, such as an access rule table instead of an `if` at every
  read. *[APoSD ch. 9; PragProg Topic 45; Agile PPP ch. 9]*
- **Sketch two substantially different designs for any important interface,
  and write its interface comment before the body.** If the comment must be
  long, the abstraction is wrong. *[APoSD ch. 11, ch. 15]*

## Errors and failure

- **Parse external input into typed values at the boundary and fail fast with
  a clear message.** Reject NaN, empty strings, malformed ids, and out-of-range
  values; never convert untrusted strings to numbers unchecked; escape ids
  before building a regex; use an own-property check on plain objects.
  *[Review lessons §2 Parse at the boundary; PragProg Topic 23]*
- **Define errors out of existence inside internal APIs.** "Ensure X is absent"
  instead of "delete X or throw"; never throw only because a case is awkward,
  since every exception joins every caller's interface. *[APoSD ch. 10]*
- **Handle a recoverable failure in the lowest module that can, with bounded
  retries, and aggregate the rest at one top-level handler.** No catch, log,
  and rethrow at each call site. *[APoSD ch. 10; PragProg Topic 24; 97 Things
  Don't Nail Your Program into the Upright Position]*
- **Check every error result and never write an empty catch-all.** If handling
  is tedious, redesign the interface. *[97 Things Don't Ignore That Error!]*
- **Crash with a clear diagnostic on any "can't happen" case,** after rollback
  and release; guard invariants with checks that stay on in production, since
  Python `-O` strips `assert` and the JVM disables it by default. Never assert
  on expected bad input. *[PragProg Topic 24, Topic 25; APoSD ch. 10]*
- **Separate business failures from technical ones.** Expected outcomes get
  their own types or result variants; bugs and infrastructure failures go to
  the top-level handler. *[97 Things Distinguish Business Exceptions from
  Technical; Clean Code ch. 7]*
- **Give every error the operation, its target, and the cause; shape error
  types by how callers handle them; translate third-party errors at the
  wrapper.** *[Clean Code ch. 7; CC Tips ch. 8; Code Simplicity ch. 4]*
- **Make absence explicit in the type** (empty collection, compiler-checked
  optional, special-case object), never a bare null. Updated from the books'
  Java-era wording. *[Clean Code ch. 7; CC Tips ch. 8; Agile PPP ch. 25]*
- **Release a resource in the routine that acquired it, with a scoped
  construct** (`with`, `using`, `defer`, RAII). *[PragProg Topic 26]*

## Comments and documentation

- **Rename or extract before you comment; then comment only what code cannot
  say:** units, bound inclusivity, what null means, ownership, invariants, and
  why. *[Clean Code ch. 4; APoSD ch. 13; 97 Things Comment Only What the Code
  Cannot Say; PragProg Topic 7]*
- **Document every public interface as callers see it:** behavior, argument
  constraints, return, side effects, errors, preconditions; no implementation
  detail. *[APoSD ch. 13]*
- **Make every comment and docstring claim match the implementation exactly,
  and fix or delete each claim the diff touches in the same change.** Ordering,
  "never throws", "at most one", and write order are contract. *[Review
  lessons §1 Claims audit; Clean Code ch. 17 C2; APoSD ch. 16; CC Tips ch. 5]*
- **Cite symbols, never line numbers; never hand-type counts or placeholders.**
  A TODO links a tracked issue. *[Review lessons §1 Claims audit]*
- **Keep history out of source, but keep the reason for a non-obvious fix in
  the code with its issue id.** *[Clean Code ch. 17 C1; 97 Things Only the
  Code Tells the Truth; APoSD ch. 16]*
- **Delete commented-out and dead code;** version control keeps it. *[Clean
  Code ch. 17 C5, G9; Code Simplicity ch. 4]*

## Duplication and single source of truth

- **Ask whether one change in intent forces edits in several places or
  formats;** if so, knowledge is duplicated even with no copied text.
  *[PragProg Topic 9; Code Simplicity ch. 5; Clean Code ch. 17 G5]*
- **Route each cross-cutting concern through one helper.** All date and time
  handling goes through one project helper, and zoneless strings are read as
  UTC or as wall-clock digits with an explicit zone. *[Review lessons §2 One
  date helper]*
- **Compute derived values instead of storing them, and generate types,
  clients, and docs from one schema.** *[PragProg Topic 9]*
- **Allow one switch per kind of selection, in a factory or an exhaustive
  match.** *[Clean Code ch. 17 G23; 97 Things Missing Opportunities for
  Polymorphism]*
- **Replace magic values with named constants kept beside the rules they
  encode.** *[Clean Code ch. 17 G17, G25; Code Simplicity ch. 4]*
- **After fixing a defect, search for the same pattern and fix every sibling
  in the same change.** *[Review lessons §3 Sibling sweep]*

## Types, data, and state

- **Wrap domain quantities and ids in their own types, narrow parameters to the
  values the domain allows, and return named fields, not tuples.** *[97 Things
  Prefer Domain-Specific Types to Primitive Types; 97 Things Write Small
  Functions Using Examples; APoSD ch. 18]*
- **Never use binary floating point for money;** use decimal or integer cents.
  *[97 Things Floating-Point Numbers Aren't Real; Clean Code ch. 17 G26]*
- **Enforce "only one", "never twice", or "at most N" in the store** with a
  unique or partial unique index, an upsert, a row lock, or an advisory lock;
  replace check-then-act with one atomic operation. *[Review lessons §2
  Invariants live in the database; PragProg Topic 34]*
- **Carry the tenant key into every data-access function on owned records;**
  see [application security](../security/application-security.md). *[Review
  lessons §2 Tenant scoping]*
- **Avoid global mutable state and singletons; pass context explicitly.**
  *[PragProg Topic 28; 97 Things Resist the Temptation of the Singleton
  Pattern; Agile PPP ch. 24]*

## Classes and dependencies

- **Tell objects what to do instead of pulling their state out, and do not
  chain through collaborators** (`a.b().c()`) except on stable libraries.
  *[Clean Code ch. 6; PragProg Topic 28; CC Tips ch. 7]*
- **Move logic to the class whose data it uses,** unless that couples a domain
  object to presentation. *[Clean Code ch. 17 G14; 97 Things Encapsulate
  Behavior, Not Just State]*
- **Give each class one reason to change; extract a class when some methods
  share some fields.** Keep business rules apart from persistence, UI, and
  threading. *[Clean Code ch. 10, ch. 13; Agile PPP ch. 8, ch. 38]*
- **Prefer composition and interfaces to implementation inheritance;** SOLID
  details are in [design patterns](../design/design-patterns.md). *[APoSD
  ch. 19; PragProg Topic 31]*
- **Make policy depend on client-owned interfaces, and wire concrete classes at
  startup** rather than with `new` or static calls in business code.
  *[Agile PPP ch. 11, ch. 37; Clean Code ch. 11]*
- **Allow no cycles in the module dependency graph, and check it in CI.** A
  unit test that needs much of the system signals coupling. *[Agile PPP
  ch. 4, ch. 28; PragProg Topic 10]*

## Boundaries and external code

- **Wrap each third-party API behind a narrow interface you own, and keep
  vendor types out of your signatures.** *[Clean Code ch. 8; CC Tips ch. 9;
  PragProg Topic 11]*
- **Write learning tests for library behavior you rely on and rerun them on
  upgrade;** if the other side does not exist yet, code against the interface
  you wish you had. *[Clean Code ch. 8; CC Tips ch. 9]*
- **Build no in-house infrastructure while an acceptable option exists; vet a
  dependency's release cadence, standard interfaces, security history, and
  license (a current addition).** *[Code Simplicity ch. 7]*

## Scope, generality, and configuration

- **Design from requirements known now: add an abstraction against a kind of
  change only once that change has arrived.** Store no field, flag, or column
  the code does not yet act on. *[Code Simplicity ch. 3, ch. 4; Agile PPP
  ch. 9; PragProg Topic 27]*
- **Before adding a configuration parameter, ask whether the module can compute
  the value;** never push an undecided design question into a flag.
  *[APoSD ch. 8; PragProg Topic 32; Clean Code ch. 17 G35]*
- **Apply a pattern only when you can name the duplication or real change it
  absorbs.** *[APoSD ch. 19; Agile PPP ch. 22; Code Simplicity ch. 7]*
- **Build each stopgap to shipping standard, since interim code tends to stay,
  and link each deliberate shortcut to a tracked issue.** *[97 Things The
  Longevity of Interim Solutions; 97 Things Act with Prudence]*

## Consistency and automated gates

- **Copy how similar decisions were handled elsewhere, and do not add a second
  convention beside the first.** *[APoSD ch. 17; Code Simplicity ch. 6]*
- **Enforce the coding standard in the build, keep it at zero warnings, and
  make build and full test run single commands.** *[97 Things Automate Your
  Coding Standard; 97 Things Keep the Build Clean; Clean Code ch. 17 E1, E2]*
- **Never silence a safety to get green;** do not skip failing tests or
  downgrade a correctness lint rule globally; scope a suppression to one file.
  *[Clean Code ch. 17 G4; Review lessons §4 Cheap gates]*
- **Carry cheap gates:** unused imports and dead code as lint errors, Markdown
  lint, and a pre-commit grep blocking U+FFFD and personal identifiers.
  *[Review lessons §4 Cheap gates]*

## Performance-aware design

- **Prefer the naturally efficient choice when it is just as simple,** and
  count remote calls per user action before tuning algorithms. *[APoSD ch. 20;
  97 Things Interprocess Communication Affects Application Response Time]*
- **Estimate big-O for loops over growing input and ask what happens at 10k
  rows;** cap or paginate. *[PragProg Topic 39; Review lessons §6
  Accessibility and scale]*
- **Optimize only a measured bottleneck, and hide the added complexity behind
  the interface.** *[Code Simplicity ch. 5; APoSD ch. 20]*

## Tensions

- **Small functions vs deep modules.** Split only when the piece is a cleaner
  abstraction; length is a cue, never a target. *[Clean Code ch. 3; APoSD
  ch. 4, ch. 9]*
- **Self-documenting code vs commented interfaces.** Document every public
  contract; inside bodies, comment only the why. *[Clean Code ch. 4; APoSD
  ch. 13]*
- **DRY vs the wrong abstraction.** Merge duplicated knowledge now; tolerate
  look-alike code that may diverge. *[Code Simplicity ch. 5; PragProg Topic 9;
  97 Things Beware the Share]*
- **YAGNI vs somewhat general.** Modestly general interface, today-sized
  implementation, no speculative extension points. *[Code Simplicity ch. 4;
  APoSD ch. 6]*
- **Up-front vs emergent design.** Design twice only for boundaries costly to
  move later: public APIs, schemas, service seams. *[APoSD ch. 11; Agile PPP
  ch. 9]*
- **Polymorphism vs switches.** With sum types, a compiler-checked switch over a
  closed set wins when operations change more than variants. *[Clean Code
  ch. 6; 97 Things Missing Opportunities for Polymorphism]*
- **Exceptions vs result values.** Follow the language: expected domain
  failures as typed results, technical ones as exceptions. *[Clean Code ch. 7;
  97 Things Distinguish Business Exceptions from Technical]*
- **Define errors away vs fail fast.** Define away inside internal APIs; parse
  and reject at the boundary. *[APoSD ch. 10; Review lessons §2]*
- **Fewer config knobs vs external config.** Compute tuning knobs; keep
  environment wiring external and secrets in a secret store. *[APoSD ch. 8;
  PragProg Topic 32]*
- **Boy Scout Rule vs scoped diffs.** Cleanups stay small and inside files the
  task touches. *[Clean Code ch. 1; 97 Things Before You Refactor]*

## Sources

- **APoSD**: A Philosophy of Software Design (John Ousterhout, 1st ed., 2018)
- **Clean Code**: Clean Code: A Handbook of Agile Software Craftsmanship
  (Robert C. Martin, 1st ed., 2008); smell codes are from ch. 17
- **CC Tips**: Clean Code: Best Tips and Tricks in the World of Clean Coding
  (uncredited, 2020)
- **Code Simplicity**: Code Simplicity: The Fundamentals of Software (Max
  Kanat-Alexander, O'Reilly, 2012)
- **PragProg**: The Pragmatic Programmer: Your Journey to Mastery, 20th
  Anniversary Edition (David Thomas, Andrew Hunt, 2019); cited by topic
- **97 Things**: 97 Things Every Programmer Should Know (Kevlin Henney, ed.,
  O'Reilly, 2010); cited by essay title
- **Agile PPP**: Agile Principles, Patterns, and Practices in C# (Robert C.
  Martin, Micah Martin, 2006)
- **Review lessons**: rules distilled from the maintainer's code-review
  findings
