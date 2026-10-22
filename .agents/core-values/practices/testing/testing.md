# Unit, integration, and test-driven development

> **Load when:** you are writing, changing, reviewing, or deleting automated
> tests; working test-first or adding a regression test for a bug; choosing
> what to mock or fake; testing code that touches a database, clock, network,
> threads, or async callbacks; fixing a flaky or slow suite; or deciding on
> coverage, test layers, or which tests run in CI.
> **See also:** [Debugging](../core/debugging.md),
> [Refactoring and legacy code](../core/refactoring-and-legacy-code.md),
> [Code and module design](../core/code-design.md),
> [Performance and load testing](../testing/performance-and-load-testing.md),
> [Continuous integration and delivery](../devops/ci-cd.md),
> [Concurrency and parallelism](../concurrency/concurrency.md),
> [Java](../languages/java.md), [Spring Boot](../languages/spring-boot.md),
> [Accessibility](../frontend/accessibility.md)

## Top rules

1. **Test observable behavior through the public API, never implementation
   steps.** A test should change only when required behavior changes; one that
   breaks on a refactor is a false alarm that teaches people to ignore red.
   *[UTPPP ch. 4; SE@Google ch. 12; AoUT2 ch. 8; JUnit5-Gulati ch. 3]*
2. **Watch every new test fail before making it pass.** Red proves the test can
   detect the defect; if a test is green from the start, break the code on
   purpose and confirm it goes red. *[TDDbE ch. 1; AoUT2 ch. 1; PUT-JM ch. 4]*
3. **Reproduce every bug with a failing test before fixing it, and keep the
   test.** It proves the fix and stops the bug returning. *[PUT-JM ch. 4;
   JUnit5-Gulati ch. 1; SE@Google ch. 9]*
4. **Mock only unmanaged out-of-process dependencies; use real in-process
   collaborators and value objects.** Mocking calls between your own classes
   couples tests to internal structure. *[UTPPP ch. 2, ch. 5, ch. 8;
   SE@Google ch. 13; PUT-JM ch. 5]*
5. **Hard-code expected values and keep tests free of logic.** No `if`, loops,
   try/catch, or expectations recomputed with production logic; a copied
   algorithm passes when both copies are wrong. *[UTPPP ch. 3, ch. 11; AoUT2
   ch. 8; SE@Google ch. 12; PUT-JM ch. 10]*
6. **Make every test hermetic and order-independent.** It builds its own state,
   shares no mutable fixture, and passes alone, in any order, on a clean
   checkout with no special environment. *[AoUT2 ch. 8; SE@Google ch. 11;
   JUnit5-Gulati ch. 1, ch. 2]*
7. **Control time, randomness, and concurrency explicitly; never use fixed
   sleeps.** Inject the clock, seed generators, and poll with a timeout.
   *[SE@Google ch. 11, ch. 13; PUT-JM ch. 6, ch. 7; UTPPP ch. 11]*
8. **Fix a flaky test at its cause, or quarantine it with a tracking issue.**
   Silent retries and commented-out tests destroy trust in the suite.
   *[SE@Google ch. 11, ch. 23; JUnit5-Gulati ch. 1]*
9. **Treat coverage as a map of untested code, never a target.** It shows a
   line ran, not that anything checked it. *[UTPPP ch. 1; SE@Google ch. 11;
   PUT-JM ch. 11; AoUT2 ch. 8]*
10. **Test every promise the code's docs make.** A docstring that says "never
    throws", "newest first", or "at most one" needs a test that fails if the
    promise breaks. *[Review lessons]*

## Writing a single test

- **Give every test one arrange, one act, and one assert section, visibly
  separated.** Several act/assert cycles mean several behaviors; split them.
  *[UTPPP ch. 3; AoUT2 ch. 2; JUnit5-Gulati ch. 1; SE@Google ch. 12]*
- **Test one behavior per test, not one assertion per test.** Assert every
  outcome of that behavior; if you would still care about the second assert
  after the first fails, it is a second test. *[UTPPP ch. 3; AoUT2 ch. 8;
  PUT-JM ch. 7]*
- **Write one test per scenario or requirement, not one per method.** Mirroring
  the method list misses zero-state and misuse cases. *[PUT-JM ch. 10;
  SE@Google ch. 12]*
- **Name the test as a sentence giving scenario and expected outcome.** The
  name is often all a failure report shows; a name needing "and" is two
  tests. Follow the framework's idiom. *[UTPPP ch. 3; SE@Google ch. 12;
  PUT-JM ch. 9]*
