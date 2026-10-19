# Outline: Swarm 9, Polyglot Trio

Prototype outline for [Tutorial outline: Swarm 9, Polyglot Trio](https://github.com/seanrobertwright/Quay-2/issues/24).
A rough take to react to, not the tutorial. Open questions are at the end.

Slug `polyglot-trio`. Page `docs/tutorials/swarm/polyglot-trio/index.md`. Starter
`examples/tutorials/polyglot-trio/starter/`, check suite `examples/tutorials/polyglot-trio/check/`.

**What this tutorial teaches that the eight before it don't.** A swarm of three different
agent CLIs, and the three ways a peer can sit on the bus. Every earlier Swarm tutorial is
all Claude. Polyglot Agent Trio puts Claude (`claude-dev`), Antigravity (`agy-planner`) and
Codex (`codex-reviewer`) side by side with a test shell, and each one shows its level once:

- `agy-planner` is a **responder**. It gets no launch prompt, so the learner pastes its role.
  It writes `PLAN.md` (a file mailbox, because a plan outlasts a reply), and it answers when
  `claude-dev` asks it a short question and waits. It can't start a conversation.
- `claude-dev` is a full peer that **asks**: it sends `agy-planner` a waited question and
  gets the answer back as a reply.
- `codex-reviewer` is a full peer that **starts a conversation**: it writes `review.md` and
  then messages `claude-dev` to act on it. This is the only tutorial where a non-Claude
  agent calls a `quay_*` tool. A2A 10 has Codex on the receiving end instead.

## The page, top to bottom

**Title:** Swarm 9: Polyglot Trio

**Pitch:** Three agents from three vendors build one small tool. Antigravity plans a
CSV-to-JSON converter, Claude Code builds it, and Codex reviews it and sends Claude the
fixes. You launch them with one click, watch them pass work across the A2A bus, and finish
by running tests none of them saw.

**Tiles:** Time and Tokens generated from test runs. Agents: 1 × Claude + 1 × Antigravity +
1 × Codex + 1 shell. Level: Advanced.

**You'll learn:** the Polyglot Agent Trio preset; what full peer and responder mean, and
how Mission Control shows them; giving an agent its role by hand when its CLI can't take a
launch prompt; asking a responder a short question and getting its reply; a plan and a
review travelling as files while the bus carries only the short messages; and a non-Claude
agent sending a message.

**Builds on:** Swarm 8 (plan, build and verify split by file kind, `PLAN.md` as a file
mailbox). One line on the page links it.

**Before you start:** the shared Before-you-start page (Quay installed; Claude Code 2.1.296
or later, signed in; event-bridge 0.1.0 or later; PowerShell 7; Node 24 or later, npm and
Git). Extra for this tutorial, on this page:

- Antigravity CLI 1.4.2 or later, signed in. Checked with `agy --version`. The shared page
  carries the install and sign-in lines (see open question 9).
- Codex CLI 0.154.0 or later, installed with `npm install -g @openai/codex` and signed in
  with `codex login`. Checked with `codex --version`.
- Update Codex first: `npm install -g @openai/codex@latest`. Codex tries to update itself
  when it launches, and a failed download makes its pane exit at once. (Decided with A2A 10;
  the shared page says it for every tutorial that opens a Codex pane.)
- One line on modes: the launcher starts all three agents in Skip mode. Each gets its own
  red banner, because each CLI's skip flag means something slightly different.

## The starter project

A command-line CSV-to-JSON converter with nothing inside it, and a spec exact enough to
build and test against without a reference solution. The split that keeps three agents
safe in one folder is by file, as in Swarm 8: the planner writes one file, the reviewer
writes one file, the builder edits two folders.

```text
starter/
  package.json          name polyglot-trio, "type": "module", "engines": { "node": ">=24" }
                        scripts: test "vitest run", typecheck "tsc --noEmit"
                        devDependencies: vitest, typescript, @types/node (exact versions)
  package-lock.json
  tsconfig.json         strict, erasableSyntaxOnly, noEmit, module and moduleResolution nodenext,
                        allowImportingTsExtensions, types node
  .gitignore            node_modules/
  README.md             the goal in two sentences; points at SPEC.md and AGENTS.md
  SPEC.md               eight numbered rules, then the exact output for samples/orders.csv
  AGENTS.md             goal, commands, ownership, house rules, the review.md shape
  CLAUDE.md             @AGENTS.md
  src/csv.ts            export function parseCsv(text: string): string[][], throws "not implemented"
  src/cli.ts            no argument: usage line to stderr, exit 2; any argument: "not implemented"
                        to stderr, exit 2
  test/csv.test.ts      one passing test (the usage line) and one it.todo per rule in SPEC.md
  samples/orders.csv    a header and four records, CRLF line endings (below)
check/
  csv2json.check.test.ts  six tests the agents never see (below)
  fixtures/               the CSV files those tests read
```

**`SPEC.md`**, the eight rules:

| Rule | Says |
| --- | --- |
| 1. Usage | `node src/cli.ts <file.csv>`. No argument, or a file that can't be read: print `Usage: node src/cli.ts <file.csv>` to stderr, exit 2. |
| 2. Records | Records end at CRLF or LF. A line break at the very end of the file does not start an empty record. |
| 3. Fields | Fields are separated by commas. Spaces around a field are kept. An empty field is the empty string. |
| 4. Quotes | A field wrapped in double quotes may hold commas, line breaks and `""`, which stands for one `"`. The wrapping quotes are not part of the value. |
| 5. BOM | A UTF-8 byte order mark at the start of the file is dropped. |
| 6. Objects | The first record is the header. Each later record becomes an object whose keys are the header fields, in order. Every value is a string; nothing is converted to a number or boolean. |
| 7. Ragged | A record whose field count differs from the header's: print `Line <n>: expected <h> fields, got <k>` to stderr, print nothing to stdout, exit 1. `<n>` is the 1-based line on which that record starts. |
| 8. Output | A JSON array, indented two spaces, then one line break. Exit 0. |

**`samples/orders.csv`** exercises rules 2 to 6 in four records: a quoted field holding a
comma (`"Smith, Jane"`), one holding `""` (`"12"" ruler"`), one holding a line break, an
empty field, and CRLF endings with a final CRLF. `SPEC.md` ends with the exact JSON the CLI
must print for it.

**The check suite** (`check/csv2json.check.test.ts`) runs the CLI with
`execFileSync(process.execPath, ["src/cli.ts", file])` and asserts exact stdout, stderr and
exit code. Six tests, each on a fixture the agents never saw:

1. LF-only endings and no final line break (rule 2).
2. A quoted empty string next to an unquoted empty field, both `""` (rules 3 and 4).
3. A BOM before the header (rule 5).
4. Values that look like numbers and booleans stay strings (rule 6).
5. A ragged record after a quoted line break, so `<n>` is the record's first line, not the
   count of records (rule 7).
6. A file that doesn't exist: usage line, exit 2 (rule 1).

All six fail against the stub, which is the state the starters CI job expects. Packed as
`polyglot-trio-check.zip`, unzipped by the learner in the last step.

**`AGENTS.md`:**

- Goal: a CSV-to-JSON converter as `SPEC.md` describes. `SPEC.md` ends with the exact
  output for `samples/orders.csv`.
- Commands: `npm test`, `npm run typecheck`, `node src/cli.ts samples/orders.csv`.
- Ownership: `agy-planner` creates and edits only `PLAN.md`. `claude-dev` edits only `src/`
  and `test/`. `codex-reviewer` creates and edits only `review.md`. Nobody edits `SPEC.md`,
  `AGENTS.md` or `samples/`.
- House rules: npm only, no new dependencies, `node:fs` only, no `enum` or `namespace`.
- Reviews go in `review.md` at the project root. The first line reads exactly
  `VERDICT: APPROVED` or `VERDICT: CHANGES REQUESTED`, then a numbered list of findings,
  each naming the file and line, what is wrong against which rule, and a one-line fix.
  (The same shape as A2A 10, so a learner who does both sees one convention.)

**Starters CI expected state:** `npm ci`, `npx tsc --noEmit` clean, `npm test` green
(1 passed, 8 todo), check suite red against the stub (6 failed).

## What the Polyglot Trio role prompts and briefing must make true (input to the launch-prompt fix)

- **claude-dev** edits only `src/` and `test/`. It follows `PLAN.md`, replaces each
  `it.todo` with a real test, and works until `npm test` and `npm run typecheck` pass. It
  carries the shared teammate clause from the A2A 3 decision: a teammate's message is acted
  on like the user's, and it messages a teammate only when the user, `AGENTS.md` or a
  teammate asks. It ends with the last line the user's prompt asks for.
- **codex-reviewer** edits only `review.md`, in the shape `AGENTS.md` gives. It reviews
  against `SPEC.md` rule by rule, never edits `src/` or `test/`, and carries the same
  teammate clause.
- **agy-planner** gets no launch prompt (the role-prompt decision: Antigravity has no
  interactive-with-prompt form). The preset carries no role prompt for it, and the launcher
  says so on its row. Its role reaches it as the learner's first paste, in step 4.
- **The team briefing names each teammate's level.** This is new: the briefing today lists
  names and roles, and names the `quay_*` tools only for agents that get the MCP server.
  For this tutorial `claude-dev` must know that `agy-planner` answers a waited message but
  never sends one, and must not expect it to report back unasked. Proposed: one line per
  teammate, for example `agy-planner (Antigravity, Architecture & Planner): a responder.
  Ask it a short question with wait_for_reply set to true; it can't message you first.`
  Full peers read `a full peer`, listeners `a listener: it gets messages but can't answer`.
  Built from the same level test that `quay_list_agents` uses, so it can't drift.

## Steps

### 1. Get the starter project

The standard step, in a `shell` pane.

**Do**

1. Download `polyglot-trio.zip` from this page and unzip it into a new, empty folder, for
   example `C:\tutorials\polyglot-trio`.
2. In Quay, click **Add Project Workspace** in the rail and pick that folder.
3. Press `Ctrl+B N`, choose **PowerShell Console**, label it `shell` and click **Start
   Terminal**.

**Paste into `shell`**

```text
git init -b main; git add -A; git commit -m Starter; npm install; npm test
```

One sentence on the files: `SPEC.md` is the contract all three agents read, `AGENTS.md`
says which agent may touch which file and how a review is laid out, and `samples/orders.csv`
is the file the finished tool must convert.

**You should see:** `01-starter-installed.webp`. The `shell` pane: the Starter commit, the
install summary, then Vitest with 1 passed and 8 todo.

**Must match**

- `git commit` prints `Starter` as the message.
- `Tests  1 passed | 8 todo`.

**May differ**

- The package count and timings; npm's funding and audit lines.

**If not: node or npm is not recognised.** Node 24 or later isn't on your PATH. Install it
from the Before-you-start page, then close and reopen Quay.

### 2. Launch the Polyglot Trio

**Do**

1. Press `Ctrl+B S` to open the Swarm Launcher.
2. Select the **Polyglot Agent Trio** card. Read its description and the note on the
   `agy-planner` row: Antigravity gets no launch prompt.
3. Click **Launch Swarm Now**.
4. Three trust questions follow, one per CLI. In `claude-dev` say yes. In `agy-planner`
   choose to trust the folder. In `codex-reviewer` choose **Yes, continue**.
5. Wait until the three agent badges in the rail read Idle.

Teaching lines for the page: the four panes are three different programs. `shell` from
step 1 is still in the rail as terminal 1; the grid shows only the swarm.

**You should see:** `02-trio-launched.webp`. A 2x2 grid: `claude-dev` top-left,
`agy-planner` top-right, `codex-reviewer` bottom-left, `test-runner` bottom-right at a
PowerShell prompt. `claude-dev` and `codex-reviewer` have each confirmed their role in one
line; `agy-planner` sits at Antigravity's prompt with no role.

**Must match**

- The pane names and positions above.
- The rail lists `shell`, `claude-dev`, `agy-planner`, `codex-reviewer`, `test-runner`, in
  that order.
- `claude-dev`'s first line reads `Role: Primary Implementer`; `codex-reviewer`'s reads
  `Role: Code Reviewer & Quality Gate`.
- Three red banners, naming Claude Code, Antigravity CLI and Codex CLI.

**May differ**

- Each CLI's welcome text, model name and version (at or above the Before-you-start
  minimums).
