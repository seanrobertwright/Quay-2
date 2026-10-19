# Outline: A2A 2, Contract-first handoff

Prototype outline for the ticket "Tutorial outline: A2A 2, Contract-first handoff".
A rough take to react to, not the tutorial. Open questions are at the end.

Slug `contract-first-handoff`. Page `docs/tutorials/a2a/contract-first-handoff/index.md`. Starter `examples/tutorials/contract-first-handoff/starter/`.

## The page, top to bottom

**Title:** A2A 2: Contract-first handoff

**Pitch:** Two Claude Code agents build a notes app, and this time they agree the API between them before either writes a line of it. `frontend-agent` asks `backend-agent` for the contract over the A2A bus, asks for one change, then hands off. Both build against the same `shared/types.ts`, and the app works the first time you start it.

**Tiles:** Time and Tokens are generated from test runs. Agents: 2 × Claude + 1 PowerShell shell. Level: Intermediate.

**You'll learn:** having one agent own a contract and another negotiate it over the bus, the difference between waiting for a reply and sending without waiting, fixed last lines that make an agent's reply checkable, and reading a negotiation back in Mission Control's message trail.

**Before you start** (all on the shared Before-you-start page, linked, plus one line here):

- Quay installed, and the shared page's checks done: Claude Code 2.1.296 or later, the `event-bridge` plugin 0.1.0 or later, PowerShell 7, Node 24 or later, Git.
- A web browser.
- A2A 1 done. This page assumes you know the four `quay_*` tools, the message trail and the toasts.
- The Full-Stack Pair preset launches both agents with `--model claude-sonnet-5-5`, so this tutorial runs that model, not your CLI default (as decided for Swarm 3).
- About 30 minutes.

## How the negotiation works

This is the lesson, so the page says it in one short section before step 1.

- `backend-agent` owns the contract. Only it writes `shared/types.ts`.
- `frontend-agent` never edits the contract. It asks for it, and asks for changes, with `quay_send_message` and `wait_for_reply: true`. Each answer comes back as a reply, because each one is a small edit that fits inside the 60 seconds a reply waits.
- Each contract reply ends with a fixed last line, `CONTRACT v1 READY`, then `CONTRACT v2 READY`, so you can check the round in Mission Control.
- When the contract covers what the UI needs, `frontend-agent` sends `CONTRACT AGREED` with `wait_for_reply: false`. Building the API takes minutes, far past 60 seconds, so nobody waits for it. That message is the handoff.
- If a reply ever runs past 60 seconds, the contract is a file anyway: `frontend-agent` polls `quay_get_agent_status` until `backend-agent` is Idle, then reads `shared/types.ts`. That is the file mailbox, used here only as the fallback.

## The starter project

Same shape as the Swarm 3 starter (Hono, `node:sqlite`, Vite and React, one port), with one difference that carries the lesson: there is no contract yet. `shared/types.ts` is empty and owned by the backend.

```text
starter/
  package.json          npm, exact versions, "type": "module", "engines": { "node": ">=24" }
  package-lock.json
  tsconfig.json         strict, erasableSyntaxOnly, noEmit, jsx react-jsx, lib DOM + ES2024, types node
  .gitignore            node_modules/, dist/, data/*.db
  README.md             the goal in two sentences; points at AGENTS.md
  AGENTS.md             see below
  CLAUDE.md             @AGENTS.md
  shared/types.ts       a header comment and `export {};` only:
                          // The API contract between server/ and web/.
                          // Owned by backend-agent. Empty until the agents agree it.
  server/app.ts         export function createApp(dbPath: string): Hono
                        skeleton: hono/logger middleware, GET /api/health only
  server/index.ts       createApp(process.env.NOTES_DB ?? "data/notes.db"),
                        serveStatic for dist/, serve() on PORT or 3000,
                        prints "Listening on http://localhost:3000"
  server/health.test.ts one passing test for GET /api/health via app.request(),
                        the pattern the backend copies for its own tests
  web/index.html
  web/vite.config.ts    root web/, build.outDir ../dist, @vitejs/plugin-react
  web/src/main.tsx
  web/src/App.tsx       placeholder: an <h1>Notes</h1> and nothing else
  data/.gitkeep
```