- **Make the test complete and concise.** Every value the assertion depends on
  appears in the body; irrelevant values hide in a factory or carry names
  like `ANY_EMAIL`. Replace magic literals and bare booleans with named
  constants. *[SE@Google ch. 12; PUT-JM ch. 11; AoUT2 ch. 8]*
- **Compare whole values when checking a result object,** or group the checks
  so every failure is reported (`assertAll`, soft assertions). *[TDDbE ch. 4;
  AoUT2 ch. 8; JUnit5-Gulati ch. 2]*
- **Assert the property you mean, not a hand-copied snapshot.** If the rule is
  "sorted by date", assert sortedness; prefer "contains" over exact message
  text. *[JUnit5-Gulati ch. 3; AoUT2 ch. 8; PUT-JM ch. 10]*
- **Make failures diagnosable from the log alone.** Use the most specific
  assertion, give domain objects a readable string form, and read the message
  while the test is still red. *[SE@Google ch. 12; PUT-JM ch. 8]*
- **Assert exceptions with a construct scoped to the throwing call**
  (`assertThrows`, `pytest.raises`, `expect(fn).toThrow`) and a specific type.
  A method-level "expects X" passes when the wrong line throws. *[AoUT2 ch. 2;
  PUT-JM ch. 6; JUnit5-Gulati ch. 5; Mockito4Spring ch. 2]*
- **Use parameterized tests for cases that differ only in data,** with a name
  per case; give cases with different logic their own tests. *[UTPPP ch. 3;
  AoUT2 ch. 2; PUT-JM ch. 3]*
- **Keep passing tests silent, and comment only what code cannot say** (the
  bug guarded, why the data was chosen). *[PUT-JM ch. 8, ch. 9]*

## Choosing what to test and which inputs

- **Test code with logic, not logic-free accessors,** but list what "simple"
  delegation hides first: argument mapping, return-value use, collaborator
  exceptions. *[AoUT2 ch. 1; PUT-JM ch. 10]*
- **Cover the typical case, then both sides of each boundary, then strange
  values** (null, empty, negative, duplicate, unsorted, malformed). *[PUT-JM
  ch. 4, ch. 6]*
- **Test every boundary parser against bad input.** Env vars, CLI flags, query
  params, and request bodies get cases for NaN, empty string, malformed id,
  and out-of-range values, each asserting a fast, clear rejection. *[Review
  lessons]*
- **Drive collaborators through the same categories.** Stub normal values,
  edge values, and errors, and assert the failure becomes the right result.
  *[PUT-JM ch. 6; Mockito4Spring ch. 4; SE@Google ch. 11]*
- **Test what callers must not be able to do,** such as mutating a returned
  collection, and that queries leave source state unchanged.
  *[JUnit5-Gulati ch. 3]*
- **Write a negative test for every tenant-scoped query.** Request another
  tenant's record by its real id and assert not-found or forbidden.
  *[Review lessons]*
- **Give every behavior the change adds or touches a test,** failure
  handling, security, and accessibility included. *[SE@Google ch. 11]*
- **Ask what happens at 10k rows.** Lists and queries get a test showing
  results are capped or paginated. *[Review lessons]*

## Test doubles

- **Prefer real implementations, then fakes, then stubs, then mocks.** Use the
  real thing when it is fast, deterministic, and easy to build. *[SE@Google
  ch. 13; UTPPP ch. 2; PUT-JM ch. 5]*
- **Prefer output-based, then state-based, then interaction tests.** Pure
  functions give the shortest, least brittle tests. *[UTPPP ch. 6; AoUT2
  ch. 4; SE@Google ch. 13]*
- **Never assert on a stub or verify a call you only stubbed for setup.** A
  stub supplies input; checking it breaks when caching or arguments change.
  *[UTPPP ch. 5; AoUT2 ch. 3, ch. 5; PUT-JM ch. 10]*
- **Verify interactions only for outgoing commands whose effect leaves the
  system** (send, publish, charge), and only the arguments that matter.
  *[UTPPP ch. 5; SE@Google ch. 13]*
- **Mock only types you own, at the outermost edge.** Wrap a third-party client
  in a thin adapter and mock or fake that. *[UTPPP ch. 9; SE@Google ch. 13]*