- The wording of each role confirmation.
- The port number in the rail header.

**If not: the `codex-reviewer` pane printed "Updating Codex CLI" and then exited.** Codex
tried to update itself and the download failed. Press `Ctrl+B 1` and run
`npm install -g @openai/codex@latest` in `shell`. Then close the four swarm panes and repeat
this step. (Relaunching the one pane would not resend its launch prompt.)

**If not: `agy-planner` asks you to sign in.** Sign in to Antigravity from `shell` as the
Before-you-start page shows, then close the four swarm panes and repeat this step.

**If not: a Claude pane shows the plugin hint, "No events from the event-bridge plugin."**
The A2A 1 fix in one paragraph: copy the hint's command, run it in `shell` (`Ctrl+B 1`),
then `/reload-plugins` in `claude-dev`.

### 3. Meet the team in Mission Control

Teaching line: all three agents are on the bus, but not equally. Mission Control says how.

**Do**

1. Open **Mission Control** from the rail's bottom toolbar (or `Ctrl+K`, **Mission
   Control**).
2. Read the agent list. `claude-dev` and `codex-reviewer` have no tag: they are full peers,
   which can send messages and answer them. `agy-planner` is tagged **Responder**: it
   answers a message whose sender waits, but it has no `quay_*` tools, so it can't start a
   conversation. `test-runner` and `shell` are not listed; a shell isn't a peer.
