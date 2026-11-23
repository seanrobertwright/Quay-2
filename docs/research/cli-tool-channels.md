<!-- markdownlint-configure-file
{ "MD013": { "tables": false, "code_blocks": false } }
-->

# Research: how each agent CLI can be given a tool channel to Quay

Ticket: [#685](https://github.com/seanrobertwright/Quay-2/issues/685), on the map
[#682](https://github.com/seanrobertwright/Quay-2/issues/682) (A2UI in Quay). It feeds #688 and
#689.

Read on 2026-11-23 against Quay `master` at `301d9d3`, each CLI's own documentation and source,
and the MCP specification. Every finding carries the version or date of its source and a mark:

- **W**: well-supported. The primary source was read and says so.
- **T**: tentative. The source was not read in full, sources conflict, or it is an inference.

Nothing was run interactively and no CLI was pointed at Quay's server for this note, so every
statement about how a CLI behaves against Quay is read from source or docs, not observed, unless
it says otherwise.

It builds on three earlier notes and does not repeat them:
`.scratch/tutorials/research/cli-a2a.md` (branch `research/cli-a2a`, 2026-10-18),
`.scratch/tutorials/research/a2a-install.md` (branch `research/a2a-install`, 2026-10-18) and
`.scratch/research/pig-per-terminal-mcp.md` (branch `research/pig-per-terminal-mcp`, 2026-10-21).
Those covered MCP config and turn-end signals for the A2A bus. This note adds what a surface
needs: how long a tool call may block, size limits, elicitation, and which MCP revision each
client speaks.

## Answer in brief

- **Nine of the ten CLIs have an MCP client whose transport fits Quay's server as it stands.**
  All nine speak streamable HTTP, send a bearer header, accept a plain JSON reply and tolerate
  the missing `GET` stream. Three of them (Claude Code, Codex, OpenCode) are already wired in
  the code, as is PiG, an eleventh CLI the ticket does not list. Aider is the exception: it has
  no MCP client and no tool calling.
- **The transport is not the obstacle. Two other things are.**
  1. **Per-launch configuration.** Claude Code, Codex, OpenCode, Copilot and Pi can be given the
     server for one process only. Gemini and Grok need a file written once that reads the
     terminal's `QUAY_*` variables. Kiro needs a generated agent file. Antigravity has no
     per-launch route and no documented variable expansion.
  2. **Blocking time.** Quay's server sends no byte until the tool call's answer is ready. With
     default settings a silent call is cut off after about 30 s (Copilot), 60 s (Claude Code,
     Pi, OpenCode 1, probably Gemini), 120 s (Kiro), 180 s (Antigravity), 300 s (Codex) or
     100 minutes (Grok). Every one of these can be raised, but in a different place for each
     CLI, and several have a second HTTP timer near five minutes behind the first.
- **Elicitation is not a route for A2UI.** Quay's server cannot send an elicitation request,
  because it has no stream to send one on. Even where it could, MCP form elicitation allows
  only flat forms of primitive fields, the CLI draws it in its own terminal UI rather than in
  Quay, and Gemini, Pi and OpenCode 1 do not support it.
- **Aider** can only reach Quay through a helper program run as a shell command, and Aider
  makes a person confirm each such command even with `--yes-always`.

## What the code says now (differences from the ticket's starting facts)

Read from `master` at `301d9d3`.

| Starting fact in the ticket | What the code says | Where |
| --- | --- | --- |
| Only Claude Code gets Quay's MCP server | **Four CLIs get it**: Claude Code, Codex, OpenCode and PiG. Each is wired its own way (below). | `RunKind::gets_quay_mcp`, `src-tauri/src/slices/pty/models.rs`; `build_command`, `src-tauri/src/slices/pty/session.rs` |
| Ten agent CLIs | **Eleven peers.** `RunKind::Pig` (PiG, a Go port of Pi) is a full peer and is not in the ticket's list. Archon is an agent but not a peer. | `RunKind::bus_level`, `models.rs` |
| Claude gets inline `--mcp-config` JSON | True. Its header is `Bearer ${CLAUDE_EVENTS_TOKEN}`, the same token as `QUAY_A2A_TOKEN` under the event-bridge plugin's name. | `mcp_config_arg`, `session.rs` |
| Every peer receives the four `QUAY_*` variables | True for every peer, at every bus level. Shells, commands and Archon get none. | `set_quay_env`, `session.rs` |
| JSON-RPC over HTTP `POST /mcp`, no SSE, no stdio | True, with details that matter to a client (next section). | `handle_mcp`, `handle_mcp_get`, `src-tauri/src/slices/bridge/routes.rs`; `handle_mcp_request`, `src-tauri/src/slices/orchestrator/mcp.rs` |

How the four are wired today:

| CLI | Mechanism in `build_command` | Token | Tool timeout set? |
| --- | --- | --- | --- |
| Claude Code | `--mcp-config '<inline JSON>'`, placed last | `${CLAUDE_EVENTS_TOKEN}` expanded by Claude Code | No |
| Codex | `-c mcp_servers.quay.url=…`, `-c mcp_servers.quay.bearer_token_env_var="QUAY_A2A_TOKEN"`, `-c mcp_servers.quay.default_tools_approval_mode="approve"`, `-c notify=[…]` | env var named in config | No |
| OpenCode | `OPENCODE_CONFIG_CONTENT` with `mcp.quay` (`type: "remote"`, `oauth: false`), merged over the workspace's own value | `{env:QUAY_A2A_TOKEN}` | No |
| PiG | `-e <quay-pig-bridge sidecar>`, which calls `registerMcpServer("quay", …)` with `exposure: "direct"` | `${QUAY_A2A_TOKEN}` expanded by PiG | Yes, 120 s (`MCP_TIMEOUT_SECS`, `src-tauri/sidecars/pig-bridge/src/main.rs`) |

Other points in the code that bear on a surface:

- **The longest wait in any Quay tool today is 60 s.** `quay_send_message` calls
  `dispatch_and_wait(…, 60)` and then returns a "still working" note. No tool blocks for minutes
  yet, so none of the limits below has been met in practice. (W, `mcp.rs`)
- **The bridge does hold one request for ten minutes already**, but not on `/mcp`:
  `POST /v1/permission` waits up to `PERMISSION_TIMEOUT` (600 s) for the operator. Nothing on
  Quay's side limits how long a `/mcp` handler may run. (W, `routes.rs`,
  `src-tauri/src/slices/bridge/pending.rs`)
- **The port is random per app start unless `QUAY_BRIDGE_PORT` pins it.** (W,
  `src-tauri/src/slices/bridge/port.rs`, `server.rs`)
- **Copilot's lookup may miss a WinGet install.** Quay looks for
  `%LOCALAPPDATA%\GitHub CLI\copilot\copilot.exe` and otherwise runs `gh copilot`. On the
  research machine `copilot.exe` (1.0.71) is a WinGet package on `PATH`, outside that folder,
  so Quay would start `gh copilot`. Whether `gh copilot` passes flags such as
  `--additional-mcp-config` through is not established. (W for the code and the install
  location; T for the consequence)
- **Sidecars exist to build on.** `src-tauri/sidecars/bridge-post` is a small library that
  reads `QUAY_EVENTS_URL`, `QUAY_TERMINAL_ID` and `QUAY_A2A_TOKEN` and posts to the bridge. Its
  I/O timeout is 5 s, so a blocking client would need its own. (W)

## Quay's MCP server as a client sees it

| Behaviour | Fact | Source |
| --- | --- | --- |
| Endpoint | `http://127.0.0.1:<port>/mcp`, plain HTTP, loopback only | `server.rs` |
| `POST` with a request | `200`, `Content-Type: application/json`, one JSON-RPC response. Never an SSE stream. One request per body; a batch array fails to parse. | `handle_mcp_request`, `JsonRpcRequest` |
| `POST` with a notification | `202 Accepted`, empty body | `reply_to_notification` |
| `GET` | `405` with `Allow: POST` | `handle_mcp_get` |
| Sessions | No `Mcp-Session-Id` is ever issued | `mcp.rs` |
| Auth | The bearer token must belong to a live terminal. Otherwise a bare `401` with a plain-text body, no `WWW-Authenticate` header and no OAuth metadata. | `authenticate_mcp_caller` |
| `Origin` | Any request carrying an `Origin` header gets `403` | `validate_host_and_origin` |
| `Host` | Must start with `127.0.0.1` or `localhost`, else `403` | same |
| Methods | `initialize`, `ping`, `tools/list`, `tools/call`, `resources/list`, `prompts/list`. Anything else, `server/discover` included, gets HTTP `200` with JSON-RPC error `-32601`. | `handle_mcp_request` |
| Version | `initialize` echoes the client's `protocolVersion` and advertises `capabilities: { tools: {} }` only | same |
| Request size | No limit is configured, so axum's default applies: `Json` refuses a body over 2 MB | `routes.rs`; [axum 0.8.9 `DefaultBodyLimit`](https://docs.rs/axum/0.8.9/axum/extract/struct.DefaultBodyLimit.html) |
| Server to client | None. No progress notifications, no requests, no elicitation. | follows from no stream |

Against the MCP specification:

- **Revision 2025-11-25** (the last handshake-based revision) permits everything Quay does. A
  server "MUST either return `Content-Type: text/event-stream` … or `Content-Type:
  application/json`" and "the client MUST support both"; a `GET` may be answered with `405`
  "indicating that the server does not offer an SSE stream"; a session id is something a server
  "MAY assign". (W,
  [transports, 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports))
- **Rejecting every `Origin` header is stricter than the spec**, which asks a server to reject
  an invalid one. No CLI client read for this note sets an `Origin` header, so it has not been
  seen to matter. (W for the spec; T for "no client sends one", which rests on reading client
  source for Codex, Gemini, Pi, OpenCode and Grok, not on a wire capture)
- **The current revision is 2026-07-28**, and Quay does not implement it. That revision drops
  the `initialize` handshake, removes the `GET` stream and sessions, requires `server/discover`
  and the headers `Mcp-Method` and `Mcp-Name`, and no longer lets a server send its own requests
  on a stream. Quay is a "legacy" server in its terms. (W,
  [versioning](https://modelcontextprotocol.io/specification/versioning),
  [streamable HTTP, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http))
- **A client that speaks only 2026-07-28 would fail against Quay.** The spec's compatibility
  matrix gives "Modern client, Legacy server: Fails". Every client read here is either legacy
  or dual-era, so none fails today. (W for the matrix,
  [versioning and compatibility, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning))
- **Quay's reply to `server/discover` is ambiguous.** The spec's signal for "fall back to
  `initialize`" is a `4xx` whose body is not a recognised modern error. A modern server answers
  an unknown method with `404` and `-32601`. Quay answers `200` with `-32601`, which is neither.
  Two dual-era clients are known to fall back (Grok by source, Claude Code by one observation,
  below), but that is each client's choice, not the spec's. (T)

## The blocking problem, across all CLIs

A surface may wait minutes for the operator. Quay's handler returns nothing, not even response
headers, until it has the answer. Three kinds of client limit apply to such a call:

1. **The MCP request timeout**: how long the client waits for the JSON-RPC response.
2. **An HTTP first-byte or headers timer**: how long the HTTP library waits for the response
   to start. This is the one that Quay's silence trips, and it is often shorter than the first
   and set somewhere else.
3. **Session behaviour**: Claude Code moves a call that runs past two minutes to a background
   task and carries on without the answer.

| CLI (version read) | Default limit a silent call meets first | How to raise it | Second limit behind it |
| --- | --- | --- | --- |
| Claude Code 2.1.330 | About 60 s: the HTTP per-request timer "covers each request through to the server's first response byte" and is the greatest of 60 s, the server's tool timeout and `MCP_TIMEOUT`; the 28-hour default "doesn't enter that comparison" (W for the rule; T that Quay trips it) | Per-server `"timeout": <ms>` in the inline entry, or `MCP_TOOL_TIMEOUT` in the child's environment | Auto-background at 120 s (`CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS`, `0` turns it off); idle abort at 300 s for HTTP (`CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`, and a per-server `timeout` is a floor on it) |
| Codex 0.171.0 and 0.146.0 | 300 s: `DEFAULT_TOOL_TIMEOUT: Duration = Duration::from_secs(300)` (W, source). The docs site says 60, which conflicts. | `-c mcp_servers.quay.tool_timeout_sec=<seconds>` | None found: no idle timer and no HTTP timeout on `tools/call` |
| OpenCode 1.19.6 | 60 s: `callTool` is given the per-server `timeout`, else `experimental.mcp_timeout`, else nothing, and the SDK's default is `DEFAULT_REQUEST_TIMEOUT_MSEC = 60000` (W) | `"timeout": <ms>` on the server entry in `OPENCODE_CONFIG_CONTENT` | Possibly Bun's fetch idle limit near five minutes (T) |
| OpenCode 2.4.0 | 12 h: `DEFAULT_EXECUTION_TIMEOUT` (W) | `mcp.timeout.execution` or the per-server override | Not established |
| Pi 1.6.0 | 60 s: `DEFAULT_TIMEOUT_SECONDS = 60`, applied to every request (W) | `timeout: <seconds>` in the `registerMcpServer` config | 300 s: a global undici dispatcher sets `headersTimeout` to the setting `httpIdleTimeoutMs`, default 300000, changed only in the settings file (W for the setting; T that it cuts the call) |
| PiG 0.5.x | 60 s default; Quay sets 120 s | `timeout` in the sidecar's config | Not read |
| Gemini CLI 0.70.0 | Probably 60 s: the MCP timeout is 10 minutes (`MCP_DEFAULT_TIMEOUT_MSEC = 10 * 60 * 1000`), but the CLI installs a global undici dispatcher with `DEFAULT_HEADERS_TIMEOUT = 60000` and the MCP transport uses the global `fetch` (W for both constants; T that the second cuts the call) | `GEMINI_API_HEADERS_TIMEOUT_MS` in the environment, or `model.requestTimeoutMs`; per-server `timeout` (ms) for the MCP limit | Body timeout 300 s (`DEFAULT_BODY_TIMEOUT`) |
| Antigravity 1.5.x docs | 180 s per tool call (W, docs) | Per-server `timeoutSeconds`; a negative value turns the limit off | Not established |
| Kiro CLI 3.5.0 | 120 s: `requestTimeout`, "Per-call request timeout in milliseconds (default: 120000)" (W, agent reference; another docs page describes `timeout` as the request timeout, which conflicts) | `requestTimeout` in the agent config | Not established |
| Copilot CLI (docs at 1.0.114) | 30 s: `timeout`, "Timeout in milliseconds for tool discovery and tool calls. Default: `30000`" (W, docs). Issue reports say 180 s on some builds (T). | `"timeout": <ms>` in the `--additional-mcp-config` entry, up to 4294967295 | A call that keeps sending progress "is canceled once it has run for ten times the server's `timeout`" |
| Grok Build 1.0.45 source | 6000 s: `DEFAULT_TOOL_TIMEOUT_SECS: u64 = 6000` (W; live docs agree) | `tool_timeout_sec` or `tool_timeouts` in `config.toml`; no flag or variable | None: only a 10 s connect timeout |
| Aider 0.86.2 | No limit on a shell command: `run_cmd.py` reads stdout to end of file (W) | n/a | A person must confirm the command first |

What this means for the carrier decision (inferences, T):

- **Raising each CLI's timeout at launch works for the five CLIs Quay configures per launch**,
  and Quay should do it for the three it already wires without one (Claude Code, Codex,
  OpenCode).
- **A silent ten-minute `POST` is fragile even then.** Pi and Gemini each keep a five-minute
  HTTP timer that a launch flag cannot change, and Claude Code backgrounds the call at two
  minutes unless a variable turns that off.
- **Two server-side shapes avoid the problem instead of tuning around it:**
  - **Answer in short calls.** One tool hands over the surface and returns at once with an id;
    a second waits a bounded time, under 25 s to clear Copilot's 30 s default, and returns
    either the answer or "still waiting, call again". `quay_send_message` already works this
    way with its 60 s wait and "still working" note. It needs nothing changed in any CLI.
  - **Answer with an SSE stream.** Sending headers at once clears every first-byte timer, and
    progress events reset the request timer in Pi and OpenCode 1 (`resetTimeoutOnProgress:
    true`). They do not extend it in Claude Code ("progress notifications from the server don't
    extend it"), Codex or Gemini, so a per-CLI timeout is still needed there.
- **A stdio shim is a third option for the CLIs without per-launch config.** One Quay-owned
  program, registered once as a stdio MCP server, could read `QUAY_MCP_URL` and
  `QUAY_A2A_TOKEN` from the environment it inherits and relay to the bridge. Stdio has no
  HTTP first-byte timer (Claude Code: "Stdio and WebSocket servers have no per-request timer").
  Whether each CLI passes its own environment to a stdio server was not read for Antigravity
  or Kiro.

## Size limits

- **Tool input.** No client was found to cap the arguments a model writes. The binding limits
  are the model's own output budget and Quay's 2 MB request body. (T for "no client cap": no
  source was found that sets one in Claude Code, Codex, Gemini, Pi, OpenCode or Grok; Copilot,
  Kiro and Antigravity are closed and undocumented on this.)
- **Tool result.** Every client trims a large result before the model sees it. An operator's
  answer is small, so this matters only if Quay returns a surface or a long text back.

| CLI | Result limit before truncation | Source |
| --- | --- | --- |
| Claude Code 2.1.330 | 25,000 tokens (`MAX_MCP_OUTPUT_TOKENS`), or 50,000 characters of text; the rest is saved to a file and its path returned | W, docs |
| Codex 0.171.0 | The model's truncation policy, fallback 10,000 bytes, cut in the middle; `tool_output_token_limit` overrides | W, source |
| OpenCode 1.19.6 and 2.4.0 | 2,000 lines or 51,200 bytes; `tool_output.max_lines`, `tool_output.max_bytes` | W, source |
| Pi 1.6.0 | 20 KB (`MCP_OUTPUT_MAX_BYTES`), middle cut, full text saved to a temp file | W, source |
| Gemini CLI 0.70.0 | 40,000 characters (`tools.truncateToolOutputThreshold`), full text saved to a file | W, source |
| Grok Build 1.0.45 | 20,000 bytes (`MCP_MAX_OUTPUT_BYTES`); `GROK_MAX_MCP_OUTPUT_BYTES` raises it | W, source |
| Kiro CLI | Not documented. Its predecessor's source has `MAX_TOOL_RESPONSE_SIZE = 400_000`. | T |
| Copilot CLI | "Large tool outputs are written to disk"; threshold not documented | W for the sentence (changelog 0.0.376) |
| Antigravity | Not documented | n/a |

A result kept under 10,000 bytes passes every documented limit.

## Elicitation

| CLI | Supports `elicitation/create`? | Source |
| --- | --- | --- |
| Claude Code | Yes, form and URL, since 2.1.76; a terminal dialog | W, changelog and docs |
| Codex | Yes, form and URL. Auto-declined when the approval policy is `never`, which Quay's Skip mode appears to set (`--dangerously-bypass-approvals-and-sandbox`). | W, `codex-mcp/src/elicitation.rs` at 0.171.0; T for Skip mode, from the comment on `codex_bus_args` in `session.rs` |
| OpenCode 1.19.6 | No: `// elicitation: {}` is commented out of the client's capabilities | W, `packages/opencode/src/mcp/index.ts` |
| OpenCode 2.4.0 | Yes, form and URL | W, `packages/core/src/mcp/client.ts` |
| Pi 1.6.0 | No: "pi does not support elicitation" | W, `coding-agent/test/mcp-conformance/README.md` |
| Gemini CLI 0.70.0 | No: the client declares only `roots`; the request for it was closed as not planned on 2026-09-06 | W, `mcp-client.ts`; issue #28074 |
| Antigravity | Not documented. Strings in the 1.4.11 binary suggest the bundled SDK handles it. | T |
| Kiro CLI | Yes in V3 sessions, from 2.34, form and URL | W, kiro.dev MCP usage page |
| Copilot CLI | Yes, form and URL, first mentioned in 0.0.421 | W, changelog |
| Grok Build | Yes, form and URL, when an interactive client is attached | W, source |
| Aider | No MCP | W |

Why it does not carry a surface:

- **Quay cannot send the request.** Under revisions up to 2025-11-25 an elicitation is a request
  from server to client, which needs an SSE stream. (W,
  [elicitation, 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation))
- **Under 2026-07-28 it needs no stream**: the server returns an `InputRequiredResult` from
  `tools/call` and the client retries with `inputResponses`. Quay would have to implement that
  revision, and only Claude Code, Grok, Copilot from 1.0.81, OpenCode 2 and Codex behind an
  off-by-default flag speak it. (W for the spec; W or T per client as marked in the per-CLI
  notes)
- **The form is too small.** "Form mode elicitation schemas are limited to flat objects with
  primitive properties only." (W, same page)
- **The CLI draws it, not Quay.** The destination on the map has Quay rendering the surface
  with its own components. (inference from the map)

## Per-CLI notes

Each list covers transports, per-launch configuration, the bearer header, and anything in the
way. Blocking time, size and elicitation are in the tables above.

### Claude Code (2.1.330, installed)

- **Transports**: `stdio`, `http` (alias `streamable-http`), `sse` (deprecated), `ws`. (W,
  [MCP docs](https://code.claude.com/docs/en/mcp))
- **Per launch**: `--mcp-config <configs...>` takes "JSON files or strings";
  `--strict-mcp-config` uses only those. Variables set in the child's environment are read per
  process. (W, `claude --help`)
- **Header**: `headers` with `${VAR}` and `${VAR:-default}` in `url` and `headers`. Names that
  look like credentials (`ANTHROPIC_API_KEY`, `NPM_TOKEN` and others, list not published) are
  read as empty in a remote server's `url` and `headers`. `CLAUDE_EVENTS_TOKEN` works today.
  (W, docs)
- **Protocol**: dual-era by default since 2.1.232. It asks an HTTP server whether it supports
  the newer revision and "connects to every other server as v1 does". `MCP_PROTOCOL_NEGOTIATION=legacy`
  opts out. (W, changelog)
- **Observed**: the Claude Code session that wrote this note had Quay's `quay_*` tools loaded,
  so the connection, fallback included, works in the installed version. (T: one observation;
  the version is `claude --version` on that machine, and the session's negotiation setting was
  not checked)
- **In the way**: nothing for the transport. For a blocking call, add `"timeout"` to the inline
  entry and decide whether to set `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=0`. Whether the inline
  JSON honours `timeout` as a config file entry does is T.

### Codex (0.146.0 installed; 0.171.0 latest, 2026-11-20)

- **Transports**: stdio and streamable HTTP only. There is no SSE transport. (W,
  `codex-rs/config/src/mcp_types.rs`, tags `rust-v0.146.0` and `rust-v0.171.0`)
- **Per launch**: `-c key=value` overrides, as Quay uses. `CODEX_HOME` and `-p/--profile` also
  exist. (W, `codex --help`)
- **Header**: `bearer_token_env_var`; `env_http_headers` maps a header to a variable name.
  There is no `${VAR}` interpolation, and an inline `bearer_token` is refused. (W, source)
- **Quirks**: only `202` or `204` count as accepted for a notification, which matches the note
  in Quay's `reply_to_notification`. A `401` starts the auth path only with a
  `WWW-Authenticate` header, so Quay's bare `401` is a plain error. `GET` returning `405` maps
  to "server does not support SSE". (W, `codex-rs/rmcp-client/src/http_client_adapter.rs`)
- **On timeout**: the model gets "timed out awaiting tools/call after …" and a late result is
  dropped. 0.171.0 also posts `notifications/cancelled`, which Quay answers with `202`. (W)
- **Protocol**: offers `2025-06-18`. 0.171.0 has 2026-07-28 behind the feature
  `mcp_2026_07_28`, off by default. (W, source)

### OpenCode (not installed; 1.19.6 is npm `latest`, 2.4.0 is a separate package)

- **Two lines are live.** `opencode-ai@1.19.6` is "OpenCode 1". `@opencode/cli@2.4.0`
  (2026-11-23) is OpenCode 2, and opencode.ai/docs now documents 2. (W, npm and the repo
  `anomalyco/opencode`, to which `sst/opencode` redirects)
- **Transports**: 1.x: `local` (stdio) and `remote`, which tries streamable HTTP and then SSE.
  2.x: streamable HTTP only. (W, source)
- **Per launch**: `OPENCODE_CONFIG_CONTENT`, as Quay uses, and `OPENCODE_CONFIG`. 2.x still
  reads both and migrates a 1.x-shaped `mcp.<name>` entry in memory, keeping `oauth: false`.
  (W, `packages/opencode/src/config/config.ts` at `v1.19.6`;
  `packages/core/src/config/normalize.ts` at `v2.4.0`)
- **Header**: `headers`, with `{env:VAR}` substituted over the whole config text, so it works
  in `url` as well. (W)
- **In the way on 2.x**: MCP tools go through Code Mode by default, so the model does not see
  them as native tools unless `"codemode": false` is set; and the default for `protocol` is
  `auto` in source but `legacy` in the docs. `auto` probes `server/discover` first. Neither
  key is carried by the 1.x-entry migration. (W for the keys; T for the default)

### Pi (0.84.4 installed; 1.6.0 is npm `latest`, 2026-11-20)

- **The installed 0.84.4 has no MCP.** Its README says "No MCP." Built-in MCP and
  `pi.registerMcpServer()` arrived in 0.99.0 (2026-09-29). The October note read 1.3.0. (W,
  the installed package; `packages/coding-agent/CHANGELOG.md` at `v1.6.0`)
- **Transports** (0.99.0 and later): stdio and streamable HTTP. `type: "sse"` is rejected.
  (W, `packages/mcp/src/config.ts`)
- **Per launch**: no flag or variable. `pi -e <file>` loads an extension that calls
  `pi.registerMcpServer(name, config)`, which lasts for the session and is not saved. A
  same-named server in the user's `mcp.json` wins. (W,
  [`docs/mcp.md`, `docs/extensions.md`](https://github.com/earendil-works/pi/tree/v1.6.0/packages/coding-agent/docs))
- **Header**: `${VAR}` and `$VAR` expand in `headers`, not in `url`. The extension must read
  `process.env.QUAY_MCP_URL` itself. (W, source)
- **Exposure**: the default is `codemode`, where the model does not see the tool directly. Set
  `exposure: "direct"`. (W)
- **In the way**: nothing in the handshake: JSON replies, `202` and a `405` on `GET` are all
  handled, and OAuth is skipped when an `Authorization` header is configured. Quay does not
  wire Pi today. (W, `packages/mcp/src/transports/streamable-http.ts`)
- **Protocol**: offers `2025-11-25`; does not implement 2026-07-28. (W)

### PiG (0.5.0 installed)

Not one of the ticket's ten. Already wired as a full peer through the `quay-pig-bridge` sidecar.
See `.scratch/research/pig-per-terminal-mcp.md`. Its keys and defaults mirror Pi's. (W, that
note and `session.rs`)

### Gemini CLI (not installed; 0.70.0, 2026-11-19)

- **Status**: still maintained, now for Code Assist licences; free and Google AI Pro and Ultra
  access moved to Antigravity CLI on 2026-06-18. (W, the repo's README and releases)
- **Transports**: stdio (`command`); streamable HTTP (`httpUrl`, now deprecated in source, or
  `url` with `"type": "http"`); SSE (`url` with `"type": "sse"`). `url` with no `type` tries
  streamable HTTP and falls back to SSE. The docs lag the source on this. (W,
  `packages/core/src/tools/mcp-client.ts` at `v0.70.0`)
- **Per launch**: no flag. `GEMINI_CLI_SYSTEM_SETTINGS_PATH` and
  `GEMINI_CLI_SYSTEM_DEFAULTS_PATH` each point one process at a settings file, and every
  settings string expands `$VAR`, `${VAR}` and `${VAR:-default}` from the process environment.
  So one Quay-owned file, named by a variable Quay sets on the terminal, gives each terminal
  its own URL and token. The system-settings path replaces a real enterprise file for that
  process; the defaults path is the lowest-precedence scope. (W,
  `packages/cli/src/config/settings.ts`; how `mcpServers` merges across scopes is T)
- **Header**: `headers`, expanded as above. A second pass in core expands headers against an
  environment with names matching `TOKEN`, `KEY`, `AUTH` or `SECRET` removed, which is harmless
  once the first pass has substituted the value. (W for both passes; T for "harmless")
- **In the way**: no MCP server connects in an untrusted folder. `GEMINI_CLI_TRUST_WORKSPACE=true`
  or `--skip-trust` trusts it for the session. (W,
  `packages/core/src/tools/mcp-client-manager.ts`)
- **Protocol**: MCP SDK 1.32.2, offers `2025-11-25`, legacy only. (W)

### Antigravity `agy` (1.4.11 installed; docs and changelog run to 1.5.15)

- **Transports**: stdio and streamable HTTP. "The legacy HTTP+SSE transport and the `httpUrl`
  field aren't supported." Remote servers use `serverUrl`; "you can also use `url`". (W,
  [MCP docs, CLI tab](https://antigravity.google/docs/mcp?tab=cli), 2026-11-23)
- **Per launch**: none found. `agy --help` has no MCP flag; `--settings` takes settings keys,
  and MCP is not one. Servers come from `~/.gemini/config/mcp_config.json`,
  `<workspace>/.agents/mcp_config.json` and an installed plugin's `mcp_config.json`. (W, local
  help and docs)
- **Header**: `headers` is supported. Expansion of process variables in a plain
  `mcp_config.json` is not documented; plugin configs expand only `${PLUGIN_ROOT}`,
  `${PLUGIN_DATA}` and variables the user enters in a setup dialog. (W for what is documented;
  T for "no expansion")
- **In the way**: with a random port and a token per terminal, a static file cannot hold
  either value. This is a configuration block, not a protocol one. Possible ways round it, none
  established: pin the port with `QUAY_BRIDGE_PORT` and accept one shared token; a stdio shim
  that reads the terminal's variables; `agy acp`, which the 1.5.9 changelog says takes MCP
  servers from its client.
- **Also**: MCP tools default to Ask mode, so a permission prompt precedes each call. (W, docs)
- **Protocol**: strings in the binary list `2026-07-28` and the handshake revisions, so the
  bundled SDK is probably dual-era. (T)

### Kiro CLI (not installed; 3.5.0, 2026-11-17)

- **3.0.0 shipped on 2026-11-03** and "makes V3 the default agent harness for interactive Kiro
  CLI sessions". (W, [changelog](https://kiro.dev/changelog/cli/))
- **Transports**: stdio (`command`) and remote (`url`), described as "Remote (HTTP/SSE)". No
  `type` key. (W, [MCP configuration](https://kiro.dev/docs/mcp/configuration/), updated
  2026-11-18)
- **Per launch**: no flag on `kiro-cli chat`. The nearest route is an agent file with its own
  `mcpServers`, selected with `--agent <name>`. The name is a path relative to the agents
  directory, not a file path, and workspace agents load only in a trusted workspace.
  `KIRO_HOME` moves the whole Kiro directory, sign-in included. `KIRO_AGENT_CONFIG_DIR` appears
  only in the 2.37.0 changelog. (W for the first three; T for the last)
- **Header**: `headers` with `${VAR}`, as in the docs' own example. Expansion in `url` is not
  documented. The approved-variables gate is for the IDE only. (W)
- **In the way**: `url` is an "HTTPS endpoint … (or HTTP endpoint for localhost)"; whether
  `127.0.0.1` counts is not stated. An organisation can turn MCP off, and an active registry is
  then "the only source of servers that can run". Selecting a Quay agent replaces the user's
  own default agent for that terminal. (W for the quotes; T for the consequences)
- **Protocol**: not established.

### GitHub Copilot CLI (1.0.71 installed; 1.0.114 latest, 2026-11-18)

- **Transports**: `local` or `stdio`, `http` (alias `streamable-http`), `sse`. A remote entry
  needs `type`, `url` and `tools` (for example `["*"]`). (W,
  [command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference))
- **Per launch**: `--additional-mcp-config <json or @file>`: "Add an MCP server for this
  session only". It is in the installed 1.0.71's help and takes priority over a same-named
  server. (W, `copilot --help` and docs)
- **Header**: "HTTP headers. Supports variable expansion", with `$VAR`, `${VAR}` and
  `${VAR:-default}`. Expansion in `url` is not stated, which does not matter for an inline
  entry built per launch. (W)
- **In the way**: a bare `401` now shows the server in the `/mcp` sign-in picker (1.0.107), so
  a wrong token looks like a sign-in prompt. An organisation's policy can disable MCP servers
  or allow only listed ones, matched on the remote URL, which a random port may never match.
  Quay's Copilot lookup may fall back to `gh copilot` (above). (W for the changelog and docs
  lines; T for the allowlist consequence)
- **Protocol**: offers `2025-11-25`; 2026-07-28 support shipped in 1.0.81 (2026-08-27), and
  newer builds probe `server/discover` before falling back. The installed 1.0.71 predates
  that. Fallback on a `-32601` reply, as opposed to a timeout, is T.

### Grok Build (not installed; source at crate version 1.0.45, release pointer at 1.0.92)

- **The public source is behind the shipping binary.** Source findings are from
  `xai-org/grok-build@2bdd1d6` (2026-09-29). Items the live docs repeat are current; the rest
  may have changed. The October note's "0.2.38" could not be matched to any version seen.
  (W for what was read)
- **Transports**: stdio and streamable HTTP. `type = "sse"` is accepted as a label, but both
  remote kinds use the streamable HTTP transport. (W for the config; T for "SSE is not
  separate")
- **Per launch**: no MCP flag, and the `GROK_CONFIG` overlays cannot set `mcp_servers`.
  `GROK_HOME` moves the whole home, sign-in included. The practical route is one static entry
  in `~/.grok/config.toml` whose `url` and header read the terminal's variables. (W,
  `xai-grok-pager/src/app/cli.rs`, `xai-grok-config/src/config_override.rs`)
- **The leader-process question from the October note is answered.** Each TUI expands
  `${VAR}` against its own environment and sends the expanded server list when it opens a
  session, and that definition replaces the leader's copy. So a per-terminal URL and token
  survive leader mode. Leader mode is off by default. (W, source at `2bdd1d6`)
- **Header**: `headers = { Authorization = "Bearer ${VAR}" }`, or `bearer_token_env_var`.
  `${VAR}` expands in `url` and `headers`. (W, source and
  [docs](https://docs.x.ai/build/features/mcp-servers))
- **In the way**: nothing in the handshake. An unset variable leaves the literal `${VAR}`, so
  a Grok started outside Quay would show a failed server. MCP calls prompt in the default
  permission mode; `--allow "MCPTool(quay__*)"` or `--always-approve` suppresses that. Quay
  passes no permission flag to Grok today. (W for the flags; T for the unset-variable case)
- **Protocol**: offers `2025-11-25`. For HTTP it first probes `server/discover`, and any reply
  that shows the server was reached, method-not-found included, falls back to `initialize`.
  It handles `InputRequiredResult`. (W, `xai-grok-mcp/src/servers.rs`)

### Aider (not installed; 0.86.2, 2026-02-12)

- **No MCP.** "mcp" does not appear in the repository's Python or docs, and the request
  [Aider-AI/aider#3314](https://github.com/Aider-AI/aider/issues/3314) is still open. (W, the
  repo at `5dc9490` and the live docs)
- **No tool calling.** Aider works by edit formats. The only thing the model can cause to run
  is a fenced shell block. (W, `aider/coders/editblock_coder.py`)
- **Shell route**:
  - A suggested command asks "Run shell command?" with `explicit_yes_required=True`. (W,
    `aider/coders/base_coder.py`)
  - `--yes-always`, which Quay passes in Skip mode, answers **no** to it:
    `res = "n" if explicit_yes_required else "y"`. A person must confirm each command. (W,
    [`aider/io.py`](https://github.com/Aider-AI/aider/blob/main/aider/io.py))
  - A second prompt asks whether to add the output to the chat. The output then becomes a
    user message followed by a canned "Ok", so the model does not continue its turn with the
    answer. (W, `base_coder.py`)
  - Each line of a shell block runs as its own command, so a surface of any size would have to
    be written to a file by an edit and passed by path. (T)
- **Other channels**: `--message-file`, `--load` and `--watch-files` carry text in;
  `--chat-history-file` and `--llm-history-file` carry it out, unstructured;
  `--notifications-command` is a signal with no payload. (W, docs)
- **Verdict**: a helper program can stand in, but only with a person confirming each use and
  without the agent resuming on the answer. Aider cannot take part at the level the others can.

## Which CLIs could not talk to Quay's MCP server as it stands

- **Aider**: no MCP client. (W)
- **Pi below 0.99.0**, which includes the 0.84.4 on the research machine: no MCP client. (W)
- **Antigravity**: the client would work, but no way was found to give one terminal its own
  port and token. (W for the absence in help and docs; T that none exists)
- **Nothing else is blocked by the protocol.** No CLI needs stdio, legacy SSE, a session id or
  a `GET` stream. Kiro has one open point: whether `http://127.0.0.1` counts as "localhost".

## Not established

- Whether Quay's silent reply really trips Claude Code's 60 s first-byte timer, Gemini's 60 s
  headers timeout, Pi's 300 s headers timeout or a Bun fetch limit in OpenCode. Each needs a
  live test with a tool that sleeps past the limit.
- Whether Claude Code's inline `--mcp-config` entry honours `timeout`.
- Copilot's real default (30 s in the docs, 180 s in issue reports) and whether `gh copilot`
  passes flags through.
- Whether any client sends an `Origin` header on the wire.
- How each dual-era client other than Grok and Claude Code treats a `200` with `-32601` on
  `server/discover`.
- Antigravity: variable expansion in a plain `mcp_config.json`, any per-process config, the
  1.4.11 default timeout, and what it does on a bare `401`.
- Kiro: `${VAR}` in `url`, whether V2 sessions honour `requestTimeout`, the protocol revision,
  and the status of `KIRO_AGENT_CONFIG_DIR`.
- Grok: whether 1.0.92 differs from the 1.0.45 source.
- Whether Antigravity, Kiro and Gemini pass their own environment to a stdio server.

## Sources

Quay code at `301d9d3`: `RunKind` (`gets_quay_mcp`, `bus_level`) in
`src-tauri/src/slices/pty/models.rs`; `build_command`, `mcp_config_arg`, `codex_bus_args`,
`opencode_config_content`, `set_quay_env` in `src-tauri/src/slices/pty/session.rs`;
`handle_mcp_request`, `reply_to_notification` in `src-tauri/src/slices/orchestrator/mcp.rs`;
`handle_mcp`, `handle_mcp_get`, `authenticate_mcp_caller`, `validate_host_and_origin`,
`handle_permission` in `src-tauri/src/slices/bridge/routes.rs`;
`src-tauri/src/slices/bridge/server.rs`, `port.rs`, `pending.rs`;
`src-tauri/sidecars/bridge-post`, `pig-bridge`.

Local commands on the research machine (help and version only): `claude` 2.1.330, `codex`
0.146.0, `agy` 1.4.11 (with `agy changelog`), `copilot` 1.0.71, `pi` 0.84.4, `pig` 0.5.0.
Gemini, OpenCode, Kiro, Grok and Aider are not installed there.

Specification and libraries:

- MCP: <https://modelcontextprotocol.io/specification/versioning>,
  <https://modelcontextprotocol.io/specification/2025-11-25/basic/transports>,
  <https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation>,
  <https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http>,
  <https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning>
- axum 0.8.9: <https://docs.rs/axum/0.8.9/axum/extract/struct.DefaultBodyLimit.html>

Per CLI:

- Claude Code: <https://code.claude.com/docs/en/mcp> ("Time limits on MCP tool calls",
  "Automatic backgrounding of long tool calls"), <https://code.claude.com/docs/en/env-vars>,
  <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md> (through 2.1.330)
- Codex: <https://github.com/openai/codex> at `rust-v0.171.0` and `rust-v0.146.0`:
  `codex-rs/codex-mcp/src/rmcp_client.rs`, `codex-rs/codex-mcp/src/elicitation.rs`,
  `codex-rs/config/src/mcp_types.rs`, `codex-rs/rmcp-client/src/http_client_adapter.rs`
- OpenCode: <https://github.com/anomalyco/opencode> at `v1.19.6` (`packages/opencode/src/mcp/`,
  `config/`, `tool/truncate.ts`) and `v2.4.0` (`packages/core/src/mcp/client.ts`,
  `config/normalize.ts`); <https://opencode.ai/docs/mcp-servers/>;
  <https://github.com/modelcontextprotocol/typescript-sdk> at `v1.29.0`
  (`src/shared/protocol.ts`, `src/client/streamableHttp.ts`)
- Pi: <https://github.com/earendil-works/pi> at `v1.6.0`: `packages/coding-agent/docs/mcp.md`,
  `docs/extensions.md`, `docs/settings.md`, `CHANGELOG.md`,
  `src/extensions/mcp/runtime.ts`, `src/core/http-dispatcher.ts`, `packages/mcp/src/`
- Gemini CLI: <https://github.com/google-gemini/gemini-cli> at `v0.70.0`:
  `packages/core/src/tools/mcp-client.ts`, `mcp-client-manager.ts`,
  `packages/core/src/utils/fetch.ts`, `packages/core/src/config/config.ts`,
  `packages/cli/src/config/settings.ts`, `packages/cli/src/utils/envVarResolver.ts`
- Antigravity: <https://antigravity.google/docs/mcp?tab=cli>,
  <https://antigravity.google/docs/settings?tab=cli>,
  <https://antigravity.google/docs/build-plugins>
- Kiro: <https://kiro.dev/docs/mcp/configuration/>, <https://kiro.dev/docs/mcp/usage/>,
  <https://kiro.dev/docs/mcp/registry/>, <https://kiro.dev/docs/reference/cli-commands/>,
  <https://kiro.dev/docs/custom-agents/configuration-reference/>,
  <https://kiro.dev/changelog/cli/>; <https://github.com/aws/amazon-q-developer-cli> at `15cc8f3`
  for inherited mechanisms
- Copilot CLI:
  <https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference>
  (source `github/docs` at `a5cc0d0`), <https://github.com/github/copilot-cli> `changelog.md` at
  `020bbc0`
- Grok Build: <https://github.com/xai-org/grok-build> at `2bdd1d6`
  (`crates/codegen/xai-grok-mcp/src/servers.rs`, `xai-grok-config/src/mcp_server_config.rs`,
  `xai-grok-pager/src/app/cli.rs`), <https://docs.x.ai/build/features/mcp-servers>
- Aider: <https://github.com/Aider-AI/aider> at `5dc9490` (`aider/io.py`,
  `aider/coders/base_coder.py`, `aider/run_cmd.py`, `aider/args.py`),
  <https://aider.chat/docs/config/options.html>,
  <https://github.com/Aider-AI/aider/issues/3314>

## The table

"Per launch" means for one terminal's process, without editing a file the user owns. "Blocking
limit" is what a silent call to Quay's server meets first with default settings, then how to
change it.

| CLI | Channel | How it is configured per launch | Blocking limit | What stands in the way |
| --- | --- | --- | --- | --- |
| Claude Code | MCP over streamable HTTP, bearer header. **Wired today.** | `--mcp-config '<inline JSON>'`; variables in the child's environment | About 60 s (HTTP first-byte timer, T), then backgrounded at 120 s. Raise with per-server `"timeout"` (ms) and `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=0`. | Nothing for the transport. No timeout is set today. |
| Codex | MCP over streamable HTTP, bearer from a named variable. **Wired today.** | `-c mcp_servers.quay.*` overrides | 300 s. Raise with `-c mcp_servers.quay.tool_timeout_sec=<s>`. | Nothing. Elicitation is auto-declined in Skip mode. |
| OpenCode | MCP over streamable HTTP, bearer header. **Wired today.** | `OPENCODE_CONFIG_CONTENT` | 1.x: 60 s; 2.x: 12 h. Raise with `"timeout"` (ms) on the server entry. | 2.x hides MCP tools behind Code Mode unless `"codemode": false`, and probes the new revision first (T). |
| Pi | MCP over streamable HTTP, bearer header, from 0.99.0. Not wired. | `pi -e <Quay extension>` calling `pi.registerMcpServer` with `exposure: "direct"` | 60 s. Raise with `timeout` (seconds) in the registration. A 300 s HTTP headers timer sits behind it (T). | Versions below 0.99.0 have no MCP (0.84.4 is installed here). |
| Gemini | MCP over streamable HTTP, bearer header. Not wired. | No flag. `GEMINI_CLI_SYSTEM_DEFAULTS_PATH` or `…_SETTINGS_PATH` naming a Quay-owned settings file that reads `${QUAY_MCP_URL}` and `${QUAY_A2A_TOKEN}` | Probably 60 s (HTTP headers timeout, T); the MCP limit is 10 minutes. Raise with `GEMINI_API_HEADERS_TIMEOUT_MS` and per-server `timeout` (ms). | Needs a trusted folder (`GEMINI_CLI_TRUST_WORKSPACE=true`). No elicitation. |
| Antigravity | MCP over streamable HTTP, `headers`. Not wired. | **None found.** Only `mcp_config.json` files (user, workspace, plugin), with no documented variable expansion | 180 s. Raise with per-server `timeoutSeconds`; negative turns it off. | A static file cannot hold a random port and a per-terminal token. Each MCP call prompts by default. |
| Kiro | MCP over HTTP, bearer header. Not wired. | No flag. A generated agent file with `mcpServers`, selected with `--agent <name>` | 120 s. Raise with `requestTimeout` (ms) in the agent config. | The agent file lives in the user's Kiro directory and replaces their default agent. "HTTP for localhost" may not cover `127.0.0.1`. |
| Copilot | MCP over streamable HTTP, bearer header. Not wired. | `--additional-mcp-config '<inline JSON or @file>'` with `type`, `url`, `headers`, `tools`, `timeout` | 30 s by the docs (180 s reported, T). Raise with `"timeout"` (ms) in the entry. | Quay may launch `gh copilot` instead of `copilot.exe`. Organisation policy can block MCP servers. |
| Grok | MCP over streamable HTTP, bearer header. Not wired. | No flag. One static `[mcp_servers.quay]` entry in `~/.grok/config.toml` reading `${QUAY_MCP_URL}` and `${QUAY_A2A_TOKEN}`, expanded per terminal | 100 minutes. Change with `tool_timeout_sec` in the same entry. | A one-time write to the user's config. MCP calls prompt unless `--allow` or `--always-approve` is passed. Source read is behind the shipping build. |
| Aider | **No MCP.** A helper program run as a shell command | n/a | No limit on a running command | A person must confirm every command, even with `--yes-always`, and the agent does not resume on the answer. |
| PiG (not in the ticket's ten) | MCP over streamable HTTP. **Wired today.** | `-e <quay-pig-bridge>` | 120 s as Quay sets it; default 60 s | Nothing. |
