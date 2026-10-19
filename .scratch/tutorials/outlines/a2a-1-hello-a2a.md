# Outline: A2A 1, Hello, A2A

Prototype outline for the ticket "Tutorial outline: A2A 1, Hello, A2A".
A rough take to react to, not the tutorial. Open questions are at the end.

Slug `hello-a2a`. Page `docs/tutorials/a2a/hello-a2a/index.md`. Starter `examples/tutorials/hello-a2a/starter/`.

## The page, top to bottom

**Title:** A2A 1: Hello, A2A

**Pitch:** Two Claude Code agents, `asker` and `answerer`, side by side. First you send `answerer` a message yourself from Mission Control. Then `asker` finds its peer, asks it to sum up `package.json`, waits for the reply and quotes it back to you.

**Tiles:** Time and Tokens are generated from test runs. Agents: 2 × Claude. Level: Starter.

**You'll learn:** checking the event-bridge plugin with `/plugin`, opening two Claude Code terminals side by side, sending a message from Mission Control with **Dispatch as User**, the four `quay_*` tools (`quay_list_agents`, `quay_send_message` with `wait_for_reply`, `quay_get_agent_status`, `quay_broadcast`), and reading the message trail and the toasts.

**Before you start:** the shared Before-you-start page (Quay installed; Claude Code 2.1.296 or later, signed in; event-bridge 0.1.0 or later; PowerShell 7; Node 24 or later, npm and Git). Nothing extra. One line on this page: both agents run in Skip mode, but in this tutorial they only read files.

## The starter project

A tiny, finished TypeScript package. Nothing gets built here: the package is only something real for `answerer` to read and sum up.

```text
starter/
  package.json        name hello-a2a, version 0.3.0, "type": "module",
                      description "Greets people in three languages."
                      engines node >=24
                      scripts: greet "node src/cli.ts", test "vitest run", typecheck "tsc --noEmit"
                      devDependencies: vitest, typescript, @types/node (exact versions, no ^)
  package-lock.json
  tsconfig.json       strict, erasableSyntaxOnly, noEmit, module/moduleResolution nodenext
  .gitignore          node_modules/
  README.md           what the package does, and that the tutorial is about messaging, not code
  AGENTS.md           see below
  CLAUDE.md           @AGENTS.md
  src/greet.ts        export function greet(name: string, lang: "en" | "es" | "fr"): string
  src/cli.ts          node src/cli.ts Ada fr prints "Bonjour, Ada!"
  test/greet.test.ts  three passing tests, one per language
```

The version `0.3.0` and the three script names are what step 6's Must match checks, so they stay fixed.

**`AGENTS.md`:** the goal in a sentence; the commands `npm run greet`, `npm test`, `npm run typecheck`; the house rules (npm only, no new dependencies, no `enum` or `namespace`); and "This tutorial is about agents messaging each other. Don't change any file unless the user asks you to."

**Starters CI expected state:** `npm ci`, `npx tsc --noEmit` clean, tests green (3 passed). No check suite.

## Steps

### 1. Get the starter project

The standard step, run inside Quay as Swarm 2 proposed.

**Do**

1. Download `hello-a2a.zip` from this page and unzip it into a new, empty folder, for example `C:\tutorials\hello-a2a`.
2. In Quay, click **Add Project Workspace** in the rail and pick that folder.
3. Press `Ctrl+B N`, choose **PowerShell** and click **Start Terminal**.

**Paste into the PowerShell pane**

```text
git init; git add -A; git commit -m Starter; npm install
```

One sentence on the files: `AGENTS.md` tells every agent the house rules, and `CLAUDE.md` points Claude Code at it.

**You should see:** `01-starter-installed.webp`. A single PowerShell pane: the Starter commit, then `npm install` finished. The rail shows the project.

**Must match**

- `git commit` prints `Starter` as the message.
- `npm install` ends with `added` and a package count, and no errors.

**May differ**

- The package count and timings.

**If not: node or npm is not recognised.** Node 24 or later isn't on your PATH. Install it from the Before-you-start page, then close and reopen Quay.

