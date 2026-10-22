# Concurrency and parallelism

> **Load when:** writing, reviewing, or debugging code in which more than one
> thread, task, coroutine, worker, or process touches the same state; choosing
> locks, atomics, concurrent collections, executors, pools, queues, async
> pipelines, or parallel loops and streams; diagnosing a race, lost update,
> deadlock, hang, starvation, or poor multicore scaling; or sizing worker
> pools, buffers, and timeouts.
> **See also:** [Java](../languages/java.md),
> [JavaScript and TypeScript](../languages/javascript-typescript.md),
> [Python](../languages/python.md),
> [Distributed systems](../distributed/distributed-systems.md),
> [Database operations, internals, and high availability](../data/database-operations.md),
> [Event-driven architecture and messaging](../architecture/event-driven-and-messaging.md),
> [Front-end components and state](../frontend/components-and-state.md),
> [Debugging](../core/debugging.md),
> [Unit, integration, and test-driven development](../testing/testing.md),
> [Performance and load testing](../testing/performance-and-load-testing.md),
> [Operating systems and Linux](../systems/operating-systems-and-linux.md)

## Top rules

1. **List every piece of state more than one thread can reach, and give each
   piece exactly one guard: one lock, one atomic, or one owning thread.** Every
   reader and writer uses it; one unguarded read brings the race back.
   *[AoMP ch. 2, 3; Java Threads ch. 3, 7; CPJ, Designing Objects]*
2. **Share less before you lock more.** Immutable values, data confined to one
   task, and ownership handed along a queue need no locks and cannot deadlock.
   *[CPJ, Designing Objects; MCPJ9 ch. 1, 5; Java Threads ch. 5]*
3. **Make every check-then-act and read-modify-write one atomic step.** "If
   absent then put" or "read, add, write back" across two calls races even when
   each call is thread-safe; hold one lock across both or use an atomic
   method. *[CPJ, Designing Objects; Java Threads ch. 8; MCPJ9 ch. 1, 11]*
4. **Enforce "only one", "never twice", "at most N", and "serialized" across
   processes in the database, not in memory.** An in-process lock covers one
   process; replicas and workers need a unique or partial unique index, an
   upsert, `SELECT ... FOR UPDATE`, or an advisory lock. *[Review lessons]*
5. **Acquire multiple locks in one documented global order, and never block on
   I/O or call foreign code while holding a lock.** Opposite orders and
   callbacks under a lock are the two common deadlock recipes. *[AoMP ch. 9;
   Java Threads ch. 3, 6; CPJ, Designing Objects; MCPJ9 ch. 1]*
6. **Assume no visibility or ordering between threads without a happens-before
   edge, and never rely on an order you merely observed.** Only locks, volatile
   or atomic accesses, and library synchronizers order memory. *[AoMP ch. 3,
   App. B; Java Threads ch. 5; MCPJ9 ch. 1]*
7. **Use the highest-level library abstraction that fits** (executor, blocking
   queue, concurrent map, latch, future) before raw threads, wait/notify, or
   hand-written lock-free code. *[MCPJ9 ch. 1; CPJ, Libraries; Java Threads ch.
   6; AoMP ch. 8, 9]*
8. **Bound everything: pool sizes, queue lengths, retries, and every wait.**
   Unbounded queues turn overload into memory exhaustion; an untimed wait on a
   hung task hangs the caller. *[Java Threads ch. 10; CPJ, Introducing
   Concurrency; MCPJ9 ch. 5, 10]*
9. **Cancel cooperatively and never swallow an interruption or cancellation
   signal.** Propagate it or restore the flag, and give every thread you start a
   shutdown path. *[AoMP ch. 8; CPJ, Introducing Concurrency; MCPJ9 ch. 4]*
10. **Keep a correct sequential version and measure against it.** It is the test
    oracle and the speedup baseline; Amdahl's law caps the gain at the serial
    fraction. *[MCPJ9 ch. 1; AoMP ch. 1; Java Threads ch. 14, 15]*

## Shared state and locking

- **Treat any read-modify-write on shared data as a race unless it is atomic or
  in the critical section, and keep no race because it never shows locally.**
  A race is benign only if every interleaving gives the same result.
  *[MCPJ9 ch. 1; Java Threads ch. 3, 15]*
