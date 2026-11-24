## Findings: the open surface points in Claude Code, Codex and Antigravity

**Verdict: every point is measured, and the 100 s wait with the 150 s limit stands in all three.** Findings 1 and 3 change the spec; 2 is covered by it:

1. **Codex tells Quay nothing when the operator presses Esc.** No turn end, no cancel, no closed connection. An answer clicked during the rest of the wait, inside Codex's 150 s limit, was returned to nobody and lost, twice.
2. **Claude Code does not close the connection on Esc.** It sends `notifications/cancelled` and its turn end, and leaves the HTTP call open. The spec's turn-end rule ends the wait.
3. **Antigravity's `--settings` can allow the surface tools per launch, but its `permissions.allow` replaces the user's own allow list for that session.** The user's `deny` rules still apply.

Run on 2026-11-24, Windows 11, a dev build of Quay 0.8.0 from branch `ticket-709` (cut from `prototype/a2ui`): 2:22 to 3:07 AM Eastern, and 3:18 to 3:26 AM for the two Codex Esc cases inside the 150 s limit. The logs are beside the prototype in `src/slices/stage/prototype-a2ui-roundtrip/`:

- `run-2026-11-24-709.quay-log.txt` and `run-2026-11-24-709.relay-log.txt`, in UTC: the first run. Surfaces `s-1` to `s-10` below are in it.
- `run-2026-11-24-709-esc.quay-log.txt`, in UTC: the second run. Its surfaces also start at `s-1`; they are written `esc/s-1` to `esc/s-3` below.
- `run-2026-11-24-709.cli-records.txt`: lines copied from the CLIs' own records, such as Codex's `turn_aborted` and Antigravity's approval prompts. The lines of `agy`'s log are in Eastern time.

| CLI | Version | Model | Mode |
|---|---|---|---|
| Claude Code | 2.1.331 | Haiku 5.5 | Skip |
| Codex | 0.164.0 | gpt-6-luna, low | Skip |
| Antigravity | 1.5.16 | Gemini 3.8 Flash (Low) | Normal ("Ask") |

#693 ran Claude Code 2.1.330, Codex 0.146.0 and Antigravity 1.4.11, so some differences below are version differences.

### Launch commands

`<port>` is the dev Quay's port, and `<...>` in general stands for a path or a value that is not shown. I typed the prompts into the terminal after launch.

```text
Claude Code:
claude --dangerously-skip-permissions --model haiku --mcp-config
  {"mcpServers":{"quay":{"type":"http","url":"http://127.0.0.1:<port>/mcp","headers":{"Authorization":"Bearer ${CLAUDE_EVENTS_TOKEN}"},"timeout":150000}}}

Codex (tool_timeout_sec 45 for s-3 to s-5, 150 for s-7 and esc/s-1 to esc/s-3):
codex --dangerously-bypass-approvals-and-sandbox -m gpt-6-luna -c model_reasoning_effort="low"
  -c projects={"E:\\q709\\proj-cx"={trust_level="trusted"},"e:\\q709\\proj-cx"={trust_level="trusted"}}
  -c mcp_servers.quay.tool_timeout_sec=150 -c mcp_servers.quay.url="http://127.0.0.1:<port>/mcp"
  -c mcp_servers.quay.bearer_token_env_var="QUAY_A2A_TOKEN"
  -c mcp_servers.quay.default_tools_approval_mode="approve" -c notify=["<quay-codex-notify.exe>"]

Antigravity:
agy mcp add quay node <relay.mjs>     (then "timeoutSeconds": 150 written into the entry it made)
agy --model gemini-3.8-flash-low --settings <one of these>
  trust only: {"trustedWorkspaces":["E:\\q709\\proj-ag"]}
  one rule, in a file: {"trustedWorkspaces":[...],"permissions":{"allow":["mcp(quay/quay_surface_proto)"]}}
  two rules, inline: {"trustedWorkspaces":[...],"permissions":{"allow":["mcp(quay/quay_surface_proto)","mcp(quay/quay_surface_reject_proto)"]}}
```

### Acceptance criteria

