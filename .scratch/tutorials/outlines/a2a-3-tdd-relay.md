# Outline: A2A 3, Hands-off TDD relay

Prototype outline for the ticket "Tutorial outline: A2A 3, Hands-off TDD relay" on the Swarm and A2A tutorials map.
A rough take to react to, not the tutorial. Open questions are at the end.

Slug `tdd-relay`. Page `docs/tutorials/a2a/tdd-relay/index.md`. Starter `examples/tutorials/tdd-relay/starter/`, check suite `examples/tutorials/tdd-relay/check/`.

## The page, top to bottom

**Title:** A2A 3: Hands-off TDD relay

**Pitch:** In Swarm 2 you drove every red-green round yourself, one pane at a time. This time you type one prompt. `test-architect` writes failing tests for `parseDuration("1h30m")`, hands the job to `feature-impl` over the A2A bus, and `feature-impl` reports back when the tests are green. You watch.

**Tiles:** Time and Tokens are generated from test runs. Agents: 3 Claude agents + 1 PowerShell shell (two of the Claude agents take part). Level: Intermediate.

**You'll learn:** asking one agent to hand work to another with `quay_send_message`, why a hand-off that takes minutes is sent with `wait_for_reply: false`, how the receiving agent reports back with a new message instead of a reply, and reading the whole relay afterwards in the A2A Orchestration Bus panel.

**Before you start** (all on the shared Before-you-start page, linked):

- Quay installed.
- Claude Code 2.1.296 or later, signed in, with the `event-bridge` plugin 0.1.0 or later. Without the plugin, the agents' badges stay at Starting or Unknown and neither hand-off is marked done.
- Node 24 or later, Git, PowerShell 7.
- About 20 minutes.

Two notes for the page, as Swarm 3 does for its preset:

- Swarm agents run in Skip mode: they edit files and run commands without asking. That is why the starter goes into a new, empty folder.
- The TDD Swarm preset starts `test-architect` with `--model claude-sonnet-5-5`. The other agents use Claude Code's default model.

## Who the agents are

The TDD Swarm preset, the same four panes as Swarm 2, with the names exactly as `BUILTIN_SWARM_PRESETS` has them:

| Pane | Role | Run kind | In this tutorial |
| --- | --- | --- | --- |
| `test-architect` | Test Architect | claude | Gets the learner's one prompt. Writes the tests, hands off, verifies at the end. |
| `feature-impl` | Feature Implementer | claude | Gets its job from `test-architect` over the bus, never from the learner. |
| `test-runner` | Test Runner Shell | powershell | Runs `npm run test:watch`, so the learner sees red turn green without asking anyone. |
| `reviewer` | Reviewer & Quality Gate | claude | Stays idle. The page says so in one line. |

The charting idea named the agents `test-author` and `feature-dev`. Those names exist only in the old example in `docs/features/a2a-orchestration.md`, which uses `cargo test` and is replaced by the A2A docs rewrite. No preset or code path creates them. See open question 1.

Each agent knows its teammates' names from the team briefing in its launch prompt, so it can pass `feature-impl` or `test-architect` as `target_terminal_id`. The router resolves a session name to a terminal id.

## The relay, and why it never waits

```text
learner --one prompt--> test-architect
                          writes test/duration.test.ts, npm test: all red
                          quay_send_message(feature-impl, wait_for_reply: false)
                        ------------------------------> feature-impl
                                                          edits src/duration.ts until npm test is green
                                                          quay_send_message(test-architect, "GREEN", wait_for_reply: false)
                        <------------------------------
                          npm test once more, last line RELAY DONE
```

- **Both hand-offs are sent without waiting.** `wait_for_reply` gives up after 60 seconds, and making a test file pass takes minutes. A waiting sender would get "received the task but is still working" and its trail entry would show Failed, though the message was delivered.
- **The report back is a new message, not a reply and not a file mailbox.** Nothing needs carrying back except the word `GREEN`; the real result is in the repo. Polling with `quay_get_agent_status` and a file mailbox are A2A 6's lesson (`fire-then-poll`). See open question 2.
- **Every message is one line,** because Quay flattens newlines in a typed message. The learner's prompt dictates the hand-off message word for word so the trail is checkable.
- **The relay ends.** The prompt tells `test-architect` to message nobody after `GREEN`, so the two agents can't ping-pong.

## The starter project

