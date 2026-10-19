# Outline: A2A 4, Review gate before commit

Prototype outline for the ticket "Tutorial outline: A2A 4, Review gate before commit".
A rough take to react to, not the tutorial. Open questions are at the end.

Slug `review-gate`. Page `docs/tutorials/a2a/review-gate/index.md`. Starter `examples/tutorials/review-gate/starter/`. No check suite.

This outline describes the app after the fix-first work: replies resolve only on a main-loop turn that starts after delivery, the bridge checks tokens, the plugin hint exists, and terminals keep creation order.

## The lesson in one paragraph

A `developer` agent builds a rate limiter, stages it, and asks a `reviewer` agent to review it over the bus. It waits for the reply. If the reply's last line is `CHANGES REQUESTED`, it fixes the findings and asks again. When the last line is exactly `APPROVED`, it commits. The learner pastes two prompts into `developer` and watches the loop run on its own.

## How the diff travels

This is the design choice the whole tutorial rests on.

- **Not in the message.** Quay flattens newlines when it types a message into a terminal. A `git diff` sent as message text arrives as one long line with every `+` and `-` run together, and a real diff would also flood the reviewer's prompt. So the diff never goes in a message.
- **By reference, through git.** Both agents share the project folder. The developer stages its work with `git add -A`, then sends a one-line message: `Review round 1: run git diff --cached against your checklist.` The reviewer runs `git diff --cached` itself and reads the real diff, newlines and all.
- **Staged, not working tree.** `git diff` alone leaves out new untracked files. Staging everything first means the reviewer sees exactly what the commit will hold.
- **The verdict comes back as a reply.** The reviewer's answer is short (at most eight lines) and its turn is bounded: one git command, no tests, no edits. That fits inside the 60 seconds `wait_for_reply` waits. The reply keeps its newlines, because it travels back as the `answer` field of the reviewer's `turn.completed` event, not typed into a terminal. So the developer can check its last line.
- **If the reply runs out of time.** `quay_send_message` returns `Peer agent (...) received the task but is still working.` instead of a verdict. The developer's prompt tells it what to do: call `quay_get_agent_status` for `reviewer` until it shows Idle, then ask it to repeat its last verdict, which is a quick turn.

## The page, top to bottom

**Title:** A2A 4: Review gate before commit

**Pitch:** One Claude Code agent writes a rate limiter. A second Claude Code agent reviews every change before it can be committed. You start the loop with one prompt, and the two agents go back and forth over Quay's A2A bus until the reviewer's reply ends in `APPROVED`.

**Tiles:** Time and Tokens are generated from test runs. Agents: 2 × Claude + 1 PowerShell shell. Level: Intermediate.

**You'll learn:** asking a peer for a verdict with `quay_send_message` and `wait_for_reply`, why a fixed last line makes a verdict checkable, passing work between agents by reference (staged changes in git) instead of pasting it into a message, what to do when a reply outlasts its 60 seconds, and reading a back-and-forth in Mission Control's message trail.

**Before you start** (all on the shared Before-you-start page, linked):

- Quay 2 installed.
- Claude Code 2.1.296 or later, signed in.
- The event-bridge plugin 0.1.0 or later. Without it a Claude pane can't answer a waiting peer, and this whole tutorial is waiting peers.
- Node 24 or later, Git (with `user.name` and `user.email` set, because an agent commits), PowerShell 7.
- A2A 1 done, or at least read: this page assumes you know what a peer message looks like in a pane.

Note for the page: both Claude terminals run in Skip mode, the New Terminal default, so they run `git` and edit files without asking. That is why the starter is a throwaway folder.

## The starter project

A small TypeScript library with the rate limiter's contract written and four red tests. The parts the reviewer will ask for are deliberately not in the tests.

```text
starter/
  package.json          name review-gate, "type": "module", "engines": { "node": ">=24" }
                        scripts: test "vitest run", typecheck "tsc --noEmit"
                        devDependencies: vitest, typescript (exact versions, no ^)
  package-lock.json
  tsconfig.json         strict, erasableSyntaxOnly, noEmit, module/moduleResolution nodenext,
                        allowImportingTsExtensions
  .gitignore            node_modules/
  README.md             the goal in two sentences; points at AGENTS.md
  AGENTS.md             see below
  CLAUDE.md             @AGENTS.md
  CHANGELOG.md          "# Changelog", an empty "## Unreleased" heading, and "## 0.1.0" with "- Project skeleton."
  src/limiter.ts        the contract, unimplemented (see below)
  test/limiter.test.ts  four visible tests, all red
```