- **Verify contract fakes against the real implementation.** Run one contract
  test suite against both; a fake fails loudly on unsupported paths.
  *[SE@Google ch. 13; JUnit5-Gulati ch. 4]*
- **Exercise the real class under test with doubles wired in.** Stubbing a
  mock and asserting on it tests the mocking library. *[Mockito4Spring ch. 2]*
- **Configure each test's doubles inside the test or a named helper,** never
  in shared setup. *[AoUT2 ch. 8]*
- **Treat a double returning a double, partial mocks, or static and private
  mocking as design smells.** Add a seam or split the class instead; modern
  libraries can mock statics, but that freezes the implementation.
  *[PUT-JM ch. 7, ch. 10; UTPPP ch. 11; Mockito4Spring ch. 2]*
- **Use argument captors when argument order or values matter** (positional
  SQL parameters); `any()` hides swapped arguments. *[Mockito4Spring ch. 4]*
- **Back mock-based tests with larger tests against real dependencies.** Mocks
  encode your possibly wrong idea of the dependency. *[SE@Google ch. 13,
  ch. 14; Mockito4Spring ch. 4]*

## Test-driven development

- **Run the full loop per behavior:** add one small test, see it fail for the
  right reason, make the smallest reasonable change, run all tests, refactor.
  *[TDDbE Part I; JUnit5-Gulati ch. 1; PUT-JM ch. 4]*
- **Write the test against the API you wish you had** and revise the API when
  the test shows it is awkward. If you cannot write the test, clarify the
  requirement first. *[TDDbE ch. 1, ch. 2; JUnit5-Gulati ch. 1]*
- **Keep a written test list** and add new concerns to it instead of chasing
  them mid-step. *[TDDbE ch. 1]*
- **Reach green by Fake It, Obvious Implementation, or Triangulation, and
  match step size to confidence.** After a surprise red, revert and take
  smaller steps. *[TDDbE ch. 2, ch. 3, ch. 9]*
- **Never stop at green.** Remove duplication, including faked constants,
  before the next test. *[TDDbE ch. 1, ch. 13; JUnit5-Gulati ch. 1]*
- **Do not change model code while red without a test.** Revert to green,
  write the missing test, then retry. *[TDDbE ch. 10]*
- **When a requirement changes, change the tests first and see them fail.**
  Code-first edits rewrite tests to match the implementation. *[PUT-JM ch. 10]*
- **Add no abstraction until a test demands it, and delete scaffolding tests
  of internals once behavior tests cover the code.** *[TDDbE ch. 7, ch. 13,
  ch. 14, ch. 16; PUT-JM ch. 4]*

## Fixing bugs and changing existing tests

- **Classify a failing test before touching it:** production bug, test bug,
  API change, or conflicting requirement. Editing a test to green without
  knowing why destroys trust. *[AoUT2 ch. 8; JUnit5-Gulati ch. 2]*
- **After fixing a test bug, reintroduce the defect and confirm it fails.**
  *[AoUT2 ch. 8]*
- **After a fix, search for the same defect pattern and add a regression test
  for each sibling in the same change.** *[Review lessons]* The diagnosis loop
  is in [Debugging](../core/debugging.md).
- **Delete invalid tests; never comment them out.** Skip a test only through
  the framework's disable marker with a reason and a tracking issue.
  *[AoUT2 ch. 2, ch. 8; SE@Google ch. 23]*
- **When refactoring tests, keep the executed-test count unchanged.**
  *[PUT-JM ch. 4]*
- **Before refactoring untested code, pin its current behavior with tests.**
  *[TDDbE ch. 6; AoUT2 ch. 10]* See
  [Refactoring and legacy code](../core/refactoring-and-legacy-code.md).

## Isolation, determinism, and flakiness

- **Give each test fresh instances and reset any static state it touches.**
  Share cached fixtures only when truly read-only. *[AoUT2 ch. 8;
  JUnit5-Gulati ch. 4]*
- **Never call one test from another or depend on run order.** Put ordered
  flows in an integration suite. *[AoUT2 ch. 8; JUnit5-Gulati ch. 2]*
- **Pass the current time into logic through the project's single date
  helper,** backed by an injectable clock (`java.time.Clock`, .NET
  `TimeProvider`). Never read the system clock or treat a timezone-less string
  as local time in code under test; pin zone and locale. *[UTPPP ch. 11;
  PUT-JM ch. 6; AoUT2 ch. 7; Review lessons]*
