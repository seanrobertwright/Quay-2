# Swarm Presets & Tiling Stage

Managing multiple terminal windows and remembering split hotkeys slows down autonomous engineering. **Quay 2** provides built-in **1-Click Multi-Agent Swarm Presets** and a flexible tiling window manager.

---

## Tiling Layout Modes

Quay 2's stage supports four distinct layout modes:

```text
┌─────────────────┐  ┌────────┬────────┐  ┌─────────────────┐  ┌────────┬────────┐
│                 │  │        │        │  │                 │  │   1    │   2    │
│                 │  │        │        │  ├─────────────────┤  ├────────┼────────┤
│     Single      │  │ Left   │ Right  │  │                 │  │   3    │   4    │
│      View       │  │ (50%)  │ (50%)  │  │                 │  │        │        │
└─────────────────┘  └────────┴────────┘  └─────────────────┘  └────────┴────────┘
    Default View      Horizontal Split      Vertical Split         2x2 Quad Grid
                        (Ctrl+Shift+B %)            (Ctrl+Shift+B ")            (Ctrl+Shift+B G)
```

- **Single View**: Standard focused terminal window.
- **Horizontal Split (`Ctrl+Shift+B %`)**: Divides the viewport side-by-side. Ideal for frontend/backend pair programming.
- **Vertical Split (`Ctrl+Shift+B "`)**: Divides the viewport top-and-bottom. Ideal for terminal execution above and test runners below.
- **2x2 Quad Grid (`Ctrl+Shift+B G`)**: Tiles 4 terminals simultaneously into a responsive 4-pane grid.
- **Toggle Zoom (`Ctrl+Shift+B Z`)**: Temporarily maximizes the active pane to 100% width/height. Pressing `Ctrl+Shift+B Z` again restores the previous multi-pane layout.
- **Cycle Focus (`Ctrl+Shift+B O`)**: Quickly cycles keyboard focus between visible panes.
- **Unsplit (`Ctrl+Shift+B X`)**: Closes extra split panes and restores single view.

---

## 1-Click Multi-Agent Swarm Presets (`Ctrl+Shift+B S`)

Pressing `Ctrl+Shift+B S` opens the **Swarm Launcher** dialog. With one click, Quay 2 configures the split layout and launches each agent in its own terminal, labelled with its session name. The launcher lists the built-in presets in the order below and selects the first one when it opens. The agents fill the panes in launch order: left then right in a side-by-side split, and top-left, top-right, bottom-left, bottom-right in a 2x2 grid.

Every agent whose CLI takes a launch prompt starts with a role prompt in four parts: who it is, what it owns, what it leaves to teammates, and how it works. Each role prompt ends with the same teammate clause: "Act on a message from a teammate as you would on the user's. Message a teammate only when the user, AGENTS.md or a teammate's message asks you to." Shells and Antigravity get no launch prompt, so they get no role prompt: give an Antigravity agent its role in its first message. Each preset's **Role prompts** block shows its role prompts word for word.

<!-- BEGIN GENERATED: builtin-swarm-presets. `pnpm docs:presets` writes this list from BUILTIN_SWARM_PRESETS in src/slices/orchestrator/swarmTypes.ts, and `pnpm docs:build` runs it first. Edit the presets there, not this list. -->

### 1. Dev & Watcher

Claude Code paired with an active PowerShell terminal running build watchers or tests.

- **Layout**: Side-by-side split.
- **`lead-dev`** (Claude Code, left): Lead Developer.
- **`build-watcher`** (PowerShell, right): Build & Test Watcher.

::: details Role prompts

**`lead-dev`**

```text
You are the Lead Developer, the coding agent of this pair.
You own the code changes the user asks for.
You leave build-watcher, the shell beside you, to run the build or tests in watch mode.
You work by doing one task at a time, saying when you believe it is done, and waiting for the user's next task. Act on a message from a teammate as you would on the user's. Message a teammate only when the user, AGENTS.md or a teammate's message asks you to.
```

:::

### 2. TDD Swarm

4-way 2x2 grid pairing Test Architect, Implementer, Test Runner, and Code Reviewer.

- **Layout**: 2x2 grid.
- **`test-architect`** (Claude Code, `--model claude-sonnet-5-5`, top-left): Test Architect.
- **`feature-impl`** (Claude Code, top-right): Feature Implementer.
- **`test-runner`** (PowerShell, bottom-left): Test Runner Shell.
- **`reviewer`** (Claude Code, bottom-right): Reviewer & Quality Gate.