**The contract (`src/limiter.ts`).**

```ts
export type LimiterOptions = { limit: number; windowMs: number; now: () => number };
export type Decision = { allowed: boolean; remaining: number; retryAfterMs: number };
export type Limiter = { check(key: string): Decision };

export function createLimiter(options: LimiterOptions): Limiter {
  throw new Error("not implemented");
}
```

The clock is a required option, so tests drive time with a plain variable and nothing waits on a real timer.

**The visible tests (`test/limiter.test.ts`).** Four tests, each with `let t = 0; const now = () => t;`, `limit: 3`, `windowMs: 1000`.

1. The first three checks for one key are allowed, with `remaining` 2, 1, then 0.
2. The fourth check in the same window is refused, with `retryAfterMs` equal to the time left in the window.
3. Two keys never affect each other.
4. A check at `t = 1500` (well past the window) is allowed again, with `remaining` back to 2.

Not tested on purpose: a check at exactly `t = 1000`. `AGENTS.md` says that one opens a new window, so `>` against `>=` is a real off-by-one the review can catch.

**CI expected state:** `npm ci` and `npx tsc --noEmit` pass; `npm test` is red, 4 of 4 failing. Same per-starter expected state as Swarm 1 and Swarm 3.

**`AGENTS.md`**, in full-ish:

- Goal: `createLimiter` is a fixed-window rate limiter, one window per key.
- Rules:
  1. A key's window opens at its first check and lasts `windowMs`. A check made `windowMs` or more after the window opened starts a new window.
  2. In a window, the first `limit` checks are allowed and every later one is refused.
  3. `remaining` is how many more checks this window allows after this one, never below 0.
  4. `retryAfterMs` is 0 when allowed, otherwise the milliseconds until the window ends.
  5. Keys never affect each other.
  6. Time comes only from `options.now()`.
- Commands: `npm test`, `npm run typecheck`.
- House rules: npm only, no new dependencies, no `enum` or `namespace`, keep the exported types in `src/limiter.ts` unchanged.
- Not mentioned: the CHANGELOG rule and the review checklist. Those live in the reviewer's briefing (step 3), so the first review round has something to find.

## Steps

### 1. Get the starter project

**Do**

1. Download `review-gate.zip` from this page and unzip it into a new, empty folder, for example `C:\tutorials\review-gate`.
2. In Quay, click **Add Project Workspace** in the rail and pick that folder.
3. Press `Ctrl+B N`, choose **PowerShell Console**, type `shell` as the **Terminal Label**, and click **Start Terminal**.

**Paste into `shell`**

```text
git init; git add -A; git commit -m Starter; npm install
```

One sentence on the files: `src/limiter.ts` is the contract the developer fills in, `test/` holds four tests that fail until it does, and `CHANGELOG.md` is the release log.

**You should see:** `01-starter-installed.webp`. The `shell` pane after `npm install`, the project in the rail.

**Must match**

- `git commit` reports the message `Starter`.
- `npm install` ends with `added` and a package count, no errors.

**May differ**

- The package count and timings.

**If not: `node` or `npm` is not recognised.** Node 24 or later isn't on your PATH. Install it from the Before-you-start page, then close and reopen Quay.

### 2. Start the developer and the reviewer

**Do**

1. Press `Ctrl+B G` for the 2x2 grid. `shell` sits in the top-left cell and the other three are empty.
2. Press `Ctrl+B N`, choose **Claude**, leave **Permission Mode** on **Skip Permissions (Default)**, type `developer` as the **Terminal Label**, and click **Start Terminal**. It opens in the top-right cell.
3. Press `Ctrl+B N` again, choose **Claude**, label it `reviewer`, and click **Start Terminal**. It opens bottom-left.
4. Wait until both Claude panes show Claude Code's prompt and their badges say Idle.

**You should see:** `02-agents-ready.webp`. A 2x2 grid: `shell` top-left, `developer` top-right, `reviewer` bottom-left, the last cell empty. Both Claude badges Idle.

**Must match**

