# Outline: A2A 7, Broadcast coordination

Prototype outline for [Tutorial outline: A2A 7, Broadcast coordination](https://github.com/seanrobertwright/Quay-2/issues/32).
A rough take to react to, not the tutorial. It follows the step-card template from
[Prototype: Tutorial page template](https://github.com/seanrobertwright/Quay-2/issues/10). Open questions are at the end.

Slug `broadcast`. Page `docs/tutorials/a2a/broadcast/index.md`. Starter `examples/tutorials/broadcast/starter/`.

## How `quay_broadcast` really works

Checked in code before drafting, because the tutorial leans on every detail.

- **One argument.** The tool's input schema in `handle_mcp_request` takes `text` and nothing else. There is no
  recipient list, priority or severity field. "Critical" can only be a word in the text.
- **Recipients.** `A2ARouter::broadcast_toast` sends to every terminal in `PtyManager::list` whose
  `run_kind.is_agent()` is true and whose status is not Exited. That is every agent terminal in every project, the
  sender included. Shell panes get nothing.
- **Delivery.** Each recipient gets one line typed into its terminal: `[Broadcast Notice]: <text>`, with newlines
  flattened to spaces. Quay sets its status to Working.
- **No reply path.** The sender doesn't wait. It gets back only `Broadcasted notice to all active agents: <text>`.
  Each recipient gets its own trail entry, from `Broadcast` to that agent, status Dispatched. When that agent's next
  turn ends, `resolve_pending_reply` marks the newest Dispatched entry for it Completed and stores the turn's answer
  as its Reply. So the trail shows each agent's reaction, but the sender never sees it.
- **On screen.** The `a2a-toast` event shows a green "Swarm Broadcast" toast for seven seconds (`A2AToast`), a
  "Swarm Broadcast" banner on each agent pane for ten seconds (`TerminalView`), and "Broadcast: <text>" on each agent's
  rail row for nine seconds (`TerminalRow`). A pass and a critical failure look the same.
- **What other agents do on a freeze.** Nothing built in. Quay has no freeze state. Each agent does what its role
  prompt and `AGENTS.md` tell it to do with a `[Broadcast Notice]:` line. So the starter's `AGENTS.md` carries a
  Release protocol, and that protocol is the real lesson.

## The page, top to bottom

**Title:** A2A 7: Broadcast coordination

**Pitch:** One agent, one message, the whole team. A `release-captain` agent announces a code freeze with
`quay_broadcast`, bumps the version, writes the CHANGELOG entry and runs the tests. A teammate's late commit breaks
the first release, so the captain broadcasts a critical failure and the freeze holds. You revert the commit, the
captain runs the release again, and its pass broadcast lifts the freeze.

**Tiles:** Time and Tokens generated from test runs. Agents: 3 x Claude + 1 shell. Level: Intermediate.

**You'll learn:**

- what a broadcast is: one line typed into every agent terminal at once, with no reply;
- why broadcast text needs a fixed one-line keyword (`FREEZE`, `RELEASE PASS`, `RELEASE FAIL CRITICAL`);
- how a team protocol in `AGENTS.md` turns a notice into behaviour;
- how to read a broadcast's fan-out in the Mission Control message trail.

**What you already know** (from earlier A2A tutorials, linked): the four `quay_*` tools, the message trail and the
toasts. This page uses only `quay_broadcast`, on purpose.

**Before you start:** the shared Before-you-start page (Quay installed; Claude Code 2.1.296+ signed in;
`event-bridge` 0.1.0+; PowerShell 7; Node 24+, npm and Git). One extra line: close agent terminals in other
projects first, because a broadcast reaches every agent in Quay (see open question 2).

## The starter project: `broadcast`

A tiny price-formatting library with a CLI, ready to ship as v1.3.0. Its tests pass. A patch file holds a
teammate's "late change" that breaks exactly one test, so the learner can force the critical-failure path on demand.

```text
starter/
  package.json          name pricetag, version 1.2.0, "type": "module", exact versions, engines node >=24
                        scripts: test = "vitest run", typecheck = "tsc --noEmit"
  package-lock.json
  tsconfig.json         strict, erasableSyntaxOnly, noEmit, module/moduleResolution nodenext
  .gitattributes        * text=auto eol=lf, so the patch applies on Windows
  .gitignore            node_modules/
  README.md             the goal and the CLI usage
  AGENTS.md             goal, commands, ownership, house rules, and the Release protocol (below)
  CLAUDE.md             @AGENTS.md
  CHANGELOG.md          Keep a Changelog format: ## [Unreleased] with two entries, then ## [1.2.0] and ## [1.1.0], dated
  src/price.ts          export function formatPrice(cents: number, currency: "USD" | "EUR"): string
  src/cli.ts            node src/cli.ts <cents> [USD|EUR] prints the price; --version prints package.json's version
  test/price.test.ts    the price tests
  test/release.test.ts  the release tests
  patches/late-change.patch   one hunk in src/price.ts: drops the zero padding on cents
```

**The tests.**

`test/price.test.ts`:

1. formats dollars: `formatPrice(1999, "USD")` is `$19.99`.
2. pads cents under ten with a zero: `formatPrice(5, "USD")` is `$0.05`. The late change breaks this one.
3. formats euros: `formatPrice(1999, "EUR")` is `19,99 €`.
4. keeps the minus sign first: `formatPrice(-250, "USD")` is `-$2.50`.
5. rejects fractional cents: `formatPrice(1.5, "USD")` throws.

`test/release.test.ts`:

1. the version in `package.json` matches the newest version heading in `CHANGELOG.md`.
2. `CHANGELOG.md` has an `## [Unreleased]` section above the newest version.
3. every version heading has a date in `YYYY-MM-DD` form.

The release tests pass on the starter (1.2.0 in both files) and fail if the captain bumps one file and not the other.

**`CHANGELOG.md` Unreleased section in the starter:**

```markdown
## [Unreleased]

### Added

- `EUR` currency in `formatPrice` and the CLI.

### Fixed

- Negative amounts keep the minus sign before the currency symbol.
```

**`AGENTS.md`, Release protocol section, in full-ish:**

- Broadcasts arrive in your terminal as one line starting `[Broadcast Notice]:`. Nobody is waiting for your reply.
  Write it for the human watching your pane.
- `FREEZE v<version>`: stop editing files now. End your reply with the line `FROZEN`. Until a `RELEASE PASS` notice
  arrives, refuse every request to edit a file and reply `FROZEN`.
- `RELEASE FAIL CRITICAL v<version>: <test>`: nothing was released and the freeze stays on. If the failing test covers
  files you own, find the cause without editing anything (`git log`, `git show`) and reply with one line starting
  `CAUSE:` that names the commit and the file. Otherwise end your reply with `STILL FROZEN`.
- `RELEASE PASS v<version>`: the freeze is lifted. End your reply with `THAWED`.
- Release Captain steps, in order. Every broadcast is a single line, because Quay flattens newlines:
  1. `quay_broadcast` with `FREEZE v<version>: release in progress. Do not edit files until RELEASE PASS.`
  2. `npm version <version> --no-git-tag-version`, then move the Unreleased entries in `CHANGELOG.md` under
     `## [<version>] - <today>` and leave an empty `## [Unreleased]` above it.
  3. `npm test`.
  4. All passed: `git commit -am "Release v<version>"`, `git tag v<version>`, then `quay_broadcast` with
     `RELEASE PASS v<version>: all tests passed, tagged v<version>. Freeze lifted.`
  5. Anything failed: `git restore package.json package-lock.json CHANGELOG.md`, then `quay_broadcast` with
     `RELEASE FAIL CRITICAL v<version>: <first failing test name>. Nothing released. Freeze stays on.`
  6. Never fix a failing test yourself.

**Ownership:** `release-captain` owns `package.json`, `package-lock.json`, `CHANGELOG.md`, the release commit and the
tag. `feature-dev` owns `src/` and `test/`. `docs-writer` owns `README.md`. House rules as every starter: npm only,
no new dependencies, no `enum` or `namespace`.

**Starters CI expects:** `npm ci` and `npx tsc --noEmit` clean, tests **green**. A second job applies
`patches/late-change.patch` and expects exactly one failing test, "pads cents under ten with a zero", so the forced
failure stays deterministic. No check suite.

## Steps

### 1. Get the starter project

- **Do:** the standard step 1 for `broadcast.zip`, then add the folder to Quay.
- **You should see:** `01-project-added.webp`. The project in the rail, empty stage.

### 2. Build the Release Crew

- **Do:** press `Ctrl+B S`, click **Create Custom Swarm**. Name it `Release Crew`. Pick **2x2 Quad Grid**.
  Click **Add Agent** until there are four rows. Fill them in:

  | Row | CLI | Role | Session name |
  | --- | --- | --- | --- |
  | 1 | Claude Code | Release Captain | `release-captain` |
  | 2 | Claude Code | Feature Developer | `feature-dev` |
  | 3 | Claude Code | Docs Writer | `docs-writer` |
  | 4 | PowerShell | Shell | `shell` |

- **Paste into row 1's Role prompt:** `You are the Release Captain. You own package.json, package-lock.json, CHANGELOG.md, the release commit and the tag. You leave src/, test/ and README.md to your teammates and never fix a failing test yourself. You work by following the Release Captain steps in AGENTS.md exactly, sending each broadcast as one line with quay_broadcast, and then stopping to wait.`
- **Paste into row 2's Role prompt:** `You are the Feature Developer. You own src/ and test/. You leave package.json, CHANGELOG.md and README.md alone. You work by obeying every Broadcast Notice under the Release protocol in AGENTS.md before any other request: during a freeze you edit nothing and answer FROZEN, and when a critical failure names a test in your files you find its cause read-only and answer with one CAUSE: line.`
- **Paste into row 3's Role prompt:** `You are the Docs Writer. You own README.md. You leave src/, test/, package.json and CHANGELOG.md alone. You work by obeying every Broadcast Notice under the Release protocol in AGENTS.md before any other request: during a freeze you edit nothing and answer FROZEN.`
- **You should see:** `02-crew-builder.webp`. The builder with four rows, three Claude Code and one PowerShell,
  and the grid layout selected.
- **Must match:** the session names; "Spawns 4 terminals" in the footer.
- **If not: row 2 still says Antigravity CLI.** Change it to Claude Code. Antigravity is a listener: it gets the
  broadcast but can't follow the protocol.

### 3. Launch the crew

- **Do:** click **Launch Swarm Now**.
- **You should see:** `03-crew-launched.webp`. Four panes: `release-captain` top left, `feature-dev` top right,
  `docs-writer` bottom left, `shell` bottom right. Each Claude agent has confirmed its role and is waiting.
- **Must match:** the pane positions; each Claude agent's first line names its role.
- **May differ:** the wording of each acknowledgement; the port badge.
- **If not: a pane shows the plugin hint.** Install `event-bridge` from Before you start, then relaunch.

### 4. Plant a teammate's late change

Teaching line: real releases break on the commit nobody reviewed. This patch is that commit.

- **Do:** press `Ctrl+B O` until `shell` is focused.
- **Paste into `shell`:** `git apply patches/late-change.patch; git commit -am "Tweak price rounding"`
- **You should see:** `04-late-change.webp`. `1 file changed` for `src/price.ts`.
- **Must match:** the commit message `Tweak price rounding`; one file changed.
- **If not: `git apply` says the patch does not apply.** The starter's line endings changed. Run
  `git checkout -- .` and try again; the starter's `.gitattributes` keeps them as LF.

### 5. Start the release

- **Do:** focus `release-captain`.
- **Paste into `release-captain`:** `Cut release v1.3.0 now. Follow the Release Captain steps in AGENTS.md exactly, one broadcast line per step, and when you are done tell me the verdict in one line.`
- **You should see:** `05-freeze.webp`. The green Swarm Broadcast toast reading `FREEZE v1.3.0: release in
  progress. Do not edit files until RELEASE PASS.` In `feature-dev` and `docs-writer`, the line
  `[Broadcast Notice]: FREEZE v1.3.0: ...`, a short acknowledgement and `FROZEN`. `shell` shows nothing.
  **Clip step** `05-freeze.mp4`: the toast sliding in, the banner on each agent pane and the two receivers' badges
  flipping to Working (Quay's own motion, under ten seconds).
- **Must match:** the toast text; `FROZEN` as the last line in both receivers; no banner on `shell`.
- **May differ:** the receivers' wording above `FROZEN`; whether the toast has faded by the time you look (it lasts
  seven seconds).
- **If not: the toast never appears.** The captain ran the steps without `quay_broadcast`. Check its pane for a
  `quay_broadcast` tool call; if it's missing, paste `Start again from step 1 of the Release Captain steps. Send the FREEZE line with quay_broadcast.`

### 6. Read the verdict

- **Do:** wait for `release-captain` to finish. It bumps the version, edits the CHANGELOG, runs `npm test`, sees one
  failure, restores its files and broadcasts the verdict.
- **You should see:** `06-critical-fail.webp`. A second toast reading `RELEASE FAIL CRITICAL v1.3.0: pads cents
  under ten with a zero. Nothing released. Freeze stays on.` `feature-dev` answers with a `CAUSE:` line naming the
  `Tweak price rounding` commit and `src/price.ts`. `docs-writer` ends with `STILL FROZEN`.
- **Must match:** `RELEASE FAIL CRITICAL v1.3.0` and the failing test name in the toast; `src/price.ts` in
  `feature-dev`'s `CAUSE:` line; `STILL FROZEN` in `docs-writer`.
- **May differ:** the commit hash; the captain's one-line verdict wording.
- **If not: the captain fixed `src/price.ts` itself.** Its role forbids that. Paste into `shell`:
  `git restore .` then paste the step 5 prompt again.

### 7. Watch the freeze hold

- **Do:** focus `docs-writer`.
- **Paste into `docs-writer`:** `Add one line to README.md saying prices always show two decimal places.`
- **You should see:** `07-freeze-holds.webp`. `docs-writer` refuses and ends with `FROZEN`.
- **Must match:** `FROZEN` as the last line; README.md unchanged.
- **If not: it edited README.md.** Paste into `shell`: `git restore README.md`. Then paste into `docs-writer`:
  `A release freeze is on. Re-read the Release protocol in AGENTS.md.`

### 8. Read the fan-out in Mission Control

Teaching line: one broadcast becomes one trail entry per agent. The trail is the only place a broadcast "hears
back", and the captain never sees it.

- **Do:** click **A2A Orchestration Bus** in the rail's bottom toolbar (or open it from the `Ctrl+K` palette).
  Scroll to **Live A2A Message Trail**.
- **You should see:** `08-trail.webp`. For each broadcast, one entry per receiving agent:
  `Broadcast → feature-dev` and `Broadcast → docs-writer`, each Completed, each with the agent's reaction as its Reply.
- **Must match:** two entries per broadcast, one per receiver; the FREEZE and the FAIL text.
- **May differ:** times; Reply wording.
- Close the panel with Esc.

### 9. Fix it and release again

- **Paste into `shell`:** `git revert --no-edit HEAD`
- **Then paste into `release-captain`:** `The late change is reverted. Run the release for v1.3.0 again from the FREEZE step, exactly as AGENTS.md says.`
- **You should see:** `09-release-pass.webp`. A FREEZE toast, then `RELEASE PASS v1.3.0: all tests passed, tagged
  v1.3.0. Freeze lifted.` Both receivers end with `THAWED`.
- **Must match:** `RELEASE PASS v1.3.0` in the toast; `THAWED` in both receivers.
- **May differ:** the receivers' wording; how long `npm test` takes.
- **If not: the captain broadcasts FAIL again.** Paste into `shell`: `git log --oneline -3`. The top line must be
  `Revert "Tweak price rounding"`. If it isn't, run the revert again.

### 10. Check it worked

- **Do:** focus `shell`.
- **Paste into `shell`:** `git log --oneline -4; git tag; node src/cli.ts --version; npm test`
- **You should see:** `10-check.webp`. Four commits, newest first: `Release v1.3.0`, `Revert "Tweak price rounding"`,
  `Tweak price rounding`, `Starter`. The tag `v1.3.0`. `1.3.0` from the CLI. All 8 tests passed.
- **Must match:** those commit messages in that order; `v1.3.0`; `1.3.0`; `8 passed`.
- **May differ:** commit hashes; test timings.
- **You're done when:**
  - `git tag` lists `v1.3.0` and the newest commit is `Release v1.3.0`;
  - `node src/cli.ts --version` prints `1.3.0`;
  - `CHANGELOG.md` has `## [1.3.0] - <today>` holding the two former Unreleased entries, under an empty
    `## [Unreleased]`;
  - `npm test` reports 8 passed;
  - both receivers' last broadcast reaction ended with `THAWED`.

**Next up:** A2A 8, Mission Control operator run.

## Screenshot list

Names are the step markers, per the screenshot decision. Full window unless noted.

| File | Shows | Must-match anchors |
| --- | --- | --- |
| `01-project-added.webp` | project in the rail, empty stage | project name |
| `02-crew-builder.webp` | builder with four rows, grid layout (modal crop) | four session names, "Spawns 4 terminals" |
| `03-crew-launched.webp` | four panes, three role acknowledgements | pane names and positions |
| `04-late-change.webp` | the patch commit (`shell` pane crop) | `Tweak price rounding`, `1 file changed` |
| `05-freeze.webp` | FREEZE toast, notices and `FROZEN` in both receivers; the clip's poster | toast text, two `FROZEN`, no banner on `shell` |
| `06-critical-fail.webp` | FAIL toast, `CAUSE:` line, `STILL FROZEN` | `RELEASE FAIL CRITICAL v1.3.0`, `src/price.ts` |
| `07-freeze-holds.webp` | `docs-writer` refusing (pane crop) | `FROZEN` |
| `08-trail.webp` | Mission Control trail with per-agent broadcast entries | `Broadcast → feature-dev`, `Broadcast → docs-writer` |
| `09-release-pass.webp` | PASS toast, `THAWED` in both receivers | `RELEASE PASS v1.3.0`, two `THAWED` |
| `10-check.webp` | log, tag, version, tests (`shell` pane crop) | four commits, `v1.3.0`, `1.3.0`, `8 passed` |

One clip, `05-freeze.mp4`, beside `05-freeze.webp`. The toast and banners are timed (seven and ten seconds), so the
capture script fires the shot at the step marker, before they fade.

## Code this tutorial depends on

Already on the fix-first list:

- Launch prompt and the per-row Role prompt box in the custom builder, so each agent starts with its role
  ([Decide: How do Swarm agents get their role prompt at launch?](https://github.com/seanrobertwright/Quay-2/issues/11)).
- Terminal creation order kept, so the grid positions in step 3 are fixed
  ([Decide: How do screenshots show realistic agent output?](https://github.com/seanrobertwright/Quay-2/issues/38)).
- Wrong replies, bridge authentication and never-drained queues (`broadcast_toast` stops enqueueing `toast`
  commands) ([Decide: Which A2A problems from the install research join the fix-first list?](https://github.com/seanrobertwright/Quay-2/issues/36)).
- The event-bridge plugin hint ([Decide: How does Quay show that the event-bridge plugin is missing?](https://github.com/seanrobertwright/Quay-2/issues/47)).
- The swallowed `Ctrl+B` prefix ([Tutorial outline: Swarm 1, Your first swarm (Dev & Watcher)](https://github.com/seanrobertwright/Quay-2/issues/16)).

New, proposed for the fix-first list:

1. **A broadcast reaches its own sender.** The `quay_broadcast` arm of `handle_mcp_request` calls
   `A2ARouter::broadcast_toast` without `caller_id`, and `broadcast_toast` filters only on `run_kind.is_agent()` and
   not Exited. So `release-captain` gets its own `[Broadcast Notice]: FREEZE ...` typed into its prompt while it is
   working, gets a trail entry addressed to itself, and that entry is "answered" by its own final message.
   Proposed: `quay_broadcast` skips the caller. Mission Control broadcasts have no caller and still reach everyone.
   Sibling in the same filter: `RunKind::is_agent` includes `RunKind::Archon`, which the glossary says is not a peer,
   so a broadcast types into an Archon workflow's terminal. Skip it too.
2. **Broadcast trail entries take whatever turn ends next.** `resolve_pending_reply` marks the newest Dispatched
   entry for a terminal Completed on any `turn.completed`, broadcast or not. The wrong-replies fix covers waiters; it
   should cover trail entries too, broadcast ones included, so a receiver that was busy when the notice landed doesn't
   attach an unrelated answer to it. Step 8 depends on this.

## Open questions

1. **Self-delivery.** Fix it (new item 1: `quay_broadcast` skips its sender), or work around it with a line in the
   captain's role prompt ("ignore Broadcast Notices you sent yourself")? The draft assumes the fix.
2. **Broadcast scope.** A broadcast reaches agents in every project, not just the sender's. Should `quay_broadcast`
   be scoped to the caller's project (a fix-first item), or does the page keep the Before-you-start line "close agent
   terminals in other projects"?
3. **What the trail calls a broadcast reaction.** Each broadcast entry gets the receiver's next answer under "Reply:",
   but the glossary says a reply is an answer handed back to a sender who waited, and nobody waits on a broadcast.
   Keep the reaction on the entry (step 8 teaches it, with new item 2), relabel it in the panel, or record broadcast
   entries with no answer at all?
4. **Severity.** There's no severity field. "Critical" is the keyword `RELEASE FAIL CRITICAL`, and a failure toast
   looks exactly like a pass. Keep it a text convention, or add an optional `severity` to `quay_broadcast` that colours
   the toast and banner? That would be a new feature, not a fix. The draft assumes text only.
5. **Forcing the failure.** The learner applies a shipped patch and commits it, which breaks exactly one test every
   time. Alternatives: an environment variable a test reads, or asking `feature-dev` to make the late change (real,
   but not deterministic). And the order: fail then pass, as drafted, or a pass-only page with the failure as an
   optional aside?
6. **Who fixes the failure.** The draft has `feature-dev` diagnose read-only with a `CAUSE:` line and the learner
   revert. Alternative: the FAIL notice lets the owner fix it and tell the captain with `quay_send_message`
   (`wait_for_reply: false`), so the second release runs hands-off. More A2A, less deterministic, and it mixes in
   lessons from earlier tutorials.
7. **Confirming the freeze.** A broadcast has no acknowledgement, so the captain runs the tests straight after the
   FREEZE line, and only the learner sees the `FROZEN` answers. Should the captain instead check with
   `quay_list_agents` that no other agent is Working before it bumps the version?
8. **A green starter.** Every other starter so far ships red; this one ships green, and its CI also checks that the
   patch fails exactly one named test. Is a per-starter "apply this patch, expect this failure" CI step acceptable?
   No check suite, since `git tag`, `git log` and the release tests already prove the result.
9. **Team size.** Three Claude agents plus a shell. Two receivers show the fan-out, and the shell shows that
   broadcasts skip non-agents. Captain plus one receiver would cost fewer tokens and still teach the protocol.
10. **Step 1.** The draft says "the standard step 1". Which form that is (outside Quay, or the in-Quay paste line
    proposed in [Tutorial outline: Swarm 2, TDD Swarm kata](https://github.com/seanrobertwright/Quay-2/issues/17))
    is for the series to settle.