- **Test async code with a synchronous executor where possible, else poll with
  a timeout.** Make production timeouts configurable. *[PUT-JM ch. 6;
  SE@Google ch. 11, ch. 14]*
- **Test async UI hooks for stale responses:** resolve two requests out of
  order, assert the latest wins and timers clear on unmount. *[Review
  lessons]*
- **Test concurrent code with many threads and repetitions;** a sequential pass
  proves nothing. *[PUT-JM ch. 6]* See
  [Concurrency and parallelism](../concurrency/concurrency.md).
- **Test "only one" or "at most N" with concurrent attempts against the real
  database,** asserting the constraint rejects extras. An in-process guard is
  not enforcement. *[Review lessons]*
- **Seed any randomness, log the seed, and promote failing values to fixed
  cases.** *[PUT-JM ch. 7]*
- **Stub live, changing data with constants** and isolate tests from machine
  settings with test properties. *[Mockito4Spring ch. 2, ch. 3]*

## Integration and database tests

- **Classify each out-of-process dependency.** Use managed ones (a database
  only your app touches) for real and verify final state; mock unmanaged ones
  (email, bus, third-party API). *[UTPPP ch. 8]*
- **Cover edge cases in unit tests; write one integration test per scenario's
  longest happy path,** plus edges units cannot reach. *[UTPPP ch. 8]*
- **Run database tests on the production engine,** not an in-memory
  substitute. *[UTPPP ch. 10; AoUT2 App. A]*
- **Read stored state back through a separate path,** and give arrange, act,
  and assert separate transactions so unflushed writes surface. *[UTPPP
  ch. 8, ch. 10]*
- **Give every developer and CI worker its own database** with schema and
  reference data under migrations, and delete other data at the start of each
  test, not the end. *[UTPPP ch. 10]*
- **Test HTTP handlers through the request pipeline,** asserting status,
  content type, and body shape. *[Mockito4Spring ch. 3]* Framework specifics
  are in [Spring Boot](../languages/spring-boot.md).
- **Give each large test an owner and diagnostics across the call chain.**
  *[SE@Google ch. 14]*

## Suite strategy, coverage, and CI

- **Write the smallest test that covers the behavior.** Small tests use one
  process, no network, disk, or sleeps. *[SE@Google ch. 11; AoUT2 ch. 1]*
- **Weight the suite toward unit tests, with fewer integration and few
  end-to-end tests.** *[SE@Google ch. 11; JUnit5-Gulati ch. 1]*
- **Never couple a test to implementation details to make it faster or
  broader;** trade only regression protection against speed. *[UTPPP ch. 4]*
- **Keep unit and integration tests separable by folder or tag** so the fast
  suite is a safe green zone. *[AoUT2 ch. 7; JUnit5-Gulati ch. 4]*
- **Run fast tests before every merge and slow suites after merge or
  nightly.** *[SE@Google ch. 23; PUT-JM App. A]* See
  [Continuous integration and delivery](../devops/ci-cd.md).
- **Generate coverage every build and use mutation testing, outside the
  inner loop, to find unasserted code.** *[JUnit5-Gulati ch. 6; PUT-JM ch. 11]*
- **Check that the runner discovers every test.** Some match only certain
  name patterns. *[PUT-JM ch. 11; JUnit5-Gulati ch. 2]*
- **Run cheap gates in pre-commit and CI:** dead code and unused imports as
  errors, accessibility lint for UI, and a grep that blocks personal
  identifiers and U+FFFD in tracked files, fixtures included. *[Review
  lessons]*
- **Never downgrade a correctness lint rule globally to get green;** scope any
  suppression to one file. *[Review lessons]*

## Design for testability

- **Read test pain as design feedback.** Long setup, many doubles, or a
  multi-call act section means the class does too much. *[PUT-JM ch. 1;
  UTPPP ch. 3]*
- **Keep decisions in a pure core and I/O in a thin shell** (Humble Object).
  *[UTPPP ch. 6, ch. 7]*
- **Inject collaborators through constructors; no static ambient context.**
  *[UTPPP ch. 7; AoUT2 ch. 3, ch. 11; PUT-JM ch. 7]* See
  [Code and module design](../core/code-design.md).
- **Do not test private methods or expose state for tests.** If a private
  method needs its own tests, extract a class. *[UTPPP ch. 11; AoUT2 ch. 8;
  SE@Google ch. 12]*
- **Keep test-only flags out of production code;** inject a fake instead.
  *[UTPPP ch. 11]*

## Test code as a product

