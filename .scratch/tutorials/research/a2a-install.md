<!-- markdownlint-configure-file
{ "MD013": { "tables": false, "code_blocks": false } }
-->

# Research: what a user needs installed for A2A to work

Ticket: [#6](https://github.com/seanrobertwright/Quay-2/issues/6), parent map
[#2](https://github.com/seanrobertwright/Quay-2/issues/2). Researched 2026-10-18
against Quay `master` at `6255f57`, the `claude-mod-events` repository at `main`
(`a6b9640`), and the Claude Code docs and changelog as published on that date.

Question: what must be installed and configured on a user's machine for every A2A
tutorial to work end to end: sending a message, receiving it, and getting a reply
back through `wait_for_reply`?

## Answer in brief

- **Claude Code**, installed with the native installer so `claude.exe` is on
  `PATH`, signed in, at **v2.1.296 or later**. v2.1.287 is the documented floor
  for mods, and v1.0.27 is the floor for the HTTP MCP config Quay injects, but the
  plugin below was built and tested against v2.1.296.
- **The `event-bridge` plugin** from the public GitHub repository
  `seanrobertwright/claude-mod-events`, installed at user scope. Quay neither
  bundles nor installs it. Without it, messages are delivered but no reply ever
  resolves: `wait_for_reply` waits its full 60 seconds and then returns a "still
  working" note, and Mission Control never marks a message completed.
- **PowerShell 7 (`pwsh.exe`)** for any Swarm preset with a shell pane. Quay
  launches `pwsh.exe` with no fallback to Windows PowerShell 5.1.
- **Skip permissions** is the mode that keeps agents from stalling. The Swarm
  launcher always uses it. Claude Code shows a one-time "bypass permissions"
  acceptance dialog the first time it runs in that mode, and the workspace trust
  dialog in each folder not yet trusted.
- **`quay_*` calls need no approval in Skip mode.** In Quay's Normal mode they are
  subject to whatever mode Claude Code starts in. Pre-approve them with
  `"permissions": { "allow": ["mcp__quay__quay_*"] }` in `~/.claude/settings.json`.
- **Only Claude Code terminals take part fully in A2A.** Presets that mix in
  Antigravity, Codex, Kiro, Copilot or OpenCode can deliver messages *to* those
  agents, but those agents can't call `quay_*` tools and never answer a
  `wait_for_reply`.

## 1. The `event-bridge` plugin (`claude-mod-events`)

### What it is

`event-bridge` is a Claude Code **mod**: a plugin whose hooks module runs inside
Claude Code's own process. Its README describes it as "a Claude Code mod that lets
a program hosting Claude Code follow what each session does and steer it". It
sends session, turn, notification and tool events over HTTP to a listener the host
runs. It can also take prompts, interrupts and toasts back from the host, and it
can let the host decide permission prompts. Its wire protocol is
`PROTOCOL.md` in that repository ("event-bridge wire protocol, version 1").

Quay's bridge (`src-tauri/src/slices/bridge/routes.rs`, `create_router`) is a host
for that protocol: `POST /v1/events`, `GET /v1/commands` and `POST /v1/permission`.
In the `RunKind::Claude` branch of `PtySession::spawn`
(`src-tauri/src/slices/pty/session.rs`), Quay sets the plugin's variables on every
Claude Code terminal:

| Variable | Value Quay sets | What the plugin does with it |
| --- | --- | --- |
| `CLAUDE_EVENTS_URL` | `http://127.0.0.1:<bridge port>` (base URL, no path) | Base URL; the plugin appends `/v1/events` and the other paths |
| `CLAUDE_EVENTS_TOKEN` | the terminal's random bridge token | Bearer token for every request |
| `CLAUDE_EVENTS_TAG` | the terminal id (`term-<uuid>`) | Echoed on every event; Quay routes by it |
| `CLAUDE_EVENTS_TOOLS` | `full` | Sends answers and tool data uncut, up to 1 MiB per event |
| `CLAUDE_EVENTS_PERMISSIONS` | `off` in Skip mode, `host` in Normal mode | `host` makes the plugin ask Quay before Claude Code shows a permission prompt |

Quay does not set `CLAUDE_EVENTS_COMMANDS`. On current plugin `main` that keeps
the command poll off (see the version gotcha below).

### Why A2A needs it

`wait_for_reply` resolves in one place only. `A2ARouter::dispatch_and_wait`
(`src-tauri/src/slices/orchestrator/router.rs`) registers a waiter for the target
terminal. `A2ARouter::resolve_pending_reply` wakes it, and the only caller of that
is the `"turn.completed"` arm of `handle_events` in
`src-tauri/src/slices/bridge/routes.rs`. That arm reads the event's `data.answer`
string, or uses `"Turn completed"` when it is missing. `turn.completed` is an
event the plugin emits from Claude Code's `turn.complete` hook (`hooks/register.ts`
in the plugin). Nothing else in Quay produces it.

What works without the plugin, and what doesn't:

| Step | Without the plugin | Why |
| --- | --- | --- |
| A Claude agent calls `quay_list_agents`, `quay_send_message`, `quay_broadcast`, `quay_get_agent_status` | Works | The MCP server comes from `--mcp-config`, not from the plugin |
| The target agent receives the message | Works | `A2ARouter::dispatch` types the text into the target's PTY with `PtyManager::submit_prompt` |
| `wait_for_reply` returns the target's answer | **Fails** | No `turn.completed` arrives. After 60 seconds `dispatch_and_wait` returns, as a success, `Peer agent (<id>) received the task but is still working...` |
| Mission Control shows the reply and marks the message completed | **Fails** | Same path: `resolve_pending_reply` is what marks it `Completed` |
| Status badges (Working, Idle, Waiting), the current-tool badge, auto task titles | Mostly fail | All driven by plugin events in `handle_events`. A dispatch sets the target to Working, and nothing sets it back |
| Quay's permission modal (Normal mode) | Fails | The plugin is what calls `POST /v1/permission` |

### Where it comes from

- Repository: <https://github.com/seanrobertwright/claude-mod-events>. It is
  **public** (GitHub reports `visibility: PUBLIC`), default branch `main`.
- Manifest: plugin `event-bridge`, version `0.1.0`, in a marketplace that is also
  named `event-bridge` (`.claude-plugin/marketplace.json`, plugin source `./`).
  So its full install id is `event-bridge@event-bridge`.
- The repository has **no tags, no releases and no license file**. GitHub's
  license field is empty. Users get whatever `main` holds when they install.
- **This machine's setup** loads the plugin from a local clone registered as a
  *directory* marketplace, not from GitHub. That clone is behind GitHub `main`
  and predates the commands gate described below. A general user can still get
  the plugin, because the GitHub repository is public and installable as a
  marketplace.

### How a general user installs it

Any of these, at user scope, which is the default for the shell command:

```powershell
# One step, from PowerShell (Claude Code v2.1.292 or later)
claude plugin install event-bridge --marketplace seanrobertwright/claude-mod-events

# Two steps, from PowerShell
claude plugin marketplace add seanrobertwright/claude-mod-events
claude plugin install event-bridge@event-bridge
```

```text
# One step, at a Claude Code prompt (v2.1.275 or later); it opens the details pane to pick a scope
/plugin install event-bridge --marketplace seanrobertwright/claude-mod-events
```

Sources: the Claude Code docs page *Install and manage plugins* ("Add a
marketplace and install in one command", "Install from your shell"), and the
plugin README's Install section.

After installing:

- Plugins installed from the shell load the next time Claude Code starts. Quay
  terminals opened after the install pick it up, and running ones need
  `/reload-plugins` or a relaunch.
- To check that it loaded, run `/plugin` in a Quay Claude terminal. A dim line
  under the tabs lists active mods, for example `1 mod active · event-bridge`
  (*Mods overview*, "See which mods a session loaded"). In Quay, the terminal's
  status badge should go to Working and back to Idle around a prompt.
- Third-party marketplaces do **not** auto-update by default (*Install and manage
  plugins*, "Keep plugins updated"). To update, run
  `claude plugin update event-bridge@event-bridge`, or use **Update marketplace**
  on the Marketplaces tab of `/plugin`.

Things that stop it from loading, from *Mods overview* ("Turn mods on or off"):
`--safe-mode`, `--bare`, `"disableAllHooks": true` in `~/.claude/settings.json`,
an organization's `allowManagedModsOnly`, and Anthropic turning installed mods off
remotely. A Quay user who adds `--bare` or `--safe-mode` as a custom flag loses
A2A replies.

### Version gotcha: older plugin builds deliver A2A messages twice

`A2ARouter::dispatch` sends every message two ways. It enqueues a `prompt`
command for the plugin's command poll (`BridgeState::enqueue_command`), and it
also types the text into the PTY. Plugin commit `9a78be3` (2026-10-14, "feat:
take commands only when the host turns them on with CLAUDE_EVENTS_COMMANDS")
made the poll opt-in. Before it, the inbox started whenever a token was set
(`Inbox.start` in the plugin's `hooks/inbox.ts` returns early only when there is
no token). Then the plugin would also submit the queued `prompt`, and the target
would get the message twice: once typed, once as a plugin prompt. Current `main`
never polls unless `CLAUDE_EVENTS_COMMANDS=host` is set, and Quay doesn't set it,
so the PTY path is the only delivery. Tutorials should tell users to install or
update the plugin from GitHub `main` as it stands now.

### Does Quay bundle or install it?

No. Searching the repository for `plugin install`, `--plugin-dir`, `marketplace`
and `enabledPlugins` finds nothing. The `bundle` section of
`src-tauri/tauri.conf.json` lists only icons, and the `v0.1.0` release assets
are only app packages. The name `claude-mod-events` appears only in docs
(`CONTRIBUTING.md`, `docs/reference/cli-flags.md`), in code comments, and in one
UI label ("Wire protocol: claude-mod-events" in
`src/slices/bridge/ActionLogDrawer.tsx`).

Options for a later code-gap ticket (not decided here): pass `--plugin-dir` with
a copy Quay ships (Claude Code loads a plugin from a directory for one session),
or detect a missing plugin and show the install command. Shipping a copy needs a
license on the plugin repository first.

## 2. Claude Code version and install

### Version floors

| Capability Quay relies on | First version | Source |
| --- | --- | --- |
| `claude --mcp-config <file>` | 0.2.75 | Claude Code `CHANGELOG.md`: "Run one-off MCP servers with `claude --mcp-config <path-to-file>`" |
| Custom headers on a remote MCP server | 0.2.106 | `CHANGELOG.md`: "MCP SSE server configs can now specify custom headers" |
| `"type": "http"` (Streamable HTTP) servers | 1.0.27 | `CHANGELOG.md`: "Streamable HTTP MCP servers are now supported" |
| Mods (function hooks) on by default in the terminal | 2.1.287 | *Mods overview*: "Mods are on by default. In the terminal, use Claude Code v2.1.287 or later." |
| `event-bridge` built and tested against | 2.1.296 | Plugin README |
| `claude plugin install --marketplace` from the shell | 2.1.292 | *Install and manage plugins* |
| `/plugin install --marketplace` in a session | 2.1.275 | *Install and manage plugins* |

The JSON Quay writes (`mcpServers.quay` with `type: "http"`, a loopback `url` and
an `Authorization: Bearer` header) matches the HTTP-with-headers example on the
Claude Code *MCP* docs page. The changelog has no separate entry for headers on
`http`-type servers, so whether 1.0.27 itself accepted that exact shape is not
established. It doesn't matter in practice, because the mod floor is far higher.

**Recommendation for tutorials:** "Claude Code 2.1.296 or later. Check with
`claude --version`." This machine runs 2.1.302.

### Install method

Quay starts Claude Code as `claude.exe` by name (`CommandBuilder::new("claude.exe")`
in the `RunKind::Claude` branch), so `claude.exe` must be on the `PATH` that Quay
inherits.

- The native installer (`irm https://claude.ai/install.ps1 | iex` in PowerShell)
  puts `claude.exe` in `%USERPROFILE%\.local\bin` (*Advanced setup*, uninstall
  steps). That is the path this machine uses, and it auto-updates.
- WinGet (`winget install Anthropic.ClaudeCode`) and npm
  (`npm install -g @anthropic-ai/claude-code`) are also official. Whether each one
  leaves a file named `claude.exe` on `PATH` was not checked. When the exact name
  is missing, portable-pty's Windows `search_path` (crate `portable-pty` 0.9.0,
  `cmdbuilder.rs`) tries the name with each `PATHEXT` extension in its place, so
  an npm `claude.cmd` shim might be picked up. That is untested.
- `docs/guide/installation.md` tells users to install with npm, and
  `docs/reference/cli-flags.md` says Quay runs `claude.cmd`. Both disagree with the
  code.
- Claude Code needs a Pro, Max, Team, Enterprise or Console account, or a
  third-party provider (*Advanced setup*, "Authenticate"). Sign in once in a plain
  terminal before starting agents in Quay.
- If Claude Code is installed while Quay is open, restart Quay so it picks up the
  new `PATH`. This follows from how Windows hands `PATH` to a new process. It
  was not tested here.

## 3. Permission mode for A2A: Skip or Normal (host)

### What Quay does in each mode

From `PtySession::spawn`, `handle_permission`
(`src-tauri/src/slices/bridge/routes.rs`) and the launch paths:

| | Skip | Normal ("Interactive Approvals") |
| --- | --- | --- |
| Claude Code flag | `--dangerously-skip-permissions` | none; Claude Code picks its own starting mode |
| `CLAUDE_EVENTS_PERMISSIONS` | `off` | `host` |
| Who answers a would-be prompt | Nobody; Claude Code doesn't prompt | The plugin asks Quay. Quay shows its approval modal, unless the terminal's live mode is Skip or the tool was allowed "for session" |
| Default for | New Terminal modal (`NewTerminalModal`, "Skip Permissions (Default)"), and the backend when no mode is sent (`RunKind::permission_mode`, which also keeps Pi at Skip) | Only when picked in the New Terminal modal |
| Swarm launcher | Always: `launchSwarm` in `src/slices/workspace/useWorkspace.ts` sends no `permission_mode`, and `SwarmModal` offers no choice | Not available |

### What Claude Code does in each

- `--dangerously-skip-permissions` is the same as
  `--permission-mode bypassPermissions`. It "skips permission prompts, except for
  the actions no mode auto-approves" (*Configure permissions*, permission modes).
  None of those exceptions applies to the `quay_*` tools: Quay's `tools/list`
  response sets no `_meta["anthropic/requiresUserInteraction"]`.
- The first interactive start with bypass enabled shows a **warning dialog**.
  Accepting it sets `skipDangerousModePermissionPrompt` in `~/.claude/settings.json`
  and the dialog doesn't come back. Declining exits Claude Code (*Choose a
  permission mode*, bypass acceptance). A Swarm launched before the user has ever
  accepted it is likely to show the dialog in every Claude pane, since they all
  start together. That is inferred, not tested.
- With no flag, a terminal session starts in **auto mode** on v2.1.283 or later,
  unless a settings `defaultMode` says otherwise, auto mode is turned off, or the
  model doesn't support it. Then it starts in Manual (*Choose a permission mode*,
  "Which mode a session starts in"). In auto mode, a classifier reviews actions
  that no allow, ask or deny rule decides, MCP tool calls among them. In Manual
  mode only reads run without asking.
