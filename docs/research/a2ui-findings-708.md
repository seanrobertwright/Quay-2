# OpenCode and PiG surface round trips (#708)

**Verdict: both pass. OpenCode 1.x and PiG make the round trip, both halves, with a 100 s wait and a 150 s limit that holds.** One spec rule has to change: when either CLI gives up on a call it sends `notifications/cancelled` and leaves the connection open, so Quay must end the wait on that notification. OpenCode 2.x is a different program and does not pass: Quay cannot launch it today.

Run on 2026-11-24, 2:27 to 3:52 AM Eastern, Windows 11, a dev build of Quay 0.8.0 from `prototype/a2ui`, with its own storage, webview profile and port, and every inherited agent-session variable cleared. Terminals were launched from Quay's New Terminal dialog and the surfaces were answered by clicking them in the running app. Times in log lines are UTC.

Evidence is cited as: `s-N`, a surface id in Quay's log; `oc-a`, `pig-d` and so on, a terminal name in Quay's log, launched as listed under **Launch commands**; *wire*, the extract of what the CLIs sent their models. Both files are under **How it was run**.

| What | Version | Model |
| --- | --- | --- |
| OpenCode | 1.19.4 | `opencode/big-pickle` for the round trips; a scripted loopback model for wire evidence and the permission matrix |
| OpenCode 2 | `@opencode/cli` 2.4.1, unpacked in a scratch folder, not installed, not run inside Quay; its MCP server was a stub | The scripted model |
| PiG | 0.5.1 (`0.5.1+1.3.0.1402973a`) | Local Qwen 3.5 9B and Qwen 3.8 27B through Ollama; the scripted model for limits and wire evidence |

**PiG's Anthropic sign-in on this machine has expired** (`OAuth refresh failed for anthropic: token refresh HTTP 400: invalid_grant, "Refresh token expired"`). It was left alone and PiG was driven on local models, in a scratch `PIG_HOME`. It needs `pig login` before anyone uses it there.

## Acceptance criteria

| Criterion | Result |
| --- | --- |
| OpenCode: answer inside the wait | **Works** (s-1). Returned as the call's result at 35.6 s; the agent carried on in the same turn |
| OpenCode: answer after the wait | **Works** (s-2). The wait ran out at 100.0 s, the agent ended its turn, the answer was typed in at 143 s and the agent acted on it |
| OpenCode: `"timeout"` holds at 150 s | **Holds.** Gave up at 150.0 s (s-3); a 145 s wait came back as a result (s-4). With no setting it gave up at 60.0 s (s-5, s-41) |
| OpenCode 2.x and Code Mode | **Yes, it hides them** (2.4.1, against a stub MCP server). `"codemode": false` on the entry shows them |
| PiG: answer inside the wait | **Works** (s-28, Qwen 3.5 9B). Returned at 37.8 s; carried on in the same turn |
| PiG: answer after the wait | **Works, on the second try** (s-37, Qwen 3.8 27B, a second launch). The wait ran out at 100.0 s, the turn ended, the answer was typed in at 175 s and the agent acted on it. The first try, on the 9B model, did not end its turn and got no answer; see **The round trip** |
| PiG: registration at 150 s | **Holds.** Gave up at 150.0 s (s-31); a 145 s wait came back as a result (s-32). Set to 120 it gave up at 120.0 s (s-33, s-40), set to 45 at 45.0 s (s-34) |
| What Quay sees on giving up | **Both: `notifications/cancelled`, connection left open** |
| `instructions` reaches the model | **OpenCode: yes, in full. PiG: no** |
| `isError` text as written | **Both: yes, unchanged** |
| Pre-approval | **OpenCode: one allow rule per tool. PiG: none needed** |
| The spec's CLI table | Replacement rows under **Spec changes** |

## The round trip

| | OpenCode 1.19.4 | PiG 0.5.1 |
| --- | --- | --- |
| **Inside the wait:** terminal, model, surface | `oc-a`, `opencode/big-pickle`, s-1 | `pig-d`, Qwen 3.5 9B, s-28 |
| Call reached Quay | 07:27:24.190, `wait=100s` | 08:16:39.459, `wait=100s` |
| Operator answered | 35.6 s after the call | 37.9 s after the call |
| How it came back | The call's result | The call's result |
| What the agent did | Ran `echo carried-on-blue` in the same turn | Ran `echo carried-on-blue` in the same turn |
| **After the wait:** terminal, model, surface | The same launch, `oc-a`, s-2 | **A second launch**, `pig-i`, Qwen 3.8 27B, s-37 |
| Call reached Quay | 07:28:49.903, `wait=100s` | 08:29:00.456, `wait=100s` |
| Wait ran out | 100.0 s | 100.0 s |
| What the agent did | Said "No answer yet." and ended its turn | Quoted the text and ended its turn |
| Answered | 143.1 s after the call | 175.3 s after the call |
| How it came back | Typed in, trail status `Dispatched` | Typed in, trail status `Dispatched` |
| What the agent did | Ran `echo carried-on-green` | Ran `echo carried-on-green` |