```text
starter/
  package.json        name tdd-relay, "type": "module", engines node >=24
                      scripts: test "vitest run", test:watch "vitest", typecheck "tsc --noEmit"
                      devDependencies: vitest, typescript (exact versions, no ^)
  package-lock.json
  tsconfig.json       strict, erasableSyntaxOnly, noEmit, module/moduleResolution nodenext,
                      allowImportingTsExtensions, rewriteRelativeImportExtensions
  vitest.config.ts    test.include: ["test/**/*.test.ts"], so the unzipped check/ never joins npm test
  .gitignore          node_modules/
  README.md           the goal in two sentences; points at AGENTS.md
  AGENTS.md           see below
  CLAUDE.md           @AGENTS.md
  src/duration.ts     the API contract, unimplemented:
                        export function parseDuration(text: string): number {
                          throw new Error("not implemented");
                        }
  test/duration.test.ts
                        import { describe, it } from "vitest";
                        describe("parseDuration", () => {
                          it.todo("1h30m is 5400 seconds");
                        });
```

One sentence on the files for the page: `AGENTS.md` is the spec both agents work from, `test/` is `test-architect`'s, `src/` is `feature-impl`'s.

### AGENTS.md (content)

- **Goal:** `parseDuration(text)` turns a duration like `1h30m` into a whole number of seconds.
- **Format:** one to three parts with no spaces between them. Each part is a whole number (digits only, leading zeros allowed) followed at once by a lowercase unit: `h`, `m` or `s`.
- **Order:** units appear at most once each, in the order `h`, `m`, `s`.
- **Values:** any size. `90m` is 5400. `0s` is 0.
- **Examples:** `1h30m` is 5400, `45s` is 45, `2h5s` is 7205.
- **Errors:** anything else throws a `RangeError` whose message is `invalid duration: ` followed by the input as given. That includes the empty string, a repeated unit, units out of order, a sign, a decimal point, an uppercase unit, a space, a number with no unit and a unit with no number.
- **Commands:** `npm test`, `npm run test:watch`, `npm run typecheck`.
- **House rules:** npm only; no new dependencies; no `enum` or `namespace`; keep the exported signature in `src/duration.ts` unchanged.

### Check suite (`check/`, packed as `tdd-relay-check.zip`)

Hands-off means the learner never read the tests the agents wrote. An unseen check suite is what proves the relay built the spec and not only its own tests. See open question 4.

```text
check/
  vitest.config.ts       test.include: ["check/**/*.test.ts"]
  duration.check.test.ts imports parseDuration from ../src/duration.ts
```

Cases, one per AGENTS.md rule: the three examples, `90m`, `0s`, `05m`, and each error case in the Errors line, checked with `toThrow(RangeError)` and the message prefix `invalid duration: `. The count is whatever that list comes to; the page never states it.

### Starter CI state

`npm ci` and `npx tsc --noEmit` clean, `vitest run` green with 1 todo. The check suite fails against the unfixed starter (every case hits `not implemented`), the same expected state the starter decision gives Bug Hunt's check suite.

## Steps

### 1. Get the starter project

**Do**

1. Download `tdd-relay.zip` from this page and unzip it into a new, empty folder.
2. In Quay, click **Add Project Workspace** in the rail and pick that folder.
3. Press `Ctrl+B N` and choose **PowerShell**.

**Paste into the PowerShell pane**

```text
git init; git add -A; git commit -m Starter; npm install
```

**You should see:** `01-starter-installed.webp`. A single PowerShell pane; `npm install` has finished and the prompt is back. The rail shows the project.

**Must match**

- `git commit` prints `Starter` as the message.
- `npm install` ends with `added` and a package count, no errors.

**May differ**

- The package count.

**If not: node or npm is not recognised.** Node 24 or later isn't on your PATH. Install it from the shared Before-you-start page, then close and reopen Quay.

### 2. Launch the TDD Swarm

**Do**

1. Press `Ctrl+B S` to open the Swarm launcher.
2. Select **TDD Swarm** and click **Launch Swarm Now**.
3. Wait until each of the three Claude panes has printed one line and gone quiet.

Teaching line: these are Swarm 2's four panes. In Swarm 2 you typed into three of them. This time you type into one, once.

**You should see:** `02-swarm-launched.webp`. A 2x2 grid: `test-architect`, `feature-impl`, `test-runner` (a PowerShell prompt) and `reviewer`. Each Claude pane ends with a one-line role confirmation.

