# Engineering process, estimation, and team practice

> **Load when:** planning, slicing, or estimating a task or project; deciding
> what "done" means and auditing claims before opening or updating a pull
> request; setting up repository gates, feature flags, or a deprecation;
> writing a design doc or spec; choosing a dependency, tool, or new
> technology; picking delivery or product metrics; or running a post-incident
> or post-project review.
> **See also:** [Version control and code review](../core/version-control.md),
> [Specifying intent for AI coding agents](../core/working-with-ai-agents.md),
> [Refactoring and legacy code](../core/refactoring-and-legacy-code.md),
> [Unit, integration, and TDD](../testing/testing.md),
> [Continuous integration and delivery](../devops/ci-cd.md),
> [Observability and reliability](../operations/observability-and-reliability.md)

## Top rules

1. **Work in the smallest batch that leaves the system working and
   releasable.** Small steps cost little when wrong, show which diff caused a
   problem, and are the route to stability, not a risk to it. *[MSE Ch 4,
   Working Iteratively; Accelerate Ch 2, Measuring Delivery Performance;
   Effective Engineer Ch 4, Move Fast to Learn Fast]*
2. **Integrate to trunk at least daily and hide unfinished work behind a
   flag.** Keep a branch or pull request under a day of work; split a large
   change into a series of small mergeable steps. *[Accelerate Ch 4,
   Trunk-Based Development; MSE Ch 5, Feedback in Integration; PragProg Topic
   50; SE@Google Ch 16, Dev Branches]*
3. **Call work "done" only when every relevant automated test is written and
   passing in a production-like environment and each stated outcome is
   checked.** "It compiles" is not done; testing is part of development, not
   a phase after "dev complete". *[Accelerate Ch 4, continuous testing;
   PragProg Topic 51, Tips 90-91]*
4. **Before opening or updating a pull request, audit every claim the diff
   touches or depends on.** Comments, docstrings, READMEs, design docs, and the
   PR description must match the code as it now stands, so fix whichever side
   is wrong. *[Review lessons, Claims audit; SE@Google Ch 10, Documentation
   Is Like Code]*
5. **After fixing a defect, search the repository for the same pattern and fix
   every sibling in the same change.** The same mistake usually lands in
   several handlers or helpers at once. *[Review lessons, Sibling sweep;
   PragProg Topic 20, The Element of Surprise]*
6. **Catch problems as far left as possible, with tools rather than people.**
   Run types and editor diagnostics first, then local tests, then the commit
   suite; formatters and linters run before review, never in it. *[SE@Google
   Ch 1, Shifting Left; Ch 8, Code Formatters; MSE Ch 5, Prefer Early
   Feedback]*
7. **Do the riskiest, least-understood part first.** Validate it with a thin
   end-to-end slice or a cheap experiment before building the rest. *[Effective
   Engineer Ch 6, Validate Your Work; Ch 7, Reduce Risk Early; PragProg Topic
   12, Tracer Bullets]*
8. **Estimate from the work, as a range, and never schedule as if every task
   goes well.** When the estimate misses the wanted date, cut scope or move the
   date deliberately; never shrink the estimate. *[MMM Ch 2, Optimism; Gutless
   Estimating; Effective Engineer Ch 7, Use Accurate Estimates]*
9. **Do not add people, or parallel agents, to late, tightly coupled work to
   recover a date.** Coordination and integration cost grow faster than the
   work shrinks. *[MMM Ch 2, Brooks's Law; Effective Engineer Ch 7, Use
   Accurate Estimates]*

## Slicing and sequencing work

- **Slice features into pieces that can be released within a week, and each
  commit into a step that is safe on its own.** Small slices shorten feedback
  and let you drop zero-value work early. *[Accelerate Ch 8, Working in Small
  Batches; MSE Ch 5, Feedback in Integration]*