3. Press `Esc` to close the panel.

**You should see:** `03-team-levels.webp`. Mission Control's agent list with three agents,
the Responder tag on `agy-planner`, and an empty trail.

**Must match**

- Three agents listed: `claude-dev`, `agy-planner`, `codex-reviewer`.
- Only `agy-planner` carries a tag, and it reads Responder.

**May differ**

- The order of the list; each agent's status, Idle or Unknown for a moment after launch.

### 4. Give the planner its role and the job

Teaching line: Antigravity can't start with a prompt, so the launcher gave `agy-planner`
nothing to go on. Its role arrives as your first message, and the job comes with it.

**Do:** press `Ctrl+B 3` to focus `agy-planner`.

**Paste into `agy-planner`**

```text
You are the planner on this team. You create and edit only PLAN.md and never change any other file. Read SPEC.md and AGENTS.md, then write PLAN.md: the functions src/csv.ts and src/cli.ts need, the order to build them, and the test cases test/csv.test.ts should hold, at least one per rule in SPEC.md, each naming its rule. When PLAN.md is written, end your answer with the line PLAN.md written.
```

**You should see:** `04-plan-written.webp`. `agy-planner` Idle with a short summary ending
`PLAN.md written`; the other agents still waiting.

**Must match**

- `agy-planner`'s last line is `PLAN.md written`.
- Press `Ctrl+B 5` and run `git status --short` in `test-runner`: the only line is
  `?? PLAN.md`.