**Scripts.**

| Script | Runs | Who uses it |
| --- | --- | --- |
| `npm test` | `vitest run` | backend-agent |
| `npm run typecheck` | `tsc --noEmit` | both agents |
| `npm start` | `vite build && node server/index.ts` | the learner, step 7 |

**Dependencies:** as Swarm 3. `hono`, `@hono/node-server`, `react`, `react-dom`; dev: `vite`, `@vitejs/plugin-react`, `vitest`, `typescript`, `@types/react`, `@types/react-dom`, `@types/node`.

**Starter CI state:** all green. `npm ci`, `npx tsc --noEmit` clean, `npm test` 1 passed. No per-starter expected-state marker needed.

**No check suite.** The agents write the contract during the run, so no test written in advance can know its routes or shapes. The backend writes its own `server/api.test.ts`; the learner's evidence is the request log and the message trail.

**`AGENTS.md`**, in full-ish:

- **Goal:** a notes app. A note has a title and a body. The first version of the API covers listing, creating and deleting notes. Anything more is agreed between the agents.
- **The contract:** `shared/types.ts` holds the API contract: the types both sides import, and one comment line per endpoint giving method, path, request body and status codes.
- **Ownership:**
  - `backend-agent` owns `shared/types.ts` and `server/`.
  - `frontend-agent` owns `web/`. It reads `shared/types.ts` but never edits it. It asks `backend-agent` for changes over the bus.
  - Nobody edits `server/health.test.ts`.
- **On the bus:** answer a teammate's message in your reply. Never call `quay_send_message` back to a teammate who is waiting on you.
- **Commands:** `npm test`, `npm run typecheck`, `npm start`. Agents never run `npm start`; the learner does.
- **House rules:** npm only, no new dependencies, no native modules, no `enum` or `namespace`, relative `/api` URLs in `web/`.

## What the Full-Stack Pair role prompts must make true (input to the launch-prompt fix)

Swarm 3 needs "nobody edits `shared/`". This tutorial needs `backend-agent` to own it. The role prompts can serve both only if they don't name folders:

- **backend-agent:** you own the server side and any API contract the project defines. Folder ownership is in the project's `AGENTS.md`.
- **frontend-agent:** you own the UI. You build against the contract and never change it; you ask its owner. Folder ownership is in the project's `AGENTS.md`.
- **Both:** read `AGENTS.md` before the first change, wait for the user between tasks, and message a teammate only when the user or `AGENTS.md` says to.

See open question 3.

## Steps

### 1. Get the starter project

**Do**

1. Download `contract-first-handoff.zip` from this page and unzip it into a new, empty folder, for example `C:\tutorials\contract-first-handoff`.
2. In Quay, click **Add Project Workspace** in the rail and pick that folder.
3. Press `Ctrl+B N`, choose **PowerShell**, type `app` in **Terminal Label (Optional)**, and click **Start Terminal (Enter)**.

**Paste into `app`**

```text
git init; git add -A; git commit -m Starter; npm install
```

One sentence on the files: `shared/types.ts` is where the contract will go, and it's empty on purpose. `server/` and `web/` are the two halves.

**You should see:** `01-starter-installed.webp`. The `app` pane after `npm install`, prompt back; the rail shows the project.

**Must match**

- `git commit` prints `Starter` as the message.
- `npm install` ends with `added` and a package count, no errors.

**May differ**

- The package count.

**If not: node or npm is not recognised.** Node 24 or later isn't on your PATH. Install it from the Before-you-start page, then close and reopen Quay.

### 2. Launch the Full-Stack Pair

**Do**

1. Press `Ctrl+B S` to open the Swarm launcher.
2. Select the **Full-Stack Pair** card.
3. Click **Launch Swarm Now**.
4. Wait until each pane has printed one line confirming its role and gone quiet.

Teaching line: the `app` terminal is still running behind the split. You'll bring it back in step 7.

**You should see:** `02-pair-launched.webp`. Two panes side by side, `backend-agent` on the left and `frontend-agent` on the right, each ending with a role confirmation.

**Must match**