- Two Claude panes labelled `developer` and `reviewer`, both Idle.

**May differ**

- The port number in the rail header.
- How long each pane takes to start.

**If not: a Claude pane shows a one-line plugin hint.** The event-bridge plugin is missing. Click **Copy** on the hint, paste the install line into that pane, then type `/reload-plugins`. The hint clears on its own.

**If not: a badge stays on Unknown.** Quay hasn't heard from that pane's plugin, so it counts as a listener and can't reply. Fix the plugin as above before going on: a reviewer that can't reply can't approve anything.

### 3. Brief the reviewer

**Paste into `reviewer`**

```text
You are the reviewer for this project. You never edit, stage or commit files, and you never message anyone: you answer in your reply. When a peer agent asks for a review, run git diff --cached and review only that staged diff against this checklist: 1. every rule in AGENTS.md has a test, including a check made exactly windowMs after a key's first check being allowed; 2. src/ reads the time only through options.now, never Date.now() or new Date(); 3. CHANGELOG.md gains a line under Unreleased that describes the change; 4. package.json is unchanged. Do not run tests or read other files. Reply in at most eight lines: a numbered list of the checklist items that fail and why, then a last line that is exactly APPROVED if none fail, or exactly CHANGES REQUESTED if any do. For now, reply with one line: Ready to review.
```

**You should see:** `03-reviewer-briefed.webp`. The `reviewer` pane's one-line answer.

**Must match**

- The reply is `Ready to review.`
- No file changed.

**May differ**

- Nothing else: the reply is one fixed line.

### 4. The developer builds the limiter

**Paste into `developer`**

```text
Read AGENTS.md. Implement createLimiter in src/limiter.ts so that npm test passes, without changing the exported types. Do not stage or commit anything yet. Tell me when npm test passes.
```

**You should see:** `04-tests-green.webp`. The `developer` pane reporting `npm test` passing; its badge back to Idle.

**Must match**

- `developer` reports `npm test` passing.
- Nothing is staged or committed yet.

**May differ**

- How it writes the limiter.
- Whether it adds tests of its own, so the test count may be more than 4.
- The agents' wording.

**If not: the developer committed.** Paste into `shell`: `git reset --soft HEAD~1`, which undoes the commit and keeps the changes. Then go on.

### 5. Run the review gate

This is the lesson. One prompt starts a loop the two agents run without you.

**Paste into `developer`**

```text
Now pass the review gate. Stage everything with git add -A, then call quay_send_message with target_terminal_id reviewer, wait_for_reply true, and the message: Review round 1: run git diff --cached against your checklist. Never put the diff itself in a message; the reviewer reads it from git. If the reply's last line is CHANGES REQUESTED, fix every finding, run npm test until it passes, stage again and send the same message with the next round number. If a reply has no verdict as its last line, call quay_get_agent_status for reviewer until its status is Idle, then ask it to repeat its last verdict. Stop and tell me if round 4 is not approved. As soon as a reply's last line is exactly APPROVED, commit with git commit -m "feat: add fixed-window rate limiter" and make no other change first. Then tell me the commit hash and how many rounds it took.
```

**Do**

1. Watch `reviewer`. The message lands as `[Peer agent (developer)]: Review round 1: ...`, the badge flips to Working, and it runs `git diff --cached`.
2. Watch `developer`. Its tool call returns `Reply from reviewer:` with the verdict, and it starts fixing.

**You should see:** `05-round-one-verdict.webp`. `reviewer` ends round 1 with a short numbered list and `CHANGES REQUESTED`; `developer` shows `Reply from reviewer:` with the same text and is Working on the fixes.

**Must match**

- The message in `reviewer` is one line starting `[Peer agent (developer)]: Review round 1`.
- The reviewer's reply ends with `CHANGES REQUESTED` or `APPROVED` as its own last line.
- `developer` shows `Reply from reviewer:`.

**May differ**

- The findings, and how many there are. Round 1 usually flags the missing CHANGELOG line and the missing exact-edge test.
- How long the review takes (up to 60 seconds).

**If not: the message in `reviewer` is one enormous line full of `+` and `-`.** The developer pasted the diff into the message, and Quay flattened its newlines. Press `Esc` in `reviewer` to stop that turn, then paste into `developer`: `Do not send the diff. Send only the round message and let the reviewer run git diff --cached itself, then carry on with the gate.`