**May differ**

- How long the plan is and how it names the functions.
- What Antigravity prints while it works.

**If not: `agy-planner` shows a plan of its own and waits for you to approve it.** Antigravity
can stop for plan review even in Skip mode (see open question 4). Approve it, and it goes
on to write `PLAN.md`.

**If not: `git status` lists a file outside `PLAN.md`.** Paste into `agy-planner`:
`Undo every change except PLAN.md, and from now on edit only PLAN.md.` Then check again.

### 5. Ask the planner, and wait for the answer

Teaching line: a responder can't send, but it can answer. `claude-dev` asks a short question
and waits; Quay hands back Antigravity's final answer as the reply. The plan itself stays in
the file, because a plan is too long for a reply.

**Do:** press `Ctrl+B 2` to focus `claude-dev`.

**Paste into `claude-dev`**

```text
Use quay_send_message to ask agy-planner this, with wait_for_reply set to true: "Is PLAN.md complete, with at least one test case for every rule in SPEC.md? Answer in one line that starts PLAN READY or PLAN NOT READY." Then tell me its reply in one line and stop.
```

**You should see:** `05-planner-answers.webp`. The question in `agy-planner`'s pane,
prefixed `[Peer agent (claude-dev)]:`, Antigravity's one-line answer under it, and
`claude-dev` quoting the reply. **Clip step:** `05-planner-answers.mp4`, the question
landing in `agy-planner`, its badge going Working then Idle, and the reply appearing in
`claude-dev`, under ten seconds.