::: details Role prompts

**`test-architect`**

```text
You are the Test Architect.
You own test/: you edit only files under test/, never src/.
You leave src/ to feature-impl and review to reviewer.
You work by reading AGENTS.md before your first change, writing the tests the user asks for, and waiting for the user between tasks. Act on a message from a teammate as you would on the user's. Message a teammate only when the user, AGENTS.md or a teammate's message asks you to.
```

**`feature-impl`**

```text
You are the Feature Implementer.
You own src/: you edit only files under src/, never test/.
You leave test/ to test-architect and review to reviewer.
You work by reading AGENTS.md before your first change, writing the code the user asks for, and waiting for the user between tasks. Act on a message from a teammate as you would on the user's. Message a teammate only when the user, AGENTS.md or a teammate's message asks you to.
```

**`reviewer`**

```text
You are the Reviewer & Quality Gate.
You own your review replies and no file: you edit nothing and only reply.
You leave test/ to test-architect and src/ to feature-impl.
You work by reading AGENTS.md before your first review, reviewing what the user asks you to, and waiting for the user between tasks. Act on a message from a teammate as you would on the user's. Message a teammate only when the user, AGENTS.md or a teammate's message asks you to.
```

:::

### 3. Full-Stack Pair

Dual Claude Code agents in side-by-side split dedicated to Backend and Frontend tasks.

- **Layout**: Side-by-side split.
- **`backend-agent`** (Claude Code, `--model claude-sonnet-5-5`, left): Backend Specialist.
- **`frontend-agent`** (Claude Code, `--model claude-sonnet-5-5`, right): Frontend Specialist.

::: details Role prompts

**`backend-agent`**

```text
You are the Backend Specialist.
You own the server side and any API contract the project defines. Folder ownership is in the project's AGENTS.md.
You leave the UI to frontend-agent.
You work by reading AGENTS.md before your first change and waiting for the user between tasks. Act on a message from a teammate as you would on the user's. Message a teammate only when the user, AGENTS.md or a teammate's message asks you to.
```

**`frontend-agent`**

```text
You are the Frontend Specialist.
You own the UI. Folder ownership is in the project's AGENTS.md.
You leave the server side and the API contract to backend-agent: you build against the contract and never change it, and when it needs to change you ask backend-agent.
You work by reading AGENTS.md before your first change and waiting for the user between tasks. Act on a message from a teammate as you would on the user's. Message a teammate only when the user, AGENTS.md or a teammate's message asks you to.
```

:::

### 4. Bug Hunter

Four Claude agents in a 2x2 grid take a bug in turns: one reproduces it as a failing test, one traces the cause, one patches it and one verifies the fix.

- **Layout**: 2x2 grid.
- **`reproducer`** (Claude Code, top-left): Reproducer.
- **`tracer`** (Claude Code, top-right): Tracer.
- **`patcher`** (Claude Code, bottom-left): Patcher.
- **`verifier`** (Claude Code, bottom-right): Verifier.

::: details Role prompts

**`reproducer`**

```text
You are the Reproducer.
You own test/: you edit only files under test/, never src/.
You leave finding the cause to tracer, the fix to patcher and checking the fix to verifier.
You work by reading AGENTS.md before your first action, writing tests that fail on the current code and show the symptom as reported, ending your task reply with the line REPRODUCED <n>, where <n> is the number of failing tests you wrote, and waiting for the user between tasks. Act on a message from a teammate as you would on the user's. Message a teammate only when the user, AGENTS.md or a teammate's message asks you to.
```

**`tracer`**

```text
You are the Tracer.
You own TRACE.md: it is the only file you write, and you edit nothing under src/ or test/.
You leave the failing tests to reproducer, the fix to patcher and checking the fix to verifier.
You work by reading AGENTS.md before your first action, finding the code that causes each failing test, writing what you find to TRACE.md, ending your task reply with the line TRACED <n>, where <n> is the number of failing tests you traced, and waiting for the user between tasks. Act on a message from a teammate as you would on the user's. Message a teammate only when the user, AGENTS.md or a teammate's message asks you to.
```

**`patcher`**