- In an interactive session, Claude Code shows the **workspace trust dialog**
  when started in a folder the user hasn't trusted (*Security*, "Trust
  verification"). Whether the bypass flag skips it is not established. Plan for
  the user to accept it once per project folder.

### Where Normal mode stalls

- The plugin waits **at most 30 seconds** for Quay's decision
  (`PERMISSION_TIMEOUT_MS` in the plugin's `hooks/permission.ts`, and PROTOCOL.md
  "Permissions"). After that it falls back to Claude Code's own dialog in the
  pane. Quay keeps its modal open for up to 600 seconds (`handle_permission`), so
  an answer given in Quay's modal after 30 seconds goes nowhere.
- A target agent waiting on any approval doesn't finish its turn. The sender's
  `wait_for_reply` gives up after 60 seconds and returns the "still working" note.
- The status-strip live-mode toggle (`toggleTerminalLiveMode`) is shown for every
  agent terminal. It only changes anything for a terminal launched in Normal
  mode. A Skip terminal runs with bypass and with `CLAUDE_EVENTS_PERMISSIONS=off`,
  so switching it to Normal has no effect.

### What tutorials should say

- Use Skip for A2A tutorials. It is the only mode with no stalls, and Swarm uses
  it anyway. Say plainly what it means. Every agent runs shell commands and edits
  files without asking, and any agent can type prompts into another agent through
  the bus. Claude Code's own docs advise bypass mode only in isolated environments.
  Recommend a throwaway clone or a worktree of the starter project, and no
  secrets in the environment.
