# Outline: A2A 10, Second opinion from Codex

Prototype outline for the ticket "Tutorial outline: A2A 10, Second opinion from Codex".
A rough take to react to, not the tutorial. Open questions are at the end.

Slug `second-opinion-codex`. Page `docs/tutorials/a2a/second-opinion-codex/index.md`.
Starter `examples/tutorials/second-opinion-codex/starter/`, check suite
`examples/tutorials/second-opinion-codex/check/`.

**What this tutorial teaches that the nine before it don't.** A peer that isn't Claude. The
bus decision makes Codex a full peer: it gets messages, its turn end shows in Quay, and it
can answer. But a review is too long for a reply, and the whole point of a second opinion is
that it comes from a different model. So `author` (Claude) asks `codex` for a review through
the file mailbox, waits for `codex` to show Idle, reads `review.md`, and acts on it. The
check-it-worked step hands the learner a check suite the agents never saw, because the
learner needs to know whether Codex caught what was there, not only that it wrote a file.

## The page, top to bottom

**Title:** A2A 10: Second opinion from Codex

**Pitch:** `author`, a Claude Code agent, owns a small retry helper that it didn't write.
Before shipping it, `author` asks `codex`, an OpenAI Codex agent in the next pane, for a
review. Codex writes its findings to `review.md`; `author` reads the file, fixes every
finding and adds the tests that were missing. Then you run the tests the agents never saw.

**Tiles:** Time and Tokens generated from test runs. Agents: 1 × Claude + 1 × Codex + 1
shell. Level: Intermediate.

**You'll learn:** opening a Codex terminal in Quay and what its Skip mode means; how a
non-Claude peer joins the bus; sending a job to Codex with `wait_for_reply: false`; the file
mailbox from the writer's side (what to ask for, and the shape to ask for); polling with
`quay_get_agent_status` until a peer is Idle; and checking an agent's review against tests
it never saw.

**Builds on:** A2A 1 (the `quay_*` tools, Mission Control's trail) and A2A 6 (fire, poll,
then read the file). The page says so in one line and links both.

**Before you start:** the shared Before-you-start page (Quay installed; Claude Code 2.1.296
or later, signed in; event-bridge 0.1.0 or later; PowerShell 7; Node 24 or later, npm and
Git). Extra for this tutorial, on this page:

- Codex CLI 0.154.0 or later, installed with `npm install -g @openai/codex` and signed in
  with `codex login` (a ChatGPT account). Checked with `codex --version`.
- Update Codex before you start: `npm install -g @openai/codex@latest`. Codex tries to
  update itself when it launches, and a failed update makes the pane exit at once.
- One line on modes: both agents run in Skip mode. Quay launches Codex with
  `--dangerously-bypass-approvals-and-sandbox` and shows the same red banner it shows for
  Claude; in this tutorial Codex only reads files and writes `review.md`.

## The starter project