- **Keep critical sections to the statements that touch shared state, with no
  blocking I/O, sleeps, or long computation inside.** Copy what you need into
  locals, release, then compute; a stalled or preempted holder makes every
  waiter queue behind it. *[AoMP ch. 1, 18; MCPJ9 ch. 1; Java Threads ch. 3]*
- **Call `lock()` immediately before `try` and release in `finally`.** Acquiring
  inside the `try` makes a failed acquire unlock a lock it never held.
  *[AoMP ch. 2, 7; Java Threads ch. 6; MCPJ9 ch. 11]*
- **Restore or invalidate shared state before a lock is released on an
  exception path.** Handing the next thread half-updated data can be worse than
  a deadlock. *[Java Threads ch. 6; CPJ, Designing Objects]*
- **Put the lock inside the shared object and record the lock-to-data mapping
  in code** (private fields, a `GuardedBy`-style annotation). Callers who must
  follow a locking convention will eventually forget. *[AoMP ch. 8, 18; CPJ,
  Designing Objects]*
- **Choose each shared collection's iteration policy on purpose**: lock for the
  whole traversal, iterate a snapshot or copy-on-write structure, or use a
  concurrent collection. A fail-fast exception is not a guard. *[CPJ, Designing
  Objects; Java Threads ch. 8]*

## Visibility and safe publication

- **Use volatile or atomic fields for one value with one writer, and atomics or
  a lock for anything compound.** `x++` on a volatile still loses updates.
  *[AoMP ch. 3; Java Threads ch. 3; MCPJ9 ch. 1]*
- **Publish a "data ready" flag with a release write and read it with an
  acquire read.** A plain flag can become visible before its data.
  *[AoMP App. B]*
- **Reject unsynchronized double-checked locking in review.** Use a volatile
  field, a holder class or once-initializer, or the language's lazy primitive.
  *[AoMP ch. 3; Java Threads ch. 5; MCPJ9 ch. 1]*
- **Never let `this` escape a constructor.** Start threads and register
  listeners from a factory or a separate `start()`. *[AoMP ch. 3]*
- **Put fields that must change together into one immutable value and swap the
  reference atomically.** Separate getters let a reader see an old x with a new
  y. *[CPJ, Designing Objects; Java Threads ch. 5]*

## Immutability, confinement, and ownership

- **Make value and service objects immutable, and lock only the methods that
  touch mutable fields.** Construction-time state needs no lock. *[CPJ,
  Designing Objects; MCPJ9 ch. 1]*
- **Give each task its own slice of data and merge after the tasks finish.**
  *[MCPJ9 ch. 5; Java Threads ch. 15]*
- **Confine a non-thread-safe library to one thread by sending every call
  through a single-thread executor or owner object.** Your lock does not help
  when its internals do not take it. *[Java Threads ch. 7, 10; CPJ, Designing
  Objects]*
- **Never touch a single-threaded UI toolkit or event loop off its thread, and
  never block that thread.** Run long work in the background and post results
  back. *[Java Threads ch. 7; CPJ, Introducing Concurrency]*
- **Keep per-activity context (request id, principal, deadline) in per-task
  scope, not statics or shared objects.** Current practice: a scoped or
  context variable (Java `ScopedValue` on JDK 25+, Python `contextvars`, Go
  `context.Context`); a thread-local on a pooled thread must be cleared when
  each task ends. *[CPJ, Introducing Concurrency; Java Threads ch. 5]*

## Deadlock and liveness

- **Order lock acquisition by a stable unique key, handle the "same object
  twice" case first, and design the order in early.** Overridable hash codes
  collide or change. Collapsing onto one global lock fixes deadlock only by
  removing parallelism. *[CPJ, Designing Objects; Java Threads ch. 6; MCPJ9 ch.
  1; AoMP ch. 9]*
- **Update state under the lock, copy what the call needs, release, then call
  out.** Callbacks and observer notifications under a lock create cycles
  invisible from either class alone. *[CPJ, Designing Objects; CPJ,
  Introducing Concurrency; Java Threads ch. 3; MCPJ9 ch. 1]*
- **Never wait on an inner object's condition while holding an outer lock.**
  Nobody can get in to signal you. *[CPJ, Designing Objects]*
- **Use timed or try-lock acquisition only with a real fallback** (release,
  undo, back off with randomized capped delay, retry), and bound retries.
  Lock-step retries livelock. *[Java Threads ch. 6; CPJ, Libraries; AoMP ch. 7]*