- Accept the one-time bypass dialog and the folder trust dialog in each pane on
  the first run. Screenshot both.
- If a tutorial uses Normal mode, pre-approve the `quay_*` tools (next section).
  Tell users to answer approvals in Quay's modal within 30 seconds, or in the pane
  after that.

## 4. Do `quay_*` tool calls need approval, and how to pre-approve them

Claude Code names MCP tools `mcp__<server>__<tool>`. Quay's server is named `quay`
(the `mcpServers.quay` key Quay writes), so the A2A tools are
`mcp__quay__quay_list_agents`, `mcp__quay__quay_send_message`,
`mcp__quay__quay_broadcast` and `mcp__quay__quay_get_agent_status`. The same
server also serves `mcp__quay__machina_submit_work_order`,
`mcp__quay__machina_get_work_order` and `mcp__quay__machina_submit_deliverable`
(`handle_mcp_request`, `tools/list`, in `src-tauri/src/slices/orchestrator/mcp.rs`).

| How the terminal runs | Does a `quay_*` call ask? |
| --- | --- |
| Quay Skip (bypass) | No |
| Quay Normal, Claude Code in Manual mode | Yes, on each tool's first use. The plugin routes the ask to Quay's modal (30-second limit), then to the pane |
| Quay Normal, Claude Code in auto mode | The classifier reviews the call unless an allow rule matches. Whether the plugin's `tool.check` sees an `ask` verdict in auto mode, and so whether Quay's modal ever shows, is not established |