A small, finished TypeScript package whose code is green but wrong in three places the
tests don't reach. The page tells the learner this up front: "the previous developer left
in a hurry; the tests pass; `author` now owns it." Nothing is hidden from the learner, only
from the agents (`AGENTS.md` doesn't mention the defects).

```text
starter/
  package.json        name retry-kit, version 1.0.0, "type": "module", engines node >=24
                      scripts: test "vitest run", typecheck "tsc --noEmit"
                      devDependencies: vitest, typescript, @types/node (exact versions)
  package-lock.json
  tsconfig.json       strict, erasableSyntaxOnly, noEmit, module/moduleResolution nodenext
  .gitignore          node_modules/
  README.md           what retry() does, the tutorial's premise, and that review.md is where
                      the review lands
  SPEC.md             the contract, eight numbered rules (below)
  AGENTS.md           see below
  CLAUDE.md           @AGENTS.md
  src/retry.ts        export async function retry<T>(fn, options): Promise<T>
  test/retry.test.ts  four passing tests: happy path, one failure then success,
                      exhausts attempts, delay is awaited
check/
  retry.check.test.ts three tests, one per planted defect (below)
```

**`SPEC.md`**, the eight rules: `attempts` is the total number of calls, so `attempts: 3`
calls `fn` at most three times; an error whose `retryable` property is `false` is thrown at
once without another attempt; the delay before a retry is `delayMs * backoff ** (n - 1)` for
retry number `n`; no delay is waited after the last failed attempt; the last error is the
one thrown; `attempts` below 1 throws a `RangeError` before any call; `fn` receives the
attempt number starting at 1; and the returned promise settles exactly once.

**The three planted defects** in `src/retry.ts`, each plain enough that any reviewer with
the spec in hand finds it:

1. The loop runs `attempts + 1` times (`<=` instead of `<`), so `attempts: 3` makes four
   calls. The visible test "exhausts attempts" counts errors, not calls, so it passes.
2. `retryable: false` is read from `options` instead of from the thrown error, so a
   non-retryable error is retried like any other.
3. The delay is awaited after every failed attempt, including the last one, so a call that
   exhausts three attempts with `delayMs: 200` wastes a final 200 ms.

**The check suite** (`check/retry.check.test.ts`) has one test per defect: it counts calls
with `attempts: 3` and expects three; it throws `{ retryable: false }` and expects one call;
and it uses fake timers to assert that no timer is pending after the last failure. All three
fail against the unfixed starter, which is the state the starters CI job expects. It is
packed as `second-opinion-codex-check.zip` and unzipped by the learner in step 8.

**`AGENTS.md`:** the goal in a sentence ("`retry` must do what `SPEC.md` says"); the
commands `npm test`, `npm run typecheck`; the house rules (npm only, no new dependencies,
no `enum` or `namespace`); and "Reviews go in `review.md` at the project root. A review
starts with a line that reads exactly `VERDICT: APPROVED` or `VERDICT: CHANGES REQUESTED`,
then a numbered list of findings, each naming the line in `src/retry.ts`, what is wrong,
and a one-line fix."

**Starters CI expected state:** `npm ci`, `npx tsc --noEmit` clean, visible tests green
(4 passed), check suite red against the starter (3 failed).

## Steps

### 1. Get the starter project

The standard step, in a `shell` pane, as the other outlines do it.

**Do**

1. Download `second-opinion-codex.zip` from this page and unzip it into a new, empty
   folder, for example `C:\tutorials\second-opinion-codex`.
2. In Quay, click **Add Project Workspace** in the rail and pick that folder.
3. Press `Ctrl+B N`, choose **PowerShell**, label it `shell` and click **Start Terminal**.

**Paste into `shell`**

```text
git init -b main; git add -A; git commit -m Starter; npm install; npm test
```

One sentence on the files: `SPEC.md` is the contract both agents will read, `AGENTS.md`
tells them the house rules and where a review goes, and `CLAUDE.md` points Claude Code at
it.

**You should see:** `01-starter-installed.webp`. The `shell` pane: the Starter commit, the
install summary, then Vitest with 4 passed.

**Must match**

- `git commit` prints `Starter` as the message.
- `Tests  4 passed`.

**May differ**

- The package count and timings; npm's funding and audit lines.

**If not: node or npm is not recognised.** Node 24 or later isn't on your PATH. Install it
from the Before-you-start page, then close and reopen Quay.

### 2. Open `author`

**Do**

1. Press `Ctrl+B N`. Under **Autonomous AI Agents** choose **Claude**. Leave **Permission
   Mode** on **Skip Permissions (Default)**. In **Terminal Label (Optional)** type `author`.
   Click **Start Terminal**.
2. Claude Code asks whether you trust this folder. Say yes.
3. Wait until `author`'s badge in the rail reads Idle.

**You should see:** `02-author-ready.webp`. `author` at Claude Code's prompt, badge Idle,
no plugin hint.

**Must match**

- The rail lists `shell` and `author`, in that order.
- `author`'s badge reads Idle, and the pane shows no plugin hint.

**May differ**

- Claude Code's welcome text and model name.
- The port number in the rail header.

**If not: `author` shows the plugin hint, "No events from the event-bridge plugin."**
The A2A 1 fix, in one paragraph: copy the hint's command, run it in `shell` (`Ctrl+B 1`),
then `/reload-plugins` in `author`.

### 3. Open `codex` beside it

**Do**

1. Press `Ctrl+B %` to split the stage. `author` stays on the left; `shell` comes back on
   the right.
2. Press `Ctrl+B O` to move focus to the right pane.
3. Press `Ctrl+B N`. Under **Autonomous AI Agents** choose **Codex**. Leave **Permission
   Mode** on **Skip Permissions (Default)**. Label it `codex`. Click **Start Terminal**.
4. Codex asks whether you trust the contents of this directory. Choose **Yes, continue**.
5. Wait until Codex shows its prompt and `codex`'s badge reads Idle.

Teaching lines for the page: the red banner now names Codex, because Quay launched it with
`--dangerously-bypass-approvals-and-sandbox`; and Codex is on the bus the same way Claude
is, wired for this terminal only, with nothing written to your Codex config.

**You should see:** `03-two-agents.webp`. `author` on the left, `codex` on the right at
Codex's prompt, the banner reading "[Codex CLI] Codex runs with approval prompts and
sandbox constraints bypassed."

**Must match**

- The rail lists `shell`, `author` and `codex`, in that order.
- Both agent badges read Idle.

**May differ**

- Codex's welcome text, model name and version, as long as the version is 0.154.0 or
  later.
- The port number in the rail header.

**If not: the `codex` pane printed "Updating Codex CLI" and then exited.** Codex tried to
update itself and the download failed. In `shell` (`Ctrl+B 1`), run
`npm install -g @openai/codex@latest`, then `Ctrl+B O` and repeat this step.

**If not: Codex asks you to sign in.** Finish `codex login` from the Before-you-start page
in `shell`, then close the `codex` pane and repeat this step.

### 4. Ask for the second opinion

Teaching line: a review is longer than a reply can carry, and `author` has nothing to do
while it waits. So the job goes out with `wait_for_reply: false`, names the file the answer
goes in, and says what shape that file takes.

**Do:** click into `author`.

**Paste into `author`**

```text
Use quay_send_message to send codex the job below, with wait_for_reply set to false. The job: "Review src/retry.ts against every rule in SPEC.md. Don't change any file except review.md. Write review.md at the project root as AGENTS.md describes: first line exactly VERDICT: APPROVED or VERDICT: CHANGES REQUESTED, then a numbered list of findings, each with the line in src/retry.ts, what is wrong, and a one-line fix. Write the file before you end your turn." Then tell me in one line what quay_send_message returned, and stop. Don't wait for the review.
```

**You should see:** `04-request-fired.webp`. `author` reports
`Successfully dispatched task to codex.` and its badge is Idle again. `codex` shows the
job, prefixed `[Peer agent (author)]:`, and its badge reads Working. **Clip step:**
`04-request-fired.mp4`, the job landing in `codex` and Codex starting on it, under ten
seconds.

**Must match**

- `Successfully dispatched task to`.
- `author` Idle while `codex` is Working.

**May differ**

- `author`'s wording; the target shows as a terminal id if `author` looked one up first.
- What Codex prints while it works.

**If not: `author` sat for about a minute and then said the peer "received the task but is
still working".** It sent with the default, `wait_for_reply: true`. The review still
happens; carry on from step 5. Mission Control's trail marks that message Failed.

### 5. Watch it in Mission Control

**Do**

1. Open **Mission Control** from the rail's bottom toolbar (or `Ctrl+K`, **Mission
   Control**).