- **Never use thread priorities, or assume lock or wakeup fairness, for
  correctness.** Enable fair locks only after showing starvation; they cost
  throughput. *[Java Threads ch. 3, 6, 9; CPJ, Designing Objects; MCPJ9 ch. 1]*
- **Use a read/write lock only for long, frequent reads and rare writes, choose
  its precedence deliberately, and never upgrade a held read lock.** Wrong
  precedence starves one side; an upgrade deadlocks. *[CPJ, Concurrent
  Application Architectures; Java Threads ch. 6; MCPJ9 ch. 1]*

## Waiting and signalling

- **Wait while holding the condition's lock, re-test the predicate in a `while`
  loop, and pair every state change that could unblock a waiter with a
  signal.** Waits return spuriously; a signal sent before anyone waits is lost,
  so the state must carry the information. *[AoMP ch. 8; Java Threads ch. 4;
  CPJ, Designing Objects]*
- **Signal all waiters on a shared condition; signal one only when every waiter
  waits for the same predicate and one can proceed.** Transition-only
  signalling with several producers or consumers loses wakeups. *[AoMP ch. 8;
  Java Threads ch. 4; CPJ, Libraries]*
- **Prefer semaphores, latches, barriers, and blocking queues to hand-built
  signalling, and follow their protocol**: arrive every phase, release every
  permit, handle a broken barrier. Gate a dependent step on a latch instead of
  forcing order onto concurrent tasks. *[CPJ, Libraries; Java Threads ch. 6;
  MCPJ9 ch. 1, 6; AoMP ch. 17]*
- **Treat timeouts as failure detection, not deadlines; after a timed wait
  re-check both the predicate and the time left.** *[CPJ, Designing Objects]*
- **Do not use sleep for timing or busy-wait.** Spin only on a latching
  condition, on a multiprocessor, for short expected waits. *[Java Threads ch.
  2; CPJ, Designing Objects; AoMP ch. 7, 8]*
- **Document each state-dependent operation's policy** (balk, wait, time out,
  retry) and offer blocking, non-blocking, and timed variants when callers
  differ. *[CPJ, Designing Objects; AoMP ch. 10]*

## Tasks, pools, and executors

- **Size pools from the core count queried at runtime, never a hard-coded
  number**: about one thread per core for CPU-bound work, roughly cores divided
  by (1 − blocked fraction) for work that blocks, then confirm with a load
  test. *[Java Threads ch. 10; MCPJ9 ch. 1]*
- **Parse pool sizes, capacities, and timeouts from config with a validator
  that rejects zero, negative, non-numeric, and absurd values at startup.**
  *[Review lessons]*
- **Give every pool a bounded queue and an explicit saturation policy**: reject
  with a clear "busy" signal or push back on the caller, never drop silently.
  *[Java Threads ch. 10; MCPJ9 ch. 4]*
- **Name pool threads and route uncaught task exceptions to logging and
  alerts.** *[Java Threads ch. 10, 13; MCPJ9 ch. 4]*
- **Return results and failures through futures or callbacks, and use the timed
  form of every wait in service code.** Worker exceptions do not reach the
  caller on their own. *[CPJ, Introducing Concurrency; Java Threads ch. 10;
  MCPJ9 ch. 5]*
- **Shut down every executor you create and await termination with a timeout.**
  Current practice: tie lifetime to a block (try-with-resources on a Java 19+
  `ExecutorService`, Python `asyncio.TaskGroup`, Go `errgroup`) so no task
  outlives its caller. *[Java Threads ch. 10; MCPJ9 ch. 3, 4]*
- **Keep blocking work off shared CPU pools** (fork/join, a common pool, an
  event loop); give it its own executor. *[MCPJ9 ch. 7, 11]*
- **For many blocking connections use lightweight threads or nonblocking I/O,
  and cap concurrency against downstream resources with a semaphore.** The
  database still has a connection limit. *[Java Threads ch. 12; CPJ,
  Introducing Concurrency]*

## Cancellation and shutdown

- **Cancel by request, never by killing a thread.** Forced stops land mid-update
  and leave locks held. *[CPJ, Introducing Concurrency; Java Threads ch. 2]*