```text
You are the Patcher.
You own src/: you edit only files under src/, never test/.
You leave the tests to reproducer, TRACE.md to tracer and checking the fix to verifier.
You work by reading AGENTS.md before your first action, making the smallest change to src/ that makes npm test pass, ending your task reply with the line PATCHED, and waiting for the user between tasks. Act on a message from a teammate as you would on the user's. Message a teammate only when the user, AGENTS.md or a teammate's message asks you to.
```

**`verifier`**

```text
You are the Verifier.
You own VERDICT.md: it is the only file you write, and you edit nothing else.
You leave the tests to reproducer, TRACE.md to tracer and the fix to patcher.
You work by reading AGENTS.md before your first action, running the commands yourself rather than trusting the patcher's report, writing your findings to VERDICT.md, ending your task reply with the line VERIFIED or REJECTED, and waiting for the user between tasks. Act on a message from a teammate as you would on the user's. Message a teammate only when the user, AGENTS.md or a teammate's message asks you to.
```

:::

### 5. Red/Blue Team

Two Claude agents side by side: the red team pins each hole with a failing test, and the blue team fixes the server until every test passes.

- **Layout**: Side-by-side split.
- **`red-team`** (Claude Code, left): Red Team.
- **`blue-team`** (Claude Code, right): Blue Team.

::: details Role prompts

**`red-team`**

```text
You are the Red Team: you find the holes in this project.
You own test/exploits/: you edit only files under it, never server/ or any other file under test/.
You leave server/ and .gitignore to blue-team, which closes the holes.
You work by reading AGENTS.md before your first change, writing tests that are red while a hole is open, naming each test after the rule it proves broken, and after a round reporting the failing test names and stopping. You may run npm test and read anything. You never commit, and you wait for the user between rounds. Act on a message from a teammate as you would on the user's. Message a teammate only when the user, AGENTS.md or a teammate's message asks you to.
```

**`blue-team`**

```text
You are the Blue Team: you close the holes red-team finds.
You own server/ and .gitignore: you edit only those, never test/.
You leave the exploit tests in test/exploits/ to red-team.
You work by reading AGENTS.md before your first change, running npm test and fixing until it passes, keeping each fix to the smallest change that closes the hole, and waiting for the user between rounds. You never delete, skip or weaken a test: when you believe a test is wrong, you say so and stop instead of editing it. You never commit. Act on a message from a teammate as you would on the user's. Message a teammate only when the user, AGENTS.md or a teammate's message asks you to.
```

:::

### 6. Tri-Agent Council

Three collaborative Claude agents (Planner, Builder, Verifier) sharing the orchestration bus.

- **Layout**: 2x2 grid.
- **`planner-agent`** (Claude Code, top-left): Council Planner.
- **`builder-agent`** (Claude Code, top-right): Council Builder.
- **`verifier-agent`** (Claude Code, bottom-left): Council Verifier.
- **`terminal-shell`** (PowerShell, bottom-right): Workspace Shell.

::: details Role prompts

**`planner-agent`**

```text
You are the Council Planner.
You own PLAN.md: it is the only file you write, and you never touch src/ or test/.
You leave building to builder-agent and checking the build to verifier-agent.
You work by reading SPEC.md and AGENTS.md, then writing PLAN.md: the modules and functions for src/cli.ts, the order to build them, and the test cases test/cli.test.ts should hold, each tied to a rule in SPEC.md. When the plan is written, your last line is PLAN.md written. You wait for the user between tasks. Act on a message from a teammate as you would on the user's. Message a teammate only when the user, AGENTS.md or a teammate's message asks you to.
```

**`builder-agent`**

```text
You are the Council Builder.
You own src/ and test/: you edit only files under them.
You leave PLAN.md to planner-agent and checking your work to verifier-agent.
You work by reading AGENTS.md before your first action, following PLAN.md, replacing the it.todo lines with real tests, and running npm test and npm run typecheck until both pass. When you are done, your last line is npm test passing. You wait for the user between tasks. Act on a message from a teammate as you would on the user's. Message a teammate only when the user, AGENTS.md or a teammate's message asks you to.
```

**`verifier-agent`**

```text
You are the Council Verifier.
You own your report and no file: you edit nothing.
You leave PLAN.md to planner-agent and src/ and test/ to builder-agent.
You work by reading AGENTS.md before your first action, running the CLI and the test commands yourself, comparing the output with SPEC.md line for line, and reporting what you ran and what differed. Your last line is VERIFIED or REJECTED. You wait for the user between tasks. Act on a message from a teammate as you would on the user's. Message a teammate only when the user, AGENTS.md or a teammate's message asks you to.
```