**Must match**

- `claude-dev` quotes a reply that starts `PLAN READY`.

**May differ**

- The rest of the reply's wording.
- Whether `claude-dev` calls `quay_list_agents` first.

**If not: the reply starts `blocked (permission)`.** Antigravity stopped to ask you
something. Press `Ctrl+B 3`, answer it in `agy-planner`, then repeat this step.

**If not: the reply starts `PLAN NOT READY`.** Paste into `agy-planner`:
`Finish PLAN.md so every rule in SPEC.md has a test case, then end with PLAN.md written.`
Then repeat this step.

**If not: `claude-dev` says `agy-planner` can't reply.** Your Antigravity CLI is older than
1.4.2, which doesn't report its answer to Quay. Update it, close the four swarm panes, and
start again from step 2.

### 6. Build the plan

**Paste into `claude-dev`**

```text
Read PLAN.md and build it in src/ and test/: replace every it.todo in test/csv.test.ts with a real test, and make npm test and npm run typecheck pass. Edit nothing outside src/ and test/. When both pass, end with the line BUILD DONE.
```

Then press `Ctrl+B Z` to zoom `claude-dev` while it works, and `Ctrl+B Z` again when it is
done.

**You should see:** `06-build-done.webp`. `claude-dev` Idle with its summary: tests written,
`npm test` passing, typecheck clean, last line `BUILD DONE`.

**Must match**

- `claude-dev`'s last line is `BUILD DONE`.
- Its summary reports passing tests and no todo.

**May differ**

- How long it takes, how many tests it wrote, and whether it split the code into more files
  under `src/`.

**If not: `claude-dev` edited `SPEC.md`, `samples/` or `PLAN.md`.** Paste into `claude-dev`:
`Undo your changes outside src/ and test/ with git checkout, and finish inside src/ and test/ only.`

### 7. Codex reviews, then hands Claude the fixes

Teaching line: this time the message goes the other way, and it starts in Codex. Codex is a
full peer, so it can do what Antigravity can't: start a conversation. The review is long, so
it travels as `review.md`; the message only tells `claude-dev` to read it. Nobody waits.

**Do:** press `Ctrl+B 4` to focus `codex-reviewer`.

**Paste into `codex-reviewer`**

```text
Review src/ against every rule in SPEC.md. Write review.md at the project root as AGENTS.md describes, and change no other file. Then use quay_send_message to send claude-dev this, with wait_for_reply set to false: "Read review.md and fix every finding in src/ and test/. Run npm test and npm run typecheck, and end with the line FIXES DONE." Then tell me the first line of review.md and stop.
```

**You should see:** `07-review-sent.webp`. `codex-reviewer` reporting its verdict line and
the send; `claude-dev` working on the message, prefixed `[Peer agent (codex-reviewer)]:`,
its badge Working.

**Must match**

- `codex-reviewer` quotes a first line that starts `VERDICT:`.
- The message appears in `claude-dev`'s pane and its badge reads Working.

**May differ**

- The verdict, and every finding. Codex may approve a build Claude got right; the check
  suite in step 9 is the referee, not the verdict.
- Whether Codex looks up `claude-dev`'s terminal id first.

**If not: `codex-reviewer` stops at an approval prompt for `quay_send_message`.** Quay
launches Codex with its tools pre-approved, so this means an older Quay. Approve it once
and carry on.

**If not: `codex-reviewer` sat for about a minute and then said `claude-dev` "is still
working".** It waited for a reply. The fixes still happen; carry on from step 8.

### 8. Watch the fixes land

**Do**

1. Press `Ctrl+B 2` and wait until `claude-dev` ends with `FIXES DONE`.
2. Open **Mission Control** and read the trail, newest first: `codex-reviewer → claude-dev`,
   then `claude-dev → agy-planner`. Press `Esc`.

**You should see:** `08-fixes-done.webp`. Mission Control's trail with both entries
Completed, the newest at the top.

**Must match**

- `claude-dev`'s last line is `FIXES DONE`.
- The trail's two entries, in that order, both Completed.

**May differ**

