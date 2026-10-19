# Outline: A2A 8, Mission Control operator run

Outline for [Tutorial outline: A2A 8, Mission Control operator run](https://github.com/seanrobertwright/Quay-2/issues/33).
Settled with the maintainer by grilling; the answers are in "Decided with the maintainer" at the end.

Slug `mission-control`. Page `docs/tutorials/a2a/mission-control/index.md`. Starter `examples/tutorials/mission-control/starter/`.

This outline describes the app after the fix-first fixes, including the ones decided with this
ticket under "Code this tutorial depends on". Lines that rely on one say so.

## The page, top to bottom

**Title:** A2A 8: Mission Control operator run

**Pitch:** You are the lead this time. Three Claude Code agents plan, build and verify a small
text-stats CLI, and every task they get comes from you, typed into Mission Control. You run two
agents at once, watch their elapsed times, pass one agent's reply to another with Copy Reply, take
a roll call with a broadcast, and clear the trail before the final verdict. You never type into an
agent's pane.

**Tiles:** Time and Tokens are generated from test runs. Agents: 3 x Claude + 1 shell. Level: Intermediate.

**You'll learn:** dispatching as the operator with Dispatch as User, running two agents at once and
reading their elapsed times, relaying a reply with Copy Reply, a broadcast that collects one reply
per agent, clearing the trail, and that a Mission Control dispatch waits as long as the agent's
turn takes.

**Builds on, without re-teaching** (the page's prerequisites):

- A2A 1, Hello, A2A: Mission Control, Dispatch as User, the trail, toasts and the four `quay_*` tools.
- A2A 6, Long jobs: fire, then poll: the 60-second limit on `wait_for_reply`. This page shows
  that a Mission Control dispatch has no such limit.
- Swarm 8, Tri-Agent Council: the same team on the same plan-build-verify loop. There the learner
  briefed each agent in its pane and `PLAN.md` carried the plan. Here the team and the loop are the
  same; the difference is that you drive it from Mission Control.

**Before you start:** the shared Before-you-start page, linked. Nothing extra: broadcasts reach
only the active project's agents (needs the broadcast-scope fix).

## The starter project: `mission-control`

A TypeScript text-stats CLI whose library is stubbed and whose tests are written and failing. The
CLI wrapper is finished so the work stays in one file.

```text
starter/
  package.json        name mission-control, "type": "module", "engines": { "node": ">=24" }
                      scripts: test "vitest run", typecheck "tsc --noEmit"
                      devDependencies, exact versions: vitest, typescript, @types/node
  package-lock.json
  tsconfig.json       strict, erasableSyntaxOnly, noEmit, module nodenext, types node
  .gitignore          node_modules/
  README.md           the goal in two sentences; points at SPEC.md and AGENTS.md
  AGENTS.md           goal, commands, ownership, and "the operator relays everything" (below)
  CLAUDE.md           @AGENTS.md
  SPEC.md             the rules for lines, words and the top word, ending with the exact line
                      the CLI must print for sample.txt
  sample.txt          a short paragraph with one clear top word
  src/stats.ts        exports countLines, countWords, topWord; each throws Error("not implemented")
  src/cli.ts          finished: reads the file named on the command line, prints
                      "Lines: <L>  Words: <W>  Top word: <word> (<n>)"
  test/stats.test.ts  six Vitest tests, all failing against the stubs
```

**The six tests:**

1. `countLines("")` is `0`.
2. `countLines("a\nb\n")` is `2` (a trailing newline does not start a line).
3. `countWords("  one two\tthree ")` is `3`.
4. `topWord("the cat and the hat")` is `{ word: "the", count: 2 }`.
5. `topWord` ignores case and punctuation: `"Quay, quay! QUAY."` gives `{ word: "quay", count: 3 }`.
6. `topWord("")` throws.

The numbers in the CLI's expected line for `sample.txt` are fixed when the starter is written, and
`SPEC.md` ends with that line.

**`AGENTS.md`**, in short:

- Goal and commands (`npm test`, `npm run typecheck`, `node src/cli.ts sample.txt`).
- Ownership: `planner-agent` writes only `PLAN.md`; `builder-agent` edits only `src/`;
  `verifier-agent` edits nothing. Nobody edits `test/` or `SPEC.md`.
- "The operator relays everything. Do not message other agents with `quay_send_message`. Answer
  the operator, end your reply with the line the task asks for, then wait." This fits the shared
  teammate clause the Council's role prompts carry: nobody here is asked to message a teammate.

**Starters CI expects:** `npm ci` and `npx tsc --noEmit` clean; `npm test` red, 6 failing. No check suite.

## Steps

### 1. Get the starter project

- **Do:** the standard step 1, inside Quay. Download `mission-control.zip`, unzip it into a new
  folder, click **+** beside **Projects** in the rail and add the folder, then press `Ctrl+B N`,
  choose **PowerShell Console** and click **Launch**.
- **Paste into the PowerShell pane:** `git init -b main; git add -A; git commit -m Starter; npm install`
- **You should see:** `01-starter-installed`. One PowerShell pane, `npm install` finished, the
  project in the rail.
- **Must match:** the commit message `Starter`; `npm install` ends without an error.
- **May differ:** install timings and package counts; npm's funding and audit lines.
- **If not: `npm install` says Node is too old.** Install Node 24 or later; check with `node --version`.

### 2. Launch the council

- **Do:**
  1. In the rail, point at the PowerShell terminal's row and click its **×** (Close terminal). The
     Council brings its own shell, `terminal-shell`.
  2. Press `Ctrl+B S`, click **Tri-Agent Council**, click **Launch Swarm Now**.
- **You should see:** `02-council-launched`. A 2x2 grid: `planner-agent`, `builder-agent`,
  `verifier-agent`, each confirming its role and waiting, and `terminal-shell` at a prompt.
- **Must match:** four panes with those names; each agent's first reply names its role (Council
  Planner, Council Builder, Council Verifier); three Idle badges.
- **May differ:** each agent's acknowledgement wording; the port in the rail header.
- **If not: a Claude pane shows the plugin hint.** Quay hasn't heard from `event-bridge`. Follow
  the hint's install line and `/reload-plugins` in that pane.
- **If not: the rail lists five terminals.** The step 1 PowerShell terminal is still open. Close it
  as in Do 1.

### 3. Open Mission Control

- **Do:**
  1. Click the **Mission Control** icon (the network icon) in the toolbar at the bottom of the rail.
     Its tooltip shows the shortcut, `Ctrl+B M`, which the rest of this page uses. (Needs the
     shortcut fix.)
  2. Tick **Dispatch as User**. **From Agent** greys out and reads **You**.
- **Teaching line:** `terminal-shell` is missing from the lists. Shells are not peers, so Mission
  Control only lists agent terminals, and only the active project's.
- **You should see:** `03-panel-open`. Mission Control over the stage: the dispatch form with
  **Dispatch as User** ticked, the **To Agent** list showing `planner-agent (claude) • [IDLE]` and
  its two teammates, and an empty trail.
- **Must match:** three agents in **To Agent**, each `[IDLE]`; From Agent reads **You**; the trail's
  empty-state text.
- **May differ:** nothing.

### 4. Dispatch two tasks at once

- **Do:**
  1. Set **To Agent** to `planner-agent`, paste the first prompt, press `Ctrl+Enter`.
  2. Set **To Agent** to `verifier-agent`, paste the second prompt, press `Ctrl+Enter`.
  3. Watch the trail. Both entries say Working with a timer that counts up from delivery. (Needs
     the elapsed-time fix.)
- **Paste into the panel's prompt box, To `planner-agent`:** `Read SPEC.md and AGENTS.md, then write PLAN.md: the functions in src/stats.ts, the order to build them, and which test in test/stats.test.ts each one makes pass. Edit no other file and do not message other agents. Reply with a summary of at most five lines, then the line PLAN.md written.`
- **Paste into the panel's prompt box, To `verifier-agent`:** `Run npm test. Edit no file and do not message other agents. Reply with the Vitest summary line and the name of every failing test, then the line BASELINE.`
- **You should see:** `04-two-working`. Two trail entries, newest first: `You → verifier-agent`
  Completed with its reply and how long it took, `You → planner-agent` still Working, its timer running.
  **Clip:** `04-two-working.mp4`, the verifier's entry flipping from Working to Completed while the
  planner's timer keeps counting (Mission Control's own motion; ten seconds or less, with timed
  replay). The still is its poster and fallback.
