# OpenCode and PiG surface round trips (#708)

**Verdict: both pass. OpenCode 1.x and PiG make the round trip, both halves, with a 100 s wait and a 150 s limit that holds.** One spec rule has to change: when either CLI gives up on a call it sends `notifications/cancelled` and leaves the connection open, so Quay must end the wait on that notification. OpenCode 2.x is a different program and does not pass: Quay cannot launch it today.

Run on 2026-11-24, 2:27 to 3:52 AM Eastern, Windows 11, a dev build of Quay 0.8.0 from `prototype/a2ui`, with its own storage, webview profile and port, and every inherited agent-session variable cleared. Terminals were launched from Quay's New Terminal dialog and the cards were clicked in the running app. Times in log lines are UTC.

| What | Version | Model |
| --- | --- | --- |
| OpenCode | 1.19.4 | `opencode/big-pickle` for the round trips; a scripted loopback model for wire evidence and the permission matrix |
| OpenCode 2 | `@opencode/cli` 2.4.1, unpacked in a scratch folder, not installed, not run inside Quay | The scripted model |
| PiG | 0.5.1 (`0.5.1+1.3.0.1402973a`) | Local Qwen 3.5 9B and Qwen 3.8 27B through Ollama; the scripted model for limits and wire evidence |

**PiG's Anthropic sign-in on this machine has expired** (`OAuth refresh failed for anthropic: token refresh HTTP 400: invalid_grant, "Refresh token expired"`). It was left alone and PiG was driven on local models, in a scratch `PIG_HOME`. It needs `pig login` before anyone uses it there.

## Acceptance criteria

| Criterion | Result |
| --- | --- |
| OpenCode: answer inside the wait | **Works.** Returned as the call's result at 35.6 s; the agent carried on in the same turn |
| OpenCode: answer after the wait | **Works.** The wait ran out at 100.0 s, the agent ended its turn, the answer was typed in at 143 s and the agent acted on it |
| OpenCode: `"timeout"` holds at 150 s | **Holds.** Gave up at 150.0 s; a 145 s wait came back as a result. With no setting it gave up at 60.0 s |
| OpenCode 2.x and Code Mode | **Yes, it hides them** (2.4.1). `"codemode": false` on the entry shows them |
| PiG: answer inside the wait | **Works.** Returned at 37.8 s; carried on in the same turn |
| PiG: answer after the wait | **Works.** The wait ran out at 100.0 s, the turn ended, the answer was typed in at 175 s and the agent acted on it |
| PiG: registration at 150 s | **Holds.** Gave up at 150.0 s; a 145 s wait came back as a result. Set to 120 it gave up at 120.0 s, set to 45 at 45.0 s |
| What Quay sees on giving up | **Both: `notifications/cancelled`, connection left open** |
| `instructions` reaches the model | **OpenCode: yes, in full. PiG: no** |
| `isError` text as written | **Both: yes, unchanged** |
| Pre-approval | **OpenCode: one allow rule per tool. PiG: none needed** |
| The spec's CLI table | Replacement rows under **Spec changes** |

## The round trip

| | OpenCode 1.19.4 | PiG 0.5.1 |
| --- | --- | --- |
| Call reached Quay | 07:27:24.190, `wait=100s` | 08:16:39.459, `wait=100s` |
| Operator answered | 35.6 s after the call | 37.9 s after the call |
| How it came back | The call's result | The call's result |
| What the agent did | Ran `echo carried-on-blue` in the same turn | Ran `echo carried-on-blue` in the same turn |
| Second call | 07:28:49.903 | 08:29:00.456 |
| Wait ran out | 100.0 s | 100.0 s |
| What the agent did | Said "No answer yet." and ended its turn | Quoted the text and ended its turn |
| Answered | 143.1 s after the call | 175.3 s after the call |
| How it came back | Typed in, trail status `Dispatched` | Typed in, trail status `Dispatched` |
| What the agent did | Ran `echo carried-on-green` | Ran `echo carried-on-green` |

OpenCode took the whole prototype question (656 bytes of arguments) and passed the nested A2UI through. PiG's was inline in the prompt and one line of JSON, because the 9B model could not copy the file's content into a tool call. That is the model; PiG passed what it was given.