| Criterion | Result |
|---|---|
| `isError` text reaches the model as written | **Yes in all three** |
| `instructions` reach the model | **Claude Code: yes, at the start. Codex: only when it looks a tool up. Antigravity: only if the model opens a file** |
| Codex's turn end when it abandons a call | **Reaches Quay**, 47.3 s after the call with a 45 s limit |
| Codex's turn end when the operator presses Esc | **Does not reach Quay**, and nothing else does |
| Claude Code: an answer at about 95 s, 100 s wait, 150 s limit | **Returned in the same turn**, at 96.9 s |
| Antigravity: `timeoutSeconds: 150` | **Holds**: cut at 150.0 s |
| Antigravity: `--settings` allows the surface tools per launch | **Yes**, one rule per tool, with the replacement above |
| The user's Antigravity configuration left as found | **Yes**, hashes below |
| The spec corrected | See **Spec changes** |

### `isError`

Quay's tool `quay_surface_reject_proto` returned the spec's rejection object (329 characters, one `errors` entry with code, surfaceId, path and a message holding quotes and a made-up word, plus `next`) as text with `isError: true`. I compared each CLI's own transcript with what Quay logged.

| CLI | In the CLI's transcript | What the model said |
|---|---|---|
| Claude Code | Tool result, `is_error: true`, equal to the sent text, 329 of 329 characters | "The tool returned an error", then the text, and that it would not retry |
| Codex | The `custom_tool_call_output` the model reads holds the text whole; the call is `status: "failed"` | Repeated it whole |
| Antigravity | Step status `ERROR`; its `error` equals the sent text. The model sees it after the prefix `Encountered error in step execution: ` | Repeated it whole |

No model retried by itself (each was told not to). In each repeat the JSON, its escapes and `next` were intact.

### `instructions`

`initialize` carried the text "Quay shows surfaces beside this terminal. Use quay_surface_proto to ask the operator something. The Quay codeword is HERON-7042." The codeword is in no tool name or description and in no scratch file.

| CLI | Evidence | Result |
|---|---|---|
| Claude Code | First prompt of the session, "without calling any tool": answered `HERON-7042` | In context from the start, although its tools are deferred |
| Codex | Same prompt: `NONE`, and the codeword is nowhere in the session's record. When the model looked up `quay_surface_reject_proto`, the result held the instructions **in front of that tool's description**. Asked for the codeword after that lookup it said `NONE` once (tools forbidden), and `HERON-7042` when told to look at the description | Reaches the model only with a tool's description, and is repeated for each tool |
| Antigravity | Same prompt: `NONE`. `agy` wrote the text to `~/.gemini/antigravity-cli/mcp/quay/instructions.md`, beside one JSON file per tool. In another session, asked for the codeword and told it could look, the model listed that folder, read the file and answered `HERON-7042`. In an ordinary tool call it read the tool's JSON file and not `instructions.md` | Reaches the model only if it opens that file |

The spec's rule that nothing depends on `instructions` is right.

### Codex: what Quay sees when a call ends early

| Case | Limit / wait | Quay saw |
|---|---|---|
| Codex abandons the call (s-3) | 45 s / 120 s | Call at 07:38:10.916. `turn.completed` at 07:38:58.202, 47.3 s later, "The call timed out after 45 seconds; I did not retry." The HTTP call stayed open and Quay's wait ran its full 120.0 s. No cancel, no close |
| Esc during a call (esc/s-1) | 150 s / 100 s | Call at 08:21:11.816, Esc at 08:21:23. Nothing in the 49 s before I clicked: no `turn.completed`, no line in `codex-notify.log`, no cancel, no close. Quay's status for the terminal said idle. Codex's own record has `turn_aborted`, reason `interrupted`, at 08:21:24.036. The click at 60.4 s was **returned as the call's result and lost**: that result is not in Codex's record |
| The same, late click (esc/s-3) | 150 s / 100 s | Call at 08:24:01.454, Esc at 08:24:14, `turn_aborted` at 08:24:15.111. The click at 96.9 s was returned and lost. Asked afterwards which colour was chosen in the interrupted call, the model said `UNKNOWN` |
| Control without Esc, same session (esc/s-2) | 150 s / 100 s | The click at 60.7 s was returned, the turn ended with "Blue", and `turn.completed` reached Quay at 08:23:47.795 |
| Esc during a call (s-4) | 45 s / 100 s | Call at 07:40:36.527, Esc at 07:40:47, `turn_aborted` at 07:40:50.916. Nothing in the 47 s before I clicked at 57.5 s. That click is past Codex's 45 s limit, so this loss alone does not show that Esc causes it; esc/s-1 and esc/s-3 do |
| Esc with no call open | none | The same: `turn_aborted` at 07:37:15.306 in Codex's record, no `notify` |
| Next tool call after an Esc | 45 s / 100 s | Reached Quay 25 s after the abandoned call (s-5) began, while that one still waited. An Esc does not hold up the next call (#693 saw the retry after a time-out queue) |
| Answer late in the wait (s-7) | 150 s / 100 s | Returned at 99.3 s; the turn ended with "Blue" |

So Quay's turn-end rule covers an abandoned call in Codex, if the agent ends its turn. With 100 s inside 150 s, Codex does not abandon a call at all. Esc is the one hole.

At each launch I skipped Codex's update offer and its hooks review (so the user's hooks did not run), and passed folder trust as a per-launch `-c projects={...}`, so `config.toml` was not written.