### 2. Open `asker` and check the plugin

**Do**

1. Press `Ctrl+B N`. Under **Autonomous AI Agents** choose **Claude**. Leave **Permission Mode** on **Skip Permissions (Default)** and **Model** on **Default**. In **Terminal Label (Optional)** type `asker`. Click **Start Terminal**.
2. Claude Code asks whether you trust this folder. Say yes. (The first time you use Skip mode it also shows a warning about bypassing permissions. Accept it. Both dialogs are on the Before-you-start page.)
3. Wait until `asker`'s badge in the rail reads Idle, then paste the line below.
4. When the plugin list shows, read it, then press `Esc` to close it.

**Paste into `asker`**

```text
/plugin
```

**You should see:** `02-plugin-check.webp` (pane). Claude Code's plugin list in `asker`, with `event-bridge` enabled.

**Must match**

- `event-bridge` is listed and enabled.
- `asker`'s badge reads Idle, and the pane shows no plugin hint.

**May differ**

- Any other plugins you have installed.
- The version shown, as long as it is 0.1.0 or later.

**If not: `asker` shows a one-line plugin hint, "No events from the event-bridge plugin."** If Claude Code is still showing a prompt in the pane, answer it; the hint clears on its own. Otherwise click **Copy** on the hint, press `Ctrl+B 1` to bring back the PowerShell pane, paste and press Enter. Press `Ctrl+B 2` to return to `asker` and type `/reload-plugins`. The hint clears and the badge turns Idle.

**If not: `event-bridge` is listed but disabled.** Enable it on the `/plugin` screen, then type `/reload-plugins`.

**If not: the version is older than 0.1.0.** In the PowerShell pane (`Ctrl+B 1`), run `claude plugin update event-bridge@event-bridge`. Then `Ctrl+B 2` and type `/reload-plugins` in `asker`.

### 3. Open `answerer` beside it

**Do**

1. Press `Ctrl+B %` to split the stage. `asker` stays on the left, and the PowerShell pane from step 1 comes back on the right.
2. Press `Ctrl+B O` to move focus to the right pane.
3. Press `Ctrl+B N`, choose **Claude**, label it `answerer` and click **Start Terminal**. `answerer` takes the right pane. The PowerShell terminal keeps running behind it.
4. Wait until `answerer`'s badge reads Idle. There is no trust prompt this time, because you trusted the folder in step 2.

Teaching line: `Ctrl+B N` always fills the focused pane, which is why the split comes first.

**You should see:** `03-two-agents.webp`. `asker` on the left, `answerer` on the right, both at Claude Code's prompt.

**Must match**

- The rail lists `powershell`, `asker` and `answerer`, in that order.
- Both Claude badges read Idle, and neither pane shows a plugin hint.

**May differ**

- The port number in the rail header.
- Claude Code's welcome text and model name.

**If not: `answerer` shows the plugin hint.** Do step 2's fix in `answerer`'s pane: `/reload-plugins` goes into `answerer`.

### 4. Send `answerer` a message yourself

**Do**

1. Click the **Mission Control** icon (the network icon) in the rail's bottom toolbar, or press `Ctrl+K` and choose **Mission Control**.
2. Under **Dispatch Prompt / Handoff Task**, tick **Dispatch as User**. **From Agent** greys out and reads **You**.
3. Check that **To Agent** is `answerer`.
4. Paste the message below into the message box and click **Dispatch Task**.

**Paste into Mission Control's message box**

```text
Say hello in one short sentence, then tell me the name of the folder you are working in.
```

Teaching line: with **Dispatch as User**, the message lands in `answerer` exactly as if you had typed it there. Messages from another agent arrive with a `[Peer agent (<name>)]:` prefix instead, as step 6 shows.

**You should see:** `04-dispatch-as-user.webp`. Mission Control's **Live A2A Message Trail** with one entry, `You → answerer`, tagged **as user**, status **Completed**, and `answerer`'s answer under **Reply**. A toast in the top right showed the message as it left.

