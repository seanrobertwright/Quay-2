# Specifying intent for AI coding agents

> **Load when:** writing or reviewing a task spec, prompt, sub-agent brief,
> skill, or project instruction file (AGENTS.md, CLAUDE.md) for an AI coding
> agent; deciding when an agent must stop and ask a human; or checking an
> agent's work before it claims "done" or opens a pull request.
> **See also:** [Version control and code review](version-control.md),
> [Engineering process](engineering-process.md),
> [Debugging](debugging.md),
> [Continuous integration and delivery](../devops/ci-cd.md),
> [Code and module design](code-design.md),
> [Data modeling](../data/data-modeling.md), [LLM applications](../llm/llm-applications.md)

## Top rules

1. **Write a structured spec before any multi-file task.** Give the objective,
   user goal, verifiable outcomes, constraints, edge cases, a conflict rule and
   a verify command; a one-line request lets the agent optimize whatever is
   easiest to measure. *[IntentEng §4 Practical Shift #1; §6 The IntentSpec
   Format]*
2. **Make "done" machine-checkable, then check it.** Name a command, test file,
   or metric with a threshold, run it at the end, and compare the result with
   each listed outcome before claiming success. *[IntentEng §4 Practical Shift
   #3; §10 Workflow]*
3. **Never weaken a check to make a change pass.** Do not edit, skip, or
   suppress tests, and do not downgrade a correctness lint rule; fix the code or
   the check's real defect. *[IntentEng §6 Constraints; §7 Pattern 3; Review
   lessons §4 Cheap gates]*