## How long a silent call stays open

Quay's wait was set past the limit so that the CLI's own limit was what ended the call.

| CLI | Setting | Gave up at | Text the model gets |
| --- | --- | --- | --- |
| OpenCode | none | 60.0 s (twice) | `MCP error -32001: Request timed out` |
| OpenCode | `"timeout": 150000` on the entry in `OPENCODE_CONFIG_CONTENT` | 150.0 s | the same |
| OpenCode | the same, Quay's wait 145 s | Did not give up; result at 145.0 s | The result |
| PiG | `"timeout": 150` in the registration | 150.0 s | `MCP request timed out after 150000ms` |
| PiG | the same, Quay's wait 145 s | Did not give up; result at 145.0 s | The result |
| PiG | `"timeout": 120`, as today | 120.0 s (twice) | `MCP request timed out after ...ms` |
| PiG | `"timeout": 45` | 45.0 s | the same |

OpenCode's agent did not call again after the limit; its prompt had told it not to. PiG's limit runs used the scripted model, which never retries, so what a real agent does there was not seen.

## What Quay sees

| Event | OpenCode 1.19.4 | PiG 0.5.1 |
| --- | --- | --- |
| The limit | `notifications/cancelled {"requestId":2,"reason":"McpError: MCP error -32001: Request timed out"}` at once, then a second one for the same id, `AbortError: The operation was aborted.`, about 1 s later | `notifications/cancelled {"requestId":3,"reason":"Request timed out"}`, once |
| The connection then | Stays open. One was still open at 300 s; another closed at 339.6 s (cause not found) | Stays open until it closes at 300.0 s (four times). It is PiG that closes it: one of the four was inside a 420 s Quay wait |
| The agent's turn end | 2 to 7 s after the cancel, when the model has finished talking | About 20 ms after with the scripted model, so as soon as the model stops |
| The operator presses Esc | `notifications/cancelled` (`AbortError`), then the turn end 0.4 s later | `notifications/cancelled` (`AbortError: This operation was aborted`), then the turn end 8 ms later |
| The process is closed | The connection closes (`CALL DROPPED`) | The connection closes |
| **A call that finished normally** | **A `notifications/cancelled` for it arrives anyway, 0.6 to 11 s after the result** | Nothing |

Two things follow.

1. **An answer clicked after a give-up is lost unless Quay reads the notification.** Shown in both: the prototype still believed the call open, returned the answer into it (OpenCode at 181 s, PiG at 193 s), and the agent never got it. The turn-end rule narrows this but does not close it: the agent may carry on for any length of time after the error.
2. **OpenCode's cancel notices cannot be trusted by themselves.** 32 of its 33 calls sent one; the only call that did not belonged to a terminal that was killed. Quay must match the request id against a call of that terminal that is still waiting, and ignore it otherwise. Ids restart from the same small numbers at every launch, so the match is by terminal and open call, never by id alone.

## `instructions` and `isError`

The handshake reply carried two lines of `instructions`, the second holding a codeword that appears nowhere else.

| | OpenCode 1.19.4 | PiG 0.5.1 |
| --- | --- | --- |
| `instructions` on the wire to the model | All 52 requests that listed Quay's tools, verbatim, in the system prompt under `<mcp_instructions><server name="quay">` | None of 57 requests, with and without PiG's skills and context files loaded |
| Asked for the codeword | `heron-8821` | "NONE" |
| `isError` text | Byte for byte: indentation, quotes, em dash, nonce | Byte for byte |
| Where it lands | The tool message | The tool message |

PiG's documentation agrees: with `exposure: "direct"` the instructions are read by codemode scripts only. Of a server's `instructions`, only the first line ever reaches the system prompt, and only for `codemode` or `deferred` servers. The local 27B model quoted the rejection back with its nonce masked; the capture shows PiG handed it over whole.

## Pre-approval

**PiG** has no permission prompt before a tool call, and the dialog offers no mode for it. Every call went straight through.