- **Prefer DAMP over DRY in tests.** Accept repetition that keeps each test
  readable alone; use test inheritance only to run one suite against several
  implementations. *[SE@Google ch. 12; PUT-JM ch. 11; AoUT2 ch. 7]*
- **Build objects through named factories or test data builders,** so one
  helper absorbs constructor changes; use setup hooks only for what every
  test needs. *[UTPPP ch. 3; AoUT2 ch. 2, ch. 8; PUT-JM ch. 9]*
- **Test the test infrastructure,** and standardize on one test and one mocking
  library per language. *[AoUT2 ch. 8; SE@Google ch. 12]*
- **Review tests as strictly as production code, and run them.** Look for
  happy-path-only cases, overspecification, order dependence, and sleeps.
  *[PUT-JM ch. 11]*
- **Delete tests that pin an obsolete structure or only duplicate another
  test.** Every test is maintenance cost. *[UTPPP ch. 1; TDDbE ch. 8, ch. 11]*

## Tensions

- **Classical vs London (mockist) unit tests.** This library is classical: a
  unit is a behavior, collaborators are real, mocks sit at unmanaged edges.
  Mockist tests win when the call protocol itself is the requirement.
  *[UTPPP ch. 2; AoUT2 ch. 4; PUT-JM ch. 5; SE@Google ch. 13]*
- **One mock per test vs as many as needed.** House position: one asserted end
  result per test, with as many edge mocks as that result requires.
  *[AoUT2 ch. 4; UTPPP ch. 9]*
- **Loose vs strict verification.** Loose matchers inside the app; exact counts
  and no extra calls only at unmanaged edges. *[AoUT2 ch. 6; UTPPP ch. 9;
  Mockito4Spring ch. 2]*
- **Template names vs plain sentences.** Prefer sentences in the framework's
  idiom; a Method_Scenario_Expected name is fine if all three parts show.
  *[AoUT2 ch. 2; UTPPP ch. 3]*
- **Rolled-back transaction vs delete-at-start cleanup.** Rollback hides flush
  and commit behavior and fails when code opens its own connection. Prefer a
  disposable database or delete-at-start. *[UTPPP ch. 10; AoUT2 App. A;
  Mockito4Spring ch. 3]*
- **Sequential vs parallel database tests (updated).** The sources predate
  cheap disposable containers (Testcontainers); run in parallel with one
  database or schema per worker rather than serially on one. *[UTPPP ch. 10]*
- **Mocking a library type vs wrapping it.** Mocking a JDBC template checks
  arguments but cannot prove the SQL works; wrap it and integration-test the
  repository. *[Mockito4Spring ch. 4; UTPPP ch. 9]*
- **No coverage target vs CI floor.** No global percentage; a floor on changed
  lines plus mutation testing is acceptable. *[UTPPP ch. 1; SE@Google ch. 11]*
- **Pyramid vs testing trophy.** The 80/15/5 split is a default; UI-heavy
  code earns more integration tests. *[SE@Google ch. 11; PUT-JM ch. 1]*
- **Random inputs (updated).** Seeded property-based testing is now mainstream
  for invariants and round-trips; run it alongside chosen examples, not
  instead of them. *[PUT-JM ch. 7; AoUT2 ch. 8]*
- **Strict test-first vs pragmatic exceptions.** Test-first is the default;
  debug-only code and code-first spikes are stated exceptions covered before
  shipping. *[TDDbE ch. 10; PUT-JM ch. 4]*

## Sources

- **UTPPP**: Unit Testing Principles, Practices, and Patterns (Vladimir
  Khorikov, 1st edition)
- **AoUT2**: The Art of Unit Testing (Roy Osherove, 2nd edition)
- **TDDbE**: Test-Driven Development: By Example (Kent Beck, 1st edition)
- **PUT-JM**: Practical Unit Testing with JUnit and Mockito (Tomek
  Kaczanowski, 1st edition)
- **JUnit5-Gulati**: Java Unit Testing with JUnit 5: Test Driven Development
  with JUnit 5 (Shekhar Gulati, Rahul Sharma, 1st edition)
- **Mockito4Spring**: Mockito for Spring (Sujoy Acharya, 1st edition)
- **SE@Google**: Software Engineering at Google: Lessons Learned from
  Programming Over Time (Titus Winters, Tom Manshreck, Hyrum Wright, 1st
  edition)
- **Review lessons**: rules distilled from the maintainer's code-review findings
