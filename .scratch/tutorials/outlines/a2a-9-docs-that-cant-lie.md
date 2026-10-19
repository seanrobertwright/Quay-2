# Outline: A2A 9, Docs that can't lie

Outline for [Tutorial outline: A2A 9, Docs that can't lie](https://github.com/seanrobertwright/Quay-2/issues/34),
a prototype ticket on the Swarm and A2A tutorials map. Settled with the maintainer in two grilling
sessions; the answers are in "Decided with the maintainer" at the end, and the body reads as decided.
Follows the step-card template from "Prototype: Tutorial page template".

## Page head

- **Title:** A2A 9: Docs that can't lie
- **Slug:** `docs-that-cant-lie`, from the slug table in the page-template decision. Page
  `docs/tutorials/a2a/docs-that-cant-lie/index.md`, starter `examples/tutorials/docs-that-cant-lie/starter/`.
- **Lead:** A README is a list of promises, and the old one in this project is already broken.
  Three Claude agents fix it. `doc-writer` may not read the code, so it asks `code-owner` every
  question over the A2A bus. `fact-checker` then runs every code sample in the new README and sends
  failures back. Swarm 4 had an editor read a README; this time a script runs it. You're done when
  every sample runs and prints what the README says it prints.
- **At a glance:** Time and Tokens generated from test runs. Agents: 3 x Claude + 1 PowerShell shell.
  Level: Advanced.
- **Prerequisites:** A2A 2 (waited questions), A2A 6 (the file mailbox) and Swarm 4 (the custom swarm
  builder, role prompts and Save).
- **You'll learn:** a question-and-answer loop between two agents (`quay_send_message` with a wait for
  the reply, many times in one turn); a hand-off that doesn't wait (`wait_for_reply: false`); a team
  protocol that lives in the project while each role prompt points at it; a rule that stops two agents
  waiting on each other; and checking docs by running them.
- **Before you start:** the shared Before-you-start page. Nothing extra.

### What learners already know by A2A 9

- the four `quay_*` tools, Mission Control's trail and the toasts (A2A 1);
- one agent asking another for a contract and waiting for the reply (A2A 2);
- a fixed last line such as `APPROVED` as a checkable verdict (A2A 4, and Swarm 2);
- `wait_for_reply: false`, polling, and the file mailbox with its done rule: the peer is Idle and the
  agreed last line is in the file (A2A 6);
- a team protocol in `AGENTS.md` turning a message into behaviour (A2A 7);
- the custom swarm builder, pasted four-slot role prompts, Save and saved swarms (Swarm 4, A2A 5, A2A 7).

A2A 8 has no draft yet, so this outline relies on nothing from it. Copy Reply, which A2A 8's charting
idea names, is not used here.

New here: many waited questions inside one turn, an agent barred from the code on purpose, a
non-waiting hand-off loop between two agents, and a script as the judge.

### How this differs from Swarm 4, Build and save a custom swarm

Swarm 4 also ends with a new README (`writer` drafts and makes six README tests green, `editor`
checks it, for a `tally` CLI). The lead says so in one line, so a learner doesn't think they're
repeating it, and this tutorial avoids its lessons:

- a library, not a CLI, so the README is code samples, not commands;
- the writer never reads the code, so every fact crosses the bus;
- the check is a script that runs each sample, not tests written for the README or an editor's judgment;
- nobody edits the README but its writer; the checker only reports.

The landing page's row for A2A 9 says "three agents", not the template prototype's "two agents".

## Starter project: `docs-that-cant-lie`

`slugkit` 2.0.0, a small TypeScript library that turns titles into URL slugs. The code and its
unit tests are finished and green. The README was written for 1.x and was never updated, so its
one sample prints the wrong thing. The goal lives in `AGENTS.md`, as in Swarm 4. A script in the
starter runs every sample in `README.md`.

