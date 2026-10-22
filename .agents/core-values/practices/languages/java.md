# Java

> **Load when:** writing, reviewing, refactoring, or debugging Java code
> (`*.java`, `pom.xml`, `build.gradle(.kts)`); using threads, executors,
> virtual threads, locks, atomics, concurrent collections, synchronizers,
> streams, or `CompletableFuture`; writing JUnit 5/6 tests or migrating from
> JUnit 4; writing JDBC or JPA data access; parsing env vars, flags, numbers,
> UUIDs, dates, or regexes in Java; or tuning or diagnosing JVM performance,
> GC, memory use, or an `OutOfMemoryError`.
> **See also:** [Spring Boot](spring-boot.md),
> [Concurrency and parallelism](../concurrency/concurrency.md),
> [Unit, integration, and test-driven development](../testing/testing.md),
> [Performance and load testing](../testing/performance-and-load-testing.md),
> [SQL and query performance](../data/sql-and-query-performance.md),
> [Application and API security](../security/application-security.md),
> [Object-oriented design patterns and SOLID](../design/design-patterns.md),
> [Debugging](../core/debugging.md), [Containers and Docker](../devops/containers.md)

Language-neutral concurrency design lives in the concurrency file. Rules
assume a current LTS JDK (21 or 25); advice from older sources is updated.

## Top rules

1. **Run tasks on an `ExecutorService` you configure and close, never on
   hand-managed threads or an unbounded default.** Set the size, a bounded
   queue, a named `ThreadFactory`, and an explicit rejection policy, and close
   it with try-with-resources (JDK 19+) or `shutdown()` plus a timed
   `awaitTermination`. *[Java Threads ch. 10, Queues and Sizes; Rejected
   Tasks; MCPJ9 ch. 4, The rejected task controller; JavaPerf ch. 9, Sizing a
   ThreadPoolExecutor]*
2. **Use `volatile` only for a value read or written in one step; use an
   atomic class, `LongAdder`, or a lock for any read-modify-write.** `count++`,
   check-then-act, and multi-field invariants are not atomic on a volatile
   field. *[Java Threads ch. 3, The Volatile Keyword; MCPJ9 ch. 1, Tips: Using
   atomic variables]*
3. **Call `lock()` on the line immediately before `try` and `unlock()` in
   `finally`.** An explicit `Lock` is not released by an exception, and
   acquiring inside the `try` makes a failed acquisition throw from
   `unlock()`. The books' own examples lock inside the `try`; follow the
   Javadoc idiom instead. *[Java Threads ch. 6, Deadlock and Automatic Lock
   Releases; MCPJ9 ch. 11, The Lock interface; ReentrantLock Javadoc]*
4. **Never swallow `InterruptedException`: rethrow it, or call
   `Thread.currentThread().interrupt()` before returning.** Catching it clears
   the flag, so cancellation and shutdown silently stop working. *[Java
   Threads ch. 2, Interrupting a Thread; MCPJ9 ch. 4, Cancellation of tasks]*
5. **Bound every wait in service code.** Use `Future.get(timeout, unit)`, the
   timed `invokeAll`/`invokeAny`, `orTimeout`/`completeOnTimeout`, and timed
   `awaitTermination`; the untimed forms hang forever on one stuck task.
   *[MCPJ9 ch. 5, The Future interface; ch. 11, The CompletableFuture class;
   Java Threads ch. 10, Callable Tasks and Future Results]*
6. **Keep blocking I/O out of the common `ForkJoinPool`.** It backs parallel
   streams, `Arrays.parallelSort`, and every executor-less `*Async`
   `CompletableFuture` stage JVM-wide; pass a dedicated executor for blocking
   work. *[MCPJ9 ch. 7, Limitations of the fork/join framework; ch. 11, The
   CompletableFuture class; JavaPerf ch. 9, The ForkJoinPool]*
7. **Parse every env var, flag, query param, and body field through a
   validator that names the field, rejects blanks, checks range, and fails
   fast.** A bare `Integer.parseInt` throws an unexplained
   `NumberFormatException`, `Double.parseDouble` accepts `NaN` and `Infinity`
   (reject with `Double.isFinite`), and `System.getenv` returns `null` or
   blanks. *[Review lessons]*
8. **Handle dates only through `java.time` behind one project helper that
   takes an injected `Clock` and an explicit `ZoneId`.** `LocalDate.now()` reads
   the process zone, and `Date`/`SimpleDateFormat` are mutable and not
   thread-safe. *[Review lessons]*
