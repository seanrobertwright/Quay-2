## Findings: the open surface points in Claude Code, Codex and Antigravity

**Verdict: every point is measured, and the 100 s wait with the 150 s limit stands in all three.** Three findings change the spec:

1. **Codex tells Quay nothing when the operator presses Esc.** No turn end, no cancel, no closed connection. An answer clicked during the rest of the wait was returned to nobody and lost.
2. **Claude Code does not close the connection on Esc.** It sends `notifications/cancelled` and its turn end, and leaves the HTTP call open. The turn end already ends the wait.
3. **Antigravity's `--settings` can allow the surface tools per launch, but its `permissions.allow` replaces the user's own allow list for that session.** The user's `deny` rules still apply.

Run on 2026-11-24, 2:22 to 3:07 AM Eastern, Windows 11, a dev build of Quay 0.8.0 from branch `ticket-709` (cut from `prototype/a2ui`). Logs are in UTC, beside the prototype in `src/slices/stage/prototype-a2ui-roundtrip/`: `run-2026-11-24-709.quay-log.txt` and `run-2026-11-24-709.relay-log.txt`.

| CLI | Version | Model | Mode |
|---|---|---|---|
| Claude Code | 2.1.331 | Haiku 5.5 | Skip |
| Codex | 0.164.0 | gpt-6-luna, low | Skip |
| Antigravity | 1.5.16 | Gemini 3.8 Flash (Low) | Normal ("Ask") |

#693 ran Claude Code 2.1.330, Codex 0.146.0 and Antigravity 1.4.11, so some differences below are version differences.

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
| Esc during a call (s-4) | 45 s / 100 s | Call at 07:40:36.527, Esc at 07:40:47. Nothing in the 46 s before I clicked: no `turn.completed`, no line in `codex-notify.log`, no cancel, no close. Quay's status for the terminal said idle after the Esc. Codex's own record has `turn_aborted`, reason `interrupted`. The click at 57.5 s was **returned as the call's result and lost** |
| Esc with no call open | none | The same: `turn_aborted` in Codex's record, no `notify` |
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

**Approval**, Normal mode:

| `--settings` | Tool called | Prompted? |
|---|---|---|
| No `permissions` | reject tool | Yes |
| `permissions.allow: ["mcp(quay/quay_surface_proto)"]` (file) | surface tool | **No** (s-8, s-9, s-10) |
| same | reject tool | Yes: the rule is per tool |
| Two rules, inline JSON | reject tool | **No** |
| Allow list, while the user's `settings.json` allows `mcp(quay/quay_list_agents)` | `quay_list_agents` | **Yes: the user's allow list is replaced** |
| No `permissions`, same user rule (control) | `quay_list_agents` | No |
| Allow for the reject tool, while the user's `settings.json` denies it | reject tool | Denied: "Matches user-configured deny rule" |

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
- `~/.claude.json` gained an entry for the scratch folder `E:/q709/plain-cc`. Other live sessions write that file, so I did not restore it.
- `E:\q709` (scratch folders) is still there: a hook here refuses a recursive delete.
- `agy`'s generated `mcp/quay` cache folder, made by this run, is removed. The CLIs' own session records of these runs stay.
- One mistyped `/permissions` became a path, and `agy` ran a read-only `icacls` on the Git folder. It changed nothing.

Every process I started is stopped.

### Not tested

- Codex: a turn that carries on after an abandoned call; Ctrl+C; its Ask mode; another model (`gpt-6-luna` runs tools through its code mode, where it looks tool descriptions up, and the `instructions` finding may differ elsewhere).
- Whether an Esc the operator types is a reliable sign of an interrupted Codex turn (see the replacement text). Quay sees those keys, but no code tested it.
- Antigravity: two `--settings` flags at once, as when the user's custom flags hold one; a user's `ask` rules under `--settings`; a wildcard rule.
- Merging the user's own allow list into the one Quay passes. The result follows from the two rows above but was not run.
- Claude Code in Normal mode, and the answers typed in after a wait (proven in #693).
- macOS and Linux.

### Spec changes

**1. Waiting for the answer.** Quoted:

> - **A wait ends at the first of:** the operator's action; 100 s; the connection closing; that terminal's own turn ending (a subagent's turn does not count). The relay turns a cancel into a closed connection.
> - After the last three, the surface stays up and answerable.

Replace with:

> - **A wait ends at the first of:** the operator's action; 100 s; the connection closing; a `notifications/cancelled` from that terminal naming the call's request id; that terminal's own turn ending (a subagent's turn does not count); in a Codex terminal, the operator typing a lone Escape. The relay turns a cancel into a closed connection.
> - The last is needed because Codex sends nothing when the operator presses Esc: no turn end, no cancel, no closed connection. Claude Code sends a cancel and its turn end and leaves the connection open. If the key did not interrupt Codex, the call returns "no answer yet" early and the answer is typed in, so nothing is lost. (Proposed; the key as a signal was not tested.)
> - After all but the operator's action, the surface stays up and answerable.

**2. The CLI table.** Quoted:

> | Claude Code | `--mcp-config` | `"timeout"` in the entry | `--allowedTools` | Record at its check | Proven |
> | Codex | `-c mcp_servers.quay.*` | `tool_timeout_sec` | Every tool on Quay's server, as today | Record at its check | Proven |
> | Antigravity | Relay, via Connect | `timeoutSeconds` in the entry | None in Skip; its own prompt in Normal, or `--settings` if it proves out | Record at its check | Proven; timeout and `--settings` to check |

Replace with:

> | Claude Code | `--mcp-config` | `"timeout"` in the entry | `--allowedTools` | Yes, in context from the start | Proven |
> | Codex | `-c mcp_servers.quay.*` | `tool_timeout_sec` | Every tool on Quay's server, as today | Only in front of a tool's description, when the model looks it up | Proven |
> | Antigravity | Relay, via Connect | `timeoutSeconds` in the entry, written directly since `agy mcp add` cannot set it | None in Skip; in Normal `--settings` with one `mcp(quay/<tool>)` allow rule per tool, joined with the user's own `permissions.allow`, which it otherwise replaces for the session | Only if the model opens the `instructions.md` that `agy` writes | Proven |

**3. `server/discover`.** Quoted:

> - **`server/discover`** answers with the standard's fallback signal, taken from the specification's text at build and verified in all five first-release CLIs.

Replace with:

> - **`server/discover`** answers with the standard's fallback signal, taken from the specification's text at build and verified in each first-release CLI that sends it. Claude Code and Antigravity do; Codex 0.164.0 does not.

**4. The six tools.** Quoted:

> Nothing depends on the server's `instructions` text, which is sent all the same, in a version that mentions only the tools that terminal has.

Not contradicted. Add after it:

> It is kept to a sentence or two, because Codex repeats it in front of each tool's description.

**5. Antigravity's pre-approval.** The table's `--settings` needs a rule of its own. Proposed, to add to **CLIs**:

> - **Antigravity's pre-approval.** Quay reads the user's `~/.gemini/antigravity-cli/settings.json` at launch, joins its `permissions.allow` with the six rules, and passes the result with `--settings`. If the file cannot be parsed, or the user's custom flags already hold `--settings`, Quay passes nothing and `agy` asks. Quay never writes that file.
