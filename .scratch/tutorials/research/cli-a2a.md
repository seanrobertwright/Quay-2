# Research: Can the other agent CLIs join Quay's A2A bus?

Ticket: [#7](https://github.com/seanrobertwright/Quay-2/issues/7), a research ticket on the
[Swarm and A2A tutorials map](https://github.com/seanrobertwright/Quay-2/issues/2). It feeds
[#12](https://github.com/seanrobertwright/Quay-2/issues/12), "Decide: How do non-Claude agents
join the A2A bus?".

Checked on 2026-10-18 against the CLI versions installed on the research machine, where present,
and each CLI's current official docs, repos and changelogs.

## Short answer

Most of them can. To join the bus fully, a CLI must do two things:

- load Quay's HTTP MCP server with a per-terminal `Authorization: Bearer` header, so it can call
  the `quay_*` tools;
- report the end of a turn with the final answer text, so Quay can resolve a `wait_for_reply`.

Each CLI does both today, partly, or not at all:

- **Both, today, without touching the user's global config:** Codex, OpenCode, Pi.
- **Both today, through a one-time global install** whose URL and header read per-terminal env
  vars: Gemini CLI and Grok Build.
- **Kiro CLI:** probably both. The answer field in its stop hook is not in the main docs.
- **Copilot CLI:** loads the MCP server per session. Its turn-end hook carries no answer text,
  only a transcript path in an undocumented format.
- **Antigravity (`agy`):** detects turn end. Its hook carries no answer text, and no per-session
  MCP path was found.
- **Aider:** has no MCP support. It can be messaged, but it cannot call `quay_*` tools.
- **Archon:** a workflow runner, not a chat agent. It is not a peer.

## What a CLI has to do to join (from this repo)

| Concern | How it works today | Code |
| --- | --- | --- |
| Launch | Each `RunKind` gets its own branch. Only `RunKind::Claude` gets the bus wiring: Quay writes a temp `--mcp-config` JSON file (`mcpServers.quay`, `type: http`, `url` `http://127.0.0.1:<port>/mcp`, `headers.Authorization: Bearer <token>`) and sets the `CLAUDE_EVENTS_*` env vars. No other branch sets an MCP server or any env var. | `PtySession::spawn` in [`src-tauri/src/slices/pty/session.rs`](https://github.com/seanrobertwright/Quay-2/blob/master/src-tauri/src/slices/pty/session.rs); `RunKind` in [`src-tauri/src/slices/pty/models.rs`](https://github.com/seanrobertwright/Quay-2/blob/master/src-tauri/src/slices/pty/models.rs) |
| Port and token | The bridge binds `127.0.0.1:0`, so the port changes on every app start. Each terminal gets its own random token. A static config file therefore cannot hold either value unless the CLI expands env vars in both the URL and the header. | `start` in [`src-tauri/src/slices/bridge/server.rs`](https://github.com/seanrobertwright/Quay-2/blob/master/src-tauri/src/slices/bridge/server.rs); `BridgeState::token_for` in [`src-tauri/src/slices/bridge/state.rs`](https://github.com/seanrobertwright/Quay-2/blob/master/src-tauri/src/slices/bridge/state.rs) |
| Caller identity | `/mcp` finds the caller by matching the bearer token against every terminal's token. With no token or a wrong one, the call still runs, with the caller named `agent`. | `handle_mcp_request` in [`src-tauri/src/slices/orchestrator/mcp.rs`](https://github.com/seanrobertwright/Quay-2/blob/master/src-tauri/src/slices/orchestrator/mcp.rs) |
| Message delivery | Quay types the message into the target's PTY with newlines flattened. After `PROMPT_SUBMIT_DELAY` it sends `\r`. This works for any CLI whose prompt accepts typed text and Enter. It also queues a `prompt` command for the claude-mod-events poll, which only Claude uses. | `A2ARouter::dispatch` in [`src-tauri/src/slices/orchestrator/router.rs`](https://github.com/seanrobertwright/Quay-2/blob/master/src-tauri/src/slices/orchestrator/router.rs); `PtyManager::submit_prompt` in [`src-tauri/src/slices/pty/manager.rs`](https://github.com/seanrobertwright/Quay-2/blob/master/src-tauri/src/slices/pty/manager.rs) |
| Reply | `dispatch_and_wait` waits up to 60 s for the target terminal's next `turn.completed`. When one arrives, `handle_events` passes its `data.answer` to `A2ARouter::resolve_pending_reply`; when `answer` is missing, the reply is the literal `Turn completed`. The envelope is routed by `tag`, which must be the Quay terminal id. | `handle_events` in [`src-tauri/src/slices/bridge/routes.rs`](https://github.com/seanrobertwright/Quay-2/blob/master/src-tauri/src/slices/bridge/routes.rs) |
| Envelope shape | `POST /v1/events` with `{"events":[Envelope]}`. `Envelope` requires `v`, `boot`, `seq`, `ts`, `sessionId`, `type` and `data`; `tag` is optional but needed for routing. `/v1/events` checks only that the host is loopback and that no `Origin` header is sent. It does not check the bearer token. | `Envelope` in [`src-tauri/src/slices/bridge/models.rs`](https://github.com/seanrobertwright/Quay-2/blob/master/src-tauri/src/slices/bridge/models.rs); `validate_host_and_origin` in `routes.rs` |
| Who sends `turn.completed` for Claude | The [claude-mod-events](https://github.com/seanrobertwright/claude-mod-events) Claude Code mod does. It is not part of this repo. Per its [PROTOCOL.md](https://github.com/seanrobertwright/claude-mod-events/blob/main/PROTOCOL.md), `turn.completed` fires "in the main loop or a subagent", and `data` carries `answer`, `reason`, and `agentId` for subagent turns. | external |

For any other CLI, joining the bus therefore means three things:

1. Give the CLI the MCP URL and its terminal's token at launch.
2. On each main-loop turn end, POST a `turn.completed` envelope with `tag` set to the terminal id
   and `data.answer` set to the final text.
3. Keep accepting typed prompts.

## The table

"Per-session" means Quay can give one terminal its own port and token without editing a
config file the user owns. "Answer text" means the turn-end signal itself carries the final
assistant message.

| CLI (version checked) | HTTP MCP with a header: how | Per-session? | Turn-end signal | Answer text in it? | Verdict and path |
| --- | --- | --- | --- | --- | --- |
| **Codex CLI** (codex-cli 0.154.0, local) | `-c mcp_servers.quay.url="http://127.0.0.1:<port>/mcp" -c mcp_servers.quay.bearer_token_env_var="QUAY_A2A_TOKEN"` ([MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [config](https://learn.chatgpt.com/docs/config-file/config-advanced)) | Yes. `-c` applies to one run, and the token stays in the child's env. | `notify` program on `agent-turn-complete` (settable with `-c notify=[...]`); or a `Stop` hook ([hooks](https://learn.chatgpt.com/docs/hooks)) | Yes: `last-assistant-message` (notify), `last_assistant_message` (Stop) | **Possible today.** Pass the MCP server with `-c` and set the token env var; add `-c notify=["<quay helper>"]` that POSTs `turn.completed`. |
| **Gemini CLI** (0.64.0, local) | `mcpServers.quay.httpUrl` + `headers` in `settings.json`, or in an extension's `gemini-extension.json`. All strings expand `$VAR` / `${VAR}` ([MCP](https://geminicli.com/docs/tools/mcp-server/), [config](https://geminicli.com/docs/reference/configuration/)) | Not by flag. A one-time global extension whose URL and header read env vars gives each terminal its own values. | `AfterAgent` hook ([hooks reference](https://geminicli.com/docs/hooks/reference/)) | Yes: `prompt_response` | **Possible today.** Install a "quay" extension once, with env-expanded `httpUrl` and `Authorization`, plus an `AfterAgent` hook. The docs say Gemini CLI "was replaced by Antigravity CLI on June 18th, 2026" for unpaid-tier and Google One users. |
| **Antigravity `agy`** (1.4.2, local) | `mcp_config.json` with `serverUrl` + `headers`, in the user `~/.gemini/config/` or workspace `.agents/` ([MCP](https://antigravity.google/docs/mcp?tab=cli)). Plugin MCP servers expand `${TOKEN}` in headers (local `agy changelog`) | No flag or config-path env var found (local `agy --help`). Whether a plugin's `url` expands env vars is not established. | `Stop` hook ([hooks](https://antigravity.google/docs/hooks?tab=cli)); OSC 7501 status sequences in the PTY output (local `agy changelog`) | No: `terminationReason`, `fullyIdle`, `transcriptPath` | **Partly.** Quay can detect turn end, by a Stop hook or by parsing OSC 7501 in the PTY reader. The answer text and a per-terminal MCP config are not established. |
| **Kiro CLI** (kiro-cli-chat 2.21.4, local; latest 2.31.1) | Agent config `mcpServers.quay` with `url` + `headers` using `${VAR}` ([MCP config](https://kiro.dev/docs/mcp/configuration/)); launch with `chat --agent quay` | Partly. The agent file is global (`~/.kiro/agents/`), but the token can come from a per-terminal env var. Kiro gates `${VAR}` on an approved-env-vars setting; whether the CLI enforces that gate is not established. | 2.x agent-config `stop` hook ([2.x reference](https://kiro.dev/docs/cli/2x-reference/)); V3 renames it `Stop` ([V3 migration](https://kiro.dev/docs/cli/v3/hooks-migration/)) | Probably: `assistant_response`. Listed only on a pre-release docs mirror; the field name appears in the installed binary. Not on kiro.dev. | **Possible with caveats.** Install one global `quay` agent with an env-expanded header and a `stop` hook. Re-check at CLI 3.0, which makes V3 the default ([changelog](https://kiro.dev/changelog/cli/)). |
| **GitHub Copilot CLI** (1.0.98 latest; not installed locally) | `--additional-mcp-config @<file>` or inline JSON: `type: "http"`, `url`, `headers`; headers support variable expansion ([command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)) | Yes: "Add an MCP server for this session only" | `agentStop` hook, shippable per session in a plugin loaded with `--plugin-dir` ([hooks reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-hooks-reference)) | No: `transcriptPath` only, and its format is undocumented | **MCP: possible today. Reply: not established.** Quay can deliver messages and Copilot can call `quay_*`. A real `answer` needs transcript parsing; without it the reply is `Turn completed`. |
| **OpenCode** (1.19.3, local) | `OPENCODE_CONFIG_CONTENT` inline JSON: `mcp.quay` with `type: "remote"`, `url`, `headers` using `{env:VAR}`, and `oauth: false` ([config](https://opencode.ai/docs/config/), [MCP](https://opencode.ai/docs/mcp-servers/)) | Yes: an env var per process, merged over the user's config | Plugin `event` hook: `session.status` idle (`session.idle` is deprecated) ([plugins](https://opencode.ai/docs/plugins/)); or the TUI's own server, started with `--port`, streaming SSE on `GET /event` ([server](https://opencode.ai/docs/server/)) | No: carries `sessionID` only; the text comes from `GET /session/:id/message` or the SDK ([SDK](https://opencode.ai/docs/sdk/)) | **Possible today, best fit.** Inject MCP through the env var. Launch with `--port`. Either Quay listens on SSE and fetches the last message, or a plugin POSTs it. |
| **Pi** (`@earendil-works/pi-coding-agent` 1.3.0, local) | Built-in MCP over streamable HTTP with `url` + `headers` (`${VAR}` expanded); `pi.registerMcpServer()` from an extension ([mcp.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md), [extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)) | Yes: an extension loaded with `-e` registers the server "for the current session" | Extension events `agent_end` (carries `messages`) and `agent_settled` (no automatic continuation left) ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)) | Yes, via `agent_end` messages | **Possible today.** One Quay extension, passed with `-e`, registers `quay` with `exposure: "direct"` and POSTs the last assistant text on `agent_settled`. |
| **Grok Build** (0.2.38, local) | `[mcp_servers.quay]` in `~/.grok/config.toml` or project `.grok/config.toml`; `${VAR}` expanded in `url` and `headers` ([MCP servers](https://docs.x.ai/build/features/mcp-servers)) | Partly: a static file reading per-terminal env vars. See the leader-process caveat below. | `Stop` hook in `~/.grok/hooks/*.json` ([hooks](https://docs.x.ai/build/features/hooks)) | Yes: `lastAssistantMessage`, clipped at 32,768 characters ([hooks user guide](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/10-hooks.md)) | **Possible today, verify env.** Install a user config and a Stop hook once. Check that per-terminal env vars reach the MCP client and hooks through Grok's shared leader process. |
| **Aider** (v0.86.2 latest; not installed locally) | None: no MCP option ([options](https://aider.chat/docs/config/options.html)); MCP request still open ([Aider-AI/aider#3314](https://github.com/Aider-AI/aider/issues/3314)) | n/a | `--notifications-command` fires when a response finishes ([notifications](https://aider.chat/docs/usage/notifications.html)) | No: runs with no arguments | **Not possible as a caller.** As a receiver it is degraded: Quay can type in, and a notifications command can post `turn.completed`. The answer would come from scraping `--chat-history-file`, or be left out. |
| **Archon** (CLI 0.11.1, local) | n/a: Quay starts it as `pwsh -Command <text>` | n/a | n/a (`archon workflow wait` blocks until a run ends; local `archon --help`) | n/a | **Not applicable.** It is a workflow runner, not a chat REPL, so typed peer messages have no prompt to land in. |

## Per-CLI notes

### Codex CLI

- Launch today: `codex.exe`, plus `--dangerously-bypass-approvals-and-sandbox` in skip mode
  (`RunKind::Codex` in `session.rs`).
- `-c, --config <key=value>` overrides any `config.toml` key for one run. Values are parsed as
  TOML ([config-advanced](https://learn.chatgpt.com/docs/config-file/config-advanced); local
  `codex --help`).
- A streamable HTTP server takes the following keys
  ([MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)). The token never touches disk.
  - `url`
  - `bearer_token_env_var`: the name of an env var whose value is sent as the bearer token
  - `http_headers`: static values
  - `env_http_headers`: header values read from env vars
- `codex mcp add --url --bearer-token-env-var` exists too, but it writes the user's global
  config (local `codex mcp add --help`).
- `notify` runs a program on `agent-turn-complete` with one JSON argument. The fields are
  `type`, `thread-id`, `turn-id`, `cwd`, `input-messages` and `last-assistant-message`
  ([config-advanced](https://learn.chatgpt.com/docs/config-file/config-advanced)).
- Hooks are the alternative ([hooks](https://learn.chatgpt.com/docs/hooks)). `Stop` gets
  `last_assistant_message` on stdin. New hooks are skipped until the user trusts them, and
  `--dangerously-bypass-hook-trust` skips that for one run (local `codex --help`).
  - Not established: whether a hook passed with `-c` needs trust.
  - Not established: whether trust applies to `notify` at all.

### Gemini CLI

- Launch today: `cmd.exe /c gemini`, with no permission flag (`RunKind::Gemini`).
- There is no launch flag for MCP config. `gemini mcp add -t http -H ... -s user|project`
  writes `settings.json` (local `gemini mcp add --help`).
- `mcpServers.<name>` takes `httpUrl` for streamable HTTP, plus `headers`
  ([MCP](https://geminicli.com/docs/tools/mcp-server/)). Every string in `settings.json` and
  `gemini-extension.json` expands `$VAR`, `${VAR}` and `${VAR:-default}`
  ([configuration](https://geminicli.com/docs/reference/configuration/)).
  - A "quay" extension holding `"httpUrl": "${QUAY_MCP_URL}"` and
    `"Authorization": "Bearer ${QUAY_A2A_TOKEN}"` is static, while each terminal still gets its
    own values from its env.
  - Extensions are global and on by default
    ([extensions reference](https://geminicli.com/docs/extensions/reference/)).
- `GEMINI_CLI_SYSTEM_SETTINGS_PATH` can point the highest-priority settings file at a
  per-terminal file. On the research machine, though, the CLI already skips its default system
  settings file because a Windows ACL check fails, so that route is fragile (local
  `gemini --version` output).
- MCP servers do not connect in an untrusted folder. `GEMINI_CLI_TRUST_WORKSPACE=true` or
  `--skip-trust` trusts the folder for the session
  ([trusted folders](https://geminicli.com/docs/cli/trusted-folders/)).
- `AfterAgent` fires once per turn after the final response. Its stdin carries
  `prompt_response`, the agent's final text, plus `session_id` and `transcript_path`
  ([hooks reference](https://geminicli.com/docs/hooks/reference/)).
- Not established: whether an extension's MCP server and hooks behave exactly like the
  `settings.json` ones. A live test settles it.

### Antigravity (`agy`)

- Launch today: `agy.exe`, plus `--dangerously-skip-permissions` in skip mode, which is a real
  flag (local `agy --help`, 1.4.2). A changelog entry narrows it to tool prompts only, so plans
  wait for review again (local `agy changelog`).
- Config:
  - `agy mcp add --header "Authorization: Bearer ..." <name> <url>` writes the user-level
    `mcp_config.json` (local `agy mcp add --help`).
  - Remote servers use `serverUrl` and `headers`
    ([MCP](https://antigravity.google/docs/mcp?tab=cli)).
  - The docs say `url` is not supported, but the changelog says "Added support for `url` in
    `mcp_config.json`". The two conflict.
- Header env expansion is confirmed only for plugin MCP servers (local `agy changelog`).
  Plugins install globally through `agy plugin install` or `/plugin`.
  - Not established: whether a plugin's server `url` expands env vars, which the ephemeral port
    needs.
  - Not established: whether `--agent` with a custom agent listing `plugins:` gives a
    per-session server.
- Turn end:
  - `Stop` hook payload: `executionNum`, `terminationReason`, `error`, `fullyIdle` and
    `transcriptPath` ([hooks](https://antigravity.google/docs/hooks?tab=cli)). There is no answer
    text, and whether `transcriptPath` holds it in a usable form is not established.
  - Hook-free alternative: agy writes OSC 7501 status (working, waiting, done, failed) to the
    terminal. `AGY_CLI_OSC7501=on` forces it on (local `agy changelog`). Quay's PTY reader could
    turn "done" into a status change or an answer-less `turn.completed`.
- `--print --input-format stream-json --output-format stream-json` gives NDJSON turns, but it
  replaces the TUI (local `agy --help`).

### Kiro CLI

- Launch today: `kiro-cli.exe chat`, plus `--trust-all-tools` in skip mode, which is real
  (local `kiro-cli chat --help`).
- No per-session MCP flag exists. MCP servers load from three places, highest first:
  1. the agent config's `mcpServers`
  2. workspace `.kiro/settings/mcp.json`
  3. global `~/.kiro/settings/mcp.json`
- Remote entries take `url` and `headers` with `${VAR}`, and plain HTTP is allowed for localhost
  ([MCP config](https://kiro.dev/docs/mcp/configuration/)).
- `chat --agent <name>` selects an agent from `~/.kiro/agents/` or a trusted workspace
  `.kiro/agents/` ([agent config](https://kiro.dev/docs/custom-agents/configuration-reference/)).
  Picking `quay` replaces the user's default agent for that terminal.
- 2.x hooks are `agentSpawn`, `userPromptSubmit`, `preToolUse`, `postToolUse` and `stop`
  ([2.x reference](https://kiro.dev/docs/cli/2x-reference/)). The kiro.dev pages do not list the
  stop payload fields.
- Evidence on the answer text:
  - A pre-release Kiro docs mirror lists `assistant_response` in the stop payload.
  - The installed 2.21.4 binary contains the string `assistant_response` next to the hook field
    names `session_id`, `tool_name`, `tool_input` and `tool_response`.
  - The open-source predecessor, Amazon Q Developer CLI, sent only `hook_event_name` and `cwd`
    ([aws/amazon-q-developer-cli docs/hooks.md](https://github.com/aws/amazon-q-developer-cli/blob/main/docs/hooks.md)).
  - Treat the field as likely, and confirm it with a live test.
- V3 renames the hook `Stop` and moves hooks to `.kiro/hooks/`
  ([V3 migration](https://kiro.dev/docs/cli/v3/hooks-migration/)). The changelog says V3 becomes
  the default with CLI 3.0 ([changelog](https://kiro.dev/changelog/cli/)). Whether the V3
  payload carries the answer is not established.
- `--output-format stream-json` implies `--no-interactive`, so it is unusable in a Quay terminal.

### GitHub Copilot CLI

- Launch today: `copilot.exe` from `%LOCALAPPDATA%\GitHub CLI\copilot\`, plus `--allow-all-tools`
  in skip mode. That flag is real; its env var is `COPILOT_ALLOW_ALL`.
  - Otherwise Quay falls back to `gh copilot`, with no permission flag
    (`RunKind::Copilot`; [command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)).
  - Not established: whether `gh copilot` passes extra flags through to the CLI.
- MCP: `--additional-mcp-config=JSON` "Add[s] an MCP server for this session only", as a JSON
  string or `@file`, and it takes precedence over the user's config. HTTP servers take `headers`,
  which "Supports variable expansion" (same reference;
  [add MCP servers](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers)).
  - Quay can write a temp file, as it does for Claude, but with `Bearer ${QUAY_A2A_TOKEN}` so
    the token stays off disk.
- Hooks load from policy, repo `.github/hooks/`, user `~/.copilot/hooks/`, settings files
  (including the cross-tool `.claude/settings.json`) and plugins
  ([hooks reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-hooks-reference)).
  `--plugin-dir=DIRECTORY` loads a local plugin, so Quay can ship an `agentStop` hook per session
  without installing anything.
- The `agentStop` payload is `sessionId`, `timestamp`, `cwd`, `transcriptPath`, `stopReason` and
  `stop_hook_active`, with no answer text. Only `subagentStop` carries `response`. The transcript
  format is not documented, so getting the answer is not established.

### OpenCode

- Launch today: `opencode.exe` from `~/.bun/bin`, plus `--auto` in skip mode. `--auto` is real:
  it auto-approves permissions that are not explicitly denied (local `opencode --help`, 1.19.3).
- Config:
  - `OPENCODE_CONFIG` takes a file path. `OPENCODE_CONFIG_CONTENT` takes inline JSON as
    "runtime overrides".
  - Config layers merge rather than replace, and `{env:VAR}` substitutes env vars
    ([config](https://opencode.ai/docs/config/)).
- A remote server is `"type": "remote"`, `url`, `headers`
  ([MCP servers](https://opencode.ai/docs/mcp-servers/)). Set `"oauth": false`, or a `401`
  starts OpenCode's OAuth flow.
- Turn end, either of two ways:
  - **Plugin.** The plugin `event` hook receives bus events
    ([plugins](https://opencode.ai/docs/plugins/)). `session.status` with an idle status replaces
    the deprecated `session.idle`. Both carry the session id only, so the text needs
    `client.session.messages()` ([SDK](https://opencode.ai/docs/sdk/)).
  - **The TUI's own server.** Running `opencode` starts the TUI and a server. With `--port`,
    Quay can subscribe to `GET /event` (SSE) and read `GET /session/:id/message`
    ([server](https://opencode.ai/docs/server/)).
- The same server can deliver prompts through `POST /tui/append-prompt` and
  `POST /tui/submit-prompt`, which avoids flattening newlines when typing into the PTY (same page).
  Not established: whether `OPENCODE_SERVER_PASSWORD` basic auth also covers the server the TUI
  starts.

### Pi

- Launch today: `cmd.exe /c pi`, with no permission flag. Quay used to add `--approve` in
  skip mode; it no longer does, and a Pi terminal has no Skip and Ask toggle (#142).
  - `--approve` is real but means "Trust project-local files for this run", not tool approval.
  - Pi does not ask before tool calls anyway (local `pi --help`, 1.3.0;
    [security.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md)).
- The installed package is `@earendil-works/pi-coding-agent`, and the official repo is
  [earendil-works/pi](https://github.com/earendil-works/pi) (local `npm ls -g`).
- MCP is now built in, so the older "no MCP" stance no longer applies
  ([mcp.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md)).
  - HTTP servers take `url` and `headers`, and header values expand `${VAR}`.
  - Each tool appears as `mcp__<server>__<tool>`.
  - A server's `exposure` decides whether the model sees the tools directly or through
    `codemode` or tool search. Quay should set `direct`.
- `pi.registerMcpServer(name, config)` "adds an MCP server for the current session", from an
  extension loaded with `pi --extension <file>` / `-e`
  ([extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)).
  `PI_CODING_AGENT_DIR` can also relocate the whole config dir (local `pi --help`).
- Turn end comes from extension events. The docs warn that "`agent_end` is not a final-idle
  signal", because retries and queued messages can start another run, and they point to
  `agent_settled` for notification-only work (same page).
  - The extension should remember the last assistant text from `agent_end`.
  - It should POST that text on `agent_settled`.

### Grok Build

- Grok Build is xAI's official CLI, released under Apache-2.0
  ([xai-org/grok-build](https://github.com/xai-org/grok-build)).
- Launch today: `.grok/bin/agent.exe` with no permission flag, so skip mode is not honoured
  (`RunKind::Grok`). The local build has `--always-approve` and
  `--permission-mode bypassPermissions` (local `grok --help`).
- MCP comes from `[mcp_servers.<name>]` in `~/.grok/config.toml` or a project
  `.grok/config.toml`. `${VAR}` expands in `url`, `command`, `args`, `env` and `headers`
  ([MCP servers](https://docs.x.ai/build/features/mcp-servers)). Grok also loads `~/.claude.json`,
  `.cursor/mcp.json` and project `.mcp.json` (same page).
- The docs describe `grok mcp add --header`, but the local 0.2.38 build's `mcp add --help` does
  not show `--header`. The install looks older than the docs.
- `GROK_HOME` relocates the user config ([settings](https://docs.x.ai/build/settings)). Not
  established: whether it also moves the sign-in.
- Hooks load from `~/.grok/hooks/*.json`, project `.grok/hooks/*.json`, and also
  `.claude/settings.json` and `.cursor/hooks.json`. Project hooks need trust
  ([hooks](https://docs.x.ai/build/features/hooks)).
- The `Stop` input carries `lastAssistantMessage`, "the text of the agent's final response this
  turn", clipped at 32,768 characters
  ([hooks user guide](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/10-hooks.md)).
  Two other kinds of Stop event must not resolve a reply, and a helper can drop them:
  - Stop also fires at session end, with `reason` `channel_closed` or `shutdown`. Keep only
    `reason == "end_turn"`.
  - A subagent's turn end has `subagentType` set.
- Grok runs a shared "leader" process (`--leader-socket`). Not established: whether MCP URL and
  header expansion, and hook processes, see the TUI process's env or the leader's. If they see
  the leader's, every Grok terminal would share one token, and a per-terminal `--leader-socket`
  may be needed.

### Aider

- Launch today: `aider.exe`, plus `--yes-always` in skip mode (`RunKind::Aider`).
- No MCP support: no option mentions it ([options](https://aider.chat/docs/config/options.html)),
  and [issue #3314](https://github.com/Aider-AI/aider/issues/3314) is still open.
- `--notifications` with `--notifications-command` (or `AIDER_NOTIFICATIONS_COMMAND`) runs a shell
  command when "the LLM has finished generating a response and is waiting for your input"
  ([notifications](https://aider.chat/docs/usage/notifications.html)). The command gets no
  arguments and no response text.

### Archon

- Quay starts it as `pwsh -Command <text>` (`RunKind::Archon`). `RunKind::is_agent` counts it as
  an agent, so `quay_broadcast` types into it too.
- Archon runs workflows. `archon chat` and `archon workflow wait` exist, but the terminal has no
  chat prompt for a peer message (local `archon --help`, 0.11.1).

## Recommended integration path (input for #12)

1. **One set of env vars for every agent terminal.** Today only Claude gets env vars. Quay should
   set neutral ones on every agent `RunKind`: an MCP URL, the terminal's token, an events URL and
   the terminal id. Example names: `QUAY_MCP_URL`, `QUAY_A2A_TOKEN`, `QUAY_EVENTS_URL`,
   `QUAY_TERMINAL_ID`. Per-CLI config can then be static and read only env vars, which handles
   the ephemeral port and keeps the token off disk.
   - `docs/reference/cli-flags.md` already claims Quay sets `QUAY_TERMINAL_ID` and
     `QUAY_BRIDGE_PORT`. No code in `src-tauri/src` sets either, so that doc is wrong today.
2. **One turn-end helper.** Codex, Gemini, Kiro, Grok, Copilot and agy all signal turn end by
   running a command. A single small Quay-shipped helper can serve them all: a subcommand of a
   Quay binary or a script. It reads the CLI's payload, picks the answer field, and POSTs a
   complete `Envelope` with `type: "turn.completed"`, `tag` set to the terminal id and
   `data.answer`. The answer field by CLI:
   - Codex: `last-assistant-message` in argv
   - Gemini: `prompt_response`
   - Grok: `lastAssistantMessage`
   - Kiro: `assistant_response`
   - Copilot and agy: none (answer-less)
   Pi and OpenCode do the same from their in-process extension or plugin.
3. **Only main-loop turns resolve a reply.** `handle_events` resolves the pending reply on any
   `turn.completed` for the tag. claude-mod-events also emits `turn.completed` for subagent turns,
   with `agentId` set. So today a Claude subagent's turn end can resolve a `wait_for_reply` early.
   The helper should skip subagent events: Grok `subagentType`, Codex `SubagentStop`, Copilot
   `subagentStop`. Quay should also ignore `turn.completed` events that carry an `agentId`.
4. **Order of work by payoff:**
   1. Codex and OpenCode: per-session, answer included, nothing installed globally.
   2. Pi: one extension file.
   3. Gemini and Grok: one-time global install.
   4. Kiro: after a live check of `assistant_response`.
   5. Copilot and agy: as tool callers, with answer-less replies, until their transcript formats
      are pinned down.
   6. Aider: receive-only.

## Related observations (outside the ticket's question)

- `/v1/events` does not check the bearer token, so any local process can post `turn.completed`
  and resolve another agent's pending reply.
- `/mcp` accepts calls with no token or a wrong one, as caller `agent`.
- Both points matter for the decision: a hook helper would work without the token, but Quay
  probably should require it (`handle_events`, `handle_mcp_request`).
- Copilot and Grok both read hooks from `.claude/settings.json`, and Grok loads MCP servers from
  `~/.claude.json` and `.mcp.json`. Anything Quay writes into those Claude files to wire up Claude
  would also fire in Copilot and Grok terminals. Today Quay passes Claude's config only as a temp
  file through a flag, so this does not happen yet.

## Not established

- Whether hooks passed with `-c` need trust in Codex, and whether hook trust applies to `notify`.
- Whether a Gemini extension's MCP server and `AfterAgent` hook behave like the `settings.json`
  ones, and whether `GEMINI_CLI_HOME` also moves sign-in credentials.
- Three things about agy:
  - whether env vars expand in a plugin MCP server's `url` or in a plain `mcp_config.json`;
  - any per-session MCP or hook mechanism;
  - whether `transcriptPath` holds the answer text.
- Three things about Kiro:
  - whether 2.x `stop` sends `assistant_response`, which the main docs do not show;
  - whether V3 `Stop` sends it;
  - whether the approved-env-vars gate applies to the CLI.
- The format of Copilot's `transcriptPath`, and whether `gh copilot` passes extra flags through.
- Whether OpenCode's server password covers the server the TUI starts.
- Whether Grok's leader process sees each terminal's env vars, and whether `GROK_HOME` moves the
  sign-in.
- For every CLI: whether typed text followed by `\r` after `PROMPT_SUBMIT_DELAY` reliably submits
  in its TUI. No CLI was run interactively for this research.

## Sources

Repo code, cited by symbol: `RunKind`, `PtySession::spawn`, `PtyManager::submit_prompt`,
`BridgeState::token_for`, bridge `start`, `handle_events`, `handle_mcp_request`,
`A2ARouter::dispatch`, `A2ARouter::dispatch_and_wait` and `A2ARouter::resolve_pending_reply`, all
under `src-tauri/src/slices/`.

Local help output on the research machine:

- `codex --help` (0.154.0)
- `gemini --help` (0.64.0)
- `agy --help` and `agy changelog` (1.4.2)
- `kiro-cli chat --help` (2.21.4)
- `opencode --help` (1.19.3)
- `pi --help` (1.3.0)
- `grok --help` (0.2.38)
- `archon --help` (0.11.1)

Web and repo sources:

- claude-mod-events wire protocol:
  <https://github.com/seanrobertwright/claude-mod-events/blob/main/PROTOCOL.md>
- Codex: <https://learn.chatgpt.com/docs/extend/mcp?surface=cli>,
  <https://learn.chatgpt.com/docs/config-file/config-advanced>,
  <https://learn.chatgpt.com/docs/hooks>
- Gemini CLI: <https://geminicli.com/docs/tools/mcp-server/>,
  <https://geminicli.com/docs/reference/configuration/>,
  <https://geminicli.com/docs/hooks/reference/>,
  <https://geminicli.com/docs/extensions/reference/>,
  <https://geminicli.com/docs/cli/trusted-folders/>
- Antigravity: <https://antigravity.google/docs/mcp?tab=cli>,
  <https://antigravity.google/docs/hooks?tab=cli>
- Kiro: <https://kiro.dev/docs/mcp/configuration/>, <https://kiro.dev/docs/cli/2x-reference/>,
  <https://kiro.dev/docs/cli/v3/hooks-migration/>,
  <https://kiro.dev/docs/custom-agents/configuration-reference/>,
  <https://kiro.dev/docs/hooks/types/>, <https://kiro.dev/changelog/cli/>,
  <https://github.com/aws/amazon-q-developer-cli/blob/main/docs/hooks.md>
- Copilot CLI:
  <https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference>,
  <https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-hooks-reference>,
  <https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers>,
  <https://github.com/github/copilot-cli/releases>
- OpenCode: <https://opencode.ai/docs/config/>, <https://opencode.ai/docs/mcp-servers/>,
  <https://opencode.ai/docs/plugins/>, <https://opencode.ai/docs/server/>,
  <https://opencode.ai/docs/sdk/>
- Pi: <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md>,
  <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md>,
  <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md>
- Grok Build: <https://docs.x.ai/build/features/mcp-servers>,
  <https://docs.x.ai/build/features/hooks>, <https://docs.x.ai/build/settings>,
  <https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/10-hooks.md>
- Aider: <https://aider.chat/docs/config/options.html>,
  <https://aider.chat/docs/usage/notifications.html>,
  <https://github.com/Aider-AI/aider/issues/3314>