9. **Enforce tenant scope and "only one" rules in SQL, not in
   `synchronized`.** Every query on tenant-owned rows filters on the tenant
   column, and uniqueness or serialization uses a unique index,
   `ON CONFLICT`, or `SELECT ... FOR UPDATE`, because several JVMs run the same
   code. *[Review lessons; JavaPerf ch. 11, Transactions]*
10. **Measure before tuning: JMH for microbenchmarks (results consumed by a
    `Blackhole`, warm-up discarded, then confirmed by a full-application
    test), a sampling profiler for hot code, the GC log for memory, and the
    default GC and JIT first.** Hand timing loops measure the interpreter or
    dead code the JIT removed.
    *[JavaPerf ch. 2, Microbenchmarks; ch. 3, Sampling Profilers; ch. 6,
    Summary; MCPJ9 ch. 2, Comparing the solutions]*

## Threads, executors, and virtual threads

- **For I/O-bound work on JDK 21+, use one virtual thread per task
  (`Executors.newVirtualThreadPerTaskExecutor()`) and never pool virtual
  threads.** Cap load on a downstream resource with a `Semaphore`, not with
  pool size. *[Java Threads ch. 12, Scaling Using Traditional I/O; MCPJ9 ch.
  1, Tips: Taking scalability into account]*
- **Size platform-thread pools from the bottleneck resource:
  `availableProcessors()` for CPU-bound work, the downstream capacity for the
  rest.** Extra threads against a saturated database lower throughput. Never
  hard-code a core count. *[JavaPerf ch. 9, Setting the Maximum Number of
  Threads; MCPJ9 ch. 1, Tips: Taking scalability into account]*
- **Configure `ThreadPoolExecutor` with core size equal to max size and an
  `ArrayBlockingQueue` sized from acceptable queueing delay.** With a bounded
  queue it adds threads only when the queue is full, the worst moment.
  *[JavaPerf ch. 9, Sizing a ThreadPoolExecutor]*
- **Handle rejection on purpose: `CallerRunsPolicy` for back-pressure or a
  "busy" response; never `DiscardPolicy`.** Rejection fires on saturation as
  well as after shutdown, and the default `AbortPolicy` throws.
  *[Java Threads ch. 10, Rejected Tasks; MCPJ9 ch. 4, The rejected task
  controller]*
- **Install an `UncaughtExceptionHandler` that logs and alerts, via the
  `ThreadFactory` or `Thread.setDefaultUncaughtExceptionHandler`.** By default
  a dead worker only prints a stack trace. For `submit()`ed tasks the failure
  surfaces only through `Future.get()`. *[Java Threads ch. 13, Threads and
  Exception Handling; ch. 10, Callable Tasks and Future Results]*
- **Use `ScheduledThreadPoolExecutor`, never `java.util.Timer`, and choose
  fixed-delay (variable-length work) or fixed-rate (catch-up) deliberately.**
  One slow or throwing `TimerTask` stalls or kills every task.
  *[Java Threads ch. 11, The java.util.Timer Class; MCPJ9 ch. 4, Additional
  information about executors]*
- **Stop threads by interruption; loop on `isInterrupted()` and treat
  `Thread.stop`, `suspend`, and `resume` as unavailable.** They are
  nonfunctional on current JDKs. *[Java Threads ch. 2, Two Approaches to
  Stopping a Thread]*
- **Clear every `ThreadLocal` in `finally` when the task ends on a pooled
  thread; prefer `ScopedValue` (final in JDK 25) for request context on
  virtual threads.** Otherwise values leak into unrelated tasks, and a
  per-thread copy across a million virtual threads costs real memory. *[Java
  Threads ch. 5, Thread Local Variables; MCPJ9 ch. 1, Tips: Preferring local
  thread variables; JEP 506]*

## Locks, atomics, and memory visibility

- **Prefer `synchronized`; switch to `ReentrantLock` only for `tryLock`,
  timed or interruptible acquisition, several `Condition`s, or fairness.**
  On JDK 24+ `synchronized` no longer pins virtual threads; on JDK 21 to 23,
  use `ReentrantLock` around blocking calls made from virtual threads.
  *[Java Threads ch. 3, Choosing a Locking Mechanism; JEP 491]*
- **Call `wait`/`await` only while holding the lock, inside a `while` loop
  that rechecks the predicate, on the same object you synchronized on.**
  Wakeups can be spurious or stolen, and a mismatched monitor throws
  `IllegalMonitorStateException`. *[Java Threads ch. 4, The Wait-and-Notify
  Mechanism and Synchronization; Wait-and-Notify Mechanism with Synchronized
  Blocks]*