2. In the agent list, find `codex`. It has no Listener tag: Codex is a full peer.
3. In the trail, find the newest entry, `author → codex`, marked Working.
4. Press `Esc` to close the panel.

**You should see:** `05-trail-working.webp`. Mission Control with `codex (codex)` in the
agent list and the `author → codex` entry at the top of the trail, Working.

**Must match**

- `author → codex` is the newest trail entry and reads Working.
- `codex` carries no Listener tag.

**May differ**

- The time stamp.
- Whether `codex`'s status in the list already reads Idle, if Codex was quick.

### 6. Collect the review

Teaching line: Quay sees Codex's turn end, so `author` can poll until `codex` is Idle, then
read the file, exactly as in A2A 6. The file is the answer; Idle only says it's ready.

**Paste into `author`**

```text
Poll codex with quay_get_agent_status about every 15 seconds until its status is Idle. Then read review.md. If the file is missing or its first line doesn't start with VERDICT:, say so and stop. Otherwise tell me the first line and how many findings it lists, in one line, and don't change anything yet.
```

**You should see:** `06-review-collected.webp`. `author` makes a few status checks, then
reports `VERDICT: CHANGES REQUESTED` and a count. `codex` shows the end of its review and
that it wrote `review.md`.

**Must match**

- `author` quotes `VERDICT: CHANGES REQUESTED`.

**May differ**

- How many polls it makes; how many findings Codex lists (three is the number planted,
  but Codex may group or add); every word of the review.