How to pre-approve. These rule forms are from *Configure permissions*, "MCP" and
"Tool name wildcards":

```json
{
  "permissions": {
    "allow": ["mcp__quay__quay_*"]
  }
}
```

- `mcp__quay__quay_*` covers the A2A tools only. `mcp__quay` or `mcp__quay__*`
  covers every tool on the server, the Machina tools included. An allow glob is
  accepted only after a literal `mcp__<server>__` prefix. `mcp__*` on its own is
  skipped with a warning.
- Put the rule in **`~/.claude/settings.json`** (user scope). A rule in the
  project's `.claude/settings.json` is not used until the folder is trusted
  (*Configure permissions*, "What runs before you trust a folder").
- The CLI flag works too:
  `--allowedTools mcp__quay__quay_list_agents,mcp__quay__quay_send_message,mcp__quay__quay_broadcast,mcp__quay__quay_get_agent_status`
  as a custom flag. Quay splits custom flags on whitespace and passes them without
  a shell. But project default flags (`spawn_terminal` in
  `src-tauri/src/slices/pty/commands.rs`) are applied to every agent CLI in the
  project, and are skipped for any preset agent that has its own `custom_flags`.
  User settings are the simpler place.
- Allow rules have no effect in bypass mode, where they aren't needed. In auto
  mode a matching allow rule settles the call before the classifier.
