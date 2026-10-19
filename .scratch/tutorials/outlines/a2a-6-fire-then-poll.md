# Outline: A2A 6, Long jobs: fire, then poll

Prototype outline for [Tutorial outline: A2A 6, Long jobs: fire, then poll](https://github.com/seanrobertwright/Quay-2/issues/31),
a prototype ticket on the Swarm and A2A tutorials map. Follows the step-card template from
"Prototype: Tutorial page template". The maintainer reacted to the first draft; the answers are in
"Decided with the maintainer" at the end, and this text is the handoff for writing the tutorial.

**How this reads the charting idea.** The charting idea says a long job goes out with `wait_for_reply: false`
and is tracked with `quay_get_agent_status`. The closed decision
[Decide: How do non-Claude agents join the A2A bus?](https://github.com/seanrobertwright/Quay-2/issues/12)
says work longer than a 60-second reply goes through a **file mailbox**: send without waiting, ask the peer to
write a named file, poll `quay_get_agent_status` until the peer is Idle, then read the file. The two agree on
the first two moves; the charting idea never says where the answer goes. This tutorial is the series' file
mailbox lesson, with two Claude peers, before A2A 10 uses the same pattern with Codex.

## Page head

- **Title:** A2A 6: Long jobs: fire, then poll
- **Slug:** `fire-then-poll`. Page `docs/tutorials/a2a/fire-then-poll/index.md`, starter
  `examples/tutorials/fire-then-poll/starter/`.
- **Lead:** A reply only waits 60 seconds. Hand a 90-second benchmark to another Claude Code agent without
  waiting, keep checking on it, and collect the result from `bench.md` when it's done.
- **At a glance:** Time and Tokens generated from test runs. Agents: 2 x Claude + 1 PowerShell shell.
  Level: Intermediate.
- **You'll learn:** why a reply can't carry long work; `quay_send_message` with `wait_for_reply: false`;
  `quay_get_agent_status` and the status it reports; the file mailbox and what says a job is done; how a
  message sent without waiting shows in Mission Control's trail.
- **Builds on:** A2A 1 (the four `quay_*` tools, Mission Control's trail) and A2A 2 (replies that wait).
- **Before you start:** the shared Before-you-start page (Quay installed; Claude Code 2.1.296+ signed in;
  `event-bridge` 0.1.0+; PowerShell 7; Node 24+, npm and Git). Nothing extra for this tutorial.

## Starter project: `fire-then-poll`

A tiny word-count library with two implementations and a benchmark that runs for a fixed time. The
benchmark is the long job. Its run time comes from the benchmark settings, not from the machine or the
model, so it outlasts the 60-second reply window on every run.

```text
starter/
  package.json        name fire-then-poll; scripts: test = "vitest run", bench = "vitest bench --run",
                      typecheck = "tsc --noEmit"; devDependencies pinned: vitest, typescript, @types/node
  package-lock.json
  tsconfig.json       erasableSyntaxOnly, module nodenext, strict, noEmit
  .gitignore          node_modules/
  AGENTS.md           goal in one sentence; exact commands; "npm run bench takes about 90 seconds:
                      run it in the foreground and wait for it"; house rules (npm only, no new
                      dependencies, no enum/namespace); "don't edit src/ or test/ unless asked"
  CLAUDE.md           @AGENTS.md
  README.md           the goal, and what the benchmark compares
  src/count-words.ts  countWordsNaive(text) and countWordsMap(text); both return [word, count] pairs
                      sorted by count, then word. Naive keeps an array of pairs and searches it for every
                      word; Map uses a Map. Both correct; naive is far slower on a large text.
  src/corpus.ts       builds a fixed sample text from a seeded generator: no file, no download
  test/count-words.test.ts
                      six tests: both implementations agree on fixed texts, ignore case, strip
                      punctuation, and return [] for an empty string
  bench/count-words.bench.ts
                      two bench tasks, naive and map, on the corpus. Each runs for BENCH_TIME_MS
                      milliseconds, read from the environment and parsed as a positive integer,
                      default 45000.
```

Two tasks at 45 seconds each, plus Vitest's warm-up, is a little over 90 seconds. The gap between the two
implementations is large on purpose, so the winner is `map` on any machine.

Starters CI expects: `npm ci`, `npx tsc --noEmit` and `npm test` clean (6 passed), and `npm run bench` with
`BENCH_TIME_MS=500` finishing in a few seconds, so a broken bench file is caught before a test run. No check
suite: the result is a file the learner reads.

## Steps

### 1. Get the starter project

- **Do:** the standard step 1, inside Quay. Download `fire-then-poll.zip` from this page and unzip it into a
  new folder. In Quay, click **+** beside **Projects** in the rail and add the folder. Press `Ctrl+B N`,
  choose **PowerShell Console**, name it `shell`, and click **Launch**.
- **Paste into `shell`:** `git init -b main; git add -A; git commit -m Starter; npm install`
- **You should see:** `01-starter-installed`. The `shell` pane: git's first commit, then npm's install
  summary and the prompt back.
- **Must match:** one commit line from git; `npm install` ends without an error.
- **May differ:** install timings and package counts; npm's funding and audit lines.
- **If not: `npm install` says Node is too old.** Install Node 24 or later; check with `node --version`.

### 2. Start two agents

- **Do:** the A2A 1 sequence, so the `shell` pane never pairs with `lead`: press `Ctrl+B N`, choose
  **Claude Code**, name it `lead`, leave the permission mode on **Skip**, and click **Launch**. Press
  `Ctrl+B %` to split, `Ctrl+B O` to move into the new pane, then `Ctrl+B N` again and launch a second
  Claude Code named `bench-runner`.
- **You should see:** `02-agents-ready`. Three panes: `shell`, `lead` and `bench-runner`. Both Claude panes
  at their prompt, both status badges Idle.
- **Must match:** the rail lists `lead` and `bench-runner` under the project; both badges read Idle.
- **May differ:** the port number in the rail header; Claude Code's welcome text.
- **If not: a pane shows the plugin hint, or its badge stays Starting.** Quay hasn't heard from the
  `event-bridge` plugin in that pane. Follow the hint's install line, then `/reload-plugins`.

### 3. Fire the job

Teaching line for the page: a reply waits at most 60 seconds, and this job takes about 90. So `lead` sends
it with `wait_for_reply: false` and gets its prompt back at once. Where the answer goes instead is the file
mailbox: `bench-runner` writes `bench.md` in the project folder, and its agreed last line says the job is
done.

- **Do:** click into `lead`.
- **Paste into `lead`:** `Use quay_send_message to send bench-runner the job below, with wait_for_reply set to false. The job: "Run npm run bench in the foreground and wait for it to finish. Then write bench.md in the project folder: the results table, two sentences on which countWords implementation to keep and why, and a last line that reads exactly WINNER: followed by naive or map. Write the file before you end your turn, and don't edit any other file." Then tell me in one line what quay_send_message returned, and stop. Don't wait for the job.`
- **You should see:** `03-job-fired`. `lead` reports `Successfully dispatched task to bench-runner.`
  and its badge goes back to Idle. `bench-runner` shows the job, prefixed `[Peer agent (lead)]:`, and its
  badge turns Working. **Clip step:** `03-job-fired.mp4`, the job landing in `bench-runner` and the two
  badges trading places (Quay's own motion; under ten seconds; timed replay, with the still as fallback).
- **Must match:** `Successfully dispatched task to`; `lead` Idle while `bench-runner` is Working.
- **May differ:** `lead`'s wording; the target shows as a terminal id if `lead` looked one up first.
- **If not: `lead` sat for about a minute, then said the peer "received the task but is still working".**
  It sent with the default, `wait_for_reply: true`. The job still runs; carry on from step 4. In Mission
  Control the entry stays Working with a note that no reply came within 60 seconds, and `bench-runner`'s
  answer fills it in when the job ends.

### 4. Look in on it

- **Do:** open Mission Control from the rail's toolbar. Find the newest entry at the top of the trail.
  Press `Esc` to close the panel.
- **You should see:** `04-trail-working`. An entry `lead → bench-runner` with the job text and a spinning
  **Working** label, and no reply under it yet.
- **Must match:** `lead → bench-runner`; Working.
- **May differ:** the time on the entry; earlier entries, if you've done other A2A tutorials in this project.

### 5. Poll once

- **Paste into `lead`:** `Check bench-runner with quay_get_agent_status and tell me its status and current tool in one line.`
- **You should see:** `05-first-poll`. `lead` reports `status=working` and a tool, most likely the shell
  running the benchmark.
- **Must match:** `working`.
- **May differ:** the tool name (`Bash` or `PowerShell`); the task text; the auto-approved count.
- **If not: the status is already idle.** Either the job finished (look for `bench.md`) or `bench-runner`
  ran the benchmark in the background and ended its turn early. Go to step 6; `lead` checks the file's
  last line, not only the status.

### 6. Wait it out

Teaching line for the page: Idle means the peer's turn ended, not that the job is done. A file mailbox job
is done when the peer is Idle **and** the agreed last line is in the file.

- **Paste into `lead`:** `Poll bench-runner with quay_get_agent_status about every 15 seconds until its status is idle. Then read bench.md. If the file is missing or its last line doesn't start with WINNER:, say so. Otherwise tell me its last line and which implementation to keep.`
- **You should see:** `06-lead-reports`. `lead` makes a few status checks, then quotes `WINNER: map` and
  recommends the Map version. `bench-runner` shows Vitest's bench summary and the line saying it wrote
  `bench.md`.
- **Must match:** `lead` quotes `WINNER: map`.
- **May differ:** how many polls it makes; the speed figures; the wording.
- **If not: `lead` says it can't wait between checks.** Poll by hand instead: paste step 5's prompt every
  half minute until it reports idle, then paste
  `Read bench.md and tell me its last line.`
- **If not: idle, but no `bench.md`.** `bench-runner` ended its turn before the run finished. Paste into
  `bench-runner`: `Wait for npm run bench to finish, then write bench.md as asked.` Then repeat this step.

### 7. Read the trail

- **Do:** open Mission Control again and find the same entry.
- **You should see:** `07-trail-completed`. The entry now reads **Completed**, with `bench-runner`'s last
  message under **Reply:**. Teaching line: the trail records the answer even though nobody waited for it,
  but only you can see it there. `lead` had to read the file.
- **Must match:** Completed; a Reply block under the entry.
- **May differ:** the reply's wording.

### 8. Check it worked

- **Paste into `shell`:** `npm test; Get-Content bench.md -Tail 1; git status --short`
- **You should see:** `08-check`. Vitest with 6 passed, then `WINNER: map`, then `?? bench.md` as the only
  status line.
- **Must match:** `Tests  6 passed`; `WINNER: map`; `?? bench.md`; no other line from `git status --short`.
- **You're done when:**
  - `lead` got its prompt back straight after firing the job, while `bench-runner` was Working;
  - `lead` polled, then quoted `WINNER: map` from the file;
  - the trail entry `lead → bench-runner` reads Completed;
  - the six tests still pass and `bench.md` is the only change in `git status --short`.
- **If not: `git status` shows edits under `src/` or `test/`.** `bench-runner` went beyond the job. Run
  `git checkout -- src test` and note it; the tutorial still counts as done.

## Next up

A2A 7: Broadcast coordination.

## Screenshot list (step markers)

| File | Shows | Scope |
| --- | --- | --- |
| `01-starter-installed.webp` | first commit, install summary | `shell` pane |
| `02-agents-ready.webp` | three panes, both Claude badges Idle | full window |
| `03-job-fired.webp` | `lead` Idle with the dispatch line, `bench-runner` Working; the clip's poster | full window, plus clip |
| `04-trail-working.webp` | trail entry with the Working spinner | Mission Control panel |
| `05-first-poll.webp` | `lead` reporting `status=working` | `lead` pane |
| `06-lead-reports.webp` | `lead` quoting `WINNER: map`, `bench-runner` after the bench summary | full window |
| `07-trail-completed.webp` | the same entry, Completed, with its Reply | Mission Control panel |
| `08-check.webp` | 6 passed, last line of `bench.md`, `git status --short` | `shell` pane |

Clip: step 3 only, `03-job-fired.mp4`.

## Code it depends on

Fix-first items from other tickets:

- **Wrong replies**, from [Decide: Which A2A problems from the install research join the fix-first list?](https://github.com/seanrobertwright/Quay-2/issues/36):
  Quay ignores a `turn.completed` that carries an `agentId`. Without it a subagent finishing inside
  `bench-runner` would flip it to Idle mid-job and end `lead`'s polling early.
- **`quay_get_agent_status` accepts a name**, from [Tutorial outline: A2A 1, Hello, A2A](https://github.com/seanrobertwright/Quay-2/issues/26),
  with the exact-id-or-unique-name rule from [Tutorial outline: A2A 2, Contract-first handoff](https://github.com/seanrobertwright/Quay-2/issues/27).
  Today the handler uses `PtyManager::get_info`, which matches the exact terminal id only, so polling
  `bench-runner` by the name the job was sent to fails with `Agent 'bench-runner' not found`.
- **A timed-out wait stays honest**, from the A2A 2 outline: the trail entry stays Working with a note and
  the late answer fills it in. Today `A2ARouter::dispatch_and_wait` marks it Failed and
  `resolve_pending_reply` never updates it. Step 3's If not describes the fixed behaviour.
- **Mission Control's name, trail newest first, toast and entry at delivery**, from the A2A 1 outline.
- **Deliveries held until the target is idle, and the Queued trail status**, from
  [Tutorial outline: A2A 5, Fan-out / fan-in](https://github.com/seanrobertwright/Quay-2/issues/30). Not
  met on this page, because `bench-runner` is Idle when the job lands.
- **The bus build**, from [Decide: How do non-Claude agents join the A2A bus?](https://github.com/seanrobertwright/Quay-2/issues/12):
  Unknown status and the "Working only when Quay will see the turn end" rule.
- **Plugin hint**, from [Decide: How does Quay show that the event-bridge plugin is missing?](https://github.com/seanrobertwright/Quay-2/issues/47):
  step 2's If not.
- **A2A docs rewrite** (install-research list), so the tool reference states that `wait_for_reply`
  defaults to true and waits 60 seconds.
- **Screenshot fixtures**, from [Decide: How do screenshots show realistic agent output?](https://github.com/seanrobertwright/Quay-2/issues/38):
  terminal order and a pinnable bridge port.

Verified in code: `quay_send_message` in `handle_mcp_request` defaults `wait_for_reply` to true and calls
`A2ARouter::dispatch_and_wait` with 60 seconds; with `false` it calls `A2ARouter::dispatch` and returns
`Successfully dispatched task to` plus the target exactly as the sender gave it; `dispatch` sets the target
Working and types the job prefixed `[Peer agent (<sender>)]:`; the bridge's `handle_events` sets Idle on
`turn.completed` and calls `A2ARouter::resolve_pending_reply`, which marks the newest Dispatched message to
that terminal Completed with the answer, so a message sent without waiting still gets its Reply in the trail.
`quay_list_agents` serialises `ClaudeStatus` through serde as lowercase (`working`), while
`quay_get_agent_status` formats it with `{:?}` (`Working`).

New in this ticket:

- **Fix-first: one form for status values.** `quay_get_agent_status` prints the status in the same lowercase
  serde form `quay_list_agents` already uses (`starting`, `working`, `waiting`, `idle`, `exited`,
  `unknown`), so a role prompt can name the value it waits for. Joins the name-resolution item above. Pages
  and prompts keep writing Idle and Working as Quay's labels.
- **Bus rule: when the 60-second clock starts.** One clock, from the `quay_send_message` call. A sender never
  waits more than 60 seconds. If the message is still Queued at timeout, the answer says it is queued behind
  the peer's current turn and will be delivered when that turn ends, instead of "received the task but is
  still working". Either way the trail entry stays open and fills in later. Joins the held-deliveries item.
- **Bus rule: what says a file mailbox job is done.** The sender names the file and its last line when it
  fires the job. Done is the peer Idle **and** that line present; Idle alone only says the turn ended. A2A
  10's `VERDICT:` line already fits. Goes into the bus decision and the glossary's File mailbox entry, and
  into the role prompts that use a file mailbox.
- **Starter side:** `BENCH_TIME_MS` on the bench file, so CI can run it short.

## Decided with the maintainer

In the order the questions were put.

1. **The file mailbox is the lesson, under the charting title.** Fire, poll, then read `bench.md`. The title
   stays "Long jobs: fire, then poll"; the lead line names the file. The A2A 1 resolution already calls this
   tutorial Fire-then-poll. A longer wait and a reply-fetching tool stay out of scope.
2. **`lead` polls on its own, with hand polling as the fallback.** Step 6 asks `lead` to loop about every 15
   seconds; its If not tells the learner to paste the step 5 prompt every half minute if `lead` says it can't
   wait. The test run settles which one the page leads with.
3. **The learner never hits the 60-second wall.** Step 3 explains the limit; its If not covers a learner who
   fires with the default wait. Saves a minute plus a second benchmark run.
4. **Done is Idle plus the agreed last line in the file.** The rule above, for the bus decision, the glossary
   and the role prompts, A2A 10 included.
5. **Lowercase status in both tools**, as above.
6. **A 90-second job, and CI runs the bench short.** Two tasks at 45 seconds each; the bench file reads
   `BENCH_TIME_MS` (default 45000) and starters CI runs it with 500.
7. **Clip at step 3**, the badges trading places, `03-job-fired.mp4`.
8. **Level Intermediate**, with A2A 2 to 4 and 10.
9. **The 60-second clock starts at the call**, one clock, with the Queued-at-timeout answer above. Raised by
   the A2A 5 outline; not met on this page.

Settled by other tickets since the draft: the launch sequence and the Mission Control name (A2A 1), the
step 1 line (`git init -b main`, Swarm 10), the PowerShell Console label (A2A 4), the timed-out wait (A2A 2)
and name resolution in `quay_get_agent_status` (A2A 1). The draft's `npm test` moved from step 1 to step 8, so
the check-it-worked step also proves `bench-runner` left the tests green.