- **Must match:** two entries; the verifier's reply contains `6 failed` and ends with `BASELINE`.
- **May differ:** the elapsed times; which entry finishes first if the planner is quick.
- **If not: an entry says `planner-agent → verifier-agent` instead of `You → ...`.** **Dispatch as
  User** was unticked. Tick it again.
- **If not: the verifier fixed the code instead.** Its prompt says not to. Paste into the panel,
  To `verifier-agent`: `Undo your edits with git checkout -- src and only report from now on.`

### 5. Relay the baseline to the builder

- **Do:**
  1. Wait for the planner's entry to say Completed. Its reply ends with `PLAN.md written`.
  2. On the verifier's entry, click **Copy Reply** (it shows on hover or keyboard focus). It flashes
     **Copied!**.
  3. Set **To Agent** to `builder-agent`, paste the prompt below, type a space, press `Ctrl+V` to
     add the verifier's reply after it, then press `Ctrl+Enter`.
- **Paste into the panel's prompt box, To `builder-agent`:** `Build PLAN.md: implement src/stats.ts until npm test and npm run typecheck both pass. Edit only src/ and do not message other agents. Reply with the files you changed, then the line npm test passing. The verifier's baseline:`
- **Teaching line:** the plan is on disk in `PLAN.md`, so the builder reads it there. The verifier's
  baseline exists only in its reply, so you carry it across. That's the one hand relay in the series.
- **You should see:** `05-baseline-relayed`. Three entries, newest first: `You → builder-agent`
  Working, its message holding the prompt and the verifier's baseline; the planner's and verifier's
  entries Completed, each with how long it took.
- **Must match:** the newest entry's message starts `Build PLAN.md` and contains `BASELINE`.
- **May differ:** the baseline's wording; the durations.
- **If not: there's no Copy Reply.** The entry is still Working, so there's no reply yet. Wait for Completed.

### 6. Let the long one run

- **Do:**
  1. Press `Esc` to close Mission Control.
  2. Watch `builder-agent` work in its pane. Its badge says Working.
  3. When the badge turns Idle, press `Ctrl+B M` to reopen Mission Control.
- **Teaching line:** the trail lives in Quay, not in the panel, so closing the panel loses nothing.
  And a Mission Control dispatch waits for the turn however long it takes: past A2A 6's 60 seconds,
  the entry still completes with the builder's reply.
- **You should see:** `06-builder-done`. The builder's entry Completed, with a duration over a
  minute and a reply ending `npm test passing`.
- **Must match:** Completed; the reply's last line `npm test passing`; `src/stats.ts` among the files.
- **May differ:** the duration; the wording before the last line.
- **If not: the builder says a test still fails.** Paste into the panel, To `builder-agent`: `Run npm test, read the failing assertion and fix src/stats.ts until it passes. Do not change the tests. End with npm test passing.`

### 7. Take a roll call

- **Do:** in the **Broadcast** box, paste the line below and click **Broadcast**.
- **Paste into the Broadcast box:** `Roll call: reply with one line, your session name and the files you changed, or none.`
- **You should see:** `07-roll-call`. The banner `Broadcast sent to 3 agents!`, then three
  `Broadcast → ...` entries, one per agent, each completing with a one-line reply.
- **Must match:** the banner text; three Broadcast entries Completed; the trail heading reads
  `Live A2A Message Trail (6)`; the planner names `PLAN.md`, the builder names `src/stats.ts`,
  the verifier says none.
- **May differ:** the order the three replies arrive in; their wording; a higher count if you
  used an If not earlier.
- **Teaching line:** a broadcast reaches every agent in this project, and only this project.

### 8. Clear the trail

- **Do:** click **Clear Trail**.
- **Teaching line:** clearing removes the trail for everyone, and it can't be undone. The agents
  keep their own conversations; only the trail goes.
- **You should see:** `08-trail-cleared`. The empty trail, heading `Live A2A Message Trail (0)`.
- **Must match:** the empty-state text.
- **May differ:** nothing.

### 9. Ask for the verdict

- **Do:** set **To Agent** to `verifier-agent`, paste the prompt, press `Ctrl+Enter`, and wait
  for Completed.
- **Paste into the panel's prompt box, To `verifier-agent`:** `Run npm test, npm run typecheck and node src/cli.ts sample.txt, and compare the CLI output with the last line of SPEC.md. Edit no file and do not message other agents. Reply with the three results, then VERIFIED or REJECTED on the last line.`
- **You should see:** `09-verdict`. One trail entry, `You → verifier-agent`, Completed, the
  reply ending `VERIFIED`.
- **Must match:** one entry; the last line `VERIFIED`.
- **May differ:** the duration; how the verifier words the three results.
- **If not: REJECTED.** The same relay as step 5: **Copy Reply** on the verifier's entry, set
  **To Agent** to `builder-agent`, paste `Fix what the verifier found. Edit only src/. End with npm test passing. The verifier's report:`,
  a space, `Ctrl+V`, `Ctrl+Enter`. When it completes, repeat this step.