**PiG's first try at the second half failed, on the 9B model.** In `pig-d`, after s-28, the same prompt was sent again. The model called with an empty `messages` (s-29, 34 bytes of arguments), got "No answer yet" at 100.0 s, and did not end its turn: it called again with different arguments (s-30, s-35, s-36), each a new surface, until the terminal was closed at 08:25:29. The operator answered none of them. The text it ignored says "End your turn now and do not call this tool again". The half was then run on the 27B model, in a new terminal, and is the one in the table. So no single PiG launch here did both halves, and no hosted model answered in PiG.

OpenCode took the whole prototype question (656 bytes of arguments) and passed the nested A2UI through. PiG's was inline in the prompt and one line of JSON, because the 9B model could not copy the file's content into a tool call (`pig-c`; its only call, s-27, had an empty `messages` and a 1 s wait). That is the model; PiG passed what it was given.

## How long a silent call stays open

Quay's wait was set past the limit so that the CLI's own limit was what ended the call.

| CLI | Setting | Gave up at | Text the model gets | Evidence |
| --- | --- | --- | --- | --- |
| OpenCode | none | 60.0 s (twice) | `MCP error -32001: Request timed out` | s-5 (`oc-c`), s-41 (`oc-y`); wire 08:47:26.792 |
| OpenCode | `"timeout": 150000` on the entry in `OPENCODE_CONFIG_CONTENT` | 150.0 s | the same | s-3 (`oc-b`) |
| OpenCode | the same, Quay's wait 145 s | Did not give up; result at 145.0 s | The result | s-4 (`oc-d`) |
| PiG | `"timeout": 150` in the registration | 150.0 s | `MCP request timed out after 150000ms` | s-31 (`pig-e`); wire 08:24:17.087 |
| PiG | the same, Quay's wait 145 s | Did not give up; result at 145.0 s | The result | s-32 (`pig-f`) |
| PiG | `"timeout": 120`, as today | 120.0 s (twice) | `MCP request timed out after 120000ms` | s-33, s-40 (`pig-g`); wire 08:23:57.610, 08:39:40.822 |
| PiG | `"timeout": 45` | 45.0 s | `MCP request timed out after 45000ms` | s-34 (`pig-h`); wire 08:22:49.029 |

OpenCode's agent did not call again after the limit; its prompt had told it not to. PiG's limit runs used the scripted model, which never retries, so what a real agent does there was not seen.

## What Quay sees

| Event | OpenCode 1.19.4 | PiG 0.5.1 |
| --- | --- | --- |
| The limit | `notifications/cancelled {"requestId":2,"reason":"McpError: MCP error -32001: Request timed out"}` at once, then a second one for the same id, `AbortError: The operation was aborted.`, about 1 s later (s-3, s-5, s-41) | `notifications/cancelled {"requestId":3,"reason":"Request timed out"}`, once (s-31, s-33, s-34; s-40 with id 4) |
| The connection then | Stays open. One was still open at 300 s (s-5); another closed at 339.6 s (s-41, cause not found) | Stays open until it closes at 300.0 s (s-33, s-34, s-38, s-40). It is PiG that closes it: s-40 was inside a 420 s Quay wait |
| The agent's turn end | 2 to 7 s after the cancel, when the model has finished talking | About 20 ms after with the scripted model, so as soon as the model stops |
| The operator presses Esc | `notifications/cancelled` (`AbortError`), then the turn end 0.4 s later (s-7) | `notifications/cancelled` (`AbortError: This operation was aborted`), then the turn end 8 ms later (s-38) |
| The process is closed | The connection closes (`CALL DROPPED`, s-6) | The connection closes (s-36, s-39) |
| **A call that finished normally** | **A `notifications/cancelled` for it arrives anyway, 0.6 to 11 s after the result** | Nothing |

Two things follow.