- **On interruption, exit promptly and propagate it or restore the flag.**
  Catching it clears the flag, so an empty `catch` hides the request from
  callers. *[AoMP ch. 8; CPJ, Introducing Concurrency]*
- **Poll for cancellation at method entry and loop headers, never mid-way
  through an irreversible action.** *[CPJ, Introducing Concurrency; MCPJ9 ch.
  2, 4]*
- **Do not expect interruption to unblock lock acquisition or classic blocking
  I/O; close the resource or use interruptible channels and I/O timeouts.**
  *[CPJ, Introducing Concurrency; Java Threads ch. 12]*
- **In async UI and client code, discard stale responses with a request id or
  abort token, and clear timers and subscriptions on teardown.** A slow early
  request must not overwrite a later result. *[Review lessons]*

## Producers, consumers, and asynchronous flow

- **Build producer/consumer handoff on a blocking queue, and choose its kind on
  purpose**: unbounded risks memory, bounded blocks producers, dropping loses
  items, priority reorders. *[Java Threads ch. 8; CPJ, Introducing
  Concurrency; AoMP ch. 10]*
- **Apply back-pressure: consumers request items as they are ready**, using the
  library's publisher rather than a hand-written reactive protocol.
  *[MCPJ9 ch. 10]*

## Designing and documenting concurrent components

- **Document each component's concurrency contract**: thread-safe or not, which
  methods block or are interruptible, which locks a caller must hold, guard
  conditions, invariants. *[CPJ, Libraries; AoMP ch. 3]*
- **Make every concurrency claim in a docstring match the code.** "Never
  blocks", "at most one", or "callbacks run in order" is a contract; re-verify
  it whenever the diff touches that code. *[Review lessons]*
- **Specify concurrent objects as linearizable by default and name each
  method's linearization point; relax to the weakest consistency the use case
  tolerates only in writing.** *[AoMP ch. 3, 12]*
- **Layer designs: an outer layer creates threads, a middle layer controls
  concurrency, inner code has none**, and avoid components that push hidden
  locking duties onto callers. *[CPJ, Concurrent Application Architectures;
  CPJ, Libraries; AoMP ch. 18]*
- **Do not compose two independently locked objects into one atomic operation
  by calling them in sequence.** Design an explicit multi-object operation, or
  use a transaction where the data lives in a database. *[AoMP ch. 18]*

## Parallel performance

- **Profile first, then parallelize only hot, independent work.** A loop that
  carries state between iterations cannot be split. *[MCPJ9 ch. 1; Java
  Threads ch. 14]*
- **Classify every loop variable before parallelizing** (private, read-only,
  reduction, truly shared); combine per-thread partials once at the end, and
  check numeric error for floating-point reductions. *[Java Threads ch. 15]*
- **Choose granularity and decomposition on purpose and benchmark a few
  sizes.** Per-element tasks drown in overhead, and data decomposition scales
  with cores while task decomposition does not. *[MCPJ9 ch. 1, 2, 3, 5;
  AoMP ch. 16]*
- **Balance uneven work dynamically** (work stealing, guided chunks); use static
  equal shares only when iterations cost the same. *[AoMP ch. 1, 16; Java
  Threads ch. 15]*
- **Pick the algorithm that splits cleanly, and test small inputs, early exits,
  and error paths, where parallel often loses.** *[MCPJ9 ch. 1, 6, 7, 9]*
- **Benchmark with a real harness** (JMH on the JVM, an equivalent elsewhere)
  with warm-up, repeated runs, and more than one machine. *[MCPJ9 ch. 2; Java
  Threads ch. 14; OSPP-III ch. 9]*
- **Start with one coarse lock; split locks, stripe, or go lock-free only when
  measurement shows a bottleneck.** *[AoMP ch. 9, 13; CPJ, Designing Objects;
  Java Threads ch. 5, 14]*
- **Split hot counters into per-thread or striped pieces summed on read, and
  pad independently written data onto separate cache lines.** *[AoMP ch. 7,
  App. B; Java Threads ch. 14; MCPJ9 ch. 11]*

## Atomics and lock-free code

- **Use library atomics and concurrent collections; hand-roll lock-free code
  only for a proven hotspot.** Two atomic operations are not atomic together.
  *[Java Threads ch. 5; AoMP ch. 3, 9]*
- **Write compound atomic updates as read, compute without side effects,
  compare-and-set, retry.** *[CPJ, Designing Objects; Java Threads ch. 5]*