- The left pane is named `backend-agent`, the right `frontend-agent`.
- Each pane's first reply names its role (Backend Specialist, Frontend Specialist) and says it is waiting.
- Both badges say Idle.

**May differ**

- The wording of each confirmation.
- How long the panes take to start.

**If not: a pane shows a one-line plugin hint.** The event-bridge plugin is missing. Click **Copy** on the hint, paste the install line into that pane, then type `/reload-plugins`. The hint clears on its own.

### 3. Make the backend the contract owner

**Paste into `backend-agent`**

```text
Read AGENTS.md. You own shared/types.ts and server/. Write no code yet: frontend-agent will ask you for the API contract over the bus. When it asks, write the contract in shared/types.ts covering only listing, creating and deleting notes, reply with its endpoint lines, and end your reply with the line CONTRACT v1 READY. If frontend-agent asks for a change, make exactly that change in shared/types.ts, reply with the changed lines, and end with CONTRACT v2 READY (v3 for the next one, and so on). Keep each contract reply short: edit the one file and answer, nothing else. Start on server/ only when frontend-agent sends CONTRACT AGREED. Then implement every endpoint in server/app.ts with Hono and node:sqlite at dbPath, keeping the createApp(dbPath) signature, add a test per endpoint in server/api.test.ts, and keep going until npm test and npm run typecheck pass. Do not edit web/ and do not run npm start. For now, reply with one line saying you are ready.
```

Teaching line: this turn does almost nothing on purpose. It loads `AGENTS.md` now, so that the contract reply in step 4 is a quick edit and lands well inside the 60-second wait.

**You should see:** `03-backend-ready.webp`. `backend-agent` has answered with one line and is Idle; `frontend-agent` is untouched.

**Must match**

- `backend-agent` replies with one line saying it is ready, and its badge goes back to Idle.
- No file has changed.

**May differ**

- The wording of the line, and whether it read other files besides `AGENTS.md`.

**If not: `backend-agent` starts writing `shared/types.ts` or `server/` code.** Press `Esc` in its pane, then paste: `Undo what you just wrote with git checkout -- . and wait for frontend-agent to ask for the contract.`

### 4. Let the frontend negotiate and hand off

**Do**

1. Press `Ctrl+B O` to move focus to `frontend-agent`. Make sure `backend-agent` shows Idle first.

**Paste into `frontend-agent`**

```text
Read AGENTS.md. You build the notes UI in web/ only, against the contract in shared/types.ts, which backend-agent owns. First, ask backend-agent for the contract as it stands with quay_send_message and wait_for_reply true, without saying what the UI needs. Then check the contract against what the UI needs: list notes with pinned notes first, add a note with a title and body, delete a note, and pin or unpin a note. If anything is missing, ask backend-agent for all of it in one message the same way and wait again. When the contract covers everything, send backend-agent exactly CONTRACT AGREED. Build server/ against shared/types.ts. with wait_for_reply false. If a reply says backend-agent is still working, call quay_get_agent_status on it every 15 seconds until it is Idle, then read shared/types.ts yourself. Then build the UI in web/src/App.tsx using the types from shared/types.ts and relative /api URLs, without waiting for the server. Keep going until npm run typecheck passes. Do not edit shared/ or server/, and do not run npm start. Tell me when you are done.
```

What happens, in words: `frontend-agent` calls `quay_send_message` and its turn pauses on the call. The message lands in `backend-agent` as a line starting `[Peer agent (frontend-agent)]:`. `backend-agent` writes the first contract and replies; the reply ends `CONTRACT v1 READY`. The first contract has no pinning, so `frontend-agent` asks for it and waits again; the reply ends `CONTRACT v2 READY`. Then it sends `CONTRACT AGREED` without waiting, and both agents start building at once.

**You should see:** `04-handoff.webp`, with the clip `04-handoff.mp4`. The moment of the handoff: a DISPATCHED toast from `frontend-agent` to `backend-agent`, the `CONTRACT AGREED` line landing in the left pane, and the `backend-agent` badge flipping to Working while `frontend-agent` carries on. Caption describes the motion: the toast appears, the line lands on the left, the left badge flips to Working.

**Must match**