**If not: `developer` says the reviewer is still working and stops.** The review took longer than 60 seconds. Wait until `reviewer` shows Idle, then paste into `developer`: `The reviewer is Idle now. Ask it to repeat its last verdict and carry on with the gate.`

**If not: the reviewer edits or stages a file.** Paste into `reviewer`: `You never edit or stage files. Undo what you just changed, then wait for the next review request.`

### 6. Watch the gate close in Mission Control

**Do**

1. While the loop runs, click the **A2A Orchestration Bus** button at the bottom of the rail (or press `Ctrl+K` and choose **Agent-to-Agent (A2A) Bus**).
2. Read the **Live A2A Message Trail**. Each round is one `developer → reviewer` entry: the message, its status, and the reviewer's reply under **Reply:**.
3. Stay until the last entry turns **Completed** with a reply ending `APPROVED`, then close the panel with the **X** in its top-right corner.

**You should see:** `06-trail-approved.webp`. The trail with two `developer → reviewer` entries: round 1 Completed, reply ending `CHANGES REQUESTED`; round 2 Completed, reply ending `APPROVED`.
Clip: `06-trail-approved.mp4`. The round 2 entry flipping from Working to Completed as the reply ending `APPROVED` appears under it. Caption describes that motion.

**Must match**

- Every entry is `developer → reviewer`.
- Every reply but the last ends `CHANGES REQUESTED`; the last ends `APPROVED`.
- No entry says Failed.

**May differ**

- The number of rounds (usually two, at most four).
- The findings in each reply.
- The times beside each entry.

**If not: there is only one entry, and it says APPROVED.** The developer got every checklist item right first time. The gate still did its job; carry on.

**If not: an entry says Failed.** That round outlasted the 60-second wait. If the developer recovered (a later entry asks it to repeat its verdict), carry on. If it stopped, use the second If not from step 5.

### 7. Check it worked

**Do**

1. Wait until `developer` reports the commit hash and the round count.
2. Click into `shell`.

**Paste into `shell`**

```text
npm test; git log --oneline; git show --stat --format= HEAD; git status --short
```

**You should see:** `07-committed.webp`. The full grid: `developer` ends with the commit hash and the round count; `shell` shows the tests passing, two commits, the files in the last commit, and a clean `git status`.

**Must match**

- `npm test` passes, with more than 4 tests.
- `git log --oneline` lists exactly two commits: `feat: add fixed-window rate limiter` on top, then `Starter`.
- The last commit changes `CHANGELOG.md`, `src/limiter.ts` and `test/limiter.test.ts`, and nothing else.
- `git status --short` prints nothing.

**May differ**

- The commit hash, the test count and line counts.

**If not: `git log` shows only `Starter`.** The developer stopped before committing. Read its last message: if round 4 was not approved, paste step 5's prompt again.

**You're done when**

- The reviewer's last reply in Mission Control ends with `APPROVED`, and no reply before it does.
- `git log --oneline` shows the `feat: add fixed-window rate limiter` commit on top of `Starter`.
- That commit touches `CHANGELOG.md`, `src/limiter.ts` and `test/limiter.test.ts` only.
- `npm test` passes and `git status --short` is empty.

**Next up:** A2A 5, Fan-out / fan-in.

## Screenshot list

All full-window captures of Quay unless noted. Names are the step markers.

| File | Shows | Must-match anchors |
| --- | --- | --- |
| `01-starter-installed.webp` | `shell` pane after `npm install`, project in the rail | `Starter` commit line, `added` line |
| `02-agents-ready.webp` | 2x2 grid, `shell`, `developer`, `reviewer`, one empty cell | two Idle badges, pane labels |
| `03-reviewer-briefed.webp` | `reviewer` pane (pane crop) | `Ready to review.` |
| `04-tests-green.webp` | `developer` pane (pane crop) | `npm test` passing |
| `05-round-one-verdict.webp` | `reviewer` and `developer` mid-loop | `[Peer agent (developer)]: Review round 1`, `CHANGES REQUESTED`, `Reply from reviewer:` |
| `06-trail-approved.webp` | Mission Control, message trail | two entries, Completed, last reply `APPROVED` |
| `07-committed.webp` | Full grid at the end | commit hash in `developer`, two-commit log in `shell` |

