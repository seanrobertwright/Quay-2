# Research: How can a PiG terminal tell Quay a turn ended?

Ticket: [#145](https://github.com/seanrobertwright/Quay-2/issues/145), a research ticket on the
[Wayfinder map: PiG as a Quay agent](https://github.com/seanrobertwright/Quay-2/issues/141).

Checked on 2026-10-21. PiG was read at `main` commit
[`3ee123c`](https://github.com/MichaelKinsy/PiG/tree/3ee123c6d5f4a754dd27ebb9190ab8e169354f13)
(latest release v0.5.1, 2026-10-19) through `gh api`, without installing or running it. Quay was read
at `master` `0dadfc1`. Nothing below was checked live; the live-check ticket should confirm the items
under "Still to check live".

## Short answer

- **Yes, PiG can be a full peer.** One extension, loaded per terminal with `-e`, can do both jobs a
  full peer needs:
  - on turn end, POST a `turn.completed` envelope with the final answer text to Quay's bridge;
  - register Quay's MCP server for that session only with `registerMcpServer`.
- **The answer text is there.** `agent_end` carries the run's `messages`. The last assistant message
  holds the text blocks, and its `usage` holds token counts. `agent_settled` carries only `aborted`,
  but it is the event that says nothing else will run. `turn_end` fires after every model call
  inside the tool loop, so it is the wrong signal.
- **The extension can reach the bridge.** Extensions are ordinary child processes that inherit
  PiG's environment. They get `QUAY_EVENTS_URL`, `QUAY_A2A_TOKEN` and `QUAY_TERMINAL_ID`, which
  Quay already sets for every peer terminal, and they run with the user's privileges. Nothing
  sandboxes their network access.
- **The docs overstate one thing.** "TypeScript runs without Node" is not what the code does. A
  TypeScript extension needs `node` 22.13 or newer on `PATH`. Go, Rust and Python extensions given
  as source need their toolchains, because PiG builds them on first load. Only a prebuilt native
  executable needs nothing on the user's machine.
- **Recommendation:** match the Claude event-bridge plugin's `turn.completed` envelope, sent the way
  the planned Codex helper sends it (#83). Ship it as a small prebuilt native executable bundled
  with Quay, loaded with `pig -e <path>`. Details are under "Recommendation".

## What Quay needs (this repo)

| Concern | What the code does today | Where |
| --- | --- | --- |
| Turn end and answer | `POST /v1/events` with `{"events":[Envelope]}`. On `turn.completed`, `handle_events` passes `data.answer` to `A2ARouter::resolve_pending_reply`, which ends a pending `wait_for_reply`. If `answer` is missing, the reply is the literal `Turn completed`. | `handle_events` in `src-tauri/src/slices/bridge/routes.rs` |
| Status | The same event sets the pane status: `turn.started` and `tool.started` mean Working, `turn.completed` and `session.started` mean Idle, `session.ended` means Exited. An Idle or Exited status releases the terminal's next held message (`deliver_held`). | `PtyManager::apply_plugin_event` in `src-tauri/src/slices/pty/manager.rs`; `handle_events` |
| Envelope shape | `v`, `boot`, `seq`, `ts`, `sessionId`, `type` and `data` are required. `tag` must be the Quay terminal id. | `Envelope` in `src-tauri/src/slices/bridge/models.rs` |
| Auth (#70, closed) | The request must be loopback with no `Origin` header and carry `Authorization: Bearer <token>`. Every event's `tag` must name the terminal that token belongs to, or the whole batch gets 401. `/mcp` uses the same check and finds the caller by token. | `authorize_events`, `authenticate_mcp_caller` in `routes.rs` |
| Env vars (#137) | Every peer terminal gets `QUAY_TERMINAL_ID`, `QUAY_A2A_TOKEN`, `QUAY_MCP_URL` (`http://127.0.0.1:<port>/mcp`) and `QUAY_EVENTS_URL` (`http://127.0.0.1:<port>/v1/events`). Claude also gets `CLAUDE_EVENTS_*`. | `set_quay_env`, `set_event_bridge_env` in `src-tauri/src/slices/pty/session.rs` |
| Turn-end kinds | `RunKind::reports_turn_end` is true only for Claude. Only those terminals show Working on delivery and get held deliveries. A PiG kind would join this list. | `src-tauri/src/slices/pty/models.rs` |
| Bus levels (#72) | **Full peer:** sends, answers a waiting sender and shows status. **Responder:** answers and shows status, but has no `quay_*` tools. **Listener:** gets messages but can't answer. Standing rule: Quay wires a CLI onto the bus per terminal, through flags, env vars or a file passed at launch, and never writes to the CLI's own user config. | `RunKind::bus_level` in `models.rs`; #72 |

How each full peer reports a turn today, or will once its ticket lands:

- **Claude:** the external event-bridge plugin
  ([claude-mod-events](https://github.com/seanrobertwright/claude-mod-events)) POSTs `turn.completed`
  with `data.answer`, using `CLAUDE_EVENTS_URL`, `CLAUDE_EVENTS_TOKEN` and `CLAUDE_EVENTS_TAG`. This is
  the only one live today.
- **Codex (#83, open):** a small Rust helper binary, bundled as a Tauri sidecar and run through
  Codex's `-c notify=[...]`. It reads `last-assistant-message` and POSTs a complete `turn.completed`
  envelope to `QUAY_EVENTS_URL`, with `tag` set to the terminal id and the terminal's bearer token.
- **OpenCode (#84, open):** no code inside the CLI. Quay launches it with `--port`, subscribes to
  its SSE `GET /event`, takes the first `session.status` idle on the main session, and reads the
  final text from `GET /session/:id/message`.

## PiG's turn-end events

All four runtimes (Node, Go, Rust, Python) implement these events and fields, according to the
generated SDK surface matrix ([`docs/extension-sdk-surface.md`](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/docs/extension-sdk-surface.md),
"Events" rows for `agent_end`, `agent_settled`, `turn_end` and `message_end`). The payload types are
in [`coding/extension/events.go`](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/coding/extension/events.go).

| Event | When | Payload | Use for Quay |
| --- | --- | --- | --- |
| `turn_end` | After each model response inside a run, including the ones that end in tool calls. | `turnIndex`, `message` (that response), `toolResults`, `messageEntryId`, `toolResultEntryIds`, plus the boundary fields `outcome`, `entries`, `continue`, `context` (`TurnEndEvent`, L623–L632). | **No.** A prompt that uses tools fires several, and only the last holds the answer. |
| `message_end` | After each finished message. | `message` (`MessageEndEvent`, L670–L673). | No, for the same reason. |
| `agent_end` | When a run's loop ends. | `messages`: the run's messages (`AgentEndEvent`, L487–L490). | **Source of the answer.** Take the last message with `role: "assistant"` and join its `text` content blocks. |
| `agent_before_settle` | Before settling. Handlers can still add entries or ask to continue. | `outcome` (`completed`, `aborted` or `error`), `entries`, `continue`, `context` (L428–L443, L492–L499). | Optional. It shows whether a continuation is coming. |
| `agent_settled` | "after an agent run has fully settled and no automatic retry, compaction, or queued continuation will run" (L445–L452). | `aborted` only. | **The moment to POST `turn.completed`.** Escape gives `aborted: true`. |

An assistant message (`AssistantMessage`, [`ai/messages.go` L125–L140](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/ai/messages.go#L125-L140)) has:

- `content`: blocks, with text blocks shaped `{"type":"text","text":...}` (`TextContent`,
  [`ai/types.go` L66](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/ai/types.go#L66));
- `provider` and `model`;
- `usage`: `input`, `output`, `cacheRead`, `cacheWrite`, `totalTokens`, `cost`
  ([`ai/types.go` L572–L580](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/ai/types.go#L572-L580));
- `stopReason`: `stop`, `length`, `toolUse`, `error`, `aborted` and others
  ([L488–L494](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/ai/types.go#L488-L494));
- `errorMessage`, when the run failed.

So the turn-end signal can carry the answer text, and the token usage that "Research: where each CLI
reports its token count" (#95) needs. PiG follows Pi 1.3.0 here: `before_agent_start` reports
`messageType` `"user"` or `"custom"`, and a `sendMessage` with `triggerTurn` also starts a run that
settles ([`docs/extension-authoring.md`](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/docs/extension-authoring.md), "Per-run prompt sections"). A
prompt that a handler rejects emits no `agent_start` or `agent_settled` (same file, "Per-run tool
loadout").

## What an extension can do

- **Process and environment.** Ordinary extensions run as subprocesses
  ([`docs/extension-runtime-cells.md`](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/docs/extension-runtime-cells.md), "Invariants"). The host
  starts each one with `cmd.Env = append(append(os.Environ(), harnessEnv...), PIG_EXT_SOCKET=..., PIG_EXT_NAME=...)`
  ([`coding/extension/host/subprocess/host.go` L3071–L3075](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/coding/extension/host/subprocess/host.go#L3071-L3075)),
  so `QUAY_*` variables set on the `pig` process reach the extension.
- **Network.** "Subprocess hosting provides lifecycle and protocol isolation. It is not an
  operating-system sandbox" ([`docs/threat-model.md`](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/docs/threat-model.md), "Extension boundary").
  The README says the same: PiG "does not provide a security sandbox for … extensions"
  ([`README.md`](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/README.md), Security). An extension can open a loopback HTTP connection like any
  user process.
- **MCP per session.** `registerMcpServer` and `unregisterMcpServer` are implemented in every SDK
  ([`docs/extension-sdk-surface.md`](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/docs/extension-sdk-surface.md) L186–L188). The built-in MCP
  client speaks streamable HTTP. Native servers default to `"exposure": "codemode"`, and
  `"exposure": "direct"` declares the tools to the model directly
  ([`docs/design/builtin-mcp.md`](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/docs/design/builtin-mcp.md), "Retiring pi-mcp-adapter", step 3).
  This avoids `~/.pig/agent/mcp.json` and the project's `.pig/mcp.json`, which the standing rule
  rules out.
- **Loading per terminal.** Explicit `-e` paths are one of the discovery sources, and
  `--no-extensions` keeps them ([`docs/extensions.md`](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/docs/extensions.md), "Discovery"). Explicit
  paths need no project trust; only `<cwd>/.pig/extensions` does.

## Extension runtimes: what each needs on the user's machine

PiG accepts a conventional factory or an exact standalone in Go, Rust, Python or Node, or "an exact
executable file" ([`docs/extensions.md`](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/docs/extensions.md), "Source forms").

| Form | Needs at load time | Source |
| --- | --- | --- |
| TypeScript or JavaScript | **Node.js 22.13 or newer on `PATH`.** `ensureNodeRuntime` runs `exec.LookPath("node")` and fails with "TypeScript extensions need Node.js 22.13 or newer; node was not found on PATH". What PiG embeds is Pi's runtime modules (`runtime-node.pack`), not a JavaScript engine. | [`node_runtime_on.go` L22–L78](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/coding/extension/host/subprocess/node_runtime_on.go#L22-L78); [`builder_node.go` L18–L19](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/coding/extension/host/subprocess/builder_node.go#L18-L19) |
| Go factory or Go source standalone | The Go toolchain. PiG generates a runner module and builds it, and caches by toolchain version. | [`docs/runtime-cell-build-cache.md`](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/docs/runtime-cell-build-cache.md), "Generated runners" and "Hashes" |
| Rust factory or crate | Cargo and rustc, for the same reason. | same |
| Python | A Python interpreter. | same |
| Native executable | Nothing. It is launched as an isolated process. | [`docs/extensions.md`](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/docs/extensions.md), "Exact standalone" |

The README's claim, "needs no Node.js, and runs Pi's TypeScript extensions unchanged"
([`README.md` L25](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/README.md#L25)), holds for PiG itself but not for TypeScript extensions. The
"TypeScript runs under PiG without Node" note in #141 should be corrected.

One more risk for a prebuilt binary: "The extension wire has no independent version"
([`docs/runtime-cell-build-cache.md`](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/docs/runtime-cell-build-cache.md), "Hashes"). New capabilities
are added as new request methods behind capability flags, "not a protocol version bump. An extension
built against an older SDK never sets the capability flags"
([`protocol.go` L338–L345](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/coding/extension/host/subprocess/protocol.go#L338-L345)). An older binary
probably keeps working against a newer PiG, but nothing promises it, and PiG ships several commits a
day.

## The options

| # | Option | How the turn end reaches Quay | Answer text | `quay_*` tools | Bus level |
| --- | --- | --- | --- | --- | --- |
| 1 | **Quay extension, loaded with `-e`, doing both jobs** | The extension POSTs `turn.completed` on `agent_settled` with the text it saved from `agent_end` | Yes | Yes, via `registerMcpServer` | **Full peer** |
| 2 | Quay extension that only reports turns | Same as 1 | Yes | No | Responder |
| 3 | Quay reads PiG's session JSONL (the OpenCode shape: Quay reads, the CLI is unchanged) | Quay watches the session file for a settled assistant message | Probably, from the file | No. MCP would need `mcp.json`, which the standing rule forbids, and `PIG_CODING_AGENT_DIR` moves `auth.json` and `sessions/` too (#141) | Responder at best |
| 4 | `--mode json` or `--mode rpc` | Events on stdout | Yes | n/a | Doesn't fit. Quay runs the TUI in a PTY and types messages in; these modes replace the TUI. |
| 5 | Nothing (today's Pi) | — | No | No | Listener |

Option 3 is weaker than option 1 in every way. Quay would need to find the session file (where it
lives and how it's named was not checked), detect the end of a run without `agent_settled`, and
parse a format that PiG guarantees only as Pi-compatible. It would still leave PiG a responder.

## Recommendation

Use **option 1**, in the shape Quay already uses for Claude and plans for Codex:

1. **Envelope.** On `agent_settled`, POST
   `{"events":[{"v":1,"boot":…,"seq":…,"ts":…,"sessionId":…,"tag":$QUAY_TERMINAL_ID,"type":"turn.completed","data":{"answer":…}}]}`
   to `$QUAY_EVENTS_URL`, with `Authorization: Bearer $QUAY_A2A_TOKEN`. This is the Claude
   event-bridge plugin's event and the Codex helper's request (#83). Take `answer` from the last
   assistant message in the latest `agent_end`. When `aborted` is true or the text is empty, leave
   `answer` out or send a reason, which the build ticket decides. Optionally also send
   `turn.started` on `agent_start` and `tool.started` and `tool.finished` on
   `tool_execution_start` and `tool_execution_end`, so the pane shows Working. `/v1/events` needs no
   change.
2. **MCP.** In the same extension, at load, call `registerMcpServer("quay", …)` with
   `url = $QUAY_MCP_URL`, an `Authorization: Bearer $QUAY_A2A_TOKEN` header and `exposure: "direct"`.
   The token comes from the environment and never touches disk. This makes PiG a full peer with no
   config file.
3. **Packaging.** Build the extension as a **native executable**, a standalone `src/main.rs` against
   the Rust SDK (`pig-sdk`), and bundle it with Quay as a Tauri sidecar. This matches the Codex
   helper in #83: a small Rust binary that Quay ships and points the CLI at. Launch with
   `pig -e <sidecar path>`. Nothing needs to be installed on the user's machine, and nothing is
   written to `~/.pig`. Fallback: if the live check shows that a native `-e` executable doesn't load
   on Windows, ship a single `.ts` file instead. That needs Node 22.13 or newer, and Quay must
   detect Node and say so when it's missing.
4. **Quay side.** Add the `pig` kind to `bus_level() == FullPeer` and to `reports_turn_end()` (and to
   the frontend's `TURN_END_RUN_KINDS`), so deliveries are held until the turn ends, as for Claude.
5. **Version.** Because the wire is unversioned and the binary is built against one SDK, pin the
   tested PiG version in the docs (#141 already says so). This is the case #141 lists under "A
   runtime version check": full peer now depends on PiG's extension API, so that item should be
   revisited.

## Still to check live

- A native executable passed with `-e` loads on Windows, and `pig` passes `QUAY_*` to it.
- `agent_settled` fires in interactive TUI mode after a typed prompt, once per prompt, and after
  Escape with `aborted: true`.
- `registerMcpServer` with an HTTP `url`, a header and `exposure: "direct"` exposes the `quay_*`
  tools without an approval prompt (#141 says PiG has no tool-call approvals).
- How `pig-sdk` is consumed when Quay builds the sidecar: `extensions/sdk-rs/Cargo.toml` names the
  crate `pig-sdk` 0.1.0, but whether it is published on crates.io or must be a git dependency pinned
  to a PiG tag was not checked.

## Sources

PiG (commit `3ee123c`):

- [`README.md`](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/README.md)
- [`docs/extensions.md`](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/docs/extensions.md),
  [`docs/extension-authoring.md`](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/docs/extension-authoring.md),
  [`docs/extension-runtime-cells.md`](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/docs/extension-runtime-cells.md),
  [`docs/runtime-cell-build-cache.md`](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/docs/runtime-cell-build-cache.md)
- [`docs/extension-sdk-surface.md`](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/docs/extension-sdk-surface.md) (generated)
- [`docs/design/builtin-mcp.md`](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/docs/design/builtin-mcp.md),
  [`docs/threat-model.md`](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/docs/threat-model.md)
- [`coding/extension/events.go`](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/coding/extension/events.go),
  [`extensions/sdk/events.go`](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/extensions/sdk/events.go)
- [`ai/messages.go`](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/ai/messages.go), [`ai/types.go`](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/ai/types.go)
- [`coding/extension/host/subprocess/host.go`](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/coding/extension/host/subprocess/host.go),
  [`node_runtime_on.go`](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/coding/extension/host/subprocess/node_runtime_on.go),
  [`builder_node.go`](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/coding/extension/host/subprocess/builder_node.go),
  [`protocol.go`](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/coding/extension/host/subprocess/protocol.go)
- [`extensions/sdk-rs/`](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/extensions/sdk-rs), [`extensions/sdk-ts/README.md`](https://github.com/MichaelKinsy/PiG/blob/3ee123c6d5f4a754dd27ebb9190ab8e169354f13/extensions/sdk-ts/README.md)

Quay:

- `src-tauri/src/slices/bridge/routes.rs`, `src-tauri/src/slices/bridge/models.rs`
- `src-tauri/src/slices/pty/session.rs`, `src-tauri/src/slices/pty/manager.rs`,
  `src-tauri/src/slices/pty/models.rs`
- Issues [#70](https://github.com/seanrobertwright/Quay-2/issues/70),
  [#72](https://github.com/seanrobertwright/Quay-2/issues/72),
  [#83](https://github.com/seanrobertwright/Quay-2/issues/83),
  [#84](https://github.com/seanrobertwright/Quay-2/issues/84),
  [#137](https://github.com/seanrobertwright/Quay-2/pull/137),
  [#141](https://github.com/seanrobertwright/Quay-2/issues/141)
- Earlier research: `.scratch/tutorials/research/cli-a2a.md` (the Pi row and the bus requirements)