**Must match**

- The entry reads `You → answerer` and carries the **as user** tag.
- Its status is **Completed**.
- The reply names the folder `hello-a2a`.

**May differ**

- The greeting's wording.
- The time on the entry.

**If not: the entry stays on Working for more than a minute.** Close Mission Control and look at `answerer`'s pane. If it shows the plugin hint, do step 2's fix there, then dispatch again.

### 5. `asker` finds its peers

**Do**

1. Close Mission Control with **×** or `Esc`.
2. Click into the `asker` pane, or press `Ctrl+B O` until its border is highlighted.

**Paste into `asker`**

```text
Call the quay_list_agents tool and list every agent it returns, one per line, with its name, run kind, level and status.
```

**You should see:** `05-list-agents.webp` (pane). A `quay_list_agents` tool call in `asker`, then two lines.

**Must match**

- `asker`'s pane shows a `quay_list_agents` tool call.
- Exactly two agents: `asker` and `answerer`, both run kind `claude`, both full peers. The PowerShell terminal is not a peer, so it isn't listed.
- `answerer` is Idle. `asker` is Working, because it is busy running this request.

**May differ**

- How the list is laid out.
- Whether `asker` also shows terminal ids or task titles.

**If not: `asker` says it has no `quay_list_agents` tool.** Only Claude Code terminals that Quay starts get the `quay` tools. Type `/mcp` in `asker`: `quay` should show as connected. If it doesn't, close `asker` and open it again as in step 2.

### 6. `asker` asks, and waits for the reply

**Paste into `asker`**

```text
Use quay_send_message to send answerer this message, and wait for the reply: Read package.json and reply in one line with the package name, its version and the names of its scripts. When the reply comes back, quote it to me exactly.
```

**You should see:** `06-reply-quoted.webp`. The message arrives in `answerer` as `[Peer agent (asker)]: Read package.json ...` and `answerer` answers it. In `asker`, the `quay_send_message` call returns `Reply from answerer:` with that answer, and `asker` quotes it.

**Clip:** `06-reply-quoted.mp4`, with the still as its poster. Caption describes what moves: the toast appears as the message leaves `asker`, `answerer`'s badge goes Working and then Idle, and the toast turns **DONE** with the reply.

**Must match**

- The message arrives in `answerer` with the `[Peer agent (asker)]:` prefix.
- `asker`'s quote names `hello-a2a`, `0.3.0`, and the scripts `greet`, `test` and `typecheck`.
- Both badges read Idle at the end.

**May differ**

- The agents' wording.
- How long it takes (up to 60 seconds).
- Whether `asker` calls `quay_list_agents` again first.

**If not: `asker` says `answerer`'s event-bridge plugin isn't reporting.** `answerer`'s pane shows the plugin hint. Do step 2's fix in `answerer`, then paste this step's prompt into `asker` again.

**If not: `asker` says `answerer` received the task but is still working.** `answerer` took longer than the 60 seconds a reply waits. Wait until `answerer`'s badge reads Idle, then paste this step's prompt again. Work that takes longer goes through a file mailbox, which a later tutorial teaches.

**If not: the message appears twice in `answerer`.** Your event-bridge plugin is an old build. Update it as in step 2, then `/reload-plugins` in both panes.

### 7. `asker` checks on `answerer`

**Paste into `asker`**

```text
Call quay_get_agent_status for answerer and tell me in one line its status and its last task.
```

**You should see:** `07-agent-status.webp` (pane). A `quay_get_agent_status` call in `asker`, then one line.

**Must match**

- `asker`'s pane shows a `quay_get_agent_status` tool call.
- `answerer`'s status is Idle.
- Its last task mentions `package.json`.

**May differ**

- The auto-approved count.
- How the task is shortened.

### 8. `asker` tells everyone

**Paste into `asker`**

```text
Call quay_broadcast with the text: Hello, A2A is working. Then tell me it was sent.
```

Teaching line: a broadcast never waits for replies. Whatever `answerer` says back stays in its own pane.