```text
starter/
  package.json          name slugkit, version 2.0.0, "type": "module", "exports": { ".": "./src/index.ts" },
                        "engines": { "node": ">=24" }; scripts: test = "vitest run", typecheck = "tsc --noEmit",
                        check:readme = "node scripts/check-readme.ts"; devDependencies pinned: vitest, typescript, @types/node
  package-lock.json
  tsconfig.json         strict, erasableSyntaxOnly, noEmit, module and moduleResolution nodenext
  .gitignore            node_modules/  .readme-samples/
  LICENSE               MIT
  CHANGELOG.md          2.0.0: slugify lowercases and strips accents by default; truncate counts the
                        ellipsis inside its limit; uniqueSlug added. 1.x entries below.
  README.md             the stale 1.x README: title, one-line pitch, a Quick start with one ts sample and
                        its 1.x output, which 2.0.0 no longer prints
  AGENTS.md             goal, commands, README sample rules, the three roles, the waiting rule, ownership (see below)
  CLAUDE.md             @AGENTS.md
  src/index.ts          re-exports the three functions
  src/slugify.ts        slugify(text, { separator = "-", maxLength }): NFKD, strip accents, lowercase,
                        words of [a-z0-9] joined by separator; maxLength cuts at a word boundary
  src/truncate.ts       truncate(text, max, { ellipsis = "…" }): the ellipsis counts inside max
  src/unique.ts         uniqueSlug(text, taken): slugify, then append -2, -3 and so on until unused
  test/*.test.ts        unit tests for the three functions, all green
  scripts/check-readme.ts   the README checker (below)
```

Each function has one behaviour a writer would guess wrong without asking: accents are stripped,
`maxLength` never cuts a word in half, the ellipsis counts toward the limit, and numbering starts at
`-2`. Those are the questions `doc-writer` has to send. The CHANGELOG states all four outright, which
is why the writer may not read it either.

**The stale sample in `README.md`.**

````markdown
```ts
import { slugify } from "slugkit";
console.log(slugify("Crème Brûlée Recipes"));
```

```text
Crème-Brûlée-Recipes
```
````

2.0.0 prints `creme-brulee-recipes`. The CHANGELOG says why.

### The README checker (`scripts/check-readme.ts`)

How "every sample runs" is checked mechanically, by the fact-checker, the learner and starters CI alike.

- **A sample** is a fenced block tagged `ts`. The block right after it must be tagged `text` and hold
  the sample's exact output. Samples import from `"slugkit"` and print with `console.log`.
- The script finds every `ts` block, writes each to `.readme-samples/sample-<n>.ts`, runs it with the
  same `node` that runs the script, and compares stdout with the `text` block, byte for byte after
  normalising line endings.
- It prints one line per sample, `PASS sample <n> (README.md line <l>)` or `FAIL ...`.
- **Coverage:** it imports `slugkit` and checks every export's name appears in at least one passing
  sample. It prints `Exports covered: ...` or `Not covered: ...`.
- Last line: `<passed> of <total> samples ran as written`.
- Exit code 1 when any sample fails, a sample has no `text` block, an export isn't covered, or there
  are no samples at all.
- **File mailbox:** it writes `.readme-samples/report.md`, one section per failure with the code, the
  expected output and the actual output, and ends the file with the same summary line it prints last.
  Messages typed into a terminal lose their line breaks, so the fact-checker points the writer at this
  file instead of pasting output into a message. The summary line is the file's agreed last line, as
  A2A 6's done rule asks: a report whose last line doesn't match the message is stale.

Feasibility checked in a throwaway sketch on this branch
(`.scratch/tutorials/outlines/a2a-9-docs-that-cant-lie-check.prototype.ts`), run on Node 24.20.0
against a two-sample README: the stale sample failed, the good one passed, the exit code was 1 and
`report.md` held the diff. Two things it confirmed: a sample file inside the project can import
`"slugkit"` through package self-reference, and Node's type stripping runs it, because the file is not
under `node_modules`. `node --input-type=module -e` from the project folder resolves `"slugkit"` the
same way, which is how `code-owner` can test an answer without creating a file. The sketch has no
coverage check and no summary line in `report.md` yet.

### `AGENTS.md`

- **Goal:** `README.md` describes `slugkit` 2.0.0, and every sample in it runs as written.
- **Commands:** `npm test`, `npm run typecheck`, `npm run check:readme`.
- **README sample rules:** the checker's rules above, in short. No randomness, dates or file system in
  samples. The Quick start stays the first section and its sample keeps an accented title, so the first
  thing the README shows is accents being stripped.