### 10. Check it worked

- **Do:** press `Esc` to close Mission Control, then `Ctrl+B 4` to focus `terminal-shell`.
- **Paste into `terminal-shell`:** `npm test; node src/cli.ts sample.txt; git status --short`
- **Teaching line:** Mission Control drove the agents; you check their work yourself.
- **You should see:** `10-checked`. Vitest's summary, the CLI line, and two `git status` lines.
- **Must match:** `Tests  6 passed`; the CLI line equal to the last line of `SPEC.md`.
- **May differ:** test timings.
- **You're done when:**
  - the verifier's trail entry ended with `VERIFIED`;
  - `terminal-shell` shows `Tests  6 passed` and the CLI prints the line `SPEC.md` ends with;
  - `git status --short` lists only `M src/stats.ts` and `?? PLAN.md`;
  - you never typed into an **agent's** pane: every task went through Mission Control.

**Next up:** A2A 9, Docs that can't lie.

## Screenshot list (step markers)

| Marker | What | Scope |
| --- | --- | --- |
| `01-starter-installed` | PowerShell pane after `npm install` | full window |
| `02-council-launched` | 2x2 grid, three role confirmations, shell prompt | full window |
| `03-panel-open` | Mission Control open, Dispatch as User ticked, To list, empty trail | full window |
| `04-two-working` | one entry Completed with its duration, one Working with its timer; the clip's poster | panel, plus clip |
| `05-baseline-relayed` | builder entry Working with the relayed baseline | panel |
| `06-builder-done` | builder entry Completed, duration over a minute | panel |
| `07-roll-call` | banner and three Broadcast entries Completed | panel |
| `08-trail-cleared` | empty trail | panel |
| `09-verdict` | one entry ending `VERIFIED` | panel |
| `10-checked` | tests, CLI line, `git status` | `terminal-shell` pane |

