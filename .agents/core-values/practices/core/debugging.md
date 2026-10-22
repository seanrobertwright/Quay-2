# Debugging

> **Load when:** a test, build, or program fails, crashes, hangs, or gives a
> wrong result; a bug report or stack trace arrives; a failure is intermittent,
> environment-specific, or appeared after an upgrade; or you are about to write,
> review, or verify a bug fix.
> **See also:** [Unit, integration, and TDD](../testing/testing.md),
> [Code and module design](../core/code-design.md),
> [Version control and code review](../core/version-control.md),
> [Concurrency and parallelism](../concurrency/concurrency.md),
> [Observability and reliability](../operations/observability-and-reliability.md),
> [Performance and load testing](../testing/performance-and-load-testing.md),
> [Refactoring and legacy code](../core/refactoring-and-legacy-code.md),
> [Specifying intent for AI coding agents](../core/working-with-ai-agents.md)

## Top rules

1. **Reproduce the exact reported symptom with one command before changing any
   code.** Without a reproduction you cannot show the fix works, and a
   different failure may be a different bug. *[WPF ch. 4; PragProg Topic 20]*
2. **Turn the reproduction into an automated pass/fail test, run it after every
   change, and keep it as a regression test.** Debugging needs many repeated
   runs, and the same test later proves the fix and stops the bug returning.
   *[WPF ch. 3; PragProg Topic 20, Topic 51]*
3. **Debug by hypothesis, not by tweaking.** State a hypothesis that explains
   every observation, predict what an experiment will show, run it, and keep or
   reject the hypothesis; changing code until a test happens to pass is
   guessing. *[WPF ch. 6, ch. 15]*
4. **Narrow the search by halving.** Bisect the input, the stack, the
   configuration, or the commit range between last good and first bad until
   only the needed elements remain. *[WPF ch. 5, ch. 13; PragProg Topic 20]*
5. **Prove the cause before you fix it.** Change only the suspected factor and
   confirm the failure disappears, then returns when you restore it; "obviously"
   is not evidence. *[WPF ch. 12, ch. 15; PragProg Topic 20]*