**Must match**

- Four panes, named `test-architect`, `feature-impl`, `test-runner` and `reviewer`.
- Each Claude pane ends with one line confirming its role, then waits.

**May differ**

- The wording of each confirmation.
- How long the panes take to start.
- The port number in the rail header.

**If not: a Claude pane shows a one-line plugin hint.** The event-bridge plugin is missing in Claude Code. Click **Copy** on the hint, paste the install line into that pane, then type `/reload-plugins`. The hint clears on its own.

**If not: the panes open in the wrong layout.** Press `Ctrl+B G` for the 2x2 grid.

### 3. Start the test watcher

**Do**

1. Click into the **test-runner** pane (or press `Ctrl+B O` until its border is highlighted).

**Paste into `test-runner`**

```text
npm run test:watch
```

**You should see:** `03-watcher-todo.webp`. Vitest in watch mode: 1 todo test, waiting for file changes.

**Must match**

- `Tests  1 todo`.
- A line saying Vitest is waiting for file changes.

**May differ**

- Timings.

### 4. Send the one prompt

**Do**

1. Click into the **test-architect** pane and paste the prompt below.
2. Take your hands off the keyboard. From here the agents hand the work on themselves.

**Paste into `test-architect`**

```text
Read AGENTS.md. Replace the todo in test/duration.test.ts with failing Vitest tests that cover every parseDuration rule in AGENTS.md, and do not touch src/. Run npm test once to confirm the new tests fail. Then call quay_send_message with target_terminal_id feature-impl, wait_for_reply false, and exactly this message: "Tests for parseDuration in test/duration.test.ts are red. Make them all pass by editing src/duration.ts only, never test/. Run npm test until it is green, then call quay_send_message with target_terminal_id test-architect, wait_for_reply false, and the message GREEN." After sending, stop and wait. When the GREEN message arrives, run npm test once and end your reply with exactly RELAY DONE as the last line if every test passes, or RELAY FAILED if any fails. Do not message anyone after that.
```

Teaching line, under the prompt: `wait_for_reply` would wait at most 60 seconds, and making these tests pass takes minutes. So `test-architect` sends and moves on, and `feature-impl` reports back by sending a message of its own.

**You should see:** `04-handoff.webp`. `test-runner` shows every new test failing. A toast reads `test-architect → feature-impl` with **DISPATCHED** and the hand-off message under **TASK DELEGATION:**. `feature-impl`'s badge says Working; `test-architect`'s says Idle.

**Clip:** `04-handoff.mp4`, the tutorial's one clip. The toast slides in, `feature-impl`'s badge flips to Working and `test-architect`'s to Idle, and the toast leaves on its own after 7 seconds. All Quay motion, under ten seconds. The caption describes what moves.

**Must match**

- `test-runner` re-ran on its own and every test fails.
- `test-architect` called `quay_send_message` with `wait_for_reply` false.
- The toast names `test-architect → feature-impl`.
- Only `test/duration.test.ts` changed.

**May differ**

- How many tests `test-architect` wrote, and their names.
- Whether it called `quay_list_agents` first.
- How long it takes, and the agents' wording.

**If not: `test-architect` waited, and after 60 seconds said `feature-impl` "received the task but is still working".** It set `wait_for_reply` true. The message was delivered anyway, so the relay carries on. Go to step 5. Its trail entry will show Failed in step 7.

**If not: `test-architect` stopped without sending, and no toast appeared.** Paste into `test-architect`: `Now send feature-impl the message from my last prompt with quay_send_message, wait_for_reply false.`

### 5. Hands off: watch it turn green

**Do**

1. Watch `test-runner`. Don't type into any pane.
2. If you want to see `feature-impl` working, press `Ctrl+B O` until it is focused, `Ctrl+B Z` to zoom it, and `Ctrl+B Z` again to go back to the grid. Focusing and zooming don't type anything.

**You should see:** `05-watcher-green.webp`. `test-runner` flipped from red to green as `feature-impl` saved `src/duration.ts`: all tests pass, 0 failed.

**Must match**

- `test-runner` shows all tests passing, 0 failed.
- Only `src/duration.ts` changed in this step.

**May differ**

- How `feature-impl` wrote it, and how many saves the watcher shows on the way.
- How long it takes (expect 2 to 10 minutes).

