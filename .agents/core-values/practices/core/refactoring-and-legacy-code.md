# Refactoring and legacy code

> **Load when:** restructuring existing code without changing its behavior;
> changing or extending code that has few or no tests; adding a feature or fix
> to code that is awkward to change; breaking dependencies to get code under
> test; splitting a monster method or god class; planning a migration, library
> swap, or rewrite; or deciding where in a codebase cleanup will pay off.
> **See also:** [Code and module design](../core/code-design.md),
> [Unit, integration, and TDD](../testing/testing.md),
> [Version control and code review](../core/version-control.md),
> [Debugging](../core/debugging.md),
> [Design patterns and SOLID](../design/design-patterns.md),
> [Architecture fundamentals](../architecture/architecture-fundamentals.md),
> [Database operations](../data/database-operations.md),
> [Performance and load testing](../testing/performance-and-load-testing.md),
> [Specifying intent for AI coding agents](../core/working-with-ai-agents.md)

## Top rules

1. **Wear one hat at a time: a step either changes structure or changes
   behavior, never both.** Mixed steps hide regressions. This library also puts
   refactoring in its own commits and names it in the PR description (see
   Tensions). *[Refactoring ch. 2; WELC ch. 23]*
2. **Cover before you modify.** Treat any code without automated tests as
   legacy, and pin its current behavior with tests before changing it; careful
   reading after an edit is not a safety net. *[WELC Preface, ch. 2;
   Refactoring ch. 1, ch. 4; APoSD ch. 19]*
3. **Preserve existing behavior, including bugs.** Pin odd behavior with a
   characterization test marked suspicious, and fix it later as a separate,
   deliberate behavior change. *[Refactoring ch. 2; WELC ch. 13]*
4. **Move in small steps: run the tests after each, commit locally on every
   green, and revert when a failure is not obvious at once.** Never debug
   forward from a broken state; redo the change in smaller steps, and squash
   the private commits before pushing. *[Refactoring ch. 1, ch. 4; Crime Scene
   app. 1]*
5. **Make the change easy, then make the easy change.** Refactor only code you
   must change or understand now; leave ugly code that works as a black box
   alone. *[Refactoring ch. 1, ch. 2; APoSD ch. 16]*
6. **Use syntax-tree-aware refactoring tools, and treat a hand or agent text
   edit as unverified.** For untested structural edits, copy parameter lists
   verbatim, make one change per step, and leave type improvements or argument
   bundling for a later, tested step. *[Refactoring ch. 2; WELC ch. 5, ch. 23]*
7. **Improve the existing system incrementally instead of rewriting it.**
   Rewrites chase a moving target; move the code toward the target a little on
   each visit, keeping it working throughout. *[WELC ch. 24; Refactoring ch. 2]*
8. **Spend cleanup effort on hotspots, files that are both complex and changed
   often, and check redesign hypotheses against version-control history.**
   Memory and gut feel point at the wrong places. *[Crime Scene ch. 2, ch. 3,
   ch. 8]*
9. **After fixing a defect or a smell, grep for the same pattern and fix every
   sibling in the same commit.** The same mistake usually lands in several
   handlers or helpers at once. *[Review lessons §3 Sibling sweep]*
10. **Before committing, read the whole diff and make every comment, docstring,
    and doc it touches true again.** Moved and renamed code leaves stale prose
    behind. *[APoSD ch. 16; Review lessons §1 Claims audit]*

## The refactoring loop

- **Never start refactoring while any test is failing.** A red baseline makes
  every later failure ambiguous. *[Refactoring ch. 1, ch. 4; Crime Scene ch. 9]*
- **Before each change, state what you are changing, how you will know it is
  right, and how you will know nothing else broke.** Classify it as adding
  behavior, changing behavior, restructuring, or optimizing. *[WELC ch. 1]*
- **When a second needed change appears mid-edit, note it and finish the
  current one and its test run first.** Interleaved edits are where most
  breakage comes from. *[WELC ch. 23; Refactoring ch. 2]*