6. **Fix the defect, never the symptom.** Do not special-case the failing input,
   add an unexplained +1, or wrap the failure in a catch-and-retry; the defect
   stays and usually spawns another. *[WPF ch. 15; PragProg Topic 20, Topic
   38; 97 Things: Don't Nail Your Program into the Upright Position]*
7. **Suspect your own code and the last thing that changed before the
   compiler, OS, or a mature library.** Mature tools are rarely the cause, and
   an upstream report needs that elimination anyway. *[PragProg Topic 20; 97
   Things: Check Your Code First Before Looking to Blame Others]*
8. **If a fix does not remove the failure, record it in the debugging log and
   revert it before trying another.** A failed fix left in place invalidates
   every later observation; reconsider the hypothesis, and check whether a
   second defect (a writer and reader sharing one mistake, a missing check on a
   wrong value) was masking the first. *[WPF ch. 15; 97 Things: Two Wrongs Can
   Make a Right]*
9. **After every fix, grep the codebase for the same defect and fix every
   sibling in the same change.** One defect usually comes from a repeated idiom;
   where the idiom is error-prone, replace it with a safe helper so it cannot
   recur. *[WPF ch. 15; PragProg Topic 20; Review lessons §3 Sibling sweep]*
10. **Read the whole error message and stack trace, and clear compiler
    warnings and linter findings, before opening the code.** Tools often have
    already reported the problem. *[PragProg Topic 20; WPF ch. 7; 97 Things:
    Keep the Build Clean]*

## Workflow for a non-trivial bug

- **Follow a fixed sequence: track, reproduce, automate and simplify, list
  possible origins, focus on the likely ones, isolate, correct.** Skipping
  reproduction or isolation is how a fix ends up treating the wrong problem.
  *[WPF ch. 1]*
- **Think defect, then infection, then failure, and trace backward from the
  failure.** A defect corrupts state, the corruption spreads, and only later
  shows; a passing run therefore does not prove the code correct. *[WPF ch. 1]*
- **Time-box intuitive debugging to about ten minutes, then switch to the
  formal process.** Quick guesses are fine for simple-looking problems; once
  the box expires, write the problem statement down and work hypothesis by
  hypothesis. *[WPF ch. 6]*
- **State the problem in writing before diving in.** Explaining each step, to a
  person, a rubber duck, or a log file, forces you to state assumptions you
  would otherwise skip. *[WPF ch. 6; PragProg Topic 20]*
- **Keep a debugging log: problem, each hypothesis, prediction, experiment,
  result, conclusion.** It stops you re-running rejected experiments and lets
  another agent or session resume the work. *[WPF ch. 6]*
- **Make every new hypothesis explain all results so far, including the ones
  that rejected earlier ideas.** Draw hypotheses from the report, the code, the
  failing run, and comparable passing runs. *[WPF ch. 6]*
- **Do not report a cause found only by reading code, watching one run, or
  correlating many runs.** Those modes generate and rank hypotheses; only a
  controlled experiment establishes cause. *[WPF ch. 6]*
- **When a bug surprises you, re-check each piece of code you trusted against
  this data and these boundary values.** Surprise means an assumption is wrong;
  "that's impossible" and "it only fails sometimes" are not diagnoses.
  *[PragProg Topic 20, Topic 38]*
- **Before committing the first working fix, re-read the problem statement and
  look for a smaller change.** The first version that works is often not the
  simplest; a fresh pass often replaces many lines with one. *[97 Things: Put
  the Mouse Down and Step Away from the Keyboard]*

## Reproducing the failure

- **Check every symptom in the report against your reproduction.** Confirm the
  run actually shows the bad value; a second-hand report or hand-made input
  often misses the triggering path. *[WPF ch. 4; PragProg Topic 20]*
- **When it will not reproduce, adopt the reporter's circumstances one at a
  time, cheapest and most likely first.** Start with configuration, data, and
  versions; leave OS and hardware for last; if everything matches and it still
  passes, question the report. *[WPF ch. 4]*
- **Watch, or replay, exactly what the reporter did.** Users take step orders
  and paths you never imagined. *[97 Things: Check Your Code First Before
  Looking to Blame Others; PragProg Topic 20]*
- **Drive the reproduction at the lowest layer that still fails.** Prefer the
  unit API, then the service or scripting layer, with the UI as the last resort;
  lower layers are faster and less brittle. *[WPF ch. 3]*
- **Put every nondeterministic input behind a seam you control: clock,
  randomness, network, user input, OS services, thread schedule.** Injectable
  time and seeds let a failing run be replayed exactly and turned into a test;
  never let users disable real randomness in security code. *[WPF ch. 4]*
- **Record what a unit saw in the failing run and replay it with a mock or
  recorded fixture.** A control layer at the unit boundary removes the need to
  stand up the whole system. *[WPF ch. 4]*
- **For a crash, capture the state at the crash (dump, stack, arguments) and
  replay the failing call from it.** This often works when the user's full
  history cannot be recreated. *[WPF ch. 4, ch. 8]*
- **Rebuild the exact failing release.** Tag every released version and link
  each fix to its report, or a field failure cannot be reproduced. *[WPF ch. 2]*

## Isolating the cause

- **Simplify the failing input until every remaining element is needed.** An
  element is irrelevant if the failure occurs with or without it; a minimal case
  often points straight at the defect and exposes duplicate reports. *[WPF
  ch. 5]*
- **Simplify by halving and automate it for large inputs.** Drop half, keep the
  half that still fails, refine granularity; use a reducer or the fuzzer's
  built-in minimizer driven by a pass/fail predicate. Apply this to interaction
  sequences and configuration, not only data. *[WPF ch. 5; PragProg Topic 20]*
- **With a passing and a failing input, isolate the difference between them.**
  Narrowing that delta converges faster than minimizing the failing input alone
  and yields an actual cause. *[WPF ch. 5, ch. 13]*
- **For a regression, run `git bisect run <test>` between last good and first
  bad.** Updated from the book's change-level tooling: have the script exit 125
  on commits that cannot be built so bisect skips them, and for upgrade
  regressions bisect dependency versions too. Small commits with tests make
  this fast. *[WPF ch. 13; PragProg Topic 20]*
- **Compare a failing run against a known-good reference run or older version
  on the same input.** The first divergence in intermediate state localizes the
  defect. *[WPF ch. 10]*
- **Look first at what is abnormal in failing runs: code reached, values
  returned, or invariants violated only there.** Anomalies correlate with
  defects but do not prove them; confirm each by experiment. *[WPF ch. 11]*
- **Prefer the actual cause: the smallest difference between the failing world
  and the closest passing one.** Context shared by passing and failing runs
  cannot be the cause. *[WPF ch. 12]*
- **Remember that an isolated cause is not necessarily the defect.** A
  failure-inducing input or change shows where the failure can be suppressed,
  not where the code is wrong, and there may be several causes. *[WPF ch. 13,
  ch. 14]*

## Observing the program

- **Decide what to observe, where, and why before adding a log line or a
  breakpoint.** Use the debugger only in service of an explicit hypothesis;
  stepping without one turns into aimless exploration. *[WPF ch. 8]*
- **Do not change the computation while observing it.** Log statements and
  watch expressions with side effects can alter or hide the failure. *[WPF
  ch. 8]*
- **Route diagnostics through the logging facility, with location and level,
  not scattered prints.** Framework logs can stay in the code safely; turn each
  ad hoc print or REPL poke that proved useful into a permanent test.
  *[WPF ch. 8; PragProg Topic 41]*
- **Use watchpoints or conditional breakpoints to answer "where does this
  variable get this value?"** They find the writing statement directly. *[WPF
  ch. 8]*