**If not: `author` says it can't wait between checks.** Poll by hand: paste
`Check codex with quay_get_agent_status and tell me its status in one line.` every half
minute until it reports Idle, then paste `Read review.md and tell me its first line and how
many findings it lists.`

**If not: Idle, but no `review.md`.** Codex ended its turn without writing the file. Paste
into `codex`: `Write review.md now, as AGENTS.md describes.` Then repeat this step.

**If not: `review.md` starts with `VERDICT: APPROVED`.** Codex missed all three defects.
Rare, and step 8 would catch it. Paste into `codex`:
`Re-read SPEC.md rule by rule and check src/retry.ts against each one. Rewrite review.md.`
Then repeat this step.

### 7. Act on the review

**Paste into `author`**

```text
Read review.md. For every finding, fix src/retry.ts so it follows SPEC.md, and add one test to test/retry.test.ts that would have failed before the fix. Don't change SPEC.md or review.md. Run npm test and npm run typecheck, and tell me in one line what you changed and the test count.
```

**You should see:** `07-fixes-applied.webp`. `author`'s one-line summary and a passing
test run with more than four tests. `codex` is unchanged.

**Must match**

- `author` reports the tests passing, with a count above 4.
- `author` names `src/retry.ts` and `test/retry.test.ts` as changed.

**May differ**

- The test count (four plus one per finding); the fix wording.

**If not: `author` disagrees with a finding and leaves it.** Paste into `author`:
`SPEC.md is the contract. Apply the finding as the spec says, or tell me which rule it
conflicts with.` A finding that really conflicts with the spec is a Codex mistake; the check
suite in step 8 is the referee.

### 8. Check it worked

The check-it-worked step hands the learner the tests the agents never saw.

**Do**

1. Download `second-opinion-codex-check.zip` from this page and unzip it into the project
   folder, so `check/retry.check.test.ts` sits beside `src/`.
2. Click into `shell`.

**Paste into `shell`**

```text
npx vitest run check; Get-Content review.md -TotalCount 1; git status --short
```

**You should see:** `08-check.webp`. Vitest with 3 passed, then `VERDICT: CHANGES
REQUESTED`, then `git status --short` listing `M src/retry.ts`, `M test/retry.test.ts`,
`?? check/` and `?? review.md`.

**Must match**

- `Tests  3 passed`.
- `VERDICT: CHANGES REQUESTED`.
- Exactly those four status lines.

**May differ**

- Timings.

**If not: one or two check tests fail.** Codex missed a defect, or `author` fixed it
wrongly. The failing test's name says which rule. Send it back round the bus: paste into
`author`:
`Send codex this with wait_for_reply set to false: "A test for SPEC.md rule <n> fails. Re-review src/retry.ts for that rule and append a finding to review.md." Then poll codex until Idle, apply the new finding, and run npm test.`
Then repeat this step.

**You're done when**

- `codex` wrote `review.md`, and its first line is `VERDICT: CHANGES REQUESTED`.
- `author` read the file, changed `src/retry.ts` and `test/retry.test.ts`, and its tests
  pass.
- The check suite passes: 3 passed.
- Mission Control's trail entry `author → codex` reads Completed.

**Next up:** this is the last tutorial. The card links back to the Tutorials landing page,
with one line: "You've run every pattern on the bus. Build a swarm of your own with Swarm 4,
or take a preset to a real project."

## Screenshot list

| File | Shows |
| --- | --- |
| `01-starter-installed.webp` | `shell`: Starter commit, install, 4 passed |
| `02-author-ready.webp` | `author` at the prompt, badge Idle |
| `03-two-agents.webp` | `author` left, `codex` right with its banner, three rail rows |
| `04-request-fired.webp` | `author` dispatched; `codex` Working on the job |
| `04-request-fired.mp4` | clip: the job landing in `codex` and Codex starting |
| `05-trail-working.webp` | Mission Control: `codex` without a Listener tag, trail entry Working |
| `06-review-collected.webp` | `author` quoting the verdict; `codex` done |
| `07-fixes-applied.webp` | `author`'s summary and the green run |
| `08-check.webp` | `shell`: check suite 3 passed, verdict line, git status |

Eight step cards, eight screenshots, one clip. Recordings: `author` (Claude) and `codex`
(Codex) for the whole run, with step markers. The Codex recording is the first one made
with a non-Claude CLI; the fake-CLI spike confirmed `codex.exe` resolves the same way as
`claude.exe` through the fixture workspace's PATH.