Capture note: steps 3 to 9 are captured from the replayed recordings, which already drive the
trail like a live agent (see the fake-CLI spike decision). The step 4 clip needs timed replay, as
A2A 1's does. Copy Reply shows on hover or focus, so the capture script hovers the reply before
step 5's shot.

## Code this tutorial depends on

### Already on the fix-first list

- The launch prompt, so the three agents open with their `Role:` lines, and the Tri-Agent Council
  role prompts with the shared teammate clause (A2A 3, Swarm 8).
- Wrong replies, held deliveries and the Queued status (install research, A2A 5): a finished turn
  completes the one entry delivered for it. This covers the draft's "entries pair with the right
  turn" candidate.
- From A2A 1: the Mission Control name everywhere, Dispatch as User (From Agent greys out and reads
  **You**, the trail shows `You → <agent>`), the newest-first trail, the toast and trail entry at
  delivery, the Esc handler and the rewritten banner.
- The plugin hint, for step 2's If not.
- The A2A docs rewrite, and terminal order, status-strip wrap and a pinnable bridge port for capture.

### Decided with this ticket

1. **Elapsed time on trail entries.** Today the panel shows only the dispatch clock time,
   `new Date(m.timestamp).toLocaleTimeString()`, bypassing the project's date helpers
   (`formatClock` and `formatDuration` in `src/lib/dates.ts`), and `A2AMessage` has a single
   `timestamp`. The fix adds `delivered_at` and `completed_at` to `A2AMessage`, set where the status
   moves to Dispatched and to Completed. A Dispatched entry counts up from `delivered_at`; a Queued
   entry shows Queued with no timer; a Completed entry shows its duration through `formatDuration`;
   the clock time goes through `formatClock`.