4. **Rank the project's goals and state which one wins each conflict.** Without
   a ranking the agent defaults to the easiest metric; a sound default is
   safety, then data integrity, then correctness, then performance, then
   developer experience. *[IntentEng §4 Practical Shift #2; §9 Gap 1]*
5. **Stop and ask a human before any escalation trigger.** Deleting data,
   changing auth logic, migrating production schemas, disabling a safety check,
   touching secret or production config, adding an external integration, and
   destructive overwrites all need sign-off. *[IntentEng §5 Escalation
   Criteria; §10 When to Escalate]*
6. **Do the stated task; propose extra scope separately.** Pause and confirm
   when the diff spreads well past the planned files; silent expansion mixes
   unrelated changes and hides the misunderstanding. *[IntentEng §4 Practical
   Shift #2; §10 Conflict Resolution Defaults]*
7. **Audit every claim the diff touches before opening or updating a PR.**
   Comments, docstrings, READMEs, design docs and the PR description must agree
   with the code as it now stands. *[Review lessons §1 Claims audit]*
8. **After every fix, sweep the repo for the same defect and fix all siblings
   in the same commit.** One bug pattern usually lands in several handlers.
   *[Review lessons §3 Sibling sweep]*
9. **Keep always-loaded instructions small and route to the rest.** Project-wide
   goals, guardrails and escalation triggers stay in the instruction file;
   specialist practice loads on demand; task intent lives in the spec.
   *[IntentEng §5 Integration with Context Engineering; §8 How Claude Code
   Skills Work]*
10. **Restate the active intent after context compaction and in every sub-agent
    brief.** Rules set at session start get compressed away and the agent
    drifts. *[IntentEng §9 Gap 4; §10 Context Compaction Survival]*

## Writing a task spec

- **Ground the objective in evidence.** Cite the metric, ticket, bug report, or
  user report that started the work, so reviewers can judge whether the change
  fixed the real problem. *[IntentEng §6 Objective]*
- **State the user goal as a job to be done: who needs to do what, and why.**
  It stops the agent from meeting a literal acceptance criterion while missing
  the purpose. *[IntentEng §6 User Goal]*
- **Write each outcome as an observable change in state, with how it is
  measured.** "Improve the experience" cannot be checked; "p95 under a
  threshold, measured by a named tool" can, and it becomes a test criterion.
  *[IntentEng §6 Outcomes; §9 Gap 2]*
- **List what must not change as explicit constraints.** Pinned API or
  dependency versions, schema compatibility, latency ceilings, and behavior
  users rely on are the guardrails the plan is checked against. *[IntentEng §4
  Practical Shift #1; §6 Constraints]*
- **Require the existing test suite to pass with the tests unchanged.** An agent
  allowed to edit tests can make any change look correct; a test that is itself
  wrong is a separate, reported fix. *[IntentEng §6 Constraints; §7 Pattern 3]*
- **List the edge cases where intent could be misread, with the expected
  behavior for each.** Mark each as handle, fail gracefully, or send to a human
  (expired credential, timeout mid-operation, user navigating back mid-flow).
  *[IntentEng §4 Practical Shift #1; §6 Edge Cases]*
- **Include a conflict rule when the task's goals can pull apart.** For example
  "correctness over latency for this endpoint", so the agent does not choose.
  *[IntentEng §6 Conflict Resolution]*
- **Estimate the files or modules the change should touch.** The estimate gives
  the scope-creep trigger a baseline. *[IntentEng §4 Practical Shift #2]*
- **Pair every speed or throughput outcome with a quality or completeness
  check.** An agent rewarded on one easy number erodes the values nobody
  measured. *[IntentEng §1 What Is Intent Engineering; §3 Why This Matters]*
- **Use the minimal spec for small tasks and the full one once work spans
  several files or needs decisions from other teams.** The minimal form keeps
  only the fields that make work checkable. *[IntentEng §10 Minimal Intent
  Spec]*

  ```markdown
  Objective: <one sentence citing the ticket, metric, or report>
  Outcome:   <observable change>, measured by <command or metric>
  Must not break: <behavior, API, or schema that stays fixed>
  Verify:    <command that exits non-zero on failure>
  ```

## Verifying and reporting work

- **Run the verify step and compare against every listed outcome before
  reporting.** Report failures and skipped checks plainly instead of claiming
  success. *[IntentEng §4 Practical Shift #3; §10 Workflow, Step 4]*
- **Treat guardrails and hard constraints as pass/fail gates.** Never fold them
  into a weighted score that can pass while a gate fails; weight only soft
  goals. This corrects the source's sample verifier; see Tensions.
  *[IntentEng §4 Practical Shift #3; §5 Hard Guardrails]*
- **Verify a guardrail with a test, static-analysis rule, or review step, not a
  text search.** Searching files for a marker comment such as "auth bypass"
  proves nothing about behavior; this corrects the source's sample check.
  *[IntentEng §4 Practical Shift #3]*
- **Make docstrings match the implementation exactly.** A docstring promising
  ordering, "never throws", "newest first", "at most one", or a write order is
  a contract; fix the prose or the code. *[Review lessons §1 Claims audit]*
- **Make the PR description cover the whole diff.** If scope grew while working,
  rewrite the description or split the PR. *[Review lessons §1 Claims audit]*
- **Cite symbols in docs, never `file:line`.** Line numbers drift on the next
  edit; a module path plus function name survives it. *[Review lessons §1
  Claims audit]*
- **Leave no placeholders or hand-typed counts in prose.** Ban "(PR #NN)",
  "TODO fill in", and typed tallies like "forty entries"; compute the number or
  omit it. *[Review lessons §1 Claims audit]*
- **Grep for the pattern behind every fixed finding before pushing.** Fix each
  occurrence in the same commit and say in the PR that the sweep ran.
  *[Review lessons §3 Sibling sweep]*
- **Record every trade-off where reviewers will see it.** The PR description or
  final report names which goal won and why. *[IntentEng §6 Conflict
  Resolution; §10 Conflict Resolution Defaults]*
- **Put proposed follow-up work in the PR description or final report, not in
  TODO comments in code.** *[IntentEng §10 Conflict Resolution Defaults; Review
  lessons §1 Claims audit]*

## Scope, ambiguity, and escalation

- **Publish the escalation triggers in the project instruction file.** Without
  them an autonomous agent makes judgment calls stakeholders would not approve.
  *[IntentEng §5 Escalation Criteria; §9 Gap 3]*
- **Stop before deleting any data, including test data, and before any
  destructive overwrite.** *[IntentEng §10 When to Escalate]*
- **Stop before changing authentication, authorization, or a validation or
  safety rule.** *[IntentEng §5 Escalation Criteria; §10 When to Escalate]*
- **Stop before a schema migration on production data or a new external API
  integration.** *[IntentEng §5 Escalation Criteria]*
- **Scope the config trigger to production, secret, and security-relevant
  configuration.** "Any config file" stalls routine work. *[IntentEng §10 When
  to Escalate]*
- **Pick one scope-creep threshold per project and state it.** For example,
  pause at three times the estimated file count; a spreading diff usually means
  the task was misunderstood. *[IntentEng §4 Practical Shift #2; §10 When to
  Escalate]*
- **Finish the stated task, then propose the expansion separately.**
  *[IntentEng §4 Practical Shift #2; §10 Conflict Resolution Defaults]*
- **When a task conflicts with project intent, say so instead of quietly
  picking a side.** *[IntentEng §7 Pattern 1; §7 Pattern 3]*
- **Ask one focused question before assuming anything about compliance,
  security, or data-loss logic.** Those rules are exact and a wrong guess is
  expensive. *[IntentEng §4 Practical Shift #2; §7 Pattern 3]*
- **For low-stakes ambiguity, proceed on stated assumptions and list them in the
  report.** This narrows the source's ask-first advice; see Tensions.
  *[IntentEng §7 Pattern 3]*

## The project instruction file

- **Put a ranked goal hierarchy in the always-loaded file.** Listing goals
  without ranking them is the most common gap. *[IntentEng §4 Practical Shift
  #2; §9 Gap 1; §10 Goal Priority Reference]*
- **Write conflict rules as pairs that name the winner.** Safety over speed,
  accuracy over caching, clarity over cleverness, passing tests over passing
  lint over elegance. *[IntentEng §4 Practical Shift #2; §6 Conflict
  Resolution; §10 Conflict Resolution Defaults; §10 Examples]*
- **Optimize performance only after correctness is verified.** Never remove
  validation, error handling, or auth checks to gain speed. *[IntentEng §4
  Practical Shift #2; §5 CLAUDE.md as the Intent Anchor]*
- **Keep hard guardrails in a separate list from ranked goals.** Guardrails are
  absolute; goals are traded off. *[IntentEng §5 Hard Guardrails]*
- **Ban the usual shortcuts as guardrails.** No auth bypass "for dev
  convenience", no skipped audit logging on data changes, no swallowed
  exceptions on critical paths, and no hard-coded business or regulatory
  thresholds (read them from config). *[IntentEng §5 Hard Guardrails; §7
  Pattern 3]*
- **State the codebase's invariants as guardrails and link to the rule's home.**
  Typical entries: every query on owned data filters by the tenant column; any
  "only one" or "never twice" claim is enforced by a constraint or lock in the
  database; external input is parsed at the boundary; all dates go through one
  helper. Data-side details live in
  [data modeling](../data/data-modeling.md). *[Review lessons §2 Four
  invariants]*
- **Keep personal identifiers and machine-specific paths out of shared
  instruction files.** Describe locations relative to the repo. *[Review
  lessons §4 Cheap gates]*

## Progressive disclosure: routing, skills, and practice files

- **Split instructions into layers by how often they apply.** Project-wide
  intent always loads; specialist workflows and domain practice load lazily;
  task intent lives in the per-task spec. *[IntentEng §5 Integration with
  Context Engineering; §8 How Claude Code Skills Work]*
- **Write every route or skill description as a trigger: when to load, not only
  what it covers.** Only names and descriptions are loaded up front, so the
  description must carry the condition. *[IntentEng §8 How Claude Code Skills
  Work; §10 Improved SKILL.md Template]*
- **Load only the files the current task needs.** Preloading every specialist
  file crowds out the task's own context. *[IntentEng §5 Four Context
  Engineering Strategies, Select]*

## Long sessions and delegation

- **Persist goals, decisions, and the active spec in repo files, not only in
  the conversation.** Write intent down, select what is relevant, compress
  history while keeping the decision rules, and isolate sub-agents. *[IntentEng
  §5 The Four Context Engineering Strategies]*
- **Carry these through every compaction: active spec name and priority, hard
  guardrails, active escalation triggers, and in-progress verify criteria.**
  *[IntentEng §9 Gap 4; §10 Context Compaction Survival]*
- **After a compaction, re-read the active spec before the next edit.**
  *[IntentEng §10 Context Compaction Survival]*
- **Brief each sub-agent with a short intent summary: title and priority, user
  goal, success criteria, and stop conditions.** *[IntentEng §5 Isolate; §10
  Workflow, Step 3]*
- **Give a sub-agent only the slice of intent its job needs, not the whole
  history.** A narrow brief keeps it on task and saves its context.
  *[IntentEng §5 Isolate]*
- **Read model ids and provider settings from configuration.** Hard-coded model
  ids go stale within months; check the provider's current model list. Updated
  from the source, whose sample code hard-codes an early-2026 model id.
  *[IntentEng §7 Pattern 1]*

## Mechanical gates on agent output

- **Fail lint on accessibility violations, unused imports, and dead code, and
  run markdownlint on Markdown.** Gates catch what an agent's self-review
  misses. *[Review lessons §4 Cheap gates]*
- **Run a pre-commit grep that blocks the U+FFFD replacement character and
  personal identifiers (usernames, home-directory paths, personal email).**
  Agents introduce both through encoding round-trips and pasted paths. *[Review
  lessons §4 Cheap gates]*
- **Scope any lint suppression to the file that needs it.** Never downgrade a
  correctness rule such as the React hooks rules to a warning globally.
  *[Review lessons §4 Cheap gates]*
- **Run the security checklist before a PR that touches HTTP handlers, HTML
  output, CI, or secrets.** Check HTML escaping, an `http`/`https`/`mailto`/
  relative allowlist for link targets, CORS scoped to named origins, a set
  CSP, timeouts and disabled redirects on token-carrying HTTP clients, no
  secrets in source, and minimal CI permissions (see
  [CI/CD](../devops/ci-cd.md)). *[Review lessons §5 Security checklist]*
- **Run the accessibility and scale checks on every UI diff.** Check that every
  input has a programmatic label, icon-only buttons have an accessible name,
  ids in reusable components are generated, list keys are stable (not the
  array index), large lists are capped or paginated, and async hooks discard
  stale responses. *[Review lessons §6 Accessibility and scale]*

## Keeping intent current

- **Store intent specs as versioned files in the repo and revise them as the
  project changes.** A stale spec gets optimized faithfully. *[IntentEng §9 Gap
  5; §10 Workflow, Step 1; §11 Key Takeaways]*
- **Keep an audit trail per completed intent.** Record the active intent, the
  decisions made, the criteria used, and whether verification passed, so drift
  becomes visible. *[IntentEng §9 Recommended Improvements; §10 Workflow,
  Step 5]*
- **Turn recurring review findings into instruction-file rules or automated
  gates.** A finding that repeats across PRs is cheaper to block than to fix
  again. *[Review lessons §4 Cheap gates]*

## Tensions

- **Ask before proceeding vs proceed on stated assumptions.** The source says to
  ask one clarifying question when requirements are ambiguous. This library
  asks first only for compliance, security, data-loss, and escalation-trigger
  decisions; for low-stakes ambiguity the agent proceeds, states its
  assumptions, and lists them in the report. *[IntentEng §4 Practical Shift #2;
  §7 Pattern 3]*
- **Weighted verification score vs pass/fail gates.** The source's sample
  verifier averages criteria and passes at a threshold, so a failed criterion
  can still pass. This library treats guardrails and hard constraints as gates
  and weights only soft goals. *[IntentEng §4 Practical Shift #3; §5 Hard
  Guardrails]*
- **TODO comment for proposed scope vs report-only.** One source example writes
  the proposed expansion as a TODO in code. This library bans TODO placeholders
  and puts the proposal in the PR description or final report. *[IntentEng §10
  Conflict Resolution Defaults; Review lessons §1 Claims audit]*
- **Fixed file-count threshold vs ratio to estimate.** The source gives several
  different thresholds. This library uses a ratio to the spec's estimate (three
  times by default) and lets each project override it once, in its instruction
  file. *[IntentEng §4 Practical Shift #2; §10 When to Escalate]*
- **Any config change as a trigger vs a scoped trigger.** Taken literally, the
  broad trigger stalls routine work. This library escalates only for
  production, secret, and security-relevant configuration. *[IntentEng §10 When
  to Escalate]*
- **Full spec for everything vs minimal spec.** Full specs cost time on small
  fixes. Use the minimal form for single-file work and the full form
  once a task spans files or teams. *[IntentEng §10 Minimal Intent Spec]*
- **The IntentSpec format as a standard vs one template.** The source calls it a
  gold standard, but it comes from one vendor's glossary and emerging practice.
  Keep its fields; do not treat its exact layout as required. *[IntentEng §6 The
  IntentSpec Format]*

## Sources

- **IntentEng**: Intent Engineering: A Comprehensive Research Guide, subtitled
  "The Evolution from Prompt to Context to Intent in Agentic AI Development"
  (research synthesis, March 2026). Figures in it, such as skill token sizes
  and company case numbers, are second-hand estimates.
- **Review lessons**: rules distilled from the maintainer's code-review findings
  across many pull requests (unpublished; sections cited by name)
