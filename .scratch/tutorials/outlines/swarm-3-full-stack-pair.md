# Outline: Swarm 3, Full-Stack Pair: bookmarks app

Prototype outline for [Tutorial outline: Swarm 3, Full-Stack Pair: bookmarks app](https://github.com/seanrobertwright/Quay-2/issues/18).
A rough take to react to, not the tutorial. Open questions are at the end.

Slug `full-stack-pair`. Page `docs/tutorials/swarm/full-stack-pair/index.md`. Starter `examples/tutorials/full-stack-pair/starter/`.

## The page, top to bottom

**Title:** Swarm 3: Full-Stack Pair: bookmarks app

**Pitch:** Two Claude Code agents build one web app at the same time: `backend-agent` owns the API in `server/`, `frontend-agent` owns the React UI in `web/`. You hand each its half, watch them work side by side, then open the app in your browser.

**Tiles:** Time and Tokens are generated from test runs. Agents: 2 × Claude. Level: Intermediate.

**You'll learn:** the Full-Stack Pair preset, giving two agents parallel tasks that can't collide, moving focus and zoom between panes while both work, and adding a shell terminal to a running swarm.

**Before you start** (all on the shared Before-you-start page, linked):

- Quay 2 installed.
- Claude Code 2.1.296 or later, signed in.
- The `event-bridge` plugin installed (the pane status badges this tutorial reads come from it).
- Node 24 or later, Git, PowerShell 7.
- A web browser.
- The starter project, because the agents run in Skip mode and edit files without asking.

Note for the page: the preset launches both agents with `--model claude-sonnet-5-5`, so this is the one place the "CLIs on their defaults" rule is overridden by Quay itself.

## The starter project

The split that makes two agents safe in one folder is baked into the starter: a written API contract, a shared types file nobody edits, and a test file that tells the backend when it's done.

```text
starter/
  package.json          npm, exact versions, "engines": { "node": ">=24" }
  package-lock.json
  tsconfig.json         erasableSyntaxOnly, jsx react-jsx, lib DOM + ES2024, types node
  .gitignore            node_modules/, dist/, data/*.db
  README.md             the goal in a paragraph
  AGENTS.md             goal, commands, house rules, folder ownership (see below)
  CLAUDE.md             @AGENTS.md
  API.md                the contract: three endpoints, the Bookmark shape, error cases
  shared/api.ts         export type Bookmark = { id: number; title: string; url: string; createdAt: string }
                        export type NewBookmark = { title: string; url: string }
  server/app.ts         export function createApp(dbPath: string): Hono
                        skeleton: hono/logger middleware, GET /api/health only
  server/index.ts       createApp(process.env.BOOKMARKS_DB ?? "data/bookmarks.db"),
                        serveStatic for web/dist, serve() on port 3000, prints "Listening on http://localhost:3000"
  server/api.test.ts    the contract tests, in-process via app.request() against createApp(":memory:")
  web/index.html
  web/vite.config.ts    root web/, build.outDir ../dist, @vitejs/plugin-react
  web/src/main.tsx
  web/src/App.tsx       placeholder: an <h1>Bookmarks</h1> and nothing else
  data/.gitkeep
```

**Scripts.**

| Script | Runs | Who uses it |
| --- | --- | --- |
| `npm test` | `vitest run` | backend-agent, and the learner at the end |
| `npm run typecheck` | `tsc --noEmit` | both agents |
| `npm start` | `vite build && node server/index.ts` | the learner, step 6 |

One port, one URL, no dev-server proxy and no process manager: `npm start` builds the UI into `dist/` and Hono serves it beside the API on port 3000.

**Dependencies:** `hono`, `@hono/node-server`, `react`, `react-dom`; dev: `vite`, `@vitejs/plugin-react`, `vitest`, `typescript`, `@types/react`, `@types/react-dom`, `@types/node`. Storage is `node:sqlite`, so nothing native.

**The contract (`API.md`).**

| Endpoint | Success | Errors |
| --- | --- | --- |
| `GET /api/bookmarks` | 200, `Bookmark[]`, newest first | |
| `POST /api/bookmarks` with `NewBookmark` | 201, the created `Bookmark` | 400 when `title` is empty or `url` is not `http(s)://` |
| `DELETE /api/bookmarks/:id` | 204 | 404 when no such id |

**The contract tests (`server/api.test.ts`).** Eight tests the backend agent makes green. They import `createApp` from `server/app.ts` and never touch the filesystem.

1. `GET /api/health` returns 200 (passes on the skeleton).
2. `GET /api/bookmarks` returns an empty list.
3. `POST` returns 201 with `id`, `title`, `url` and `createdAt`.
4. `POST` with an empty title returns 400.
5. `POST` with a non-http URL returns 400.
6. `GET` after two `POST`s returns both, newest first.
7. `DELETE` returns 204 and the bookmark is gone from `GET`.
8. `DELETE` of an unknown id returns 404.

**CI expected state:** `npm ci` and `npx tsc --noEmit` pass; `npm test` is red (7 of 8 failing). This starter needs the starters CI job to carry a per-starter expected state, which the starter decision already allows for planted-bug starters.

**`AGENTS.md`**, in full-ish:

- Goal: a bookmarks app. The API is specified in `API.md`; the UI lists, adds and deletes bookmarks.
- Commands: `npm test`, `npm run typecheck`, `npm start`.
- Ownership: `backend-agent` edits only `server/`. `frontend-agent` edits only `web/`. Nobody edits `shared/`, `API.md` or `server/api.test.ts`.
- House rules: npm only, no new dependencies, no native modules, no `enum` or `namespace`.
- No check suite. The contract tests are visible on purpose: they are the backend's definition of done.

## Steps

### 1. Get the starter project

**Do**

1. Download `full-stack-pair.zip` from this page and unzip it into a new folder, for example `C:\tutorials\full-stack-pair`.
2. In PowerShell, in that folder: `git init`, `git add -A`, `git commit -m "Starter"`, `npm install`.
3. In Quay, click **+** next to **Projects** in the rail and choose the folder.

One sentence on the files: `API.md` is the contract both agents build to, `server/` and `web/` are the two halves, and `server/api.test.ts` is how the backend knows it's done.

**You should see:** `01-project-added.webp`. The starter project selected in the rail.

### 2. Launch the Full-Stack Pair

**Do**

1. Press `Ctrl+B S` to open the Swarm Launcher.
2. Select the **Full-Stack Pair** card.
3. Click **Launch Swarm Now**.

**You should see:** `02-pair-launched.webp`. Two panes side by side: `backend-agent` on the left, `frontend-agent` on the right. Each has confirmed its role and is waiting.

**Must match**

- The left pane is named `backend-agent`, the right `frontend-agent`.
- Each agent's first reply names its role (Backend Specialist, Frontend Specialist) and says it is waiting for a task.

**May differ**

- The exact wording of each agent's confirmation.

**If not:** a pane shows a plugin hint. Install the `event-bridge` plugin from the Before-you-start page, then relaunch.

### 3. Brief the backend agent

**Paste into `backend-agent`**

> Build the bookmarks API described in API.md, inside server/ only. Implement every endpoint in server/app.ts with Hono, keep the createApp(dbPath) signature, store bookmarks in SQLite at dbPath using node:sqlite, and keep going until npm test passes. Do not edit anything under web/, shared/ or server/api.test.ts. Tell me when you're done.

**You should see:** `03-backend-working.webp`. The backend agent reading `API.md` and editing `server/app.ts`; its badge shows Working.

**Must match**

- The badge on `backend-agent` says Working.
- Every file it creates or edits is under `server/`.

**May differ**

- Which files it reads first, how many tool calls, how long it takes.

### 4. Brief the frontend agent

**Do**

1. Press `Ctrl+B O` to move focus to the right pane. Don't wait for the backend to finish.

**Paste into `frontend-agent`**

> Build the bookmarks UI described in API.md, inside web/ only. In web/src/App.tsx, list bookmarks from GET /api/bookmarks, add one with a title and URL form through POST /api/bookmarks, and delete one with a button through DELETE /api/bookmarks/:id, using the types in shared/api.ts and relative /api URLs. The backend-agent is building the API in server/ right now, so don't wait for it. Keep going until npm run typecheck passes. Do not edit anything under server/ or shared/. Tell me when you're done.

**You should see:** `04-both-working.webp`. Both panes Working at the same time.

**Must match**

- Both badges say Working.
- Every file `frontend-agent` creates or edits is under `web/`.

**May differ**

- Which agent finishes first.

### 5. Watch them finish

**Do**

1. Press `Ctrl+B Z` to zoom the focused pane while you read it, and `Ctrl+B Z` again to return to the split. `Ctrl+B O` cycles between the two.
2. Wait until both agents say they're done.

**You should see:** `05-both-done.webp`. Both agents idle, each with a short summary of what it built.

**Must match**

- `backend-agent` reports `npm test` passing, 8 tests.
- `frontend-agent` reports `npm run typecheck` passing.
- Both badges say Idle.

**May differ**

- How long it takes (expect 5 to 15 minutes).
- The wording of the summaries, and whether an agent ran extra checks of its own.

**If not:** `backend-agent` says a test still fails after several attempts. Paste into `backend-agent`: "Run npm test, read the failing assertion, and fix server/app.ts until it passes. Do not change the tests."

**If not:** an agent edited the other folder. Paste into that agent: "Run git checkout -- <folder> to undo your changes there and finish inside your own folder only."

### 6. Start the app in a third terminal

**Do**

1. Press `Ctrl+B O` until the right pane is focused.
2. Press `Ctrl+B N`, choose **PowerShell**, name it `app`, and click **Launch**.
3. In the new pane, run `npm start`.

Teaching line: the right pane now shows `app`. `frontend-agent` is still running behind it: `Ctrl+B 2` brings it back, `Ctrl+B 3` returns to `app`.

**You should see:** `06-app-started.webp`. The `app` pane with the Vite build summary and `Listening on http://localhost:3000`.

**Must match**

- The last line is `Listening on http://localhost:3000`.

**May differ**

- The build's file sizes and timings.

**If not:** `npm start` fails in the Vite build. Press `Ctrl+B 2`, then paste into `frontend-agent`: "npm start fails in the build with this error, fix it in web/ only: <paste the error>". Then `Ctrl+B 3` and run `npm start` again.

**If not:** `EADDRINUSE` on port 3000. Something else is using the port; stop it, or run `$env:PORT=3001; npm start` and use that port below.

### 7. Check it worked

**Do**

1. Open `http://localhost:3000` in your browser.
2. Add a bookmark: title `Quay`, URL `https://github.com/seanrobertwright/Quay-2`.
3. Refresh the page. The bookmark is still there.
4. Delete it, refresh again, and it's gone.
5. Back in Quay, read the `app` pane: every click you made is a logged request.

**You should see:** `07-request-log.webp`. The `app` pane's request log: `POST /api/bookmarks 201`, then `GET /api/bookmarks 200` from the refresh, then `DELETE /api/bookmarks/1 204`.

**Must match**

- A `POST /api/bookmarks` line with status 201, followed by a `GET /api/bookmarks` line with status 200.

**May differ**

- Request timings, and the id in the `DELETE` line.

**You're done when**

- A bookmark added in the browser is still listed after a refresh.
- `data/bookmarks.db` exists in the project folder.
- `npm test` passes, 8 tests. (Stop the server with `Ctrl+C` in the `app` pane first.)
- `git status` shows changes only under `server/` and `web/`.

**Next up:** Swarm 4, Build and save a custom swarm.

## Screenshot list

All full-window captures of Quay unless noted. Names are the step markers.

| File | Shows | Must-match anchors |
| --- | --- | --- |
| `01-project-added.webp` | Starter selected in the rail, empty stage | project name in the rail |
| `02-pair-launched.webp` | Split layout, both role confirmations | pane names, "Backend Specialist", "Frontend Specialist" |
| `03-backend-working.webp` | Left pane mid-work, right pane idle | Working badge on the left, `server/` paths |
| `04-both-working.webp` | Both panes mid-work | two Working badges |
| `05-both-done.webp` | Both summaries | "8 passed", typecheck line, two Idle badges |
| `06-app-started.webp` | Right pane is `app`, build output | the Listening line |
| `07-request-log.webp` | Right pane is `app`, request log (pane crop) | 201 then 200 lines |

No clip. Nothing here is Quay motion worth ten seconds.

## Open questions, in order

1. **Contract in the starter, or agreed by the agents?** This draft ships `API.md`, `shared/api.ts` and the contract tests, so the two agents never need to talk and the tutorial stays about parallel ownership. The alternative, letting them negotiate the API over the bus, is what A2A 2 (Contract-first handoff) teaches.
2. **The browser is invisible to the capture pipeline.** Screenshots are Quay only, and there is no reference solution to build a browser shot from. This draft puts the browser in words and makes the `app` pane's request log the screenshot and Must match for step 7. Alternative: one hand-captured browser screenshot outside the pipeline.
3. **Where `npm start` runs.** This draft adds a third terminal inside Quay, which replaces the focused pane and teaches that hidden terminals keep running. Alternatives: the learner's own PowerShell window (nothing new learned), or `Ctrl+B G` to go to a 2x2 grid with the shell in a third cell.
4. **Visible contract tests, red in CI.** The backend's definition of done is a test file the agents can read. That means a starter whose tests start red, so the starters CI job needs a per-starter expected state. Alternative: no contract tests, and the backend decides for itself when it's done.
5. **The model override.** The preset launches both agents with `--model claude-sonnet-5-5`. Keep it and say so on the page, or drop the flag from the preset when the role prompts are written so the pair runs on the CLI default like every other tutorial?
6. **Level.** Intermediate, because the learner coordinates two agents and reads a request log. Swarm 1 and 2 would be Starter.