## Code it depends on

All from the bus build in [Decide: How do non-Claude agents join the A2A bus?](https://github.com/seanrobertwright/Quay-2/issues/12), as amended by [Task: Live-test Codex, OpenCode and Antigravity against the bus design](https://github.com/seanrobertwright/Quay-2/issues/44) and whatever [Decide: What does the live test change in the bus design?](https://github.com/seanrobertwright/Quay-2/issues/54) settles:

- Codex launched with the four `QUAY_*` variables, the `-c mcp_servers.quay.*` overrides
  (including `default_tools_approval_mode="approve"`), and `-c notify=[...]` pointing at
  the turn-end sidecar. This tutorial never has Codex call a `quay_*` tool, so the approval
  mode matters only for the badge in Mission Control's banner, not for any step.
- The sidecar posting `turn.completed` with the terminal's tag and token, dropping
  subagent payloads. Step 6 depends on it: without it `codex` never shows Idle.
- Working on delivery and Idle on turn end for Codex (step 4's badge, step 6's poll).
- `quay_get_agent_status` resolving a name, from the A2A 1 resolution (step 6).
- Mission Control named as such, trail newest first, the Listener tag (step 5), from the
  A2A 1 resolution.
- The plugin hint (step 2), the Paste slot naming a pane, the check-suite zip packing
  from the starter decision.

**Gap seen in the fake-CLI spike, proposed for the bus build:** a Codex pane's backend
status stays `starting` until its first turn ends, because nothing reports a session start
for it. The rail shows Idle anyway (the frontend flips Starting to Idle on first output),
but `quay_list_agents` and `quay_get_agent_status` report `starting`, so an agent that
polls `codex` before sending would read the wrong state. Proposed: the bus build sets a
full peer Idle when its pane first prints, or Unknown, and never leaves it at Starting.

Verified in code on master: `RunKind::Codex` spawns `codex.exe` by bare name with
`--dangerously-bypass-approvals-and-sandbox` in Skip mode; `A2ARouter::dispatch` types the
job prefixed `[Peer agent (<sender>)]:` with Enter 250 ms later and sets the target
Working; the bridge sets Idle on `turn.completed`; the frontend moves an agent pane from
Starting to Idle on its first output or after three seconds.

## Open questions

1. **Review target.** This draft ships the three defects in the starter, so every run has
   the same thing to find and the check suite can referee. The alternative is realism:
   `author` builds something first and Codex reviews fresh code, which no two runs share
   and no check suite can grade. Proposed: planted defects, with the premise stated on the
   page.
2. **Pane names.** `author` and `codex`, with `codex` named after its CLI so the page can
   say "the `codex` pane" and "Codex" and mean the same thing. A2A 4 already owns
   `developer` and `reviewer`.
3. **One round or a loop.** A2A 4 loops until APPROVED. This draft runs one review round
   and lets the check suite decide whether a second round is needed (step 8's If not).
   Proposed: one round; the second round exists only as a fix.
4. **A check suite here.** The starter decision allows one where the check-it-worked step
   needs tests the agents must not see. Without it, "done" would rest on Codex's own verdict.
   Proposed: yes, three tests, one per defect, failing against the starter in CI.
5. **Must match on Codex's output.** Codex's wording and finding count vary. Proposed: Must
   match holds only the verdict line and the test counts; the planted defects are never
   named in Must match, and the check suite does the grading.
6. **Codex Skip mode on the page.** Codex's flag bypasses approvals and its sandbox, which
   is more than Claude's. Proposed: one line in Before you start and the teaching line in
   step 3, no more; Codex only writes one file here.
7. **The self-update gotcha.** Proposed: Before you start says to update Codex first, and
   step 3 carries the If not. Should the Before-you-start page itself say this for every
   tutorial that opens a Codex pane (Swarm 9's Polyglot Trio does too)?
8. **The `starting` status gap.** Join the bus build as described under Code it depends
   on, or leave it, since no step in this tutorial polls before sending?
9. **Clip.** Step 4, the job landing in `codex` and Codex starting, which needs the Codex
   recording to replay with timing. Fallback: none, since A2A 6 already clips the badges
   trading places.
10. **Closing the series.** The Next up card links to the landing page as the template
    says. Proposed one closing line, above. Anything else the last page should carry?
11. **Level and size.** Intermediate: it reuses A2A 6's moves with a new peer. Eight step
    cards, eight screenshots, one clip.