- What `claude-dev` changed, if anything: with `VERDICT: APPROVED` it may report no
  changes.
- The time stamps.

### 9. Check it worked

The check-it-worked step hands the learner the tests none of the agents saw.

**Do**

1. Download `polyglot-trio-check.zip` from this page and unzip it into the project folder,
   so `check/` sits beside `src/`.
2. Press `Ctrl+B 5` to focus `test-runner`.

**Paste into `test-runner`**

```text
npx vitest run check; node src/cli.ts samples/orders.csv; Get-Content review.md -TotalCount 1; git status --short
```

**You should see:** `09-check.webp`. Vitest with 6 passed, the JSON for `orders.csv`, the
verdict line, then `git status --short`.

**Must match**

- `Tests  6 passed`.
- The JSON matches the end of `SPEC.md`, line for line.
- The verdict line starts `VERDICT:`.
- `git status --short` lists `?? PLAN.md`, `?? check/` and `?? review.md`, and every other
  line is under `src/` or `test/`.

**May differ**

- Timings; which files under `src/` and `test/` changed.

**If not: some check tests fail.** A rule slipped past the plan, the build and the review.
The failing test's name says which rule. Paste into `codex-reviewer`:
`A check test for SPEC.md rule <n> fails. Re-review src/ for that rule, add a finding to review.md, and send claude-dev the same message as before.`
Wait for `FIXES DONE` in `claude-dev`, then repeat this step.

**You're done when**

- `agy-planner` wrote `PLAN.md` and answered `claude-dev` with `PLAN READY`.
- `codex-reviewer` wrote `review.md`, starting `VERDICT:`, and messaged `claude-dev`.
- The check suite passes: 6 passed, and the CLI prints the JSON `SPEC.md` gives.
- Mission Control's trail shows both entries Completed.

**Next up:** Swarm 10, Parallel experiments with worktrees.

## Screenshot list

| File | Shows |
| --- | --- |
| `01-starter-installed.webp` | `shell`: Starter commit, install, 1 passed and 8 todo |
| `02-trio-launched.webp` | 2x2 grid of three CLIs and the test shell, three banners |
| `03-team-levels.webp` | Mission Control: three agents, Responder tag on `agy-planner` |
| `04-plan-written.webp` | `agy-planner` ending `PLAN.md written` |
| `05-planner-answers.webp` | the waited question in `agy-planner`, `claude-dev` quoting `PLAN READY` |
| `05-planner-answers.mp4` | clip: question lands, Antigravity answers, reply returns |
| `06-build-done.webp` | `claude-dev` ending `BUILD DONE` |
| `07-review-sent.webp` | `codex-reviewer`'s verdict and send; `claude-dev` Working on the message |
| `08-fixes-done.webp` | Mission Control trail, both entries Completed |
| `09-check.webp` | `test-runner`: check suite 6 passed, JSON, verdict line, git status |

Nine step cards, nine screenshots, one clip. Recordings: `claude-dev` (Claude),
`agy-planner` (Antigravity) and `codex-reviewer` (Codex) for the whole run, with step
markers, plus the `test-runner` cast. This is the first recording of Antigravity, and the
first in which a replayed non-Claude CLI calls a `quay_*` tool.

## Code it depends on