- `backend-agent`'s pane shows at least three lines starting `[Peer agent (frontend-agent)]:`, the last one containing `CONTRACT AGREED`.
- Both badges say Working after the handoff.
- `frontend-agent` never edits `shared/types.ts`.

**May differ**

- How the agents phrase their requests and replies, and the routes and field names they choose (for example `PATCH /api/notes/:id` or `POST /api/notes/:id/pin` for pinning).
- Whether `frontend-agent` calls `quay_list_agents` first or sends straight to `backend-agent` by name.
- The time each round takes.

**If not: `frontend-agent` says the reply timed out, or that `backend-agent` is still working.** The contract edit ran past 60 seconds. Nothing is lost: the prompt tells `frontend-agent` to poll `quay_get_agent_status` and read `shared/types.ts` once `backend-agent` is Idle. Wait for it.

**If not: `frontend-agent` edits `shared/types.ts` itself.** Paste into `frontend-agent`: `Run git checkout -- shared/ to undo your change. shared/types.ts belongs to backend-agent: ask it for the change with quay_send_message and wait for its reply.`

### 5. Read the negotiation in Mission Control

**Do**

1. Click **A2A Orchestration Bus** in the rail's bottom toolbar (the network icon) to open Mission Control.
2. Scroll to **Live A2A Message Trail**. Read the entries from the top: the request, the change, the handoff.
3. Press `Esc` to close the panel. The agents keep working behind it.

**You should see:** `05-message-trail.webp` (panel crop). Three entries, each `frontend-agent → backend-agent`: the ask, Completed, with a Reply ending `CONTRACT v1 READY`; the pinning change, Completed, with a Reply ending `CONTRACT v2 READY`; and `CONTRACT AGREED. Build server/ against shared/types.ts.`, still Working.

**Must match**

- The trail heading counts at least three messages.
- Two Completed entries whose replies end `CONTRACT v1 READY` and `CONTRACT v2 READY`.
- A last entry containing `CONTRACT AGREED`, marked Working.

**May differ**

- The wording of each request and reply, and the timestamps.
- A third contract round (`CONTRACT v3 READY`) if `frontend-agent` asked twice.

**If not: the last entry already says Completed.** `backend-agent` finished building before you looked. That's fine: its reply is its build summary.

**If not: an entry says Failed and "Timed out waiting for reply".** That round ran past 60 seconds and `frontend-agent` fell back to reading `shared/types.ts`. The run is still good; see open question 5 for why the label is wrong.

### 6. Watch them finish

**Do**

1. `Ctrl+B O` moves focus between the panes; `Ctrl+B Z` zooms the focused one while you read it, and `Ctrl+B Z` again returns to the split.
2. Wait until both agents say they're done.

**You should see:** `06-both-done.webp`. Both agents Idle, each with a short summary.

**Must match**

- `backend-agent` reports `npm test` and `npm run typecheck` passing.
- `frontend-agent` reports `npm run typecheck` passing.
- Both badges say Idle.

**May differ**

- How long it takes (expect 5 to 15 minutes), which agent finishes first, and the number of tests.
- The reusable lines: the agents' wording and the port number in the rail header.

**If not: `backend-agent` says a test still fails after several attempts.** Paste into `backend-agent`: `Run npm test, read the failing assertion, and fix server/app.ts until it passes. Keep to the contract in shared/types.ts.`

**If not: `frontend-agent` reports a type error in its use of the contract.** Paste into `frontend-agent`: `Fix the type error in web/ against shared/types.ts as it is. If the contract itself is wrong for the UI, ask backend-agent for the change over the bus and wait for its reply.`

### 7. Start the app

**Do**

1. Press `Ctrl+B O` until the right pane is focused.
2. Press `Ctrl+B 1` (or click `app` in the rail) to bring the `app` terminal into the right pane.

**Paste into `app`**

```text
npm start
```

Teaching line: `frontend-agent` is still there behind `app`. `Ctrl+B 3` brings it back, `Ctrl+B 1` returns to `app`.

**You should see:** `07-app-started.webp`. The `app` pane with the Vite build summary and `Listening on http://localhost:3000`.

**Must match**

- The last line is `Listening on http://localhost:3000`.