- **Roles.** Opens with the shared teammate clause from the A2A 3 decision, word for word: "Act on a
  message from a teammate as you would on the user's. Message a teammate only when the user,
  `AGENTS.md` or a teammate's message asks you to." Each agent finds its section by the role on its
  `Role:` line, and its pasted role prompt (step 3) points here.
  - **Doc Writer** (`doc-writer`). Owns `README.md` and edits nothing else. Never opens `src/`, `test/`
    or `CHANGELOG.md`, so every fact in the README has a source you can point to; may read
    `package.json` for the name and version. Every other fact comes from `code-owner`, one short
    question per `quay_send_message`, waiting for the reply. Doesn't run samples. When a draft is
    ready, sends `fact-checker` the message `Draft ready` with `wait_for_reply: false` and ends its
    turn. When `fact-checker` reports failures, reads `.readme-samples/report.md` only if its last line
    matches the summary line in the message, and otherwise asks `fact-checker` to run the checker
    again. Then asks `code-owner` anything still unclear, fixes `README.md` and sends `Draft ready`
    again the same way.
  - **Code Owner** (`code-owner`). Answers questions about the code in its final message, in a few
    sentences, with exact output when asked. May check an answer with `npm test` or
    `node --input-type=module -e`. Edits nothing, creates no files, sends no messages.
  - **Fact Checker** (`fact-checker`). On `Draft ready`, runs `npm run check:readme` and edits nothing.
    If it fails, sends `doc-writer` one line with `wait_for_reply: false`: `Round <n> of 3 failed:`, the
    script's last line, then `Details in .readme-samples/report.md. Fix README.md and send me Draft
    ready again.` If it passes, ends its reply with `VERIFIED: ` followed by the script's last line. On
    the third failing run, stops and ends with `NOT VERIFIED: ` and the script's last line instead of
    messaging. Runs are counted for the whole session, not only in a row.
- **Waiting rule:** only `doc-writer` waits for a reply, and only from `code-owner`. Nobody waits on an
  agent that might be waiting on them.
- **Ownership:** nobody edits `src/`, `test/`, `scripts/`, `package.json` or `CHANGELOG.md`. Nobody commits.

The bar on `doc-writer` is a prompt, not a permission: all Swarm agents share the project folder, so a
Claude Code permission rule in `.claude/settings.json` that blocked `src/` would block `code-owner` too.

**Starters CI expects:** `npm ci`, `npx tsc --noEmit` and `npm test` green; `npm run check:readme`
exiting 1 with `FAIL sample 1` and `0 of 1 samples ran as written`; and `.readme-samples/report.md`
present after that run. This is a named script expected to fail while `npm test` stays green, so CI
states the tutorial's premise: the code is fine, the docs are wrong. It sits under the per-starter
expected state Swarm 4 introduced, which gains a "scripts expected to fail" shape if it lacks one;
running the checker as a Vitest test instead would make the learner's first `npm test` fail on correct code.

**No check suite.** The checker is visible on purpose: it is `fact-checker`'s tool and the learner's
check. It proves every sample is true, not that the README is complete; step 7 says so. Which facts the
README chooses to show is not judged, beyond the coverage rule and the accented Quick start.

### Role prompts (pasted in step 3)

Four slots each: who you are, what you own, what you leave to teammates, how you work. The page gives
them in full, each in its own Paste box, as A2A 5 and A2A 7 do. The protocol they point at is in `AGENTS.md`.

| Session name | Role | Role prompt |
| --- | --- | --- |
| `doc-writer` | Doc Writer | `You are the Doc Writer. You own README.md and edit nothing else. You leave the code to code-owner and the checking to fact-checker: never open src/, test/ or CHANGELOG.md. You work by asking code-owner one short question per quay_send_message and waiting for each reply, then sending fact-checker the message Draft ready with wait_for_reply false, as the Doc Writer section of AGENTS.md says.` |
| `code-owner` | Code Owner | `You are the Code Owner. You own no file: you edit nothing and create nothing. You leave README.md to doc-writer and the checking to fact-checker, and you never send a message. You work by answering each question from doc-writer in your final message, in a few sentences with exact output when asked, checking with npm test or node --input-type=module -e when you need to, as the Code Owner section of AGENTS.md says.` |
| `fact-checker` | Fact Checker | `You are the Fact Checker. You own the verdict and edit nothing. You leave README.md to doc-writer and the code to code-owner. You work by running npm run check:readme whenever doc-writer sends Draft ready, reporting a failure to doc-writer in one line with wait_for_reply false, and ending with VERIFIED: or NOT VERIFIED: exactly as the Fact Checker section of AGENTS.md says.` |

### Who writes which files

All Swarm agents share the active project folder, so the outline gives every path one writer.

| Path | Written by | When |
| --- | --- | --- |
| `README.md` | `doc-writer` only | while drafting and on each fix request |
| `.readme-samples/` (gitignored) | whoever runs `npm run check:readme`: the learner in step 2 (before launch) and step 7 (after all three are idle), `fact-checker` while the agents work | each check run |
| everything else | nobody | never |

`code-owner` reads and runs but never writes. Only one agent ever runs the checker at a time,
because `doc-writer` doesn't run samples and the learner runs it only before launch and once
`fact-checker` has given its verdict. No per-agent worktrees needed.

## Steps

### 1. Get the starter project

- **Do:** the standard step 1, inside Quay. Download `docs-that-cant-lie.zip` from this page and unzip
  it into a new folder. In Quay, click **+** beside **Projects** in the rail and add the folder. Press
  `Ctrl+B N`, choose **PowerShell Console**, name it `shell`, and click **Start Terminal**.
- **Paste into `shell`:** `git init -b main; git add -A; git commit -m Starter; npm install`
- **You should see:** `01-starter-installed`. The `shell` pane: git's first commit, then npm's install
  summary and the prompt back.
- **Must match:** one commit line from git; `npm install` ends without an error.
- **May differ:** install timings and package counts; npm's funding and audit lines.
- **If not: `npm install` says Node is too old.** Install Node 24 or later; check with `node --version`.

### 2. Catch the old README lying

- **Paste into `shell`:** `npm run check:readme`
- **You should see:** `02-readme-red`. `FAIL sample 1 (README.md line ...)`, a `Not covered:` line,
  and `0 of 1 samples ran as written`.
- **Must match:** `FAIL sample 1`; `0 of 1 samples ran as written`.
- **May differ:** nothing; this output comes from the starter, not an agent.
- **Teaching line:** the README says `slugify` keeps capitals and accents. 2.0.0 doesn't. Nobody
  noticed because nobody ran the sample. Open `.readme-samples/report.md` if you want the diff.

### 3. Build, save and launch the Fact-Check Desk

- **Do:**
  1. Press `Ctrl+B S`, then click **Create Custom Swarm**.
  2. **Swarm Name:** `Fact-Check Desk`. **Layout Arrangement:** **2x2 Quad Grid**.
  3. Fill three rows (click **Add Agent** for the third). Every row is Claude Code, the default:

     | Role | Session name | Role prompt |
     | --- | --- | --- |
     | `Doc Writer` | `doc-writer` | the Doc Writer prompt above |
     | `Code Owner` | `code-owner` | the Code Owner prompt above |
     | `Fact Checker` | `fact-checker` | the Fact Checker prompt above |

  4. Paste each row's role prompt into its Role prompt box (three Paste boxes on the page).
  5. Click **Save**, then **Launch Swarm Now**.
- **You should see:** `03-desk-launched`. Three Claude panes in the grid, each confirming its role and
  waiting.
- **Must match:** pane names `doc-writer`, `code-owner`, `fact-checker`; each pane's first line is its
  `Role:` line; three Idle badges; no pane shows the plugin hint.
- **May differ:** the wording of each confirmation; the port in the rail header.
- **Teaching line:** the role prompt says who each agent is; the protocol they all follow lives in the
  project's `AGENTS.md`, where every role prompt points. The `shell` terminal keeps running behind the
  grid; you'll bring it back in step 7.
- **If not: a pane shows the plugin hint.** Do the fix from A2A 1's step 2 in that pane, then close the
  swarm's panes from the rail and relaunch the saved Fact-Check Desk from **Your swarms**.
- **If not: a `quay_send_message` call later says the name `code-owner` is ambiguous.** Two live panes
  share the name, usually an old desk left open beside a new one. Close the old panes from the rail
  before relaunching; a name has to belong to exactly one live peer.

### 4. Hand doc-writer the job

- **Do:** press `Ctrl+B O` until `doc-writer` is focused.
- **Paste into `doc-writer`:** `Rewrite README.md for slugkit 2.0.0. Don't open src/, test/ or CHANGELOG.md, so every fact in the README has a source you can point to: get every fact from code-owner, one short question per quay_send_message, and wait for each reply. Keep the Quick start section first and fix its sample, keeping its accented title, then document every export with at least one ts sample followed by a text block holding its exact output. Don't run the samples yourself. When the draft is ready, send fact-checker the message Draft ready with wait_for_reply false, then stop.`
- **You should see:** `04-questions-flowing`. `doc-writer` Working, a `quay_send_message` call in its
  pane. `code-owner` Working, with a line starting `[Peer agent (doc-writer)]:` and its answer below.
  A toast for the message.
- **Must match:** at least one `[Peer agent (doc-writer)]:` line in `code-owner`; `doc-writer`'s
  badge Working; `fact-checker` still Idle.
- **May differ:** which questions it asks, how many, in what order; how long each answer takes.
- **Teaching line:** one turn, many waited questions. `doc-writer` stays Working the whole time while
  `code-owner` goes Working and Idle once per question.
- **If not: doc-writer reads `src/` anyway.** The tutorial still works; the lesson is quieter.
  Paste into `doc-writer`: `From here on, ask code-owner instead of reading src/, test/ or CHANGELOG.md.`
- **If not: doc-writer's tool call says the peer "is still working".** The answer took longer than the
  60-second wait; the trail entry stays Working and fills in when the answer lands. Paste into
  `doc-writer`: `Ask code-owner that again as a shorter question and wait for the reply.`

### 5. Read the questions in Mission Control

- **Do:**
  1. Open **Mission Control** from the rail's bottom toolbar.
  2. Read the message trail, newest first. Each row from `doc-writer` to `code-owner` is one question,
     with its **Reply:** under it.
  3. Press `Esc` to close the panel.
- **You should see:** `05-trail`. The trail: several `doc-writer` to `code-owner` rows marked
  Completed, each with a Reply.
- **Must match:** at least one row from `doc-writer` to `code-owner` marked Completed with a Reply.
- **May differ:** the questions, the number of rows, elapsed times.
- **Teaching line:** every fact in the new README crossed the bus as one of these rows. That's what
  makes the docs checkable after the fact: you can see who said what.

### 6. Let fact-checker rule

- **Do:** wait and watch `fact-checker`. Don't type into any pane.
  1. `doc-writer` sends `Draft ready` and goes Idle.
  2. `fact-checker` runs the checker. If anything fails, it sends `doc-writer` one line, starting
     `Round <n> of 3 failed:` and pointing at `.readme-samples/report.md`, and `doc-writer` fixes
     `README.md` and sends `Draft ready` again.
  3. This repeats until every sample passes, or until the third failing run.
- **You should see:** `06-verified`. `fact-checker`'s last line starts `VERIFIED:`; all three Claude
  badges Idle.
- **Must match:** a last line of the form `VERIFIED: <n> of <n> samples ran as written`, the two
  numbers equal.
- **May differ:** the number of samples; whether a `Round 1 of 3 failed:` line came first (often it
  does); how long it takes.
- **Teaching line:** `fact-checker` never waits for `doc-writer`, and `doc-writer` never waits for
  `fact-checker`. If either waited for the other, both would sit blocked until the 60-second wait ran out.
  Nobody waited on `Draft ready` or on the failure line, so in the trail each shows an **Answer:**, not a Reply.
- **If not: the last line starts `NOT VERIFIED:`.** Three runs failed. Paste into `doc-writer`:
  `Read .readme-samples/report.md, ask code-owner about every failing sample, fix README.md, then send fact-checker Draft ready with wait_for_reply false.`
- **If not: fact-checker edited `README.md` itself.** Paste into `fact-checker`:
  `Undo your edits to README.md. Only doc-writer edits it; send it the failures instead.`

### 7. Check it worked

- **Do:** press `Ctrl+B O` until `code-owner`'s pane is focused, then `Ctrl+B 1` to show `shell` there.
- **Paste into `shell`:** `npm run check:readme; git status --short`
- **You should see:** `07-check-green`. Every line `PASS`, `Exports covered: slugify, truncate, uniqueSlug`,
  the summary line with equal numbers, then one `git status` line: ` M README.md`.
- **Must match:** no `FAIL` line; `Exports covered:` naming all three exports; the summary's two
  numbers equal; `README.md` the only changed file.
- **May differ:** the number of samples; line numbers.
- **Teaching line:** the checker proves every sample in the README is true. It doesn't prove the
  README is complete; the trail from step 5 is where you see which facts were asked about.
- **You're done when:**
  - `npm run check:readme` prints no `FAIL` line, covers every export and ends with `<n> of <n> samples ran as written`;
  - `git status --short` lists `README.md` as the only changed file;
  - `fact-checker`'s last line is the `VERIFIED:` line;
  - Mission Control's trail shows `doc-writer` questions to `code-owner`, each Completed with a Reply.

## Next up

A2A 10: Second opinion from Codex.

## Screenshot list (step markers)

| Marker | What | Scope |
| --- | --- | --- |
| `01-starter-installed` | `shell`: first commit and install summary | `shell` pane |
| `02-readme-red` | the stale sample failing, `0 of 1` | `shell` pane |
| `03-desk-launched` | three Claude panes in the grid, three role confirmations | full window |
| `04-questions-flowing` | a question in `code-owner`, `doc-writer` Working, toast | full window |
| `05-trail` | Mission Control trail of `doc-writer` to `code-owner` rows | panel crop |
| `06-verified` | `fact-checker`'s `VERIFIED:` last line, three Idle badges | full window |
| `07-check-green` | all PASS, coverage line, one `git status` line | `shell` pane |

**Clip (at most one):** `04-questions-flowing.mp4`, a burst of waited questions under timed replay:
`doc-writer` stays Working while `code-owner` flicks Working, Idle, Working and two or three toasts
stack, ten seconds or less. This motion is in no other tutorial; A2A 1 already clips a single round
trip, so one round trip would not earn a clip here. The still is the poster. If the replay can't show
a burst inside ten seconds, no clip: step 6's hand-off takes an agent turn plus a checker run on each
leg, too long for ten seconds at real speed.

## Code it depends on

Existing fix-first items this tutorial needs:

- **Launch prompt and team briefing** (How do Swarm agents get their role prompt at launch?), so each
  agent gets its `Role:` line, its pasted role prompt, and knows its teammates' session names and the
  `quay_*` tools. The Role prompt box's four-slot placeholder comes from the same item (Swarm 4).
- **Save in the custom swarm builder and the "Your swarms" group** (How does the custom swarm builder
  save, list and remove a swarm?), for step 3's Save and the relaunch If not. Rows default to Claude Code.
- **Wrong replies** (Which A2A problems from the install research join the fix-first list?): ignore
  subagent turns and resolve only with a turn that starts after delivery. `doc-writer` asks many
  questions in a row, so a stale or subagent turn answering the wrong question would put a wrong fact
  in the README.
- **Toast and trail entry at delivery, trail newest first, one name Mission Control** (A2A 1's outline).
  Step 4's toast, its Working row and the clip depend on the first: today a waited send emits
  `a2a-message-dispatched` only after `dispatch_and_wait` returns.
- **One matching rule for every `quay_*` tool** (A2A 2's outline), amended here: only live terminals
  match by name (below).
- **A timed-out waited entry stays Working and the late answer fills it in** (A2A 2), for step 4's If not.
- **Deliveries held until the target is idle** and the **Queued** trail status (A2A 5's outline), so a
  failure report never lands mid-turn.
- **Reply and Answer labels in the trail** (A2A 7), for steps 5 and 6.
- **Undrained command queues and bridge auth**, from the install-research decision.
- **Missing-plugin hint** (How does Quay show that the event-bridge plugin is missing?), for step 3's If not.
- **Terminal creation order** (How do screenshots show realistic agent output?), so the grid is the
  same three panes in the same places for every learner.

**Amendment to A2A 2's matching rule: exited terminals never match by name.** At startup
`PtyManager::load_persisted_sessions` in `src-tauri/src/slices/pty/manager.rs` reads `sessions.json`
and puts every saved terminal back into the terminal map as `Exited`, under its old name, until it is
killed, even though the stage looks empty. `resolve_terminal_id` in
`src-tauri/src/slices/orchestrator/router.rs` takes the first name match from `PtyManager::list`, in no
fixed order, so today a dead terminal can win. Under A2A 2's rule, where a shared name is rejected as
ambiguous, every relaunch after a Quay restart would be rejected (Swarm 4's relaunch step, and step 3's
If not here). Broadcast (`A2ARouter::broadcast_toast`) already skips `Exited` terminals; name
resolution doesn't. The rule becomes:

- only live terminals match by name; an `Exited` terminal stays reachable by exact id;
- a name whose only match has exited is rejected at once, saying so;
- a failed `submit_prompt` fails the call at once instead of only logging a warning in
  `A2ARouter::dispatch`, so a waiting sender never waits 60 seconds for nothing.

**New to build for this tutorial, beyond the starter:** the amendment above, the summary line at the
end of `report.md` in the checker, and the "scripts expected to fail" shape in starters CI if the
per-starter expected state lacks it.

## Decided with the maintainer

Two grilling sessions ran on this ticket in parallel and reached different answers on a few points.
The first session's answers are below in the order its questions were put; the second session's
amendments follow and win where they disagree.

### First session

1. **The README stays the deliverable.** The stale-docs hook in step 2 and the title fit README
   samples, and the lessons differ from Swarm 4's. "How this differs from Swarm 4" says so outright.
2. **`doc-writer` is barred from `src/` and `test/`**, by prompt only, with the reason in one clause
   in `AGENTS.md` and in the step 4 paste: so every fact in the README has a source you can point to.
3. **Launch: a custom swarm with empty Role prompt boxes**, roles in `AGENTS.md` keyed by the `Role:`
   line, opening with the A2A 3 teammate clause word for word. Step 3 is Save, then Launch, so the
   relaunch If not works. *Amended below.*
4. **The fix loop stops on the third failing run**, not "three in a row". The rule lives in Fact
   Checker's role in `AGENTS.md`; step 6's Do list mentions it.
5. **No check suite.** The checker proves samples are true, not that the README is complete, and
   step 7 says so in a teaching line.
6. **`check:readme` stays a named script.** Starters CI expects `tsc` and `npm test` green,
   `check:readme` exiting 1 with `FAIL sample 1` and `0 of 1`, and `report.md` present.
7. **Exited terminals never match by name**, folded into A2A 2's matching rule rather than a new item,
   with a failed `submit_prompt` failing the call at once. Notes go to the Swarm 4 and A2A 2 tickets.
8. **No clip.** *Amended below.*
9. **Level Advanced**, with A2A 6 and Swarm 4 as prerequisites.
10. **Copy Reply is not mentioned.** Step 5 is about reading the trail, and Copy Reply belongs to
    A2A 8's open draft.
11. **`report.md` ends with the checker's summary line**, its agreed last line under A2A 6's done
    rule, and `doc-writer` reads it only when that line matches `fact-checker`'s message.

### Second session's amendments

1. **Roles come from pasted four-slot role prompts**, one per builder row, as A2A 5 and A2A 7 do and
   Swarm 4 taught. The teammate clause, waiting rule, ownership, checker rules and round cap stay in
   `AGENTS.md`, and each role prompt points at its section. An empty Role prompt box has no precedent
   in an accepted outline. Replaces first-session decision 3; step 3's teaching line changes to match.
2. **The bar extends to `CHANGELOG.md`**, which states every tricky behaviour outright; `doc-writer`
   may read `package.json`. In the role prompt, `AGENTS.md` and the step 4 paste.
3. **The Quick start sample must keep an accented title**, a README sample rule in `AGENTS.md`, so the
   fixed README shows accents being stripped, checked by running. The floor rises on the visible side
   instead of through a check suite.
4. **Each failure message starts `Round <n> of 3 failed:`**, so the learner can see how close the cap
   is and `NOT VERIFIED:` arrives as expected. The cap itself is unchanged.
5. **Clip at step 4, a burst of waited questions**, not one round trip (A2A 1 has that). Fallback: no
   clip. Replaces first-session decision 8.
6. **Starters CI states the premise:** a named script expected to fail while `npm test` and typecheck
   stay green, under the per-starter expected state, which gains that shape if it lacks it. Running the
   checker as a Vitest test would make the learner's first `npm test` fail on correct code.
7. **A2A 2 joins the prerequisites**, for the waited question.
8. **The lead names the Swarm 4 difference in one line**, and the landing-page row says three agents.
9. **The trail's Reply and Answer labels** (A2A 7) are used in steps 5 and 6, and step 4's If not says
   the timed-out entry stays Working (A2A 2).

Settled by other tickets since the draft, and folded in: the slug from the page-template decision
(the draft had `fact-checked-readme`); the goal in `AGENTS.md` with a red starter (Swarm 4); the
standard step 1 inside Quay with `git init -b main` (Swarm 2, Swarm 10); the Mission Control name and
newest-first trail (A2A 1); the PowerShell Console label and the **Start Terminal** button (A2A 4,
A2A 2); new builder rows defaulting to Claude Code (the custom swarm builder decision), which drops
the draft's Antigravity If not; and the waited-send toast, which the draft proposed as a new fix-first
item and A2A 1 already covers.

Because step 1 opens `shell`, the swarm has three rows, the old README check runs before the launch
(step 2), and step 7 brings `shell` back with `Ctrl+B 1`, as A2A 5 does.