- **Lazily initialize a shared singleton with the holder-class idiom or an
  enum; if you must double-check, the field must be `volatile`.** A
  non-volatile double-checked field can publish a half-built object.
  *[Java Threads ch. 5, Double-Checked Locking; MCPJ9 ch. 1, Double-checked
  locking; JavaPerf ch. 7, Lazy Initialization]*
- **Use `AtomicInteger`/`AtomicReference` for single values, a
  read-compute-`compareAndSet` loop for compound updates, and `LongAdder` for
  write-heavy counters.** CAS loops degrade under heavy contention. A
  `LongAccumulator` function must be associative and commutative.
  *[Java Threads ch. 5, Summary of Atomic Variable Usage; MCPJ9 ch. 11, Atomic
  variables]*

## Concurrent collections and synchronizers

- **Never share `ArrayList`, `HashMap`, or other unsynchronized collections
  between writer threads; use `ConcurrentHashMap`, `ConcurrentLinkedDeque`,
  or a `BlockingQueue`, and treat `Vector` and `Hashtable` as legacy.**
  Unsafe sharing loses data or loops forever. *[MCPJ9 ch. 11, Concurrent data
  structures; Java Threads ch. 8, Using the Collection Classes]*
- **Do map read-modify-write with `compute`, `computeIfAbsent`, or `merge`,
  with short side-effect-free functions that never touch other keys.**
  A `get` then `put` races; a slow or re-entrant function blocks or deadlocks
  the bin. *[MCPJ9 ch. 11, The compute() method; Java Threads ch. 8, Complex
  Synchronization]*
- **Iterate a shared synchronized collection under its lock, or iterate a
  snapshot; never treat `ConcurrentModificationException` as a guard.** It is
  best-effort and fires after damage is done. *[Java Threads ch. 8,
  Iterators and Enumerations]*
- **Pick the synchronizer by coordination shape:** `CountDownLatch` for one
  wait on N events, `CyclicBarrier` for a reusable meeting point, `Phaser` for
  a changing party set, `Semaphore` to cap access, `Exchanger` for a two-way
  swap. Never hand-roll these with `wait`/`notify`. *[MCPJ9 ch. 1, Concurrency
  design patterns; Java Threads ch. 6, Synchronization Classes Added in J2SE
  5.0]*

## Streams and CompletableFuture

- **Write `reduce` with an associative accumulator and a true immutable
  identity; build mutable containers with `collect`.** A shared mutable
  identity corrupts parallel results. A custom collector's supplier must
  return a fresh container each call. *[MCPJ9 ch. 8, An introduction to the
  reduction operation; ch. 9, The collect() method]*
- **Go parallel only with a well-splitting source (arrays, ranges, primitive
  streams, `SplittableRandom`) and enough work to beat the overhead, measured
  against the sequential stream.** `Stream.iterate` and line streams split
  poorly. *[MCPJ9 ch. 8, Sources of a stream; ch. 6, Conclusions]*
- **Compose `CompletableFuture` with `then*`, `allOf`, and `anyOf`, and give
  blocking stages an explicit executor.** Non-async stages run on whichever
  thread completed the previous stage. *[MCPJ9 ch. 11, The CompletableFuture
  class]*

## Parsing input, dates, and regexes

- **Validate UUIDs against the canonical 36-character form, or round-trip
  through `UUID.fromString(s).toString()`; `fromString` accepts non-canonical
  forms.** *[Review lessons]*