**May differ**

- The build's file sizes and timings.

**If not: `npm start` fails in the Vite build.** Press `Ctrl+B 3`, then paste into `frontend-agent`: `npm start fails in the build. Read the error in the app terminal output I will paste next and fix it in web/ only.` Paste the error, wait for Idle, then `Ctrl+B 1` and run `npm start` again.

**If not: `EADDRINUSE` on port 3000.** Something else is using the port. Stop it, or paste `$env:PORT=3001; npm start` and use that port below.

### 8. Check it worked

**Do**

1. Open `http://localhost:3000` in your browser.
2. Add two notes: title `Groceries`, body `Milk, eggs`; then title `Ideas`, body `Pin me`.
3. Pin `Ideas`, then refresh the page. `Ideas` is listed first, and both notes are still there.
4. Delete `Groceries` and refresh again. It's gone.
5. Back in Quay, read the `app` pane: every click you made is a logged request.

**You should see:** `08-request-log.webp` (pane crop). The `app` pane's request log: `--> POST /api/notes 201` twice, the pin request with a 2xx status, `--> GET /api/notes 200` from the refresh, then the delete with a 2xx status.

**Must match**

- Two `POST /api/notes` lines with status 201, followed by a `GET /api/notes` line with status 200.
- No line in the log has a 4xx or 5xx status. This is the "first run": the UI and the API agreed before you started the server.

**May differ**

- The method and path of the pin and delete requests, the ids in them, and the timings.

**If not: a request in the log has a 4xx status.** The two halves don't agree on the contract. Stop the server with `Ctrl+C`, press `Ctrl+B 3`, and paste into `frontend-agent`: `npm start logged a failed request. Compare web/ with shared/types.ts, and if the server is off the contract, tell backend-agent over the bus with wait_for_reply false. Tell me when both sides match.` The run no longer counts as a first-run pass, but the app gets fixed the right way, through the contract's owner.

**You're done when**

- A note pinned in the browser is listed first after a refresh, and a deleted note stays gone.
- The `app` pane's log showed no 4xx or 5xx request on the first `npm start`.
- Mission Control's trail shows the contract request, the change and `CONTRACT AGREED`, all from `frontend-agent` to `backend-agent`.
- With the server stopped (`Ctrl+C` in `app`), `npm test` and `npm run typecheck` pass, and `git status --short` lists changes only under `shared/`, `server/` and `web/`.

**Next up:** A2A 3, Hands-off TDD relay.

## Screenshot list

All full-window captures of Quay unless noted. Names are the step markers.

| File | Shows | Must-match anchors |
| --- | --- | --- |
| `01-starter-installed.webp` | `app` pane after `npm install` | `Starter` commit, `added` line, project in the rail |
| `02-pair-launched.webp` | Split, both role confirmations | pane names, "Backend Specialist", "Frontend Specialist", two Idle badges |
| `03-backend-ready.webp` | `backend-agent`'s one-line ready reply | Idle badge on the left, untouched right pane |
| `04-handoff.webp` | Handoff moment (poster for the clip) | DISPATCHED toast, `CONTRACT AGREED` line on the left, two Working badges |
| `05-message-trail.webp` | Mission Control's trail (panel crop) | `frontend-agent → backend-agent` three times, `CONTRACT v1 READY`, `CONTRACT v2 READY`, `CONTRACT AGREED` |
| `06-both-done.webp` | Both summaries | test and typecheck lines, two Idle badges |
| `07-app-started.webp` | Right pane is `app`, build output | the Listening line |
| `08-request-log.webp` | `app` request log (pane crop) | 201, 201, 200 lines; no 4xx |

**Clip:** `04-handoff.mp4`, step 4. A message crossing the bus is the sequence a still can't show: the toast appears, the `CONTRACT AGREED` line lands in the left pane and the left badge flips to Working, in about three seconds at real speed. It includes terminal output streaming in, so it uses the timed-replay window the replay decision allows.

**Fixture recording:** one whole run, three terminals: two Claude casts plus their bridge logs (status events, `turn.completed`, and every `quay_*` call, including the two `wait_for_reply` round trips), and one PowerShell cast. Markers 01 to 08. The two Claude recordings talk to each other, so both play on the capture's one shared clock.