- `--mcp-config` servers: the docs describe an approval prompt only for project
  `.mcp.json` servers. No approval step is documented for servers passed with
  `--mcp-config`.

## 5. Agent CLIs each built-in Swarm preset needs

Presets are `BUILTIN_SWARM_PRESETS` in `src/slices/orchestrator/swarmTypes.ts`.
The executable each run kind starts is in `PtySession::spawn`:

| Run kind | What Quay starts | Lookup |
| --- | --- | --- |
| `claude` | `claude.exe` with the A2A env vars and `--mcp-config` | `PATH` |
| `antigravity` | `agy.exe` | `PATH` |
| `codex` | `codex.exe` | `PATH` |
| `kiro` | `kiro-cli.exe chat` | `%LOCALAPPDATA%\Kiro-Cli\kiro-cli.exe`, else `PATH` |
| `copilot` | `copilot.exe` | `%LOCALAPPDATA%\GitHub CLI\copilot\copilot.exe`; else `gh.exe copilot` from `C:\Program Files\GitHub CLI\` or `PATH` |
| `opencode` | `opencode.exe` | `%USERPROFILE%\.bun\bin\opencode.exe`, else `PATH` |
| `powershell` | `pwsh.exe -NoProfile -NoLogo` | `PATH`. No fallback to `powershell.exe`, although `docs/reference/cli-flags.md` says there is one |

| Preset (`id`) | Agents (`name` → run kind) | Needs installed | A2A reach |
| --- | --- | --- | --- |
| Polyglot Agent Trio (`polyglot-trio`) | `claude-dev` → claude, `agy-planner` → antigravity, `codex-reviewer` → codex, `test-runner` → powershell | Claude Code, Antigravity CLI, Codex CLI, PowerShell 7 | Only `claude-dev` can call `quay_*` or answer `wait_for_reply` |
| Full-Stack Pair (`fullstack-pair`) | `backend-agent` → claude, `frontend-agent` → claude, each with `--model claude-sonnet-5-5` | Claude Code | Full, both ways |
| Dev & Watcher (`dev-and-watcher`) | `lead-dev` → claude, `build-watcher` → powershell | Claude Code, PowerShell 7 | One agent, so nothing to message except the shell pane |
| TDD Swarm (`tdd-swarm`) | `test-architect` → claude (`--model claude-sonnet-5-5`), `feature-impl` → claude, `test-runner` → powershell, `reviewer` → claude | Claude Code, PowerShell 7 | Full among the Claude agents |
| Tri-Agent Council (`tri-agent-council`) | `planner-agent`, `builder-agent`, `verifier-agent` → claude; `terminal-shell` → powershell | Claude Code, PowerShell 7 | Full among the Claude agents |
| Frontier Agent Federation (`frontier-federation`) | `claude-dev` → claude, `kiro-architect` → kiro, `copilot-assistant` → copilot, `opencode-verifier` → opencode | Claude Code, Kiro CLI, GitHub Copilot CLI (or `gh` with Copilot), OpenCode | Only `claude-dev` can call `quay_*` or answer `wait_for_reply` |

Notes:

- A message sent to a non-Claude agent or to a shell pane is still typed into
  that pane: `A2ARouter::dispatch` writes to any terminal's PTY. A `wait_for_reply`
  on it always runs the full 60 seconds, because only the plugin produces
  `turn.completed`. This confirms the map fact "Only Claude Code terminals get the
  `quay` MCP server and send `turn.completed`".
- A non-Claude agent can't simply be pointed at Quay's MCP server. The bridge
  port is random on each start (`BridgeServer::start` binds `127.0.0.1:0`), and a
  caller is identified by its per-terminal token, which only Claude terminals are
  given. Any other caller is recorded as `"agent"`.
- Each vendor CLI has its own sign-in. How each vendor's Windows installer names
  its executable, and whether it matches the names above, was not checked.
- PowerShell 7: `winget install --id Microsoft.PowerShell --source winget`
  (Microsoft Learn, *Install PowerShell 7 on Windows*). Windows installs Windows
  PowerShell 5.1 by default. PowerShell 7 is a separate install that runs side by
  side with it.
- Whether `claude-sonnet-5-5` is a model id every account can use was not checked.

## 6. Install checklist for the tutorials' prerequisites page

1. Windows 10 1809 or later, or Windows 11, and Quay (`Quay_0.1.0_x64-setup.exe`
   or the `.msi` from the `v0.1.0` release, or a source build).
2. Claude Code 2.1.296 or later from the native installer:
   `irm https://claude.ai/install.ps1 | iex`. Then `claude --version`, and sign
   in once with `claude`.