**Clip:** `06-trail-approved.mp4`, the round 2 trail entry turning from Working to Completed with its `APPROVED` reply. Mission Control is Quay's own motion, and the flip is a sequence a still can't show. Trimmed to the few seconds around the flip, well under ten. It needs the replayed bridge calls at their recorded offsets, which the replay decision provides.

**Fixture recording:** one whole run, three terminals (two Claude casts with their bridge logs, one PowerShell cast), markers 01 to 07. The round count in the recording sets the screenshot; the page's May differ covers other counts.

## Open questions, in order

1. **How the diff travels.** This draft sends it by reference: the developer stages with `git add -A` and the one-line message says `run git diff --cached`, so the reviewer reads the real diff from the shared folder. A diff in the message would arrive flattened to one line. Alternative: a file mailbox, with the developer writing `review/diff.patch` for the reviewer to read. Proposed: by reference through the staging area, with the flattening shown once as an If not in step 5.
2. **Reply or file mailbox for the verdict.** This draft uses a reply with `wait_for_reply`, because the review is bounded (one git command, no tests, no edits, at most eight lines) and fits the 60 seconds. The prompt carries the fallback: poll `quay_get_agent_status` until Idle, then ask for the verdict again. Alternative: the reviewer writes its verdict to a file mailbox every round, which is A2A 6's lesson. Proposed: reply.
3. **Making round 1 find something.** The checklist lives in the reviewer's briefing paste, not in the starter, and asks for a CHANGELOG line and an exact-edge test that the developer's prompt never mentions. So round 1 almost always ends `CHANGES REQUESTED` and the learner sees the loop turn. Alternative: ship the checklist as `REVIEW.md` in the starter, which is more realistic but lets the developer read it and pass first time. Proposed: in the paste, with Must match allowing a first-time `APPROVED`.
4. **Is the gate enforced, or only prompted?** In this draft only the developer's prompt stops it committing early. Alternative: the starter ships a pre-commit hook (via `core.hooksPath`) that refuses a commit unless `.review/approved` holds the staged tree's hash, written by the reviewer on approval. Proposed: no hook. The tutorial teaches the A2A loop, not git hooks, and the check step confirms the commit came after the `APPROVED` reply.
5. **Layout.** This draft uses the 2x2 grid with `shell`, `developer` and `reviewer` visible and one empty cell, built with `Ctrl+B G` and then `Ctrl+B N` twice (a new terminal fills the first empty cell). Alternative: a side-by-side split of the two agents with `shell` hidden behind one of them. Proposed: the grid, so the learner can watch both agents and run the check without switching.
6. **New code gap: a late reply is lost.** When a reply outlasts the 60-second wait, the trail entry is marked Failed with `Timed out waiting for reply`. When the reviewer then answers, nothing updates that entry: the waiter has gone, and the reply only matches an entry that is still Working. The verdict exists only in the reviewer's pane. Proposed: join the fix-first list. A late reply is recorded on its trail entry, still not returned to the sender, built with the wrong-replies fix since both touch how a waiter resolves.
7. **New code gap: the trail reorders itself.** Mission Control prepends each live update to the top of the trail, but its three-second reload replaces the list in send order, oldest first. A new entry appears at the top, then jumps to the bottom. That would spoil this tutorial's clip and confuse anyone reading the rounds. Proposed: join the fix-first list. One order, oldest first as the bridge stores it, with the trail scrolled to the newest entry.
8. **Mission Control's own words.** The map calls the panel Mission Control. On screen it is the **A2A Orchestration Bus** (rail button and panel title), the command palette says **Agent-to-Agent (A2A) Bus**, and "Mission Control" names only the rail's bottom toolbar in code. The panel's banner also says every Claude, Antigravity or Codex terminal gets the `quay` MCP server, which the bus decision makes false for listeners, and its close button's tooltip promises `Esc`, which does nothing. Proposed: Do slots use the on-screen labels; the banner text and an `Esc` handler join the fix-first list with the Listener tag build; one name is settled across the A2A outlines and added to the glossary.
9. **Level and check suite.** Intermediate: two agents run a loop on their own, and the learner reads a message trail. No check suite: the reviewer's checklist is the gate and the agents' tests are the check. Proposed: as drafted.