**OpenCode** names the tools `quay_<tool>`, so `quay_ask` is `quay_quay_ask`. Rows are Ask mode unless noted.

| The operator's configuration | Quay's `permission` in `OPENCODE_CONFIG_CONTENT` | Result |
| --- | --- | --- |
| None | none | No prompt |
| `"permission": {"*": "ask"}` | none | Prompt, before the call is sent |
| the same | `{"quay_quay_surface_proto": "allow"}` | No prompt; the other Quay tool still prompts |
| `"permission": "ask"` | the same | No prompt |
| `"permission": {"quay_*": "ask"}` | the same | No prompt |
| `"permission": {"*": "ask"}`, Skip mode (`--auto`) | none | No prompt |
| `"permission": {"*": "ask"}` | `{"quay_*": "allow"}` | No prompt for any Quay tool: too wide |
| `"agent": {"build": {"permission": {"*": "ask"}}}` | `{"quay_quay_surface_proto": "allow"}` | **Prompt.** An agent's own rule wins over Quay's |

- The setting is one exact-name allow rule per surface tool.
- The prompt comes before the call is sent (the call reached Quay after Allow once), so it does not use up the wait.
- While OpenCode's prompt is up, Quay shows the terminal as Working, not Waiting.

## OpenCode 2.x (2.4.1)

| Point | Seen |
| --- | --- |
| Launch | `opencode --port <n> --auto` exits 1: `Unrecognized flag: --port in command opencode`. Quay passes `--port` to every OpenCode terminal, so a 2.x terminal dies at launch. `--model` is also gone from the root command. |
| Code Mode | The model is offered `execute` and no Quay tool. The tools are described in the system prompt as `tools.quay.*`, and the `instructions` are there with "Use tools from this server through `execute`". |
| `"codemode": false` | Quay's tools are offered directly. It works both in the 1.x entry Quay passes today and under `mcp.servers`. |
| `server/discover` | Sent first. Quay's `200` with `-32601` made it fall back to `initialize`. `"protocol": "legacy"` (tested with `"codemode": false` under `mcp.servers`) skips the probe. |
| `isError` text | Wrapped: `{"error":{"type":"tool.execution","message":"<the text, escaped>"},"content":[]}` |
| Server | A background service by default, shared by terminals unless `--standalone` is given. Whether a service started by one terminal reads another terminal's token was not tested. |

OpenCode 1.19.4 and PiG 0.5.1 sent no `server/discover` in any of their launches here; both start with `initialize` at protocol `2025-11-25`.

## Other things seen

- **A small model ignored "do not call this tool again".** The 9B model on PiG, after "No answer yet", called three more times with different arguments. Each was a new card. The rejoin rule covers only an equal call, so the four-per-place limit is what bounds this.
- OpenCode can load the operator's private instruction files and skills, so that was turned off in these runs (`OPENCODE_DISABLE_CLAUDE_CODE`, `OPENCODE_DISABLE_EXTERNAL_SKILLS`) and its `XDG_*` folders were scratch folders.

## Not tested

| What | Why |
| --- | --- |
| PiG on its own Anthropic models | The sign-in has expired, and renewing it is the operator's to do |
| OpenCode with the operator's own configuration and plugins | It would send private instruction files to a free model provider |
| OpenCode 2.x inside Quay | Quay's launch line is refused |
| A rule of Quay's against an operator's explicit `"deny"` for the same tool | Not reached. The two share a key and Quay's layer is the later one, so Quay's may win; check it in #730 |
| Subagents (OpenCode `task`) making the call | Not part of the ticket |
| macOS and Linux | Windows only |

## How it was run