- **Never take a step larger than your feedback can check.** Take one step,
  get independent feedback (a test run, REPL output, a demo), then take the
  next; a task that needs guessing far ahead must be split. *[PragProg Topic 27,
  Don't Outrun Your Headlights]*
- **Ship new behaviour behind a runtime flag, roll flag flips out in stages,
  and delete the old path once the flag is fully on.** This separates deploying
  from releasing. *[SE@Google Ch 24, Flag-Guarding Features; MSE Ch 14,
  Deployability; PragProg Topic 50]*
- **Reject any task that is not a prerequisite for the next milestone.**
  Side quests such as rewriting a library mid-project are how scope creeps;
  propose them separately. *[Effective Engineer Ch 7, Define Specific Goals]*
- **Never refactor and add a feature in the same step.** A week-long refactor
  is a rewrite and needs planning; see
  [Refactoring and legacy code](../core/refactoring-and-legacy-code.md).
  *[PragProg Topic 40, Refactoring; MSE Ch 6, Tools of Incrementalism]*

## Definition of done and the claims audit

- **Make the PR description describe the whole diff.** If the scope grew,
  rewrite the description or split the PR. *[Review lessons, Claims audit]*
- **Cite symbol names in docs, never file-and-line locations, and leave no
  placeholders or hand-typed counts.** Line numbers drift on the next edit;
  fill in or delete "TODO" and "(PR #NN)", and compute a count or omit it.
  *[Review lessons, Claims audit]*
- **Make every docstring promise match the implementation exactly.** Ordering,
  "never throws", "newest first", "at most one", and write order are contracts
  callers rely on. *[Review lessons, Claims audit; SE@Google Ch 1, Hyrum's
  Law]*
- **Back every "only one", "never twice", or "at most N" claim with a database
  mechanism, not a comment or an in-process guard.** Use a unique or partial
  unique index, a conflict clause, a row lock, or an advisory lock; see
  [Relational and analytical data modeling](../data/data-modeling.md).
  *[Review lessons, Invariants live in the database]*
- **Change the docs in the same change as the behaviour they describe.** Keep
  docs in source control beside the code, with an owner and review.
  *[SE@Google Ch 10, Documentation Is Like Code; MMM Ch 15, Self-Documenting
  Programs]*
- **Define milestones as binary, verifiable events, never percent-complete.**
  "90 percent done" can stay true for months; "all acceptance tests pass on
  the merged build" cannot. *[MMM Ch 14, Milestones or Millstones; Effective
  Engineer Ch 7, Measurable Milestones]*

## Feedback loops, automation, and repository gates

- **Keep the edit-build-test loop short.** Use incremental builds, hot reload,
  or a REPL, and run the tests the change affects before the full suite.
  *[Effective Engineer Ch 4, Invest in Time-Saving Tools; MSE Ch 5, Prefer
  Early Feedback]*
- **Script any procedure you do by hand more than twice, and keep the script
  in version control.** Manual setup steps leave every machine slightly
  different. *[Effective Engineer Ch 4, Invest in Time-Saving Tools; PragProg
  Topic 51, Tip 95; Accelerate Ch 4, What Is Continuous Delivery?]*
- **Give every repository the cheap gates.** Lint UI code with an
  accessibility plugin, fail on unused imports and dead code, lint Markdown,
  and enforce formatting in pre-commit with a printed fix command. Never
  downgrade a correctness rule to a warning globally; scope the suppression
  to one file or line, with a reason. *[Review lessons, Cheap gates;
  SE@Google Ch 8, Error Checkers and Code Formatters]*
- **Add a pre-commit grep that fails on U+FFFD and on the maintainer's
  usernames, home paths, and email addresses.** Corrupted encoding and leaked
  identifiers are cheap to block and costly to scrub from history. *[Review
  lessons, Cheap gates]*
- **Add a style rule or static check only if it solves a recurring problem
  with a low effective false-positive rate.** A warning developers ignore
  counts as false; report on changed lines with a suggested fix, and follow
  the language community's conventions. *[SE@Google Ch 8, Guiding Principles;
  Ch 20, Focus on Developer Happiness]*
- **Automate mechanics freely, but keep a human choosing on rare automated
  decisions such as auto-failover until the logic is well understood.** That
  logic runs rarely and can widen a partial outage into a full one.
  *[Effective Engineer Ch 9, Relentlessly Automate Mechanical Tasks]*

## Planning and estimation

- **Break work into tasks of two days or less before estimating.** A longer
  task hides subtasks nobody has thought about yet. *[Effective Engineer Ch 7,
  Use Accurate Estimates]*