2. **Broadcasts and Mission Control's lists are scoped to the project.** Today
   `A2ARouter::broadcast_toast` types into every non-exited agent terminal in every project, and
   `App.tsx` passes Mission Control the full `terminals` list rather than `visibleTerminals`. The fix:
   `quay_broadcast` reaches the peers in the caller's project; Mission Control's Broadcast box reaches
   the active project's peers; To Agent and From Agent list only the active project's agents; and
   `quay_send_message` by name matches within the caller's project first (an exact id still reaches
   any terminal), which amends the matching rule decided with A2A 2.
3. **`Ctrl+B M` opens Mission Control.** The `Ctrl+B` handler in `useWorkspace.ts` has no M binding
   today. The rail tooltip and the palette entry show the shortcut. A2A 1 keeps teaching the icon.
4. **Mission Control's form and copy buttons.**
   - With Dispatch as User ticked, To Agent lists every peer in the project. Today To Agent filters
     out `fromTerminal`, which still holds an agent's id while From Agent reads **You**, so that agent
     would vanish from the list.
   - Otherwise, changing From Agent resets To Agent when they would match, and a dispatch to self is
     refused. Today changing From Agent never resets `toTerminal`, so a hidden value can send an
     agent's message to itself.
   - Copy message and Copy Reply show on `focus-visible` as well as hover (today
     `opacity-0 group-hover:opacity-100`), and the icon-only Copy message button gets
     `aria-label="Copy message"`, as Swarm 8 did for the rail's Close terminal button.

Seen but not proposed, because this tutorial doesn't need it: the trail has no filters; the trail
keeps every message in memory with no cap, and the panel reloads the whole list every three
seconds; the panel is a modal that blurs the panes behind it.

## Decided with the maintainer

In the order the questions were put.

1. **The team is the Tri-Agent Council**, the same as Swarm 8. "Builds on" says outright that the
   team and the loop are the same and the difference is driving them from Mission Control. The
   draft's claim that the agents never messaging each other set this apart from Swarm 8 was wrong:
   Swarm 8 keeps the bus out too.
2. **Copy Reply relays the verifier's `BASELINE`** to the builder; the builder reads `PLAN.md` from
   disk. Step 9's REJECTED If not uses the same move. It is the series' one hand relay.
3. **Elapsed time is a fix-first item**, counted from delivery, as above.
4. **Broadcasts and Mission Control's lists are scoped to the project**, with name matching within
   the caller's project first. The Before-you-start line and step 7's If not are gone. This also
   settles open question 2 of the A2A 7 outline.
5. **`Ctrl+B M` opens Mission Control.** Step 3 teaches the icon, later steps the shortcut.
6. **The check stays in `terminal-shell`.** You're done when stresses that you never typed into an
   agent's pane.
7. **One fix-first item for Mission Control's form and copy buttons**, as above.
8. **One clip at step 4**, `04-two-working.mp4`.
9. **Level Intermediate**, with A2A 1, A2A 6 and Swarm 8 as prerequisites.

Settled by other tickets since the draft, and folded in: the Mission Control name and Dispatch as
User (A2A 1), which replace the draft's open questions 1 and 2 and its "You in From Agent" proposal;
the newest-first trail, the Esc handler and the banner text (A2A 1); the right-turn pairing (A2A 5);
the standard step 1 with `git init -b main` and closing that terminal before the Council launches
(Swarm 8, Swarm 10); and the PowerShell Console label (A2A 4). Because the step 1 terminal is
closed, `terminal-shell` is `Ctrl+B 4` in step 10.