- **Integrate refactorings with mainline at least daily.** Renames and moves on
  long-lived branches cause semantic conflicts a text merge cannot detect.
  *[Refactoring ch. 2; Crime Scene ch. 14]*
- **Keep the unit suite fast enough to run on every step, and keep tests that
  touch the database, network, or file system in a separate suite.** Slow
  feedback makes small steps impractical. *[WELC ch. 2, ch. 7]*

## Deciding when and what to refactor

- **Refactor before adding a feature that fits the current structure badly.**
  Preparatory refactoring beats forcing the feature in or copy-pasting a
  near match. *[Refactoring ch. 2]*
- **Refactor the area around a bug before fixing it when copied logic or mixed
  queries and updates are involved.** The fix then holds in one place.
  *[Refactoring ch. 2]*
- **Once you have worked to understand code, encode that understanding with
  renames and extractions.** The next reader should not repeat the work.
  *[Refactoring ch. 2; Crime Scene ch. 5]*
- **Fix small messes on the spot; note larger ones and handle them as a
  separate change.** Each pass leaves the code slightly better without
  inflating the task. *[Refactoring ch. 2; APoSD ch. 16]*
- **Refuse each new kludge, and leave changed code shaped as if it had been
  designed with the change in mind.** Complexity grows from small shortcuts;
  if the right restructure is too costly, take a nearly-as-clean cheaper one
  and record the rest. *[APoSD ch. 2, ch. 3, ch. 16]*
- **Tolerate a second copy of duplicated code; refactor at the third, and merge
  only copies that express the same knowledge.** Look-alike code for different
  rules changes at different rates. *[Refactoring ch. 2; Crime Scene ch. 9;
  APoSD ch. 9]*
- **Name, in the PR or commit description, the feature or fix each refactoring
  makes easier.** One that does not speed the next change is not worth its
  review cost. *[Refactoring ch. 1, ch. 2]*

## Getting legacy code under test

- **Follow the legacy change sequence: find change points, find test points,
  break dependencies, write tests, then change and refactor.** Each episode
  should leave both new behavior and new tests. *[WELC ch. 2]*
- **Write characterization tests that assert what the code does now, not what
  a spec says.** Write a deliberately wrong assertion, read the actual value,
  and encode it. *[WELC ch. 13; Refactoring ch. 4]*
- **Prove each targeted test cannot pass another way, and confirm the branch
  actually runs.** Coincidental inputs, such as values where integer and
  float math agree, give false confidence. *[WELC ch. 13]*
- **Make every new test fail once, for example by injecting a fault, then
  revert the fault.** A test that never failed may not exercise the code.
  *[Refactoring ch. 4; APoSD ch. 19]*
- **Test first what you need to understand, then the behaviors you will
  change, then the wiring of anything you will move.** If tests cannot give
  confidence for the plan, shrink the plan. *[WELC ch. 13]*
- **Trace effects forward from each change point (return values, mutated
  arguments, globals, statics, subclass field access) to decide where tests
  go.** Testing only the edited method misses propagated effects.
  *[WELC ch. 11]*
- **When many related classes must change, test one level back at a pinch
  point, then replace those tests with unit tests as each class is touched.**
  Pinch-point tests are scaffolding, not the destination. *[WELC ch. 12]*
- **Break a dependency only for sensing (you cannot observe the result) or
  separation (you cannot run the code in a harness), and choose the technique
  for that reason.** *[WELC ch. 3]*
- **Prefer object seams (an interface, an overridable method, a constructor
  parameter) over link-time or preprocessor substitution.** They are explicit
  and keep tests maintainable. *[WELC ch. 4, ch. 19]*
- **Make the first dependency-breaking edits conservative and mechanical, even
  if they look worse.** Accept an awkward parameter or name as a scar to heal
  once tests exist. *[WELC ch. 2, ch. 10, ch. 25]*
- **When a constructor builds its own collaborators, add a parameter for them
  and keep the old constructor delegating with the default.** Existing callers
  stay untouched while tests inject fakes. *[WELC ch. 9, ch. 25]*