1. **An answer clicked after a give-up is lost unless Quay reads the notification.** Shown in both: the prototype still believed the call open, returned the answer into it (OpenCode at 181 s, s-3; PiG at 193 s, s-31), and the agent never got it. The turn-end rule narrows this but does not close it: the agent may carry on for any length of time after the error.
2. **OpenCode's cancel notices cannot be trusted by themselves.** 32 of its 33 calls sent one; the only call that did not belonged to a terminal that was killed. Quay must match the request id against a call of that terminal that is still waiting, and ignore it otherwise. Ids restart from the same small numbers at every launch, so the match is by terminal and open call, never by id alone.

## `instructions` and `isError`

The handshake reply carried two lines of `instructions`, the second holding a codeword that appears nowhere else.

| | OpenCode 1.19.4 | PiG 0.5.1 |
| --- | --- | --- |
| `instructions` on the wire to the model (each request is a line of the wire extract) | All 52 requests that listed Quay's tools, word for word, in the system prompt under `<mcp_instructions><server name="quay">` | None of 57 requests, with PiG's skills and context files loaded (2, `pig-y`) and without (55) |
| Asked for the codeword | `heron-8821` (`oc-r`, 07:41:01.819) | "NONE" (`pig-i`, 08:33:07.510) |
| `isError` text (399 characters, quoted whole in the wire extract) | Equal to what Quay sent, every character, 5 times out of 5: indentation, quotes, em dash, nonce | Equal, 4 times out of 4, as PiG's tool result and as the tool message it then sent |
| Where it lands | The tool message | The tool message |

PiG's documentation (`mcp.md` in its bundled docs) agrees: with `exposure: "direct"` the instructions are read by codemode scripts only. Of a server's `instructions`, only the first line ever reaches the system prompt, and only for `codemode` or `deferred` servers. The local 27B model quoted the rejection back with its nonce masked; the capture shows PiG handed it over whole (wire 08:33:48.895).

## Pre-approval

**PiG** has no permission prompt before a tool call, and the dialog offers no mode for it. Every call went straight through.

**OpenCode** names the tools `quay_<tool>`, so `quay_ask` is `quay_quay_ask`. Rows are Ask mode unless noted.

| The operator's configuration | Quay's `permission` in `OPENCODE_CONFIG_CONTENT` | Result | Evidence |
| --- | --- | --- | --- |
| None | none | No prompt | `p1`, s-21 |
| `"permission": {"*": "ask"}` | none | Prompt, before the call is sent | `p2`: no call until Allow once, then s-26 |
| the same | `{"quay_quay_surface_proto": "allow"}` | No prompt; the other Quay tool still prompts | `q3`, s-22; `q3b`: prompt, no call |
| `"permission": "ask"` | the same | No prompt | `q4`, s-23 |
| `"permission": {"quay_*": "ask"}` | the same | No prompt | `q9`, s-25 |
| `"permission": {"*": "ask"}`, Skip mode (`--auto`) | none | No prompt | `q6`, s-24 |
| `"permission": {"*": "ask"}` | `{"quay_*": "allow"}` | No prompt for any Quay tool: too wide | `q8`, rejection at 08:01:39.398 |
| `"agent": {"build": {"permission": {"*": "ask"}}}` | `{"quay_quay_surface_proto": "allow"}` | **Prompt.** An agent's own rule wins over Quay's | `q7`: prompt, no call |

The wire extract ends with what the driving script printed for each of these terminals, the prompt's lines included.

- The setting is one exact-name allow rule per surface tool.
- The prompt comes before the call is sent (the call reached Quay after Allow once), so it does not use up the wait.
- While OpenCode's prompt is up, Quay shows the terminal as Working, not Waiting.

## OpenCode 2.x (2.4.1)

It was run by hand with `opencode run`, because Quay's launch line is refused, against a stub MCP server and not Quay's. The stub offers the two prototype tools, sends two lines of `instructions`, rejects with a shorter text than Quay's, and answers a method it does not know as Quay does (HTTP 200, `-32601`). Its requests and log are in the wire extract (08:04:08 to 08:04:45).

| Point | Seen |
| --- | --- |
| Launch | `opencode --port <n> --auto` exits 1: `Unrecognized flag: --port in command opencode` (run as `opencode --port 14777 --auto`). Quay passes `--port` to every OpenCode terminal, so a 2.x terminal dies at launch. `--model` is also gone from the root command. |
| Code Mode | The model is offered `execute` and none of the server's tools. They are described in the system prompt as `tools.quay.*`, and the `instructions` are there, after "Use tools from this server through `execute`" (wire 08:04:09.239). |
| `"codemode": false` | The server's tools are offered directly. It works both in the 1.x entry Quay passes today (08:04:34.556) and under `mcp.servers` (08:04:40.808). |
| `server/discover` | Sent first (08:04:08.542). A `200` with `-32601`, as Quay answers, made it fall back to `initialize`. `"protocol": "legacy"` (tested with `"codemode": false` under `mcp.servers`, 08:04:44.287) skips the probe. |
| `isError` text | Wrapped: `{"error":{"type":"tool.execution","message":"<the text, escaped>"},"content":[]}` |
| Server | A background service by default, shared by terminals unless `--standalone` is given. Whether a service started by one terminal reads another terminal's token was not tested. |