**If not: `feature-impl` edited `test/`.** Paste into `feature-impl`: `Run git checkout -- test to undo your changes there, then make the tests pass by editing src/duration.ts only.`

### 6. The report comes back

**Do**

1. Keep watching. A second toast arrives, and `test-architect` wakes up.

**You should see:** `06-relay-done.webp`. A toast reads `feature-impl → test-architect`. The `test-architect` pane shows the typed message `[Peer agent (feature-impl)]: GREEN`, one more test run, and a last line `RELAY DONE`. All three Claude badges end Idle.

**Must match**

- `test-architect` received a message starting `[Peer agent (feature-impl)]: GREEN`.
- Its last line is `RELAY DONE`.

**May differ**

- Anything `test-architect` says before the last line.
- Anything `feature-impl` added after `GREEN`.

**If not: `feature-impl` went Idle, no second toast arrived, and `test-architect` is still waiting.** Paste into `feature-impl`: `Send test-architect the message GREEN with quay_send_message, target_terminal_id test-architect, wait_for_reply false.`

**If not: the last line is `RELAY FAILED`.** Paste into `test-architect`: `Send feature-impl the names of the failing tests with quay_send_message, wait_for_reply false, and ask it to fix src/duration.ts only and send GREEN again.` Then watch this step again.

### 7. Read the relay in the A2A Orchestration Bus

**Do**

1. Click the **A2A Orchestration Bus** button in the rail's bottom toolbar.
2. Scroll to **Live A2A Message Trail**.
3. Press `Esc` to close the panel when you've read it.

**You should see:** `07-trail.webp`. The panel's trail, cropped. Two entries: `test-architect → feature-impl` with the hand-off message and a Reply from `feature-impl`, then `feature-impl → test-architect` with `GREEN` and a Reply ending `RELAY DONE`. Both show **Completed**.

**Must match**

- An entry `test-architect → feature-impl`, Completed.
- An entry `feature-impl → test-architect` whose message is `GREEN`, Completed, with a Reply ending `RELAY DONE`.

**May differ**

- The times on each entry.
- The wording of the first entry's message and of both Replies, apart from `RELAY DONE`.

**If not: the trail has more than two entries.** The others are from earlier work in this Quay session. Look for the two that name `test-architect` and `feature-impl`.

**If not: the first entry shows Failed, "Timed out waiting for reply".** `test-architect` waited in step 4 instead of sending and moving on. The message still went through. Nothing to fix.

### 8. Check it worked

**Do**

1. Click into **test-runner** and press `q` to stop the watcher.
2. Download `tdd-relay-check.zip` from this page and unzip it into the project folder, so `check/` sits beside `src/`. The agents never saw these tests.

**Paste into `test-runner`**

```text
npm test; npm run typecheck; npx vitest run --config check/vitest.config.ts; git status --short
```

**You should see:** `08-check.webp`. `test-runner` shows the agents' tests passing, a clean type check, every check test passing, and `git status` listing the two changed files and the new `check/` folder.

**Must match**

- `npm test` passes with 0 failed.
- `npm run typecheck` prints nothing.
- The check run passes with 0 failed.
- `git status --short` lists exactly ` M src/duration.ts`, ` M test/duration.test.ts` and `?? check/`.

**May differ**

- The number of tests in `npm test`.

**If not: some check tests fail.** The relay built what its own tests asked for, not everything AGENTS.md says. Paste into `test-architect`: `These check tests fail: <paste the failing names>. Add tests for them to test/duration.test.ts, then hand off to feature-impl exactly as before.` Then repeat steps 5 to 8.

**You're done when**

- `test-architect`'s last line is `RELAY DONE`.
- The trail shows `test-architect → feature-impl` and `feature-impl → test-architect`, both Completed.
- `npm test`, the type check and the check suite all pass.
- `git status --short` shows only `src/duration.ts`, `test/duration.test.ts` and `check/`.
- You typed into an agent pane once, in step 4, apart from any If not you followed.

**Next up:** A2A 4, Review gate.

## Screenshot list

Full-window captures of Quay unless noted. Names are the step markers.