3. The plugin:
   `claude plugin install event-bridge --marketplace seanrobertwright/claude-mod-events`.
   Check that `/plugin` in a Claude session lists `event-bridge` as an active mod.
4. PowerShell 7: `winget install --id Microsoft.PowerShell --source winget`.
5. For Polyglot Agent Trio or Frontier Agent Federation only: the extra agent
   CLIs, signed in.
6. Optional, for Normal-mode tutorials: add `mcp__quay__quay_*` to
   `permissions.allow` in `~/.claude/settings.json`.
7. First run in each pane: accept the bypass-permissions warning (Skip mode) and
   the folder trust dialog.

## 7. Side findings for other tickets

None of these block this ticket. They came up while checking the answers above.

### Docs that disagree with the code

- `docs/guide/configuration.md` says `CLAUDE_EVENTS_URL` includes `/v1/events`.
  The code sets the base URL, which is what the plugin requires.
- `docs/guide/configuration.md` and `docs/reference/cli-flags.md` list
  `QUAY_TERMINAL_ID`, `QUAY_BRIDGE_PORT` and `ANTHROPIC_MODEL` as injected. The
  code sets none of them. They also leave out `CLAUDE_EVENTS_TOOLS` and
  `CLAUDE_EVENTS_PERMISSIONS`.