OpenCode 1.19.4 and PiG 0.5.1 sent no `server/discover` in any of their launches here; both start with `initialize` at protocol `2025-11-25`.

## Other things seen

- **A small model ignored "do not call this tool again".** This is PiG's failed first try above (s-29, then s-30, s-35 and s-36). The rejoin rule covers only an equal call, so the four-per-place limit is what bounds this.
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

## Launch commands

`<port>` is a port Quay picks, `<quay>` the dev Quay's own port, `<S>` the scratch folder. Quay adds the terminal's `QUAY_*` variables to each launch and PiG and OpenCode read their token from there. Everything in this section that is not Quay's own came from the prototype's knobs file, read at each launch.

**OpenCode 1.19.4**, in a scratch Git folder holding `question.json`:

```text
opencode --port <port> --auto --model opencode/big-pickle    Skip mode; Ask mode has no --auto

XDG_CONFIG_HOME=<S>\xdg\config  XDG_DATA_HOME=<S>\xdg\data
XDG_STATE_HOME=<S>\xdg\state    XDG_CACHE_HOME=<S>\xdg\cache
OPENCODE_DISABLE_CLAUDE_CODE=1  OPENCODE_DISABLE_EXTERNAL_SKILLS=1  OPENCODE_DISABLE_AUTOUPDATE=1
OPENCODE_CONFIG_CONTENT=
{"mcp":{"quay":{"type":"remote","url":"http://127.0.0.1:<quay>/mcp",
   "headers":{"Authorization":"Bearer {env:QUAY_A2A_TOKEN}"},"oauth":false,"timeout":150000}},
 "provider":{"scripted":{"npm":"@ai-sdk/openai-compatible",
   "options":{"baseURL":"http://127.0.0.1:14709/v1","apiKey":"none"},
   "models":{"fixed":{"name":"Scripted","tool_call":true,"limit":{"context":128000,"output":4096}}}}}}
```

| Terminal | Differs by | Used for |
| --- | --- | --- |
| `oc-a` | as above | s-1, s-2 |
| `oc-b`, `oc-d` | as above | s-3, s-7; s-4 |
| `oc-c` | no `"timeout"` | s-5, s-6 |
| `oc-w` | `--model scripted/fixed` | `isError` on the wire |
| `oc-r` | as above | The codeword, and the rejection quoted back |
| `p1`, `p2`, `q3` to `q9` | `--model scripted/fixed`; Ask mode but for `q6`; the operator's configuration in `<S>\xdg\config\opencode\opencode.json`; Quay's `"permission"` added to `OPENCODE_CONFIG_CONTENT` | The permission matrix |
| `oc-y` | `--model scripted/fixed`, no `"timeout"` | s-41 |

**PiG 0.5.1**, in the same folder:

```text
pig -e <quay-pig-bridge> --model ollama/qwen3.5:9b --thinking off -ns -nc

PIG_HOME=<S>\pighome
QUAY_A2UI_PROTO_PIG_WIRE=<S>\logs\pig-wire.jsonl
QUAY_A2UI_PROTO_PIG_TIMEOUT=<seconds>                        control runs only; 150 without it
```

`<S>\pighome\agent\models.json` defines the `ollama` provider (`http://127.0.0.1:11434/v1`) and the `scripted` one (`http://127.0.0.1:14709/v1`), both `openai-completions`. `-ns` and `-nc` leave out PiG's skills and context files.