**You should see:** `08-broadcast.webp`. A **Swarm Broadcast** toast in the top right with `Hello, A2A is working.`, and `answerer`'s pane showing `[Broadcast Notice]: Hello, A2A is working.` with a short acknowledgement.

**Must match**

- `answerer`'s pane shows `[Broadcast Notice]: Hello, A2A is working.`
- `asker`'s own pane does not.

**May differ**

- What `answerer` says back.
- Whether you caught the toast: it leaves after 7 seconds. The notice in `answerer` is the lasting evidence.

### 9. Check it worked

**Do**

1. Press `Ctrl+B O` to focus the right pane, then `Ctrl+B 1` to show the PowerShell terminal there.
2. Paste the line below. It prints nothing, because the agents only read.
3. Open Mission Control again and read the **Live A2A Message Trail**.

**Paste into the PowerShell pane**

```text
git status --short
```

**You should see:** `09-message-trail.webp`. Mission Control's trail, newest first: `Broadcast → answerer`, `asker → answerer` with the `package.json` reply, and `You → answerer` tagged **as user**.

**Must match**

- Three entries, in that order.
- `asker → answerer` is **Completed**, and its reply names `hello-a2a` and `0.3.0`.
- `You → answerer` is **Completed** and tagged **as user**.

**May differ**

- The times, and the wording of each reply.
- Whether the broadcast entry shows `answerer`'s acknowledgement as its reply.

**You're done when**

- The trail shows all three messages, and the two you or `asker` sent are Completed with replies.
- `asker`'s pane quotes a reply naming `hello-a2a` and `0.3.0`.
- `git status --short` printed nothing.

**Next up:** A2A 2, Contract-first handoff.

## Screenshot list

Full-window captures of Quay unless noted. Names are the step markers.

| File | Shows | Must-match anchors |
| --- | --- | --- |
| `01-starter-installed.webp` | One PowerShell pane after `npm install` | `Starter` commit, `added` line |
| `02-plugin-check.webp` | `asker` pane (crop), `/plugin` list | `event-bridge` enabled |
| `03-two-agents.webp` | Split, `asker` left, `answerer` right | rail order, two Idle badges |
| `04-dispatch-as-user.webp` | Mission Control over the stage, one trail entry | `You → answerer`, as user, Completed |
| `05-list-agents.webp` | `asker` pane (crop) | `quay_list_agents` call, two agents |
| `06-reply-quoted.webp` | Both panes, toast | `[Peer agent (asker)]:`, `hello-a2a`, `0.3.0` |
| `06-reply-quoted.mp4` | The clip, still above as poster | toast, Working to Idle, DONE |
| `07-agent-status.webp` | `asker` pane (crop) | `quay_get_agent_status` call, Idle |
| `08-broadcast.webp` | Both panes, broadcast toast | `[Broadcast Notice]:` in `answerer` only |
| `09-message-trail.webp` | Mission Control over the stage, three entries | entry order, Completed, as user |

**Fixture recording:** one whole run, three terminals (two Claude casts with their bridge logs, one PowerShell cast), markers `01` to `09`. Steps 4 and 9 are Quay UI the capture script drives itself: it ticks **Dispatch as User** and clicks **Dispatch Task** over CDP, and the replayed `answerer` turn answers it.

**Clip:** step 6, as above. It needs the timed replay that "Decide: How do screenshots show realistic agent output?" chose, because terminal output moves in it.

## Code this tutorial depends on

Already on the fix-first list: terminals kept in creation order (rail order in step 3), the plugin hint and the Starting, Idle and Unknown rules (step 2), wrong replies and listener answers (step 6), swallowing the `Ctrl+B` prefix (every step), and peer levels in `quay_list_agents` (step 5).

New gaps found while drafting are open questions 4 to 9.

## Open questions, in order