- **Quote untrusted text with `Pattern.quote` before building a regex, and
  with `Matcher.quoteReplacement` before `replaceAll`.** `$` and `\` are
  special in replacement strings. *[Review lessons]*
- **Read timezone-less timestamps as `LocalDateTime` and attach an explicit
  zone, or treat them as UTC; never let the process default zone decide.**
  Derive "today" from the shared helper, never from `Instant.toString()`
  slicing. *[Review lessons]*

## Data access (JDBC and JPA)

- **Use `PreparedStatement` with bound parameters for all SQL, with a sized
  per-connection statement cache.** Statements are reused per connection;
  injection rules are in the security file. *[JavaPerf ch. 11, Prepared
  Statements and Statement Pooling]*
- **Load tenant-owned entities by id and tenant together (for example
  `findByIdAndOrgId`), never by `findById` alone.** *[Review lessons]*
- **Size the connection pool to what the database can serve, not to the
  thread count.** Each connection also holds heap buffers. *[JavaPerf ch. 11,
  JDBC Connection Pools]*
- **Turn off autocommit for multi-statement units of work and batch writes
  with `addBatch`/`executeBatch` or JPA batch settings with periodic
  `flush`.** Autocommit makes each statement a full transaction. *[JavaPerf
  ch. 11, Transactions; Optimizing JPA Writes]*
- **Keep transactions as short as correctness allows; lock optimistically
  for rarely contended rows and with `FOR UPDATE` for hot ones.** Never weaken
  isolation below what correctness needs. *[JavaPerf ch. 11, Transactions;
  Review lessons]*
- **Paginate or stream every unbounded query and set the JDBC fetch size for
  large result sets.** Ask what happens at 10k rows before shipping. *[JavaPerf
  ch. 11, Result Set Processing; Review lessons]*

## Testing with JUnit (Jupiter)

General test design (TDD, AAA, pyramid, flakiness) is in the testing file.

- **Test exceptions with `assertThrows` around the one call that should
  throw, then assert on the returned exception's message and fields.**
  `@Test(expected=...)` passes when any line throws. *[JUnit5-Gulati ch. 5,
  Using assertThrows Assertion Method]*
- **Order assertion arguments expected, actual, message; JUnit 4 put the
  message first.** Pass costly messages as a `Supplier`. *[JUnit5-Gulati ch.
  2, Assertions]*
- **Use AssertJ for collection, map, and exception assertions, and
  `assertAll` to report every failed property of one behavior.**
  *[JUnit5-Gulati ch. 2, Grouping Assertions; ch. 3, AssertJ]*
- **Create per-test mutable state in `@BeforeEach`; put only expensive
  read-only resources in `@BeforeAll`.** With
  `@TestInstance(Lifecycle.PER_CLASS)`, reset every field before each test.
  *[JUnit5-Gulati ch. 2, JUnit Life Cycle API]*
- **Replace copied tests with `@ParameterizedTest` and a source, and set a
  `name` pattern so each case is identifiable in reports.** *[JUnit5-Gulati
  ch. 7, Parameterized Test]*
- **Skip a broken test with `@Disabled("reason")`, never by deleting or
  commenting it out.** It stays visible as skipped. *[JUnit5-Gulati ch. 3,
  Disabled Tests]*
- **Use `assertTimeoutPreemptively` only when the test must be cut off at
  the deadline; otherwise use `assertTimeout` or the declarative `@Timeout`
  (5.5+).** The preemptive form runs the code on another thread, so
  `ThreadLocal`-bound state such as transactions is absent. *[JUnit5-Gulati
  ch. 5, Working with Test Timeout]*
- **Name test classes `*Test` or `*Tests` under Maven, or configure Surefire
  `<includes>`.** The book's `*Spec` suffix matches none of Surefire's
  default patterns, so those tests silently never run. *[JUnit5-Gulati ch. 1,
  Writing Your First Test; Surefire inclusion docs]*
- **Migrate JUnit 4 suites class by class onto Jupiter, running the rest on
  the Vintage engine only as a bridge.** JUnit 6 (Java 17+) keeps the Jupiter
  API, deprecates Vintage and `junit-jupiter-migrationsupport`, and puts
  Platform, Jupiter, and Vintage on one version; pin it through `junit-bom`.
  *[JUnit5-Gulati ch. 8, Moving to JUnit 5; JUnit 6 release notes]*
- **Test concurrent code with an interleaving-exploring tool as well as
  stress runs; today that means jcstress or Lincheck.** Repeated runs only
  lower the odds of missing a race. *[MCPJ9 ch. 12, Testing concurrency
  applications]*

## Performance, memory, and the JVM

Benchmark method and load-test design are in the performance-testing file.

- **Buffer file and socket streams, and use `StringBuilder` for strings built
  across statements or loops.** One-expression `+` is already efficient.
  *[JavaPerf ch. 12, Buffered I/O; String Performance]*
- **Size collections up front when the count is known, and pool only
  expensive objects (threads, connections, parsers, compiled schemas).**
  Pooling cheap objects drags them into the old generation. *[JavaPerf ch. 7,
  Object Reuse; ch. 12, Collection Sizing; ch. 10, Choosing a Parser]*
- **Start with the default collector (G1), confirm from the GC log that GC is
  the problem, then tune to a pause-time goal before resizing the heap; use
  ZGC for very low pauses on large heaps.** *[JavaPerf ch. 5, Choosing a GC
  Algorithm; ch. 6, Summary]*
- **Set heap limits explicitly in containers (`-XX:MaxRAMPercentage` or
  `-Xmx`) and keep heaps just under the compressed-oops limit, about
  31 GB.** *[JavaPerf ch. 5, Controlling Parallelism; ch. 8, Compressed oops]*
- **Read which pool an `OutOfMemoryError` names (heap, metaspace, native,
  threads) and find the leak with a heap histogram or dump before raising
  limits.** *[JavaPerf ch. 7, Out of Memory Errors]*
- **Leave unified GC logging (`-Xlog:gc*`) and a continuous JFR recording on
  in production, and check effective flags with `jcmd <pid> VM.flags`.**
  *[JavaPerf ch. 3, Java Flight Recorder; Basic VM Information]*
- **Profile with a sampler first, and inspect blocked threads with JFR or
  thread dumps; take a `jcmd Thread.print` dump before guessing at a hang.**
  CPU profiles do not show blocked time. *[JavaPerf ch. 3, Blocking Methods
  and Thread Timelines; Java Threads ch. 6, Deadlock Detection]*

## Logging, serialization, HTTP, and secrets

- **Use parameterized or supplier log messages so disabled levels build
  nothing, and log only the per-request data the business needs.** *[JavaPerf
  ch. 12, Logging]*
- **Never deserialize untrusted data with native Java serialization; use an
  explicit data format, and where legacy code forces it, set an
  `ObjectInputFilter` allowlist with size limits.** Filters reduce the risk
  but do not make arbitrary input safe. *[OWASP Deserialization]*
- **Give every outbound `HttpClient` call that carries a token a connect and
  request timeout and `Redirect.NEVER`.** *[Review lessons]*
- **Write secrets with `Files.createTempFile` (unique name, owner-only on
  POSIX) or explicit `0600` permissions, never a fixed relative path.**
  *[Review lessons]*

## Build, lint, and review gates

- **Compile with `-Xlint:all -Werror` and run a static analyzer (Error Prone,
  PMD, or Checkstyle) that fails on unused imports and dead code.** *[Review
  lessons]*
- **Suppress a warning with `@SuppressWarnings` on the narrowest element and
  a comment saying why; never downgrade a correctness check build-wide.**
  *[Review lessons]*

## Tensions

- **Lock-free atomics vs locks.** One source says atomics always win; the
  other calls lock-free design debatable. This library uses library atomics
  and `LongAdder` freely, keeps hand-written CAS designs for profiled
  hotspots, and measures under real contention. *[MCPJ9; Java Threads]*
- **Pooled platform threads vs virtual threads.** The sources predate
  JDK 21 and size pools for blocking I/O. Use virtual threads for I/O-bound
  request work, and bounded platform pools for CPU-bound work and for code
  that pins carriers through native calls. *[Java Threads; MCPJ9; JavaPerf]*
- **Unbounded vs bounded executor queues.** JavaPerf accepts
  `LinkedBlockingQueue` for unbounded backlogs; Java Threads prefers bounded
  queues. This library bounds every queue in services and allows unbounded
  ones only in batch jobs whose input size is known. *[JavaPerf; Java
  Threads]*
- **Weak default isolation vs database-enforced invariants.** JavaPerf
  suggests a READ UNCOMMITTED default with explicit locking. This library
  keeps the database default and enforces invariants with constraints and
  `FOR UPDATE`. *[JavaPerf; Review lessons]*

## Sources

- **JavaPerf**: Java Performance: The Definitive Guide (Scott Oaks; O'Reilly, 1st edition, 2014; covers Java 7 and 8)
- **Java Threads**: Java Threads, 3rd Edition (Scott Oaks, Henry Wong; O'Reilly, 2004; covers J2SE 5.0)
- **MCPJ9**: Mastering Concurrency Programming with Java 9, 2nd Edition (Javier Fernandez Gonzalez; Packt, 2017)
- **JUnit5-Gulati**: Java Unit Testing with JUnit 5: Test Driven Development with JUnit 5 (Shekhar Gulati, Rahul Sharma; Apress, 2017)
- **Review lessons**: rules distilled from the maintainer's code-review findings
- **ReentrantLock Javadoc**: Java SE 25 API, `java.util.concurrent.locks.ReentrantLock` (<https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/ReentrantLock.html>)
- **JEP 491**: OpenJDK, JEP 491: Synchronize Virtual Threads without Pinning (<https://openjdk.org/jeps/491>)
- **JEP 506**: OpenJDK, JEP 506: Scoped Values (<https://openjdk.org/jeps/506>)
- **OWASP Deserialization**: OWASP Cheat Sheet Series, Deserialization Cheat Sheet (<https://cheatsheetseries.owasp.org/cheatsheets/Deserialization_Cheat_Sheet.html>)
- **Surefire inclusion docs**: Maven Surefire Plugin, Inclusions and Exclusions of Tests (<https://maven.apache.org/surefire/maven-surefire-plugin/examples/inclusion-exclusion.html>)
- **JUnit 6 release notes**: JUnit, 6.0.0 release notes (<https://docs.junit.org/6.0.0/release-notes.html>)