- **Defend CAS on recycled nodes against ABA** with version stamps or safe
  reclamation, and let any thread finish a half-done multi-step update it
  finds. *[AoMP ch. 10]*
- **After an optimistic unlocked read, lock and re-validate before acting, and
  make aborted attempts harmless.** *[AoMP ch. 9, 18]*
- **State each method's progress guarantee.** Prefer locks unless stalled
  holders are common, and lock-free over wait-free unless you need per-call
  bounds. *[AoMP ch. 3, 9]*

## Testing, debugging, and review

- **Test on multicore hardware with tools that explore interleavings**, using
  the sequential version as the oracle. Current tools: jcstress and Lincheck
  on the JVM, ThreadSanitizer for C, C++, and Rust, `go test -race` for Go.
  *[MCPJ9 ch. 1, 12; Java Threads ch. 15]*
- **When a program hangs, take a thread dump before guessing.** Runtimes report
  lock cycles but not a lost wakeup or a never-released lock. *[Java Threads
  ch. 6]*
- **Expose metrics for pools, queues, and locks** (active, queued, rejected,
  waiters). *[MCPJ9 ch. 12]*
- **Make concurrency bugs replayable** by recording inputs, timing, and lock
  order, or with a record-and-replay debugger. *[OSPP-III ch. 10]*
- **Review with three checklists.** Safety: races, broken atomicity, stale
  reads. Liveness: deadlock, livelock, missed signals, starvation. Efficiency:
  too much locking, too many threads. *[CPJ, Libraries]*
- **After fixing a race or missing guard, grep for the same pattern and fix
  every sibling in the same change.** *[Review lessons]*

## Tensions

- **Signal all vs signal one per condition.** House position: signal all on a
  shared condition; with many waiters, give each predicate its own condition and
  signal precisely. *[AoMP ch. 8; CPJ, Libraries; Java Threads ch. 4]*
- **Generous vs minimal fences.** AoMP holds both. House position: library
  synchronization by default; minimal fences only in a profiled hot path with a
  written argument. *[AoMP App. B]*
- **Thread pools vs a task per request.** The older warnings assumed OS threads
  (dated: Java 21 virtual threads, goroutines, and async runtimes changed
  this). House position: pool CPU-bound work at about core count; give I/O-bound
  work a lightweight task each, bound downstream resources with semaphores, and
  do not pool virtual threads (before JDK 24, blocking inside `synchronized`
  pins the carrier thread). *[AoMP ch. 16; Java Threads ch. 12; CPJ,
  Introducing Concurrency; MCPJ9 ch. 1]*
- **Atomics always beat locks vs measure first.** MCPJ9 claims they always win;
  CAS loops degrade under heavy write contention. House position: atomics for
  single variables, striped counters for hot ones, locks for multi-field
  invariants. *[MCPJ9 ch. 1, 11; Java Threads ch. 5; AoMP ch. 12]*
- **Never call out under a lock vs practicality.** House position: update,
  release, then call; when the message must match the state, queue it under the
  lock and send after release. *[CPJ, Designing Objects; Java Threads ch. 6]*
- **Immutability vs allocation cost.** House position: immutable by default,
  persistent or copy-on-write structures for large aggregates, and reject
  immutability only with a measurement. *[MCPJ9 ch. 1; CPJ, Designing Objects]*
- **Transactional memory vs locks.** AoMP expects transactional memory to win
  (dated: hardware support was disabled on many CPUs). House position: locks,
  atomics, and library collections in memory; transactions where the data lives
  in a database. *[AoMP ch. 18]*

## Sources

- **AoMP**: The Art of Multiprocessor Programming (Maurice Herlihy, Nir Shavit,
  Revised First Edition)
- **Java Threads**: Java Threads (Scott Oaks, Henry Wong, 3rd edition)
- **CPJ**: Concurrent Programming in Java: Design Principles and Patterns (Doug
  Lea), cited by part from the author's tutorial slides summarizing the book
- **MCPJ9**: Mastering Concurrency Programming with Java 9 (Javier Fernandez
  Gonzalez, 2nd edition)
- **OSPP-III**: Operating Systems: Principles and Practice, Volume III: Memory
  Management (Thomas Anderson, Michael Dahlin, 2nd edition)
- **Review lessons**: rules distilled from the maintainer's code-review findings