- `docs/reference/cli-flags.md` says Quay runs `claude.cmd`, and that `--model`
  and `--dangerously-skip-permissions` always come before `--mcp-config`. The code
  runs `claude.exe` and appends custom flags, `--model` among them, after
  `--mcp-config <path>`. `--mcp-config` takes several values (`<configs...>` in
  `claude --help`), so a custom flag that doesn't start with `-` is likely to be
  read as another config file.
- `docs/features/a2a-orchestration.md` says every session gets the tools. Only
  Claude sessions do. It also names a `target_terminal_id` parameter for
  `quay_get_agent_status` (the code uses `terminal_id`) and a `level` parameter
  for `quay_broadcast` (the code has none), shows a JSON reply shape the code
  doesn't return, and omits the Machina tools on the same server.
- The plugin README still calls the mod API "early access". The Claude Code docs
  now say mods are on by default from v2.1.287. That README is in the plugin's
  own repository.
- `PtySession::spawn` cites "ADR 0006", which doesn't exist in this repository.

### Code gaps that affect A2A tutorials

- **Subagent turns resolve replies early.** The plugin emits `turn.completed` for
  subagent turns too, with an `agentId` (PROTOCOL.md event table, and
  `turnCompletedData`). Quay's `"turn.completed"` arm doesn't check `agentId`, so
  a target that spawns a subagent hands back the subagent's report as its reply.
- **A busy target answers with the wrong turn.** If the target is mid-turn when a
  message is typed in, that turn's `turn.completed` resolves the wait. Quay keys
  waiters by terminal only, not by turn.
- **The Normal-mode timeout mismatch** described in section 3 (30 seconds in the
  plugin, 600 seconds in Quay).
- **Commands that are never drained.** With the current plugin, the `prompt` and
  `toast` commands that `A2ARouter::dispatch` and `A2ARouter::broadcast_toast`
  enqueue are never polled. Nothing else drains `BridgeState`'s per-terminal
  queues, so they grow for the life of the app.
- **Security, for a review ticket.** `handle_mcp` doesn't call
  `validate_host_and_origin` and accepts calls with no token, recorded as
  `"agent"`. `handle_events` checks no token. So a local process, or a page using
  DNS rebinding, could send prompts into a bypass-mode agent or fake a
  `turn.completed`. The MCP config file holding the bearer token is written to
  `quay-mcp-<terminal id>.json` in `std::env::temp_dir()` with default
  permissions.