- **Give estimates as ranges with confidence levels, such as 50 percent by
  week 4 and 90 percent by week 8.** A single date is usually the most
  optimistic outcome still possible. *[Effective Engineer Ch 7, Use Accurate
  Estimates; MMM Ch 2, Optimism]*
- **Cross-check an estimate with a second method, and do not anchor on the
  requester's date.** Compare a bottom-up task sum with history from similar
  work. *[Effective Engineer Ch 7, Use Accurate Estimates; MMM Ch 2, Gutless
  Estimating]*
- **For new kinds of work, narrow the estimate after each thin iteration
  instead of committing to one up-front number.** Only the work reveals the
  team's real pace. *[PragProg Topic 15, Estimating]*
- **Never estimate by sizing the coding and scaling it up.** Testing and
  integration dominate, effort grows faster than size, and tightly coupled
  parts cost several times more per unit of output. *[MMM Ch 2, Systems Test;
  Ch 8, Calling the Shot; Aron's and Harr's Data]*
- **Plan in calendar time at realistic availability, with buffer for
  unplanned work.** Interruptions, migrations, harnesses, and firefighting eat
  a large share of every week. *[MMM Ch 8, Portman's Data; Effective Engineer
  Ch 7, Budget for the Unknown]*
- **When a schedule slips, choose a real reschedule or a formal scope cut, and
  make the new plan generous enough not to slip again.** Otherwise scope is
  cut silently through hasty design and skipped tests. *[MMM Ch 2,
  Regenerative Schedule Disaster]*

## Reducing risk before building

- **Spend roughly a tenth of the effort testing the riskiest assumption
  first.** Use a prototype, a run on a data subset, or a log query showing
  whether a bug reaches users. *[Effective Engineer Ch 6, Find Low-Effort Ways
  to Validate Your Work]*
- **Start a new system with a tracer bullet: one thin feature built to
  production quality through every layer, then grow it in end-to-end slices.**
  It proves early that the layers integrate, and the code is kept. *[PragProg
  Topic 12, Tracer Bullets; Effective Engineer Ch 7, Reduce Risk Early]*
- **Use a throwaway prototype only to answer a named risk question, and say
  up front that it will be discarded.** If you cannot skip correctness and
  robustness, you are building a tracer bullet. *[PragProg Topic 13,
  Prototypes; MSE Ch 12, Abstraction vs. Pragmatism]*
- **Wire stubbed modules together end to end early, and keep the scaffold
  running as pieces fill in.** Early integration exposes interface mismatches
  while the code is small. *[Effective Engineer Ch 7, Reduce Risk Early; MMM
  Ch 13, Build Plenty of Scaffolding]*
- **Avoid big-bang rewrites; migrate behind a seam in behaviour-preserving
  steps.** Rewrites are underestimated and drift into second-system bloat;
  incremental migration can stop midway. *[Effective Engineer Ch 7, Approach
  Rewrite Projects with Extreme Caution; MMM Ch 5, The Second-System Effect]*
- **Match the rigour of testing, review, and docs to the code's lifespan and
  risk, but never cut basic engineering corners to meet a date.** A one-off
  script and a service that must run for years need different investment.
  *[SE@Google Ch 1, Time and Change; Effective Engineer Ch 8, Balance Quality
  with Pragmatism; PragProg Topic 5, Good-Enough Software]*

## Specifications, design docs, and decisions

- **Write a short design doc before major work.** State goals and non-goals,
  compare alternatives with trade-offs, cover security, privacy, and storage,
  and re-check the goals before launch. *[SE@Google Ch 10, Design Docs;
  Effective Engineer Ch 6, Beware the One-Person Team; MMM Ch 10, Why Have
  Formal Documents?]*
