<!-- markdownlint-configure-file
{ "MD013": { "tables": false, "code_blocks": false } }
-->

# Live test: Codex, OpenCode and Antigravity against the bus design

Ticket: [Task: Live-test Codex, OpenCode and Antigravity against the bus design](https://github.com/seanrobertwright/Quay-2/issues/44),
parent map [Wayfinder map: Swarm and A2A tutorials](https://github.com/seanrobertwright/Quay-2/issues/2).
Design under test: [Decide: How do non-Claude agents join the A2A bus?](https://github.com/seanrobertwright/Quay-2/issues/12).

Tested 2026-10-18 on Windows 11 with the CLIs installed on the maintainer's machine. Each
CLI ran against a throwaway git repository in a temp folder. Quay itself was not running;
its MCP server was stood in for by a 60-line Node script that speaks Streamable HTTP, logs
every request's `Authorization` header and JSON-RPC method, and serves one tool, `ping`,
which returns `pong`. TUIs were driven inside a Windows ConPTY by a small pywinpty script
that types text, waits two seconds, then sends `\r`, and captures the raw byte stream.

| CLI | Version tested |
| --- | --- |
| Codex CLI | codex-cli 0.154.0 |
| OpenCode | 1.19.3 |
| Antigravity CLI (`agy`) | 1.4.2 |

Tokens in the payloads below are throwaway strings chosen for the test.

## Verdicts

| # | Fact under test | Result |
| --- | --- | --- |
| 1 | Typed messages submit in the Codex, OpenCode and Antigravity TUIs | **OpenCode and Antigravity: pass** in a ConPTY with a 2-second gap before Enter. **Codex: not reached**, the interactive `codex` tried to self-update and exited. Quay's own 250 ms path is still the maintainer's checklist. |
| 2a | Codex `notify` fires once per main-loop turn with `last-assistant-message` | **Pass**, with a finding: it also fires for subagent turns. |
| 2b | Codex `notify` stays silent for subagent turns, or marks them | **Fail as stated.** It fires for the subagent turn too. The subagent payload differs: its own `thread-id`, no `client` field, empty `input-messages`. |
| 2c | Codex `notify` runs without hook trust or `--dangerously-bypass-hook-trust` | **Pass.** No flag given, `notify` ran. |
| 2d | `-c mcp_servers.quay.url=...` and `-c mcp_servers.quay.bearer_token_env_var=QUAY_A2A_TOKEN` load the server for that run only | **Pass**, with a finding: the tool call is blocked until `-c mcp_servers.quay.default_tools_approval_mode="approve"` is added. |
| 3 | `AGY_CLI_OSC7501=on` makes `agy` print OSC 7501 working and done sequences around each turn in a ConPTY | **Pass**, and the `done` sequence carries the answer text, base64-encoded. |
| 4a | OpenCode `GET /event` streams `session.status` idle at each turn end | **Pass.** It also still emits the deprecated `session.idle`. |
| 4b | `GET /session/:id/message` returns the final text | **Pass.** A `text` part on the last assistant message, `finish: "stop"`. |
| 4c | Child sessions can be told apart from the main session | **Pass.** Children carry `parentID`; `GET /session/:id/children` lists them; their events carry their own `sessionID`. |
| 4d | `OPENCODE_CONFIG_CONTENT` with a `remote` server, a `{env:QUAY_A2A_TOKEN}` header and `oauth: false` loads Quay's MCP server | **Pass.** `/mcp` reported `quay` connected and the dummy saw `Bearer <token>`. |

## 1. Codex CLI 0.154.0

### Commands run

All runs used `codex exec --skip-git-repo-check` in the throwaway repo, with `-c` overrides
and no changes to `~/.codex/config.toml` (checked before and after: it holds no `quay`
server). The maintainer's own config has a `notify` entry for computer use; the `-c notify`
override replaced it for the run, as Quay's would.

```text
-c notify=["pwsh","-NoProfile","-File","<temp>/notify-dump.ps1"]
-c mcp_servers.quay.url="http://127.0.0.1:47999/mcp"
-c mcp_servers.quay.bearer_token_env_var="QUAY_A2A_TOKEN"
-c mcp_servers.quay.default_tools_approval_mode="approve"     # needed, see below
```

### MCP server from `-c`: loads, but the call needs an approval mode

The dummy server's log for the run with only `url` and `bearer_token_env_var`:

```json
{"method":"POST","url":"/mcp","auth":"Bearer secret-token-codex","rpc":"initialize","id":0}
{"method":"POST","url":"/mcp","auth":"Bearer secret-token-codex","rpc":"notifications/initialized"}
{"method":"GET","url":"/mcp","auth":"Bearer secret-token-codex"}
{"method":"POST","url":"/mcp","auth":"Bearer secret-token-codex","rpc":"tools/list","id":1}
{"method":"DELETE","url":"/mcp","auth":"Bearer secret-token-codex"}
```

So the server is loaded per run and the token from the env var is sent on every request.
But the tool call itself did not run:

```text
mcp: quay/ping started
mcp: quay/ping (failed)
MCP tool call requires approval, but approval policy is never
```

`codex exec` runs with `approval_policy = never`, and so does
`--dangerously-bypass-approvals-and-sandbox`, the flag Quay passes in Skip mode. A tool
call that would ask is refused under that policy rather than auto-approved. The fix is
the per-server approval mode documented on the Codex MCP page:

| `default_tools_approval_mode` | Result under `approval_policy = never` |
| --- | --- |
| unset | `MCP tool call requires approval, but approval policy is never` |
| `"auto"` | same failure |
| `"approve"` | `mcp: quay/ping (completed)`, answer `pong` |

Quay's Codex launch wiring therefore needs a fourth override,
`-c mcp_servers.quay.default_tools_approval_mode="approve"`.

Not tested: the same run with `--dangerously-bypass-approvals-and-sandbox` itself. The
sandbox this test ran in refused to launch Codex with that flag. The approval policy it
sets is the same `never`, so the result is expected to match, but it was not observed.

### `notify`: fires without hook trust, and for subagent turns too

`notify` is not a hook; it ran with no trust flag. Payload from the plain run, one line,
one JSON argument:

```json
{"type":"agent-turn-complete","thread-id":"01a151f5-45b6-7243-b92f-b59c6ea50180","turn-id":"01a151f5-4806-7c22-b082-d9ff46598d8a","cwd":"<temp>\\livetest\\proj","client":"codex_exec","input-messages":["Call the quay ping tool exactly once and then reply with exactly the word it returned, nothing else."],"last-assistant-message":"pong"}
```

The prompt "Spawn one subagent and have it tell you the capital of France ..." produced
**two** `notify` calls, in this order:

```json
{"type":"agent-turn-complete","thread-id":"01a151ec-0085-7cf2-bdda-65af77740bb4","turn-id":"01a151ec-0129-7333-a7f0-6cfc14da3d2f","cwd":"<temp>\\livetest\\proj","input-messages":[],"last-assistant-message":"Paris"}
{"type":"agent-turn-complete","thread-id":"01a151eb-ba72-7a00-9591-382e0ca5ab03","turn-id":"01a151eb-bcf2-7360-af7a-662cadc6d5a8","cwd":"<temp>\\livetest\\proj","client":"codex_exec","input-messages":["Spawn one subagent and have it tell you ..."],"last-assistant-message":"Paris"}
```

The first is the subagent's turn: a different `thread-id`, no `client` field and an
empty `input-messages`. The second is the main turn. So the bus design's helper cannot
rely on `notify` being silent for subagents. It can drop a payload that has no `client`
field or an empty `input-messages`, or keep only the `thread-id` of the first payload
that does carry `client`. Which of those holds in the interactive TUI, where `client`
may be a different string, was not observed (see the self-update note).

### Interactive `codex` self-updated and exited

Starting plain `codex` in the ConPTY printed `Updating Codex CLI from 0.154.0 to 0.163.0`,
failed to unpack the download, and exited before showing a prompt. The installed version
stayed 0.154.0. Two consequences for the tutorials: the Codex pane may spend its first
seconds updating itself, and the typed-submit check for Codex is still owed from inside
Quay.

## 2. Antigravity CLI 1.4.2

Run: `agy` (no permission flag) in the ConPTY with `AGY_CLI_OSC7501=on`. Enter at 14 s to
accept the folder-trust dialog, the prompt "Reply with the single word pong and nothing
else" at 30 s, Enter at 32 s. Every OSC 7501 sequence in the capture, in order:

```text
ESC ] 7501 ; state=blocked:kind=auth:app=antigravity:msg=U2lnbiBpbiByZXF1aXJlZA==   BEL
ESC ] 7501 ; state=idle:app=antigravity                                              BEL
ESC ] 7501 ; state=working:app=antigravity                                           BEL
ESC ] 7501 ; state=done:app=antigravity:msg=cG9uZw==                                 BEL
```

An earlier run that left the trust dialog open also showed
`state=blocked:kind=permission:app=antigravity:msg=VHJ1c3QgdGhpcyBmb2xkZXI/`.

- Format: `state=<state>` then colon-separated `key=value` pairs. States seen: `blocked`,
  `idle`, `working`, `done`. `blocked` carries `kind=auth` or `kind=permission`.
- `msg` is base64 of UTF-8 text: `U2lnbiBpbiByZXF1aXJlZA==` is "Sign in required",
  `VHJ1c3QgdGhpcyBmb2xkZXI/` is "Trust this folder?", and `cG9uZw==` is **"pong"**, the
  whole answer. So `done` carries the answer text. How long a message it carries before
  truncating was not measured. `AGY_CLI_OSC7501_MESSAGES=brief` drops the `msg` part
  (per `agy changelog` 1.4.0), so Quay should not set it.
- The terminator is BEL. The capture also held OSC 0 (title) and OSC 11 (background query).
- `agy` signed in on its own at start, from a stored credential, after a brief
  `Signing in...`; the `blocked:kind=auth` state covered that window.

This is more than the design asked for. [Decide: How do non-Claude agents join the A2A bus?](https://github.com/seanrobertwright/Quay-2/issues/12)
reads OSC 7501 for status only and treats Antigravity as a listener because it has no
answer text. The `done` message gives Quay the answer, so Antigravity could become a
sender-less peer that still answers a `wait_for_reply`. That is a reopen for the bus
design, not a decision made here.

## 3. OpenCode 1.19.3

Runs: `opencode --port <port>` (the TUI, with its server) in the ConPTY, twice with the
maintainer's plugins and three times with `--pure`. The prompt was typed at 22 to 25 s
and Enter two seconds later. A `curl -N` subscriber read `GET /event` from 12 s.

### MCP server from the env var

```text
OPENCODE_CONFIG_CONTENT={"mcp":{"quay":{"type":"remote","url":"http://127.0.0.1:47999/mcp","headers":{"Authorization":"Bearer {env:QUAY_A2A_TOKEN}"},"oauth":false}}}
QUAY_A2A_TOKEN=secret-token-opencode
```

`GET /mcp` on the TUI's server reported `"quay":{"status":"connected"}`. The dummy saw:

```json
{"method":"POST","url":"/mcp","auth":"Bearer secret-token-opencode","rpc":"initialize"}
{"method":"POST","url":"/mcp","auth":"Bearer secret-token-opencode","rpc":"notifications/initialized"}
{"method":"GET","url":"/mcp","auth":"Bearer secret-token-opencode"}
{"method":"POST","url":"/mcp","auth":"Bearer secret-token-opencode","rpc":"tools/list"}
```

and, in the `--pure` run that asked for the ping, one `tools/call` with the same token.
The tool part on the assistant message ended `"status":"completed"`. No approval prompt
appeared in the TUI.

### Turn end on `GET /event`

Event types seen on one text-only turn, in order (noise such as `plugin.added`,
`file.watcher.updated`, `tui.toast.show` and `server.heartbeat` left out):

```text
session.created        {"sessionID":"ses_eae0fae39ffec6O21J7I8HIs4N", "info":{...}}
session.status         {"sessionID":"ses_eae0fae39ffec6O21J7I8HIs4N","status":{"type":"busy"}}   (repeated)
message.part.updated   ... "type":"text","text":"pong" ...
session.status         {"sessionID":"ses_eae0fae39ffec6O21J7I8HIs4N","status":{"type":"idle"}}
session.idle           {"sessionID":"ses_eae0fae39ffec6O21J7I8HIs4N"}
```

`session.status` with `status.type` `idle` arrives at turn end, and the deprecated
`session.idle` right after it. The final text also streams as a `message.part.updated`
with a `text` part, so Quay can take the answer from the stream or from the REST call.

### The final text from `GET /session/:id/message`

After the turn, the messages of the session, parts filtered to the interesting types:

```text
user       parts: text "Reply with the single word pong and nothing else"
assistant  finish "stop"  parts: step-start, reasoning "...", text "pong", step-finish
```

A read taken while the turn was still running returned the assistant message with no
parts yet, so Quay should read after idle, not before.

### Child sessions

The prompt "Use the task tool to delegate to the general subagent ..." created a second
session. `GET /session/<child>`:

```json
{"id":"ses_eae0de18affeW5Sdy32yp25YJK","parentID":"ses_eae0e4070ffe7aIqzfnTjFq5c3","title":"Capital of France (@general subagent)", ...}
```

- The child has `parentID`; the main session has none.
- `GET /session/<main>/children` returns the child list.
- The child gets its own `session.created` and `session.status` events, keyed by its own
  `sessionID`, so Quay filters the stream on the main session's id.
- Whether `GET /session` lists children varied between reads; filter on `parentID`
  rather than relying on the list.

### Environment notes

- This machine's OpenCode config runs a compaction turn and then an automatic
  "Continue if you have next steps, or stop and ask for clarification" user turn after
  each answer, even with `--pure`. The first `idle` after delivery is the real turn end;
  later `busy`/`idle` pairs belong to that follow-up. A default install is not expected
  to do this, but Quay's watcher should take the first idle after delivery regardless.
- With the maintainer's plugins loaded, the subagent run failed with
  `Model not found: anthropic/claude-haiku-4-5` from a plugin-defined agent. Unrelated to
  the bus; it is why the `--pure` runs exist.

## 4. Typed submit (fact 1)

The ConPTY harness typed the prompt and sent `\r` two seconds later. OpenCode and
Antigravity both submitted: OpenCode's session went `busy` and answered, Antigravity went
`working` then `done`. Codex's TUI never came up (self-update, above). Quay types with a
250 ms gap (`PROMPT_SUBMIT_DELAY` in `PtyManager::submit_prompt`), from a different
process, so the maintainer's in-Quay checklist on the ticket still stands for all three.

## Files

Harness and evidence live outside the repo in the test's temp folder: `mcp-dummy.mjs`
(the stand-in MCP server), `notify-dump.ps1` (Codex notify target), `conpty.py` (ConPTY
driver), `analyze_raw.py` (OSC scanner), and an `evidence/` folder of raw captures,
SSE streams and JSON responses. Nothing from it is needed to reproduce the results
beyond the commands quoted above.