- **macOS and Linux builds.** The release ships them, but `RunKind::Claude` starts
  `claude.exe` on every platform.

## Not established

- Whether `--dangerously-skip-permissions` skips the workspace trust dialog.
- In Normal mode under auto mode: whether the plugin's `tool.check` gets an `ask`
  verdict for `mcp__quay__*` calls, and so whether Quay's modal ever shows, or
  whether the classifier decides alone.
- Whether `event-bridge` loads and behaves correctly on Claude Code 2.1.287 to
  2.1.295. The plugin is tested on 2.1.296 and the docs' floor for mods is
  2.1.287.
- Whether 1.0.27 accepted `headers` on an `http`-type server in `--mcp-config`.
- Whether WinGet or npm installs of Claude Code leave a `claude.exe` that Quay can
  start.
- Each non-Claude CLI's install method and executable name on Windows.
- The full install-from-GitHub flow, which was not run here so as not to disturb
  this machine's directory-marketplace install.

## Sources

Repository code (Quay `master` at `6255f57`):

- `src-tauri/src/slices/bridge/routes.rs`: `handle_events` (the `"turn.completed"`
  arm), `handle_permission`, `handle_mcp`, `validate_host_and_origin`,
  `create_router`
- `src-tauri/src/slices/pty/session.rs`: `PtySession::spawn` (all `RunKind`
  branches)
- `src-tauri/src/slices/pty/commands.rs`: `spawn_terminal`
- `src-tauri/src/slices/pty/manager.rs`: `PtyManager::submit_prompt`,
  `PtyManager::set_live_mode`
- `src-tauri/src/slices/orchestrator/mcp.rs`: `handle_mcp_request`
- `src-tauri/src/slices/orchestrator/router.rs`: `A2ARouter::dispatch`,
  `A2ARouter::dispatch_and_wait`, `A2ARouter::resolve_pending_reply`
- `src-tauri/src/slices/bridge/state.rs`, `src-tauri/src/slices/bridge/server.rs`
- `src/slices/orchestrator/swarmTypes.ts`: `BUILTIN_SWARM_PRESETS`
- `src/slices/workspace/useWorkspace.ts`: `launchSwarm`, `toggleTerminalLiveMode`
- `src/slices/terminal/NewTerminalModal.tsx`
- `docs/guide/configuration.md`, `docs/reference/cli-flags.md`,
  `docs/guide/installation.md`, `docs/features/a2a-orchestration.md`
- Crate `portable-pty` 0.9.0, `src/cmdbuilder.rs`: Windows `search_path`

The plugin, <https://github.com/seanrobertwright/claude-mod-events> at `main`:
`README.md`, `PROTOCOL.md`, `.claude-plugin/plugin.json`,
`.claude-plugin/marketplace.json`, `hooks/hooks.json`, `hooks/register.ts`,
`hooks/config.ts`, `hooks/events.ts`, `hooks/permission.ts`, and the commit log
(commit `9a78be3`). `hooks/inbox.ts` was read in an older local copy, to confirm
the behavior before that commit.

Claude Code:

- [Mods overview](https://code.claude.com/docs/en/plugins/mods/overview)
- [Install and manage plugins](https://code.claude.com/docs/en/plugins/install)
- [Configure permissions](https://code.claude.com/docs/en/permissions)
- [Choose a permission mode](https://code.claude.com/docs/en/permission-modes)
- [Connect Claude Code to tools via MCP](https://code.claude.com/docs/en/mcp)
- [Advanced setup](https://code.claude.com/docs/en/setup)
- [Security](https://code.claude.com/docs/en/security)
- [`CHANGELOG.md`](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md),
  through 2.1.302
- `claude --help` from 2.1.302

Other:

- [Install PowerShell 7 on Windows](https://learn.microsoft.com/en-us/powershell/scripting/install/install-powershell-on-windows),
  Microsoft Learn