- **Route third-party, final, or sealed library types through a thin wrapper
  you own before testing logic that depends on them.** The wrapper is the seam
  and limits vendor lock-in; prefer it even where current mock libraries can
  mock final classes. *[WELC ch. 10, ch. 14, ch. 15]*
- **Treat a static setter or reset hook on a singleton as a temporary seam,
  and block it from production with a build or runtime check.** For new code,
  inject the dependency instead. *[WELC ch. 9, ch. 25]*

## Adding behavior to code you cannot yet test

- **Put new logic in a new, test-driven method or class and call it from the
  old code (sprout).** New code stays tested even when the host is not; sprout
  a class when the host cannot be instantiated in a harness. *[WELC ch. 6]*
- **To run new behavior before or after existing behavior, wrap it.** Rename
  the original, give a new method the old name and signature, and have it call
  both. Use a decorator class when the concern is unrelated. *[WELC ch. 6]*
- **Treat sprouts and wraps as tactical, and return to cover and refactor the
  host.** They leave the host no better and can duplicate untested logic.
  *[WELC ch. 6, ch. 8]*
- **In legacy TDD, get the class under test first, then red, green, and
  mandatory duplication removal.** Copy-and-modify is a stepping stone only
  when tests let you fold the copy back. *[WELC ch. 8]*

## Smells and the refactorings that fix them

General naming, function, and module-depth rules live in
[Code and module design](../core/code-design.md); this list is the
change-driven subset.

- **Extract a fragment into a function named for what it does whenever you had
  to stop and work out what it does.** The test is the gap between intent and
  implementation, not line count. *[Refactoring ch. 3, ch. 6; Crime Scene
  ch. 5]*
- **Never split a method for length alone, and inline functions and
  forwarding layers whose body is as clear as their name.** Undo a split that
  makes you flip between parent and child to follow it. *[APoSD ch. 9;
  Refactoring ch. 3, ch. 6, ch. 7]*
- **When one change forces edits across many modules, gather that knowledge
  into one place, even via a temporarily large unit.** *[Refactoring ch. 3;
  Crime Scene ch. 8]*
- **When one module changes for unrelated reasons, split it; separate
  sequential concerns into phases joined by an explicit intermediate data
  structure.** *[Refactoring ch. 3, ch. 6]*
- **Move a function to the module whose data it uses most.** When the choice
  is hard it matters little; pick one and move again later. *[Refactoring
  ch. 3, ch. 8]*
- **Turn values that always travel together into a parameter object, and
  primitives with domain meaning into small value types.** Delete one value
  from the clump; if the rest lose meaning, they belong together.
  *[Refactoring ch. 3, ch. 7]*
- **Wrap shared mutable data behind accessors before moving or changing it,
  and shrink its scope.** A data reorganization becomes a function
  reorganization with one place to watch writes. *[Refactoring ch. 3, ch. 6]*
- **Before replacing a stored derived value with a calculation, assert they
  agree wherever it is read, then switch readers.** The assertion catches
  update paths you missed. *[Refactoring ch. 9]*
- **Split any function that both returns a value and has observable side
  effects.** Side-effecting queries are also what makes code impossible to
  sense under test. *[Refactoring ch. 11; WELC ch. 10]*
- **Replace nested conditionals for edge cases with guard clauses, and extract
  complex conditions into functions named for why they branch.**
  *[Refactoring ch. 10]*
- **Replace a type switch with polymorphism or a registry only when the same
  switch repeats in several places, and make the fallback error list every
  supported option.** A single switch is not a smell, and (an update) a
  repeated one is fine when the compiler checks exhaustiveness, as with
  sealed types or discriminated unions. *[Refactoring ch. 3, ch. 10; Crime
  Scene ch. 10]*
- **Before merging near-duplicate code, make the copies identical in small
  steps and treat every difference as possibly untested behavior.**
  *[Refactoring ch. 12]*
- **Delete dead and commented-out code once you establish nothing uses it.**
  Version control keeps the history. *[Refactoring ch. 8; WELC ch. 16]*

## Monster methods and big classes

- **Do not let a big class get bigger: put new work in sprouted methods or
  classes.** *[WELC ch. 20]*