### Claude Code

| Case | Quay saw |
|---|---|
| Answer at about 95 s, wait 100 s, `"timeout": 150000` (s-1) | Call at 07:26:09.691, answered at 96.9 s, returned at once; the turn (same `turnId`, 111 s in all) ended with "Green". 96.9 s is past the 60 s default, so the timeout was in force |
| Wait 200 s, `"timeout": 150000` (s-2) | At 120 s the call moved to the background and **the turn ended** (`turn.completed` at 07:30:21) with the call still open. At 150.0 s Claude Code sent `notifications/cancelled` ("SdkError: Request timed out") and closed the connection, and the failure started a new turn |
| Esc during a call (s-6), wait 100 s | `notifications/cancelled` ("AbortError: user-cancel") at 07:43:27.587, `turn.completed` with `reason: "aborted"` 0.13 s later. The connection **stayed open**; Quay's wait ran to 100.0 s |

In #693 2.1.330 sent no cancel on a time-out; 2.1.331 does.

### Antigravity

| Case | Result |
|---|---|
| `timeoutSeconds: 150`, wait 240 s (s-8) | `notifications/cancelled` ("context deadline exceeded") at 150.0 s. #693 measured a default of 180 s on 1.4.11 |
| The relay closing its HTTP call on that cancel | Quay saw the closed connection 2 ms later. An Esc at 13.5 s (s-10) gave "context canceled" and the same close |
| Answer late in the wait (s-9), 100 s wait | Returned at 99.1 s; the model answered "Green" |
| `agy mcp add` | Cannot set `timeoutSeconds`; it also adds `"disabled": false`. The limit has to be written into `mcp_config.json` directly |

**Approval**, Normal mode. The evidence is `agy`'s own log (Eastern time), copied in `run-2026-11-24-709.cli-records.txt`: a prompt is a `Surfacing tool confirmation` line, and no prompt is a call with no such line. The log also prints the allow list in force at launch. `ag4` to `ag10` are the sessions.

| `--settings` | Tool called | Prompted? | Evidence |
|---|---|---|---|
| Trust only, no `permissions` | reject tool | Yes | ag4: surfaced 02:50:55.804, I approved 02:51:08.553 |
| One rule | surface tool | **No** (s-8, s-9, s-10) | ag5: the allow list in force is that rule alone; no surfacing before the calls of 02:52:17, 02:55:13 and 02:57:52 |
| One rule | reject tool | Yes: the rule is per tool | ag5: surfaced 02:57:14.304, I declined 02:57:27.875. ag6: surfaced 02:58:51.856, I approved 02:59:32.431 |
| Two rules, inline | reject tool | **No** | ag7: called 03:00:13, no surfacing |
| Two rules, while the user's `settings.json` allows `mcp(quay/quay_list_agents)` | `quay_list_agents` | **Yes: the user's allow list is replaced** | ag8: the allow list in force is the two rules alone; surfaced 03:02:48.144 |
| Trust only, same user rule (control) | `quay_list_agents` | No | ag9: the allow list in force holds the user's rule; called 03:03:44, no surfacing |
| Two rules, while the user's `settings.json` denies the reject tool | reject tool | Denied: "Matches user-configured deny rule" | ag10: 03:04:32 |

`--settings` refuses a key it does not know: `Error: --settings: unknown setting "mcpServers"`, so the server entry cannot be passed per launch. `trustedWorkspaces` can, and spares the trust prompt.

### `server/discover`

Claude Code and Antigravity send it first and fall back to `initialize` on Quay's present reply. Codex 0.164.0 does not send it.

### The user's configuration