- **For timing-dependent, concurrent, or event-driven bugs, emit a
  machine-parsable trace and analyse it with tools.** A debugger shows one
  moment; a trace shows how state changed, such as unbalanced open and close
  calls. *[PragProg Topic 20]*
- **Log at ERROR only conditions that need someone to act.** A noisy error log
  buries the line that matters during an incident. *[97 Things:
  Verbose Logging Will Disturb Your Sleep]* Production telemetry, sampling, and
  alerting belong in
  [observability](../operations/observability-and-reliability.md).

## Tracing the infection to the defect

- **Narrow the search with the backward slice.** Only statements the bad value
  data- or control-depends on can have caused it; check the closest dependences
  first. *[WPF ch. 7, ch. 15]*
- **Follow the infection back one hop at a time.** Find the bad value's
  origins, check which is already wrong, and repeat; when all origins are sane,
  the code combining them is the defect. *[WPF ch. 9, ch. 15]*
- **Judge state at function and module boundaries.** State is narrow and easy
  to judge there; once a point is proven sane, search forward from it. *[WPF
  ch. 9, ch. 15]*
- **Rank origins to check: failing assertions and observed bad values, then
  proven causes, then anomalies, then code smells, then other dependences.**
  This spends effort where defects most likely are. *[WPF ch. 15]*
- **Confirm a candidate is both wrong and causal.** An infected but non-causal
  value misleads you, and a causal value that is not wrong means you are
  patching the wrong place. *[WPF ch. 15]*
- **When you can reproduce a failure but cannot follow it, record the run with
  a time-travel debugger and step backward from the bad value to its write.**
  Use rr or Pernosco on Linux, WinDbg Time Travel Debugging on Windows, or the
  language's replay tool (updated from the book's research omniscient
  debuggers). *[WPF ch. 9]*
- **Confirm code-reading conclusions with a real run.** The code you read may
  not be the code that ran, and static reasoning loses detail. *[WPF ch. 7]*

## Hard bug classes