1. **Where the `/plugin` check sits.** The page template says step 1 is always "Get the starter project". The event-bridge decision says A2A 1 opens with the `/plugin` check. Plugins don't load until the folder is trusted, so the check needs the starter first. Proposed: the check is step 2, the first card after the starter, together with opening `asker`.
2. **Two terminals by hand, not a preset.** No built-in preset is two plain Claude agents. Full-Stack Pair and Red/Blue Team carry roles, and their team briefings would name the `quay_*` tools before the lesson does. Proposed: by hand, with `Ctrl+B N`, `Ctrl+B %`, `Ctrl+B O`, `Ctrl+B N`. The order matters: the step 1 PowerShell terminal means "`Ctrl+B N` twice, then `Ctrl+B %`" (the template sample's order) would pair `asker` with PowerShell.
3. **All four tools in one Starter tutorial.** Proposed: yes, one call each in steps 5 to 8, as the charting idea says. Depth stays with later tutorials: polling status in Fire-then-poll, broadcasts in Broadcast.
4. **Gap: "Dispatch as User" doesn't exist as named.** The code has a checkbox labelled "Send directly without peer attribution (as user prompt)", and still needs a From Agent, so the trail credits `asker` for a message the learner wrote. Proposed: join the fix-first list. Relabel it **Dispatch as User**; when ticked, From Agent greys out and reads **You**, and the trail shows `You → answerer`. Step 4 is written that way.
5. **Gap: the panel has three names and stale text.** Its header says "A2A Orchestration Bus", the command palette "Agent-to-Agent (A2A) Bus", and the docs "Mission Control". Its banner says every agent terminal, Antigravity included, gets the `quay` MCP server, which the bus decision contradicts. Its × button's tooltip says "Close Panel (Esc)", but `Esc` does nothing. Proposed: join the fix-first list. One name, **Mission Control** (A2A 8's slug already uses it), on the header, the rail tooltip and the palette entry; the banner rewritten for full peers and listeners; `Esc` closes it. The glossary gains Mission Control.
6. **Gap: a waited message shows up late.** `quay_send_message` with `wait_for_reply` emits the events behind the toast and the live trail update only after the reply lands, so no toast shows while `answerer` works. The trail's order also flips: live updates go on top, but the 3-second poll puts the oldest first. Proposed: join the fix-first list. Emit the toast and trail entry at delivery, and order the trail newest first in the backend. The step 6 clip depends on it.
7. **Gap: `quay_get_agent_status` takes only a terminal id.** `quay_send_message` also accepts a name, so `asker` can send to `answerer` by name but can't check its status by name. And the task title it reports is cut from the typed prompt, so it starts with the `[Peer agent (asker)]:` prefix. Proposed: join the fix-first list. Resolve names the same way in both tools, and strip the prefix when Quay sets the task title.
8. **Gap: `quay_broadcast` reaches the sender too.** It types the notice into every agent terminal, the caller's own included, so `asker` gets its own broadcast as a new prompt. Proposed: join the fix-first list. Skip the caller. Mission Control's own Broadcast box still reaches every peer.
9. **Gap: `quay_list_agents` lists shell terminals.** It returns every terminal, PowerShell included; the bus decision only says Archon is left out. Proposed: list peers only, as part of the "is a peer" test the bus build already adds. Step 5's Must match counts two.
10. **A Paste slot outside a pane.** Step 4 pastes into Mission Control's message box, not a terminal pane. Proposed: the Paste slot may name a Quay field (`::: paste Mission Control`), and the build-time slot check accepts it.
11. **The clip.** Proposed: step 6, the message crossing from `asker` to `answerer` and the reply coming back, shown with timed replay. The risk is a round trip longer than ten seconds; the clip is trimmed to delivery and reply. Fallback: step 4, the toast and the trail entry turning Completed.
12. **The check-it-worked evidence.** Mission Control's trail is Quay, but not a pane. The pane evidence is `asker`'s quote from step 6 and `git status --short` printing nothing. Proposed: the trail counts as this tutorial's evidence, because the trail is the lesson, and the pane evidence goes in You're done when.
13. **Level.** Starter: two Claude agents, nine step cards, nine screenshots, one clip.