| File | Before | After |
|---|---|---|
| `~/.gemini/config/mcp_config.json` | `869b53be090c7492029b359855e66dc09b1cf146cd8c7f046f33cb2c182dd05b` | the same |
| `~/.gemini/antigravity-cli/settings.json` | `6ef0e303f53009287df890c432369c180b559c068eb4969c5b83c02b002d42f4` | the same |

Both were backed up, edited (a `quay` entry; one allow rule, then one deny rule), restored from the backup and compared byte for byte. The rest of `~/.gemini/config`, `~/.gemini/settings.json`, `~/.codex/config.toml` and `~/.claude/settings.json` hash the same as before.

Left behind, and what I could not put back:

- `agy` updated itself from 1.5.13 to 1.5.16 when I first ran it. Every measurement above is on 1.5.16.
- `~/.claude.json` gained one entry, for the scratch folder `E:/q709/plain-cc`, and is **not restored**. Other live sessions write that file, so putting an old copy back would lose their changes. Removing only that entry was tried, and a secrets hook on this machine refused it.
- `E:\q709` (scratch folders) is still there: a hook here refuses a recursive delete.
- `agy`'s generated `mcp/quay` cache folder, made by this run, is removed. The CLIs' own session records of these runs stay.
- One mistyped `/permissions` became a path, and `agy` ran a read-only `icacls` on the Git folder. It changed nothing.

Every process I started is stopped.

### Not tested

- Codex: a turn that carries on after an abandoned call; Ctrl+C; its Ask mode; another model (`gpt-6-luna` runs tools through its code mode, where it looks tool descriptions up, and the `instructions` finding may differ elsewhere).
- Whether an Esc the operator types is a reliable sign of an interrupted Codex turn (see the replacement text). Quay sees those keys, but no code tested it.
- Antigravity: two `--settings` flags at once, as when the user's custom flags hold one; a user's `ask` rules under `--settings`; a wildcard rule.
- Joining the user's own allow list with the rules Quay passes, so that the list is not replaced. Not run, so nothing below proposes it.
- Claude Code in Normal mode, and the answers typed in after a wait (proven in #693).
- macOS and Linux.

### Spec changes

**1. Waiting for the answer.** Quoted:

> - **A wait ends at the first of:** the operator's action; 100 s; the connection closing; that terminal's own turn ending (a subagent's turn does not count). The relay turns a cancel into a closed connection.
> - After the last three, the surface stays up and answerable.

Replace with:

> - **A wait ends at the first of:** the operator's action; 100 s; the connection closing; that terminal's own turn ending (a subagent's turn does not count); in a Codex terminal, the operator typing a lone Escape. The relay turns a cancel into a closed connection.
> - The last is needed because Codex sends nothing when the operator presses Esc: no turn end, no cancel, no closed connection. If the key did not interrupt Codex, the call returns "no answer yet" early and the answer is typed in, so nothing is lost. (Proposed; the key as a signal was not tested.)
> - After the last four, the surface stays up and answerable.

**2. The CLI table.** Quoted:

> | Claude Code | `--mcp-config` | `"timeout"` in the entry | `--allowedTools` | Record at its check | Proven |
> | Codex | `-c mcp_servers.quay.*` | `tool_timeout_sec` | Every tool on Quay's server, as today | Record at its check | Proven |
> | Antigravity | Relay, via Connect | `timeoutSeconds` in the entry | None in Skip; its own prompt in Normal, or `--settings` if it proves out | Record at its check | Proven; timeout and `--settings` to check |

Replace with:

> | Claude Code | `--mcp-config` | `"timeout"` in the entry | `--allowedTools` | Yes, in context from the start | Proven |
> | Codex | `-c mcp_servers.quay.*` | `tool_timeout_sec` | Every tool on Quay's server, as today | Only in front of a tool's description, when the model looks it up | Proven |
> | Antigravity | Relay, via Connect | `timeoutSeconds` in the entry, written directly since `agy mcp add` cannot set it | None in Skip; in Normal `--settings` with one `mcp(quay/<tool>)` allow rule per tool, which replaces the user's own `permissions.allow` for the session | Only if the model opens the `instructions.md` that `agy` writes | Proven |

**3. `server/discover`.** Quoted:

> - **`server/discover`** answers with the standard's fallback signal, taken from the specification's text at build and verified in all five first-release CLIs.

Replace with:

> - **`server/discover`** answers with the standard's fallback signal, taken from the specification's text at build and verified in each first-release CLI that sends it. Claude Code and Antigravity do; Codex 0.164.0 does not.