- **Specify everything a caller can observe and nothing internal, and say
  where behaviour is deliberately unspecified.** Callers depend on every
  observable behaviour, documented or not. *[MMM Ch 6, Written
  Specifications; SE@Google Ch 1, Hyrum's Law]*
- **When a spec is ambiguous, ask its owner instead of guessing, and record
  the answer where every implementer will see it.** *[MMM Ch 6, The Telephone
  Log]*
- **Announce any change to a component's speed, size, or input and output
  assumptions as a spec change.** Most system bugs come from mismatched
  assumptions between components. *[MMM Ch 7, Communication; Ch 13,
  Bug-proofing the Definition]*
- **Before adding a feature, name the existing design concept it extends; if
  it fits none, leave it out or rework the concepts instead of bolting it
  on.** *[MMM Ch 4, Conceptual Integrity; Ch 5, The Second-System Effect]*
- **Treat requirements as learned through feedback.** Restate what you heard,
  show each option's consequences with mock-ups, and state the need rather
  than a design. *[PragProg Topic 45, The Requirements Pit; Accelerate Ch 8,
  Team Experimentation]*

## Dependencies, tools, and technology choices

- **Before adding a dependency, check its tests, maintainer, compatibility
  promise, breaking-change history, and adoption, and decide who upgrades
  it.** Importing is cheap on day one; the maintenance is not. *[SE@Google Ch
  21, Considerations When Importing]*
- **Before adopting a framework, confirm it can be deployed automatically,
  tested in your context, versioned with its config, and started fast enough
  for many runs a day.** *[MSE Ch 14, General Tools to Support Engineering]*
- **Prefer the option with the least ongoing operational burden, and trial
  fashionable technology as a time-boxed, disposable experiment.** Each new
  language or datastore splits expertise and adds failure points. *[Effective
  Engineer Ch 9, Embrace Operational Simplicity; MSE Ch 12, Abstraction vs.
  Pragmatism]*
- **Standardize the operational platform and infrastructure; let shared
  tools for everything else win by being easier to use, not by mandate.**
  *[Accelerate Ch 5, Allow Teams to Choose Their Own Tools; MMM Ch 12, Sharp
  Tools]*

## Change approval, review, and deprecation

- **Use peer review plus an automated pipeline as change approval, not an
  external approval board.** External approval slowed delivery without
  lowering change fail rate. *[Accelerate Ch 7, Lightweight Change
  Management]*
- **Scale review depth to risk.** Always review infrastructure and core
  business logic before merge, and send quality-critical code to the most
  thorough reviewer; mechanics live in
  [Version control and code review](../core/version-control.md).
  *[Effective Engineer Ch 8, Sustainable Code Review; Ch 6, Beware the
  One-Person Team; SE@Google Ch 9, Keep Reviewers to a Minimum]*
- **Run the domain checklist for what the diff touches.** HTTP handlers, HTML
  output, CI, and secrets go through
  [Application and API security](../security/application-security.md); UI
  diffs go through [Accessibility](../frontend/accessibility.md) and a "what
  happens at 10k rows" check. *[Review lessons, Security checklist;
  Accessibility and scale checks]*