| Terminal | Differs by | Used for |
| --- | --- | --- |
| `pig-a`, `pig-b` | `--model anthropic/claude-haiku-5-5`, no scratch `PIG_HOME`; `pig-a` without `--thinking off -ns -nc` | The expired sign-in |
| `pig-c`, `pig-d` | as above | s-27; s-28 to s-30, s-35, s-36 |
| `pig-e`, `pig-f` | `--model scripted/fixed` | s-31, s-38; s-32 |
| `pig-g`, `pig-h` | `--model scripted/fixed`, timeout 120; 45 | s-33, s-40; s-34, s-39 |
| `pig-i` | `--model ollama/qwen3.8:27b` | s-37, the codeword, `isError` |
| `pig-z` | `--model ollama/qwen3.8:27b` | `isError` (it was meant to be the next row's run; the knobs had not been rewritten) |
| `pig-y` | `--model scripted/fixed`, without `--thinking off -ns -nc` | `instructions` with skills and context files loaded |

**The prompts.** OpenCode's asked it to read `question.json`, call `quay_surface_proto` once with its `messages` and `wait_seconds` 100 (145 or 300 in the limit runs), say the colour, run `echo carried-on-<colour>`, and end its turn if there was no answer yet. PiG's gave the arguments inline and said not to call the tool again. The scripted model takes `CALL <part of a tool name> <JSON arguments>`.

**OpenCode 2.4.1**, with the `XDG_*` and `OPENCODE_DISABLE_*` variables above, and so over the same scratch folders (the operator's configuration there was still `q9`'s):

```text
opencode run --standalone --auto "CALL quay_reject_proto"

OPENCODE_CONFIG_CONTENT= {"model":"scripted/fixed", <one of these>, "provider": <as above>}
08:04:08  "mcp":{"quay":{<entry>,"timeout":150000}}
08:04:33  "mcp":{"quay":{<entry>,"timeout":150000,"codemode":false}}
08:04:40  "mcp":{"servers":{"quay":{<entry>,"codemode":false}}}
08:04:44  "mcp":{"servers":{"quay":{<entry>,"codemode":false,"protocol":"legacy","timeout":{"execution":150000}}}}
<entry> = "type":"remote","url":"http://127.0.0.1:14710/mcp","headers":{"Authorization":"Bearer x"},"oauth":false
```

## How it was run

- Added to the prototype: an `instructions` text, a `quay_reject_proto` tool that always answers with the spec's rejection object, logging of the handshake and of turn events, a config layer for OpenCode's launch, and a timeout override and wire capture in `quay-pig-bridge`. `tools/prototype-a2ui-wire/scripted-model.mjs` is the scripted model.
- Quay's log: `src/slices/stage/prototype-a2ui-roundtrip/run-2026-11-24.ticket-708.quay-log.txt`. Each terminal's CLI and version are in its `INITIALIZE` line.
- The wire extract: `run-2026-11-24.ticket-708.wire.txt` beside it. It has one line per request that listed tools, the instruction blocks and tool results whole, the OpenCode 2 stub's log, and the permission matrix as printed. The full captures are not committed, because their request bodies hold local paths and whole system prompts.
- After the run, a review made the prototype refuse a knobs, instructions or timeout setting it cannot read, and write its log on a thread of its own, only when a log file is named. The merged OpenCode configuration above is the reviewed code's output for the run's knobs file; the runs themselves were not repeated.
- The first permission batch in that log (07:42 to 07:55 UTC) ran in Skip mode by mistake and proves nothing about Ask mode. It is not used above. The matrix is the batch from 07:56 on.
- No configuration file of the operator's was changed. `~/.pig/agent/settings.json` and `trust.json` were backed up and have the same hashes as before; `auth.json` has its old timestamp. Two PiG launches before the scratch `PIG_HOME` was set appended to `~/.pig/agent/exit.log` and `crash-output` and left a session folder for the scratch project. Listing OpenCode's models and credentials touched the timestamp of `opencode.db`.
- `oc-z` and one early `pig-c` call (s-27) were launched or prompted wrong and prove nothing.
- One probe of a hosted free model through a logging proxy (since deleted) was refused by the provider ("Free usage limit reached"), so hosted models were only used directly.
- Every process started for this was stopped by its PID, and the local model was unloaded.

## Spec changes

Quoted from #706 as last edited at 3:45 AM Eastern on 2026-11-24 (08:45:05 UTC), after #709's edits, and read at 3:54 AM.

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

No other sentence of #706 is contradicted. "Nothing depends on the server's `instructions` text" is borne out: PiG does not show it.

## Proposals, not contradictions

Nothing here is needed for #706 to be right. They are for the operator to take or leave.

- **"CLIs", `server/discover`**, completed for these CLIs: "Claude Code and Antigravity do; Codex 0.164.0 does not." could become "Claude Code and Antigravity do; Codex 0.164.0, OpenCode 1.19.4 and PiG 0.5.1 do not. OpenCode 2.4.1 does."
- **"Solution"**, since OpenCode 2 is a separate program under the same name: "The first release connects Claude Code, Codex, OpenCode, PiG and Antigravity." could say "OpenCode 1.x".
- **A ticket of its own:** a 2.x OpenCode terminal dies at launch in today's Quay.