From the bus build in [Decide: How do non-Claude agents join the A2A bus?](https://github.com/seanrobertwright/Quay-2/issues/12),
as amended by [Decide: What does the live test change in the bus design?](https://github.com/seanrobertwright/Quay-2/issues/54):

- The responder level: Antigravity's decoded OSC 7501 `done` text as the `wait_for_reply`
  answer, a `blocked` turn returning its kind and message, the Responder tag in Mission
  Control, and the level in `quay_list_agents` (steps 3 and 5).
- Antigravity's status read from OSC 7501, so its badge goes Working and Idle (steps 4
  and 5).
- Codex launched with the four `QUAY_*` variables, the `-c mcp_servers.quay.*` overrides
  with `default_tools_approval_mode="approve"`, and the `notify` turn-end sidecar that drops
  subagent payloads (step 7: Codex calls `quay_send_message` without a prompt; its badge
  returns to Idle).
- The `starting` status gap noted on A2A 10: a full peer that reports no session start is
  set Idle on first output, so `codex-reviewer` isn't left at `starting`.
- The Polyglot Trio description from the live-test decision in `BUILTIN_SWARM_PRESETS`
  (step 2).

From the launch-prompt decision: launch prompts for `claude-dev` and `codex-reviewer`, the
launcher's "no launch prompt" note on the `agy-planner` row, and the team briefing naming
each teammate's level (new, above).

From earlier outlines: Mission Control's name, the trail newest first and named targets
(A2A 1); the shared teammate clause in role prompts (A2A 3); the plugin hint (event-bridge
decision); `git init -b main` in step 1 (Swarm 10); the PowerShell Console label (A2A 4).

Verified in code on master: `polyglot-trio` is a `grid` preset whose agents are, in order,
`claude-dev` (claude), `agy-planner` (antigravity), `codex-reviewer` (codex) and
`test-runner` (powershell); `launchSwarm` spawns them in that order and puts exactly those
four in the grid, top-left to bottom-right, leaving earlier terminals in the rail;
`RunKind::Antigravity` spawns `agy.exe` with `--dangerously-skip-permissions` in Skip mode;
`Ctrl+B` followed by a digit focuses that terminal in rail order, up to 9.

## Open questions

1. **Who plans, and how the role arrives.** This draft has the learner paste
   `agy-planner`'s role and job as one message, and the preset carries no role prompt for
   it. The alternative is a code change (a Copy role prompt button on rows that get none,
   or typing the role into the pane after launch), which the role-prompt decision rejected
   for every CLI. Proposed: the page paste, no code.
2. **The team briefing names levels.** Proposed above as a new input to the launch-prompt
   build. Without it, `claude-dev` would have to be told in each prompt that `agy-planner`
   only answers when asked. Accept, or leave the briefing as decided and put the level in
   step 5's paste?
3. **Codex as sender.** This draft has `codex-reviewer` start the conversation, so each of
   the three agents shows its level, and A2A 10 (Codex on the receiving end, polled through
   a file mailbox) stays distinct. The alternative mirrors A2A 10 here: `claude-dev` sends
   the review job and polls. Proposed: Codex sends.
4. **Antigravity's plan review in Skip mode.** The CLI research found that
   `--dangerously-skip-permissions` covers tool prompts only, and plans "wait for review
   again". Untested: whether asking `agy-planner` to write `PLAN.md` stops for Antigravity's
   own plan review, and what OSC 7501 state it shows while it waits. Proposed: step 4's If
   not covers it, and the maintainer checks it on the first test run; no new task ticket.
   If it stops every time, step 4 gains a Do line instead of an If not.
5. **The responder question is a check, not a need.** Step 5 exists to show a responder
   answering; `claude-dev` could read `PLAN.md` without asking. Proposed: keep it, framed
   as the implementer confirming the hand-over before starting, with a checkable
   `PLAN READY` line.
6. **The starter has no planted defects.** Unlike A2A 10, Codex reviews code Claude just
   wrote, so the verdict varies and `VERDICT: APPROVED` is a valid run. The check suite is
   the referee and Must match never names a finding. The alternative is planting defects in
   a half-built starter, which fights the plan-then-build story. Proposed: no planted
   defects; the check suite's fixtures aim at rules builders commonly miss (BOM, line
   numbers after a quoted line break, quoted empty strings).
7. **Clip.** Step 5, the responder round trip, which needs the Antigravity recording to
   replay with timing. Fallback: step 7, the message landing in `claude-dev` and the two
   badges trading places, which needs only the Codex and Claude recordings.
8. **Level and size.** Advanced: three CLIs, three accounts, messages in both directions.
   Nine step cards, nine screenshots, one clip.
9. **Antigravity install line.** The research has the CLI's version, launch flags and MCP
   commands but not its install and sign-in commands. Proposed: the shared Before-you-start
   page takes them from Google's Antigravity CLI docs when the page is written; no research
   ticket now.
10. **A Codex launch failure means relaunching the whole swarm.** Relaunching one pane
    doesn't resend its launch prompt (role-prompt decision), so step 2's If not closes all
    four. Accept, or let the learner relaunch only `codex-reviewer` and paste its role by
    hand like `agy-planner`'s?