- **When you change shared infrastructure, migrate its users yourself or stay
  backward compatible.** Do not push churn onto every consumer. *[SE@Google
  Ch 1, Policies That Don't Scale]*
- **Make deprecation warnings name the replacement and appear while the call
  is written, then block new uses once migration is done.** Warnings slow
  new adoption but seldom migrate existing callers. *[SE@Google Ch 15,
  Deprecation Warnings; Ch 22, Cleanup]*

## Measuring outcomes

- **Track delivery with DORA's current metrics, not Accelerate's 2018 set.**
  Throughput is change lead time, deployment frequency, and failed-deployment
  recovery time; instability is change fail rate and deployment rework rate.
  A deployment fails when it needs immediate intervention such as a rollback
  or hotfix. *[DORA metrics; Accelerate Ch 2, Measuring Software Delivery
  Performance; MSE Ch 3, The Importance of Measurement]*
- **Never set targets on lines of code, velocity, utilization, or coverage.**
  Teams hit coverage targets with tests that assert nothing, and near-full
  utilization sends lead time toward infinity. *[Accelerate Ch 2, The Flaws in
  Previous Attempts; MSE Ch 8, Measurement]*
- **Pick metrics for the behaviour they encourage.** Count outstanding bugs
  rather than bugs fixed; an easily gamed metric will be gamed. *[Effective
  Engineer Ch 5, Pick the Right Metric]*
- **Treat each decision as a hypothesis with a stated good and bad outcome,
  and build the loop that checks it.** *[Effective Engineer Ch 6, Build
  Feedback Loops for Your Decisions; MSE Ch 5, Feedback in Product Design]*

## Shared ownership and learning from failure

- **Run a blameless post-mortem after incidents and failed projects, starting
  from "human error", not ending there.** Output a root cause, a tooling or
  runbook fix, and a check that blocks a repeat. *[Accelerate Ch 3, Westrum;
  Effective Engineer Ch 10, Post-Mortems]*
- **Keep the bus factor above one.** Document non-obvious workflows and
  spread knowledge of any part only one person can safely change. *[Effective
  Engineer Ch 10, Share Ownership of Code; MSE Ch 12, Fear of
  Over-Engineering]*
- **Align boundaries so a team can change, test, and deploy its part without
  another team.** System structure mirrors team communication. *[MMM Ch 10,
  Conway's Law; Accelerate Ch 5, Deployability and Testability]*

## Tensions

- **Plan to throw one away vs grow incrementally.** Brooks withdrew the 1975
  advice in his 1995 edition's retrospective chapter. Grow systems from
  tracer bullets in small releases; discard only prototypes built to answer a
  named question. *[MMM Ch 11, Plan to Throw One Away; MMM 1995; PragProg
  Topics 12-13]*
- **Up-front estimate vs refine as you go.** Ranges from two-day tasks suit
  known work; for new work give a wide range and narrow it per iteration.
  Neither allows shrinking an estimate to fit a date. *[Effective Engineer Ch
  7; PragProg Topic 15; MMM Ch 2]*
- **Brooks's Law vs parallel work.** Adding people or agents early, to
  well-separated work, can help; late coupled work gets slower. Fan out only
  along clean boundaries. *[MMM Ch 2; Effective Engineer Ch 7]*
- **Stop the line on red CI vs an error budget.** Revert first in small
  repositories; at monorepo scale a known, non-production failure may be
  tracked instead of blocking all commits. *[SE@Google Ch 23, Failure
  Management; Accelerate Ch 4, What Is Continuous Delivery?]*
- **One approval vs the most thorough reviewer.** Default to one qualified
  approval; for risky code choose the reviewer who will dig hardest.
  *[SE@Google Ch 9; Effective Engineer Ch 6]*
- **External change approval vs regulated environments.** Meet segregation of
  duties with a recorded peer approval plus a pipeline-only path to
  production. *[Accelerate Ch 7, What About Segregation of Duties?]*
- **Tool freedom vs consistency.** Standardize the operational platform, one
  formatter, and one test framework per language; leave the rest to the team.
  *[Accelerate Ch 5; SE@Google Ch 8; MMM Ch 12]*
- **Dated numbers.** Brooks's schedule ratios are assembler-era evidence that
  test and integration dominate, not figures to plug in, and DORA has renamed
  and extended the Accelerate metrics. *[MMM Ch 2, Ch 8; DORA metrics]*

## Sources

- **Accelerate**: Accelerate: The Science of Lean Software and DevOps
  (Nicole Forsgren, Jez Humble, Gene Kim; IT Revolution, 1st ed., 2018)
- **DORA metrics**: DORA's software delivery performance metrics
  (dora.dev), <https://dora.dev/guides/dora-metrics/>
- **Effective Engineer**: The Effective Engineer (Edmond Lau; The Effective
  Bookshelf, 2015)
- **MMM**: The Mythical Man-Month: Essays on Software Engineering (Frederick
  P. Brooks, Jr.; Addison-Wesley, 1st ed., 1975)
- **MMM 1995**: The Mythical Man-Month, 20th Anniversary Edition, chapter
  "The Mythical Man-Month after 20 Years" (Brooks; Addison-Wesley, 1995)
- **MSE**: Modern Software Engineering: Doing What Works to Build Better
  Software Faster (David Farley; Addison-Wesley, 1st ed., 2022)
- **PragProg**: The Pragmatic Programmer: Your Journey to Mastery, 20th
  Anniversary Edition (David Thomas, Andrew Hunt; Addison-Wesley, 2019)
- **SE@Google**: Software Engineering at Google: Lessons Learned from
  Programming Over Time (Titus Winters, Tom Manshreck, Hyrum Wright;
  O'Reilly, 1st ed., 2020)
- **Review lessons**: rules distilled from the maintainer's code-review
  findings