- **In an untested monster method, start with extractions of two to five lines
  chosen for the fewest values crossing the boundary, and add tests to each
  piece.** *[WELC ch. 22]*
- **Extract into the current class first with an honest, awkward name; move to
  another class only once the direction is clear.** Redoing an extraction is
  insight, not waste. *[WELC ch. 22]*
- **For a method with many locals, move it into its own class whose fields
  replace the locals, then refactor it in pieces.** *[WELC ch. 22, ch. 25]*
- **Find hidden classes by grouping methods by task, by the fields they use,
  and by which methods change together.** Each cluster is an extraction
  candidate. *[WELC ch. 12, ch. 20; Crime Scene ch. 15, app. 1]*
- **Let the current change pick the responsibility to extract.** A new way of
  doing something marks the variation point to make substitutable. *[WELC
  ch. 20]*
- **Split a class at the implementation level (extract and delegate) before
  splitting its interface.** Clients stay unchanged meanwhile. *[WELC ch. 20]*
- **When extracting without tests, search the text for field uses and watch
  for overrides and shadowed fields.** Moving them silently changes which
  code runs, and the compiler will not warn. *[WELC ch. 20, ch. 23]*

## Finding where refactoring pays off

- **Rank files by change frequency over a chosen recent window (for example
  `git log --since=<date> --format= --name-only`), then overlap with a cheap
  complexity proxy such as non-blank lines or indentation depth.** Change
  frequency predicts defects better than size alone. *[Crime Scene ch. 2,
  ch. 3, ch. 6]*
- **Plan countermeasures before adding a feature inside a hotspot: extra
  tests, refactoring time, or a different design.** Review hotspot diffs more
  strictly. *[Crime Scene ch. 3, ch. 4]*
- **Judge a hotspot by its complexity trend across revisions and by maximum
  nesting depth, not by a single average.** Rising complexity is a warning; a
  dip usually marks a refactoring. *[Crime Scene ch. 6]*
- **Mine change coupling (files that change in the same commits) to find
  dependencies the imports do not show, and classify each pair before acting.**
  Code-plus-test is expected; copy-paste or poor encapsulation needs a fix.
  *[Crime Scene ch. 7, ch. 8]*
- **Before trusting history metrics, normalize author aliases and exclude
  generated code and mass-reformat commits.** Updated for current workflows:
  also exclude bot authors, and since one squashed commit couples every file
  in its PR, prefer churn over commit counts for squashed history, as the book
  does for long-lived branches. *[Crime Scene ch. 12, ch. 14]*
- **Budget extra tests and review for code with many minor contributors or
  whose main authors have left; check per-file authorship with
  `git shortlog -sn -- <path>`.** *[Crime Scene ch. 12, ch. 13]*
- **To understand tangled code, do a scratch refactoring on a throwaway branch,
  then discard it.** Never commit it; the real refactoring may differ.
  *[WELC ch. 16]*

## Large and long-running changes

- **To swap a library or untangle a dependency, put an abstraction in front of
  it, move callers to the abstraction, then switch implementations.** The code
  stays releasable at every step. *[Refactoring ch. 2; WELC ch. 14]*
- **Change a published interface by keeping the old signature as a deprecated
  forwarder until every caller has moved.** *[Refactoring ch. 2, ch. 6]*
- **Rename schema elements with expand-contract migrations across releases.**
  Add, dual-write, move readers, then drop; see
  [Database operations](../data/database-operations.md). *[Refactoring ch. 2]*
- **Do not add a second "better" convention beside the old one; migrate every
  use or keep the old one.** *[APoSD ch. 17; Crime Scene ch. 10]*
- **Consolidate scattered date, parsing, or validation logic into the
  project's single helper as you touch it.** Shotgun duplicates of these are
  where bugs hide. *[Review lessons §2 One date helper; Refactoring ch. 3]*

## Keeping refactors safe and honest

- **Do not trust an automated refactoring blindly, and never interleave
  manual edits between automated steps without running tests.** Tools miss
  reflection, dynamic dispatch, and side-effecting expressions. *[WELC ch. 5;
  Refactoring ch. 2]*