- **Treat a bug that moves or vanishes under the debugger or extra logging as
  undefined behavior until proven otherwise.** Check uninitialized reads,
  out-of-bounds access, stack corruption, and data races before blaming the
  tool. *[WPF ch. 4; 97 Things: Check Your Code First Before Looking to Blame
  Others]*
- **In memory-unsafe code, run memory and undefined-behavior detectors first.**
  Use AddressSanitizer, UBSan, MemorySanitizer, ThreadSanitizer, or Valgrind
  (updated from the book's tools); heap corruption invalidates every other
  observation. *[WPF ch. 10]*
- **When failures are intermittent or appear in random places, suspect
  concurrency and shared process state first.** Globals, caches, and the
  working directory shared by threads are common culprits. *[PragProg Topic 34;
  97 Things: Check Your Code First Before Looking to Blame Others]* See
  [concurrency](../concurrency/concurrency.md).
- **Fix a race on "only one" or "never twice" in the database, not with an
  in-process guard.** Use a unique or partial unique index, `ON CONFLICT`,
  `SELECT ... FOR UPDATE`, or an advisory lock; a flag or comment does not hold
  across processes. *[Review lessons §2 Four invariants]*
- **In async UI code, check for stale responses overwriting fresh ones.** Guard
  with a request id and clear timers on unmount. *[Review lessons §6
  Accessibility and scale]*
- **When a date is off by hours or a day, look for a timezone-less string
  parsed as process-local time.** Route the fix through the project's single
  date helper and grep for raw parsing calls elsewhere. *[Review lessons §2 Four
  invariants]*
- **When a value is unexpectedly NaN, empty, or out of range, find the boundary
  that failed to parse it.** Fix it with a parser that rejects bad input with a
  clear message, not a downstream null check. *[Review lessons §2 Four
  invariants]*
- **When one user or org sees another's data, check the tenant column in every
  WHERE clause on that path.** A globally unique id alone is never sufficient.
  *[Review lessons §2 Four invariants]*
- **When code works on one machine only, suspect hidden context.** Working
  directory, locale, environment variables, clock accuracy, and hand-configured
  setup all differ. *[PragProg Topic 38, Topic 51]*

## Correcting the defect

- **Do not write the fix until you can say how it breaks the infection chain.**
  If you cannot explain why this failure and similar ones will stop, you do not
  yet understand the bug. *[WPF ch. 15]*
- **Commit or stash the original code before applying a fix.** You need a clean
  revert point if the fix does not work. *[WPF ch. 15]*
- **Fix one defect per change and verify each separately.** Fixes made together
  can interact and produce failures that look like the original. *[WPF ch. 15]*
- **Run the original reproduction and the full regression suite, then get the
  fix reviewed.** Fixes are more failure-prone than ordinary changes. *[WPF
  ch. 15]*
- **Never fix a failing test by weakening it.** Do not skip the test, loosen
  the assertion, or downgrade a correctness lint rule to `warn`; scope any
  needed suppression to one file. *[Review lessons §4 Cheap gates]*
- **When a proper fix is too risky or impossible, apply a clearly labelled
  workaround and keep the issue open.** Workarounds break when surrounding code
  changes and tend to become permanent. *[WPF ch. 15; 97 Things: The Longevity
  of Interim Solutions]*
- **Do not recover locally from a caller breaking a contract or from your own
  code's mistake.** Fail with a technical error so the defect stays visible;
  patching around a broken precondition hides the bug in the caller. *[97
  Things: Distinguish Business Exceptions from Technical]*

## After the fix

- **Add the regression test every time, however trivial the bug.** Code that
  broke once tends to break again; find bugs once. *[PragProg Topic 51; WPF
  ch. 2]*
- **Find out why existing tests missed the bug, and cover the class of failure,
  not only the case.** A missing null check suggests probing for others; ask
  whether a linter or analyzer could catch it and enable that check, and add
  input checks where bad data travelled unchecked. *[WPF ch. 16; PragProg
  Topic 20]*
- **Keep the assertions added while debugging, and add the one that would have
  caught this bug.** Check preconditions, postconditions, and invariants at
  public entry and exit so the next infection surfaces near its origin.
  *[WPF ch. 10, ch. 16; 97 Things: Thinking in States]*
- **Update every comment, docstring, and doc the bug proved wrong.** A
  docstring promising "never throws" or an ordering the code did not deliver
  must be corrected with the fix. *[Review lessons §1 Claims audit]*

## Error handling that helps debugging

The design of error types and contracts lives in
[code design](../core/code-design.md); these rules are about keeping failures
visible.

- **Check every error result and never write an empty catch-all.** Swallowed
  errors turn crashes into silent corruption with no trace. *[97 Things: Don't
  Ignore That Error!]*
- **Use one top-level reporting path instead of layers of catch-and-retry.** It
  should roll back, log with diagnostics, and fail gracefully. *[97 Things:
  Don't Nail Your Program into the Upright Position; 97 Things: Distinguish
  Business Exceptions from Technical]*
- **Never use assertions to validate external input or critical results.**
  Assertions can be compiled out; use explicit error handling that always runs,
  and cross-check critical results independently. *[WPF ch. 10]*
- **Keep cheap invariant checks running in production as real checks.** An
  unnoticed wrong result is worse than a noticed failure; remove a check only
  when measurement shows it costs too much. *[WPF ch. 10; PragProg Topic 25]*

## Reporting and tracking bugs

- **Write reports so someone else can reproduce the failure.** Include a
  one-line summary, exact version, environment, steps, frequency, expected and
  actual behavior, and diagnostics, stated neutrally. *[WPF ch. 2; 97 Things:
  How to Use a Bug Tracker]*
- **For a problem found during development, write a failing test rather than
  only a ticket.** A test always shows whether the problem still exists; link a
  ticket when others need visibility. *[WPF ch. 2]*
- **Aim extra review and testing at recently changed, frequently changed,
  historically defect-prone, or highly central code.** Validate any such
  metric against your own defect history before trusting it. *[WPF ch. 16]*

## Tensions

- **Assertions on in production vs stripped in release builds.** The sources
  keep them on; common tooling strips them (C `NDEBUG`, Python `-O`, Java's
  default). This library keeps cheap invariant checks on as explicit checks that
  raise and report, and reserves strippable asserts for expensive internal
  checks. *[WPF ch. 10; PragProg Topic 25]*
- **Revert a fix that did not help vs suspect a masked second defect.** WPF
  says revert first; 97 Things warns that reverting a correct fix sends you in
  circles. This library reverts to a clean state, records the attempt in the
  log, and re-applies it if the investigation finds a second defect. *[WPF
  ch. 15; 97 Things: Two Wrongs Can Make a Right]*
- **Failing test vs tracked ticket.** WPF treats the test as making the report
  obsolete; teams still need visibility. Take the test as the source of truth
  and link a ticket when others must know. *[WPF ch. 2]*
- **Let it crash vs keep the process alive.** Crashing early limits damage only
  when something restarts the process; without a supervisor, or while holding a
  transaction, fail fast but release resources and roll back first. *[PragProg
  Topic 24; 97 Things: Don't Nail Your Program into the Upright Position]*
- **Intuition vs formal process.** Quick-and-dirty debugging is allowed within
  a short time box; the box length is a heuristic, not a measured threshold.
  *[WPF ch. 6]*
- **Testing vs review as the main gate.** WPF reports review finds more defects
  per unit of effort; test-first culture treats tests as the gate. Both are
  cheap for an agent, so run both on every fix. *[WPF ch. 3, ch. 15]*

## Sources

- **WPF**: Why Programs Fail: A Guide to Systematic Debugging (Andreas Zeller,
  2nd edition)
- **PragProg**: The Pragmatic Programmer: Your Journey to Mastery (David
  Thomas, Andrew Hunt, 20th Anniversary edition)
- **97 Things**: 97 Things Every Programmer Should Know: Collective Wisdom from
  the Experts (Kevlin Henney, ed., 1st edition)
- **Review lessons**: rules distilled from the maintainer's code-review findings