- Added to the prototype: an `instructions` text, a `quay_reject_proto` tool that always answers with the spec's rejection object, logging of the handshake and of turn events, a config layer for OpenCode's launch, and a timeout override and wire capture in `quay-pig-bridge`. `tools/prototype-a2ui-wire/scripted-model.mjs` is the scripted model.
- Log: `src/slices/stage/prototype-a2ui-roundtrip/run-2026-11-24.ticket-708.quay-log.txt`.
- The first permission batch in that log (07:42 to 07:55 UTC) ran in Skip mode by mistake and proves nothing about Ask mode. It is not used above. The matrix is the batch from 07:56 on.
- No configuration file of the operator's was changed. `~/.pig/agent/settings.json` and `trust.json` were backed up and have the same hashes as before; `auth.json` has its old timestamp. Two PiG launches before the scratch `PIG_HOME` was set appended to `~/.pig/agent/exit.log` and `crash-output` and left a session folder for the scratch project. Listing OpenCode's models and credentials touched the timestamp of `opencode.db`.
- One probe of a hosted free model through a logging proxy was refused by the provider ("Free usage limit reached"), so hosted models were only used directly.
- Every process started for this was stopped by its PID, and the local model was unloaded.

## Spec changes

Quoted from #706 as it stood at 4:45 AM Eastern on 2026-11-24, after #709's edits.

**1. "Waiting for the answer".** Contradicted: neither CLI closes the connection when it gives up or when the operator presses Esc.

> - **A wait ends at the first of:** the operator's action; 100 s; the connection closing; that terminal's own turn ending (a subagent's turn does not count); in a Codex terminal, the operator typing a lone Escape. The relay turns a cancel into a closed connection.

Replace with:

> - **A wait ends at the first of:** the operator's action; 100 s; the connection closing; a `notifications/cancelled` from that terminal naming the waiting call's request id; that terminal's own turn ending (a subagent's turn does not count); in a Codex terminal, the operator typing a lone Escape. The relay turns a cancel into a closed connection.
> - OpenCode and PiG send that notification and leave the connection open when their limit passes or the operator presses Esc. A cancel that names no call still waiting in that terminal is ignored: OpenCode sends one after every call that has already returned, and request ids restart at each launch (#708).

The next line, "The last is needed because Codex sends nothing", still reads right: the Codex rule stays last. Then:

> - After the last four, the surface stays up and answerable.

Replace with:

> - After the last five, the surface stays up and answerable.

**2. "Testing Decisions", seam 1.** Follows from 1; #709's addition had not been counted here either.

> all four ends of a wait

Replace with:

> all six ends of a wait, a cancel for a call that has already returned

**3. "CLIs", the table.**

> | OpenCode | `OPENCODE_CONFIG_CONTENT` | `"timeout"` in the entry | Allow rule | Record at its check | To check |
> | PiG | `-e quay-pig-bridge` | The bridge's registration (120 s today) | None needed | Record at its check | To check |

Replace with:

> | OpenCode 1.x | `OPENCODE_CONFIG_CONTENT` | `"timeout": 150000` in the entry (60 s without it) | One `permission` rule per tool, by full name: `"quay_quay_ask": "allow"` and on. Not `quay_*`, which covers the bus tools. An agent's own `permission` in the operator's configuration wins over it | Yes, in full, in the system prompt | Proven (1.19.4) |
> | OpenCode 2.x | `OPENCODE_CONFIG_CONTENT` | Not tested | Not tested | Yes, in full, in the system prompt | Second set: 2.4.1 refuses the `--port` Quay launches with, and hides MCP tools behind Code Mode unless the entry has `"codemode": false` |
> | PiG | `-e quay-pig-bridge` | `"timeout": 150` in the bridge's registration (120 s today) | None needed | No | Proven (0.5.1) |

**4. "CLIs", `server/discover`.** Not contradicted; completed for these two.

> Claude Code and Antigravity do; Codex 0.164.0 does not.

Replace with:

> Claude Code and Antigravity do; Codex 0.164.0, OpenCode 1.19.4 and PiG 0.5.1 do not. OpenCode 2.4.1 does.

**5. "Solution".** For precision, since OpenCode 2 is a separate program under the same name.

> The first release connects Claude Code, Codex, OpenCode, PiG and Antigravity.

Replace with:

> The first release connects Claude Code, Codex, OpenCode 1.x, PiG and Antigravity.

No other sentence of #706 is contradicted. "Nothing depends on the server's `instructions` text" is borne out: PiG does not show it.

Apart from the spec: a 2.x OpenCode terminal dies at launch in today's Quay. That is a bug of its own and needs its own ticket.