- **Lean on the compiler or type checker by changing a declaration and
  following the errors, knowing it cannot see inheritance and shadowing.**
  An update: enable explicit-override checks (TypeScript `noImplicitOverride`,
  a Java `@Override` lint) to close part of that gap. *[WELC ch. 23]*
- **Keep tenant filters, boundary parsing, and database constraints intact
  when moving or merging queries and handlers.** An extracted helper that
  drops the tenant column from a WHERE clause is a data leak.
  *[Review lessons §2 Tenant scoping, Parse at the boundary]*
- **When extracting a reusable component, replace fixed element ids with
  generated ones and array-index keys with stable keys.** Code that was safe
  once becomes broken when reused. *[Review lessons §6]*
- **Keep the repository's cheap gates green: unused imports and dead code as
  errors, and a pre-commit grep that blocks U+FFFD and personal identifiers.**
  Mass edits introduce encoding damage and leftovers; never downgrade a
  correctness lint rule globally to land a refactor. *[Review lessons §4]*
- **Put the reason for a subtle fix in a comment next to the code, not only in
  the commit message.** Otherwise a later cleanup reverts it. *[APoSD ch. 16]*
- **Finish the refactor first, then profile, tune only measured hot spots, and
  revert tuning that did not help.** See
  [Performance and load testing](../testing/performance-and-load-testing.md).
  *[Refactoring ch. 2; APoSD ch. 20]*

## Tensions

- **Refactoring as private craft vs separate, disclosed commits.** Fowler is
  skeptical of splitting refactoring commits and treats refactoring as the
  programmer's own business. Agent work is reviewed asynchronously, so this
  library separates structure and behavior commits (or at least labels the
  refactoring) and discloses every refactoring in the diff description.
  *[Refactoring ch. 2; Review lessons §1]*
- **Fix design problems now vs keep the diff scoped.** APoSD says improve on
  every change; Fowler says leave code you need not touch. This library makes
  small improvements inside files the task touches and ships larger
  restructuring as a separate change. *[APoSD ch. 3, ch. 16; Refactoring ch. 2]*
- **Small functions vs deep modules.** Fowler is comfortable with very short
  functions; APoSD warns that shallow pieces raise total complexity. Use the
  gap between intent and implementation, never line count.
  *[Refactoring ch. 3, ch. 6; APoSD ch. 9]*
- **Coverage vs encapsulation.** WELC biases toward coverage, even exposing
  private methods. This library moves the logic to a new class where it is
  public instead of widening visibility. *[WELC ch. 10, ch. 11]*
- **Pass null and static setters vs modern practice.** Pass Null often will
  not compile under null-safe types; use builders or dummy objects. Static
  setters are migration seams; new code uses dependency injection. *[WELC
  ch. 9, ch. 25]*
- **Pairing vs asynchronous review.** WELC insists on a second pair of eyes
  for untested dependency breaking. For an agent, keep those diffs small,
  mechanical, and flagged for independent review. *[WELC ch. 23;
  Refactoring ch. 2]*
- **Dated tooling.** The sources predate ubiquitous language-server
  refactorings and squash-merge or bot-heavy histories; Crime Scene's tool
  walkthroughs are updated in its 2nd edition (2024). Prefer language-server
  refactorings and plain `git log`, filtered as above. *[Refactoring ch. 2;
  WELC ch. 5; Crime Scene ch. 14]*

## Sources

- **Refactoring**: Refactoring: Improving the Design of Existing Code (Martin
  Fowler, with Kent Beck, 2nd edition, 2019)
- **WELC**: Working Effectively with Legacy Code (Michael C. Feathers, 1st
  edition, 2005)
- **Crime Scene**: Your Code as a Crime Scene (Adam Tornhill, 1st edition,
  2015); app. 1 is the appendix on refactoring hotspots
- **APoSD**: A Philosophy of Software Design (John Ousterhout, 1st ed., 2018)
- **Review lessons**: rules distilled from the maintainer's code-review findings