| File | Shows | Must-match anchors |
| --- | --- | --- |
| `01-starter-installed.webp` | PowerShell pane after `npm install` | `Starter`, `added` |
| `02-swarm-launched.webp` | 2x2 grid, three role confirmations | the four pane names |
| `03-watcher-todo.webp` | `test-runner` in watch mode (pane crop) | `Tests  1 todo` |
| `04-handoff.webp` | Watcher red, the first toast, `feature-impl` Working | toast `test-architect → feature-impl`, DISPATCHED |
| `04-handoff.mp4` | The clip: toast in, badges flip, toast out | same caption as the still |
| `05-watcher-green.webp` | Watcher all green, `feature-impl` finishing | 0 failed |
| `06-relay-done.webp` | Second toast, `test-architect` ending `RELAY DONE` | `[Peer agent (feature-impl)]: GREEN`, `RELAY DONE` |
| `07-trail.webp` | A2A Orchestration Bus trail (panel crop) | two Completed entries, `GREEN`, `RELAY DONE` |
| `08-check.webp` | `test-runner` final run (pane crop) | 0 failed twice, `git status` lines |

Fixture recording: one whole run, four terminals (three Claude casts with bridge logs, one of them the idle `reviewer`, and one PowerShell cast), markers 01 to 08. The bridge logs carry both `quay_send_message` calls. Replay must post each receiver's `turn.started` after the typed message arrives, per the fake-CLI spike, or the trail entries won't complete.

## Open questions, in order

1. **Preset or custom swarm, and which names?** This draft uses the TDD Swarm preset as coded: `test-architect`, `feature-impl`, `test-runner` and `reviewer`, with `reviewer` left idle. It makes the contrast with Swarm 2 exact: same team, same loop, one prompt. The charting names `test-author` and `feature-dev` come only from the old example in `docs/features/a2a-orchestration.md`. Proposed: keep the preset, and have the A2A docs rewrite use the preset names in its example too. Alternatives: a custom swarm with those names (but Swarm 4 is the only tutorial that teaches the builder), or two `Ctrl+B N` terminals (which get no team briefing).
2. **How the result comes back.** This draft sends both hand-offs with `wait_for_reply: false`, and `feature-impl` reports by sending a new one-line message, `GREEN`. That is neither a reply nor a file mailbox. Proposed: accept the report-back message as the relay pattern, leave polling and the file mailbox to A2A 6, and add **Relay** to the tutorials glossary: a chain of messages sent without waiting, where each peer passes the next step on with a new message.
3. **The TDD Swarm role prompts.** Swarm 2 settled that none of these agents messages a teammate unless asked, and that each waits for the user between tasks. Read strictly, `feature-impl` would ignore a task that comes from `test-architect`. Proposed: when the role-prompt texts are written, word it as "unless the user, or a message from a teammate, asks you to", and have agents act on a teammate's message as they would on the user's. Swarm 2's own steps still work, because its prompts never ask anyone to message.
4. **A check suite.** Hands-off means the learner never read the agents' tests, so this draft adds `tdd-relay-check.zip`: one case per AGENTS.md rule, run with its own Vitest config after the agents finish. Starters CI expects it to fail against the unfixed starter. Proposed: yes. Alternative: no check suite, like Swarm 2, and trust the agents' own tests.
5. **Code gap: a trail entry for a message sent without waiting can complete on the wrong turn.** `A2ARouter::resolve_pending_reply` marks the newest Dispatched message to a terminal Completed on that terminal's next `turn.completed`, whether or not anyone waits. If `GREEN` lands while `test-architect` is still finishing an earlier turn, that earlier turn's answer becomes its Reply. The fix-first "wrong replies" item speaks only of waiters registered by `wait_for_reply`. Proposed: join the fix-first list as part of that item, so trail entries follow the same "a turn that starts after delivery" rule.
6. **Code gap: the trail's order flips.** In `A2APanel`, a message that arrives while the panel is open is put at the top, but the panel reloads from the router every 3 seconds, and the router lists oldest first. Entries jump. This draft's Must match avoids depending on order. Proposed: join the fix-first list with one fixed order, newest first, since A2A 8 (Mission Control) will lean on the trail more than this tutorial does.
7. **The model flag.** The preset starts `test-architect` with `--model claude-sonnet-5-5` and the other two Claude agents on the default. Proposed: keep it and say so under Before you start, as Swarm 3 does for its preset. Alternative: drop the flag when the role prompts are written.
8. **Level.** Proposed: Intermediate. One prompt is easy to type, but the lesson is why the hand-off doesn't wait and how the work comes back, which leans on A2A 1's ideas. Swarm 2 is Starter.