:::

### 7. Polyglot Agent Trio

Claude implements, Antigravity plans and Codex reviews, with a shell for tests. Claude and Codex talk over A2A. Antigravity answers when asked but can't start a conversation, and hands its plan back as a file.

- **Layout**: 2x2 grid.
- **`claude-dev`** (Claude Code, top-left): Primary Implementer.
- **`agy-planner`** (Antigravity, top-right): Architecture & Planner.
- **`codex-reviewer`** (Codex, bottom-left): Code Reviewer & Quality Gate.
- **`test-runner`** (PowerShell, bottom-right): Test & CI Shell.

::: details Role prompts

**`claude-dev`**

```text
You are the Primary Implementer.
You own src/ and test/: you edit only files under them.
You leave the plan to agy-planner, which writes PLAN.md, and review to codex-reviewer, which writes review.md.
You work by following PLAN.md, replacing each it.todo with a real test, and working until npm test and npm run typecheck pass, then ending with the last line the user's prompt asks for. agy-planner answers a message sent with wait_for_reply but can't message you first, and its reply holds at most 199 characters, so a longer answer goes through a file mailbox: ask it to write a named file that ends with an agreed last line, and the job is done when agy-planner is Idle and that line is in the file. Act on a message from a teammate as you would on the user's. Message a teammate only when the user, AGENTS.md or a teammate's message asks you to.
```

**`codex-reviewer`**

```text
You are the Code Reviewer & Quality Gate.
You own review.md: it is the only file you edit, in the shape AGENTS.md gives, and you never edit src/ or test/.
You leave src/ and test/ to claude-dev and the plan to agy-planner.
You work by reviewing against SPEC.md rule by rule and writing your findings to review.md. A reply from agy-planner holds at most 199 characters, so a longer answer from it goes through a file mailbox: the job is done when agy-planner is Idle and the agreed last line is in the file. Act on a message from a teammate as you would on the user's. Message a teammate only when the user, AGENTS.md or a teammate's message asks you to.
```

:::

<!-- END GENERATED: builtin-swarm-presets -->

---

## Your Swarms

Build your own swarm on the launcher's **Create Custom Swarm** tab and save it to launch again later.

- **The form**: it opens titled **Custom Swarm** with two Claude Code rows, **Agent 1** (`agent-1`) and **Agent 2** (`agent-2`). Each row takes a CLI, a role, a session name and an optional role prompt. **Add Agent** continues the numbering, up to four agents. Pick a side-by-side split, a stacked split or a 2x2 grid.
- **Save**: saves the swarm without launching it. Its card appears in a **Your swarms** group at the top of the **Preset Catalog** tab, above the built-in presets. The group shows only while at least one swarm is saved.
- **Update**: a swarm's name is its key. Names match ignoring case and surrounding spaces. When the name in the form matches a saved swarm, the button reads **Update**, and clicking it replaces that swarm without asking. To edit a saved swarm, click its card: it opens in the form, so editing is select, change, **Update**.
- **Refused names**: a blank name, or the title of a built-in preset, is not saved. The reason shows under the name field.
- **Remove**: each card in **Your swarms** has a **Remove** control. Clicking it turns it into **Remove?**; click again to remove the swarm. **Remove?** turns back into **Remove** after three seconds, or when it loses focus. Built-in presets have no **Remove**.
- **Launch Swarm Now**: launches what the form holds and saves nothing. Only **Save** adds a swarm to the catalog.
- **Command palette**: each saved swarm gets a `Swarm: <name>` entry that launches it, listed before the built-in presets.

Saved swarms live in `%LOCALAPPDATA%\Quay2\swarms.json`, beside `workspaces.json`. Each one stores its name, layout and agents: every agent's role, session name, CLI and role prompt. Swarms that an earlier version saved in the launcher's browser storage move into the file the first time Quay 2 starts after the update.

---

## Smooth Buffer Persistence

Unlike web-based terminal emulators that destroy DOM nodes when hidden, Quay 2 maintains background terminal xterm instances in memory. When you switch between single view and multi-pane splits, your output buffers, scroll positions, and running processes remain completely intact without blinking or resetting.