## Open questions, in order

1. **How much negotiation?** This draft has `frontend-agent` ask for the contract cold, find pinning missing and ask for it, then hand off with `CONTRACT AGREED`. That is two waited round trips and one send without waiting, and it shows a real change request. The cost is one slightly artificial instruction ("without saying what the UI needs"). Alternative: one round trip where the frontend states its needs up front, then builds. Proposed: keep the two rounds; it is the only way the page shows a contract changing through its owner.
2. **Where the contract lives, and its shape.** This draft keeps it to `shared/types.ts` alone: types plus one comment line per endpoint, written by `backend-agent`, with routes and names under May differ. Alternative: a fixed `API.md` format the backend fills in, which would make routes checkable but adds a second file for the frontend to read. Proposed: types file only, as the charting idea said.
3. **The Full-Stack Pair role prompts must serve two starters.** Swarm 3 needs "nobody edits `shared/`"; this tutorial needs `backend-agent` to own it. Proposed: the role prompts name halves (server side and contract, UI) and leave folder ownership to each project's `AGENTS.md`, and both say "message a teammate only when the user or `AGENTS.md` says to". The texts are written with the launch-prompt fix.
4. **The 60-second wait, and the file mailbox as a fallback.** Each contract round is one small file edit, and step 3 warms `backend-agent` up so the rounds land well inside 60 seconds. The frontend's prompt still carries the file-mailbox fallback (poll `quay_get_agent_status` until Idle, then read `shared/types.ts`). Proposed: keep the fallback in the prompt and name the file mailbox in one line on the page, leaving the full lesson to whichever later A2A tutorial owns it. Alternative: leave the fallback out and handle a timeout only in an If not.
5. **Code gap: the trail and toasts misreport a waited message.** Two parts, both in `quay_send_message` with `wait_for_reply: true`. First, Quay emits the message to Mission Control and the toasts only after the reply lands, so during the wait the open trail shows nothing and no DISPATCHED toast appears; the toast arrives already done. Second, when the wait gives up, the trail entry turns Failed with "Timed out waiting for reply", while the sender is told the peer is still working, and the peer's later answer never reaches the trail, because only entries still marked Dispatched are filled in. Proposed: join the fix-first list. Emit the message on delivery as the no-wait path does, keep a timed-out entry Working with a "no reply within 60s" note, and let the turn's answer fill it in when it ends. Until then this draft's clip uses the no-wait handoff, which already toasts on delivery.
6. **Code gap: `target_terminal_id` is matched loosely.** The tool schema asks for a terminal ID, but the router also takes a session name, a run kind (so `claude` picks any Claude terminal) or a substring. An unknown target is still logged, then waited on for the full 60 seconds. Agents will pass names here, because the team briefing gives names. Proposed: join the fix-first list. Accept an exact terminal ID or an exact session name, say so in the schema, and reject anything else at once with the list of peers.
7. **Reusing the step-1 terminal as `app`.** This draft labels the step-1 PowerShell terminal `app` and brings it back with `Ctrl+B 1` in step 7, so the learner has three terminals, not four. It relies on the terminal-order fix from the replay decision, so the numbers are stable. Alternative: Swarm 3's way, a new PowerShell terminal from `Ctrl+B N` in step 7. Proposed: reuse, and apply the same to Swarm 3 when its page is written.
8. **"Works on the first run": Must match or You're done when?** The charting idea says done when the UI works against the real API on the first run. This draft makes "no 4xx or 5xx on the first `npm start`" a Must match in step 8 and a You're done when line, with an If not that repairs a mismatch through the bus. Proposed: keep it in both, and say plainly in the If not that a repaired run isn't a first-run pass.
9. **No check suite.** The contract is written during the run, so a test written in advance can't know its routes. Proposed: none. The backend writes its own `server/api.test.ts`, and the evidence is the request log plus the message trail. The starter is green in CI.
10. **Clip and level.** Proposed: the clip is step 4's handoff (toast, line landing, badge flipping), and the level is Intermediate: two agents negotiating over the bus, eight step cards, eight screenshots.
