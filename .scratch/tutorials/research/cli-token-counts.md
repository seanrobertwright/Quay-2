# Research: Where does each CLI report a session's token total?

Ticket: [#95](https://github.com/seanrobertwright/Quay-2/issues/95), a research ticket under the
[tutorials build](https://github.com/seanrobertwright/Quay-2/issues/60). It answers fact 5 of
[#44](https://github.com/seanrobertwright/Quay-2/issues/44) and feeds the Tokens tile decided in
[#14](https://github.com/seanrobertwright/Quay-2/issues/14): "the highest total, rounded up to two
significant figures", summing the agents that report tokens and naming any that don't.

Checked on 2026-10-21 against Claude Code 2.1.306, codex-cli 0.163.0, OpenCode 1.19.3 and
Antigravity CLI 1.4.3 (print-mode runs) and 1.4.4 (TUI run; `agy` updated itself between the two).
Earlier research in #44 used codex-cli 0.154.0, OpenCode 1.19.3 and Antigravity CLI 1.4.2. Sources
are each CLI's docs, its source where public (Codex `main` at commit `c419fd0`, OpenCode tag
`v1.19.3`), and live runs on this machine in throwaway git repos.

## Short answer

All four CLIs record a token count. None of them prints one plain session total that means the
same thing as the others, so the test-run record needs one definition and a recipe per CLI.

- **Claude Code:** `/usage` (aliases `/cost`, `/stats`) shows the session's tokens per model, rounded
  to tenths of a thousand. The exact figures are in the session transcript's last `cost-state`
  line. Both are cumulative for the session and include subagents and background calls.
- **Codex:** the TUI prints `Token usage: total=… input=… (+ … cached) output=…` on exit. Its
  `total` leaves cached input out. The rollout log's `total_token_usage.total_tokens` is the full,
  cumulative figure. Subagents have their own rollout files and must be added.
- **OpenCode:** the TUI shows only the current context size and the cost. `opencode export
  <sessionID>` gives the session's cumulative `tokens` object. Child sessions must be added.
- **Antigravity (`agy`):** the TUI shows no token total, and nothing is printed on exit. Its
  conversation transcript records `input_tokens`, `cache_read_tokens` and `output_tokens` on each
  model step, and these must be summed. Print mode (`agy -p --output-format json`) returns a
  cumulative `usage` object, but tutorials run in the TUI.
- **Every one of the four reports tokens.** On these versions no agent is "not counted". Quay
  itself shows a Claude spend figure, but it is machine-wide and cannot isolate one test run.

Recommended definition: **every input token the model read (fresh, cache read and cache write)
plus every output token (thinking and reasoning included)**, summed over every model call in the
session, including subagents where the CLI records them.

## The definition, and why

The CLIs split input differently:

| CLI | `input` includes cached tokens? | `output` includes thinking or reasoning? | Ready-made total |
| --- | --- | --- | --- |
| Claude Code | No. `cacheReadInputTokens` and `cacheCreationInputTokens` are separate | Yes. Thinking is a detail of output (`output_tokens_details.thinking_tokens`) | None |
| Codex | Yes. `cached_input_tokens` is part of `input_tokens` | Yes. `reasoning_output_tokens` is part of `output_tokens` | `total_tokens` = input + output |
| OpenCode | No. `cache.read` and `cache.write` are separate | No. `reasoning` is separate | `total` on each step = all five fields |
| Antigravity | No, by the step pattern (see its section) | Yes. `thinking_tokens` is part of `output_tokens` | `total_tokens` = input + output, without cache reads |

Evidence for each cell is in the CLI's section. Counting everything is the only definition every
CLI can meet from its own fields. Cache reads dominate long sessions: in the Claude TUI run below,
cache reads were 74,749 of 135,005 tokens. A figure without them would make Claude look far
cheaper than Codex, whose headline numbers include cached input.

So the record does not lose detail, it should keep each agent's parts (fresh input, cache read,
cache write, output) next to the total. Then a later change of definition needs no re-run.

## Claude Code

### Claude Code: where the figures appear

| Place | What it shows | Cumulative? | Usable for the record? |
| --- | --- | --- | --- |
| `/usage` Session block (also `/cost`, `/stats`) | `Total cost`, durations, and `Usage by model:` with input, output, cache read and cache write per model | Yes, for the session. Resets on `/clear` | Yes, but figures above 1,000 are rounded (`74.7k`) |
| Last `cost-state` line in the transcript | `modelUsage.<model>.inputTokens`, `outputTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens`, `thinkingTokens`, `costUSD`; `totalCostUSD` | Yes, and restored on `--resume` | **Yes, exact.** Matches `/usage` |
| `assistant` lines in the transcript | `message.usage.input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` per API response | Per response; sum them | No. Background calls are missing (see below) |
| `claude -p --output-format json` result | `modelUsage` (same keys as `cost-state`), `total_cost_usd`, and a top-level `usage` | `modelUsage` is cumulative over a resumed session; `usage` covers only the last response | Not for TUI runs |
| Status line JSON | `cost.total_cost_usd` is cumulative. `context_window.total_input_tokens` and `total_output_tokens` are the current context size, "from the most recent API response" ([statusline](https://code.claude.com/docs/en/statusline)) | Cost only | No session token total |
| Exit | `Resume this session with: claude --resume <session-id>`. No token or cost line | n/a | Gives the session id |
| OpenTelemetry export | Per-user token and cost metrics ([costs](https://code.claude.com/docs/en/costs)) | n/a | Needs telemetry set up; not needed |

The transcript is `~/.claude/projects/<encoded cwd>/<session-id>.jsonl`, where the encoded cwd
replaces every character other than an ASCII letter or digit with `-`. This is the encoding Quay's
`claude_project_dir_name` in `src-tauri/src/slices/machina/spend.rs` reproduces. Subagent
transcripts sit under `<session-id>/subagents/`.

### Claude Code: live checks

- `claude -p "Reply with the word pong and nothing else" --output-format json`, then a second
  prompt with `--resume <session-id>`. The second result's `modelUsage` was 4 input, 8 output,
  37,692 cache read and 50,320 cache write: both turns together. Its top-level `usage` held only the
  second response. The transcript then had one `cost-state` line per run, the second one
  cumulative.
- Interactive `claude` in a ConPTY (pywinpty), with two typed prompts, then `/usage`, then
  `/exit`. `/usage` printed:

  ```text
  Usage by model:
       claude-haiku-5-5:  2.3k input, 29 output, 0 cache read, 0 cache write ($0.0002)
       claude-opus-5-5:  4 input, 8 output, 74.7k cache read, 57.9k cache write ($0.4781)
  ```

  The transcript's last `cost-state` held the exact values: Haiku 2,346 input and 29 output; Opus 4
  input, 8 output, 74,749 cache read and 57,869 cache write. Total by the definition above:
  135,005. The `assistant` lines held only the two Opus responses. The Haiku call was a
  background request that only `cost-state` and `/usage` count.
- The run used a subscription sign-in (the status line showed 5-hour and weekly plan limits). The
  docs say the Session block "is intended for API users", but its token lines appeared anyway.
- Interactive sessions write `cost-state` when the session ends. In this project's transcript
  folder, most transcripts that have a `cost-state` line have exactly one, and in the ones
  checked it was the last line.

### Claude Code: subagents, background calls and compaction

`cost-state` counts more than the transcript's `assistant` lines. Three earlier interactive
sessions with subagents on this machine were compared. In each, `cost-state`'s output count was
larger than the main transcript plus its `subagents/` files. In one, it was 467,199 output
tokens, against 74,304 in the main transcript and 324,667 with the subagent files added. So
subagents are in it, and so are background calls on other models (Haiku here) that no
`assistant` line records.
In one session with an auto-compaction (`compact_boundary`), `cost-state` output was about 20,000
tokens above the transcript sum, which is consistent with the compaction call being counted.
The docs list compaction, prompt suggestions and summarisation as token use
([costs](https://code.claude.com/docs/en/costs), "Background token usage").

Two cautions for the test run:

- `/clear` starts a new session, and the totals restart at zero (docs, `/usage`). A tutorial that
  tells the learner to `/clear` produces two sessions to add.
- The maintainer's own hooks started extra `claude -p` sessions in the throwaway folder during the
  TUI run. A clean test account, as #14 requires, avoids counting those.

## Codex CLI

### Codex: where the figures appear

| Place | What it shows | Cumulative? | Usable for the record? |
| --- | --- | --- | --- |
| Exit line in the terminal | `Token usage: total=18,014 input=18,004 (+ 32,000 cached) output=10`, then `codex resume <id>` | Yes, for the thread | Yes: add `total` and `cached` |
| Rollout log, `event_msg` with `payload.type: "token_count"` | `info.total_token_usage` and `info.last_token_usage`, each with `input_tokens`, `cached_input_tokens`, `cache_write_input_tokens`, `output_tokens`, `reasoning_output_tokens`, `total_tokens` | `total_token_usage` is cumulative | **Yes, exact** |
| Rollout log, `token_usage_record` lines | `usage` (one response), `turn_token_usage`, `thread_token_usage` | `thread_token_usage` is cumulative | Same figure as above |
| `/status` in the TUI | A `Token usage` line, but hidden for ChatGPT sign-ins | Yes | Not with a ChatGPT sign-in |
| `codex exec --json` | `turn.completed` with `usage`: the thread's cumulative totals (no `total_tokens` key) | Yes | Not for TUI runs |

The rollout log is `~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<thread-id>.jsonl`.

The exit line and `/status` show `TokenUsage::blended_total`, which the source documents as
"non-cached input + output" (`codex-rs/protocol/src/protocol.rs` in
[openai/codex](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs);
the TUI copy is in `codex-rs/tui/src/token_usage.rs`). So `total=` leaves out cached input. The
full figure is `total + cached`, which equals `total_tokens`.

`/status` hides the line for ChatGPT accounts: `StatusHistoryCell` in
`codex-rs/tui/src/status/card.rs` carries the comment "Hide token usage only for ChatGPT
subscribers". On this machine, signed in with ChatGPT, `/status` showed only `Context window: 95%
left (25K used / 258K)`.

### Codex: live checks

- `codex -c check_for_update_on_startup=false` in a ConPTY: the update check did not run, unlike
  in #44. Two prompts, `/status`, `/quit`. The exit line was the one quoted in the table. The
  rollout's last `total_token_usage` was 50,004 input (32,000 cached), 10 output, 50,014 total:
  18,014 + 32,000.
- `codex exec --json "Reply with the word pong and nothing else"`, then `codex exec --json resume
  <thread-id> "…ping…"`. The first `turn.completed.usage` had 23,453 input and 5 output. The second
  had 46,936 input (23,296 cached) and 10 output: both turns. The `Usage` doc comment in
  `codex-rs/exec/src/exec_events.rs` says "used during the turn", but `usage_from_last_total` in
  `event_processor_with_jsonl_output.rs` fills it from the thread total. Live behaviour agrees with
  the code, not the comment.
- Across the rollouts on this machine with non-zero reasoning, `total_tokens` equals
  `input_tokens + output_tokens`. So reasoning is inside output, and cached input is inside input.

### Codex: subagents and compaction

A subagent is its own thread with its own rollout file. Its `session_meta.payload` has
`parent_thread_id` set to the parent and `source.subagent.thread_spawn`. In a run from #44, the
parent's final `total_token_usage` (92,701) equalled the sum of its own responses, and the
subagent's 22,750 were not in it. Add each child rollout's last `total_tokens` to the parent's.

In an older rollout with a `compacted` line, `total_token_usage` kept rising across the compaction
and never dropped. Whether the compaction request's own tokens are in it was not isolated.

## OpenCode

### OpenCode: where the figures appear

| Place | What it shows | Cumulative? | Usable for the record? |
| --- | --- | --- | --- |
| TUI sidebar "Context" | `<n> tokens`, `<n>% used`, `$<n> spent`. The tokens are the last assistant message's five fields, so this is the context size | Cost only | No |
| `opencode export <sessionID>` | `info.tokens`: `input`, `output`, `reasoning`, `cache.read`, `cache.write`; `info.cost`; and per message `info.tokens` (with `total`) | `info.tokens` is cumulative | **Yes, exact** |
| Server `GET /session/:id` (TUI started with `--port`, or `opencode serve`) | The same session object with `tokens` | Yes | Yes, same figure |
| `opencode run --format json` | `step_finish` events with `part.tokens` (`total`, `input`, `output`, `reasoning`, `cache.read`, `cache.write`) and `part.cost` | Per step; sum them | Not for TUI runs |
| `opencode stats` | Totals over all sessions, optionally by days or project | Across sessions | No: no per-session filter |
| `/export` in the TUI | The conversation as Markdown ([TUI docs](https://opencode.ai/docs/tui/)) | n/a | No tokens |

The TUI has no token or cost slash command ([TUI docs](https://opencode.ai/docs/tui/)). The
sidebar's code is `packages/tui/src/feature-plugins/sidebar/context.tsx` in
[anomalyco/opencode](https://github.com/anomalyco/opencode/tree/v1.19.3), the current home of
`sst/opencode`.

How the fields are built: `getUsage` in `packages/opencode/src/session/session.ts` subtracts cache
reads and writes from the provider's input count, and reasoning from its output count. It keeps
`total` as the provider's total. The session row is kept up to date by `applyUsage` in
`packages/core/src/session/projector.ts`, which adds each message's usage to its own session's
row only.

### OpenCode: live checks

- `opencode run --pure --format json "Reply with the word pong and nothing else"` on the default
  model. It answered `pong`, then auto-compacted, received a `Continue if you have next step`
  prompt, and kept going until stopped by hand. Each step's `total` equalled `input + output +
  reasoning + cache.read + cache.write` (for example 233 + 32 + 66 + 281,472 = 281,803).
- `opencode export` of that session: `info.tokens` equalled the sum over all assistant messages,
  including the compaction messages (`agent: "compaction"`, `summary: true`). So compaction turns
  are counted. `GET /session/<id>` on `opencode serve` returned the same `tokens` object.

### OpenCode: child sessions

Subagents run as child sessions with `parentID` (#44, fact 4c). `applyUsage` does not roll a
child's usage into the parent, so add each child's `tokens`. `GET /session/:id/children` lists
them, and a child's own session object carries `parentID`.

## Antigravity (`agy`)

### Antigravity: where the figures appear

| Place | What it shows | Cumulative? | Usable for the record? |
| --- | --- | --- | --- |
| TUI footer | `Context ░░░ 1% │ Usage ███ 99% (↻ 4h 58m) …`: context and quota percentages | n/a | No |
| `/context` | `<model> · 14.1k/1.0M tokens` and a breakdown by category: the current context | No | No |
| `/usage` | "Models & Quota": quota bars per model group | n/a | No |
| Exit | `Resume with -c (or command below):` and `agy --conversation=<id>`. No token line | n/a | Gives the conversation id |
| Conversation transcript | On each `PLANNER_RESPONSE` step: `input_tokens`, `cache_read_tokens`, `output_tokens` | Per step; sum them | **Yes, exact** |
| `agy -p … --output-format json` | `usage` with `input_tokens`, `output_tokens`, `thinking_tokens`, `cache_read_tokens`, `total_tokens` | Yes, over the conversation | Not for TUI runs |
| Status line JSON | `context_window` with `total_input_tokens`, `total_output_tokens`, `context_window_size` ([statusline docs](https://antigravity.google/docs/cli/statusline)) | Not stated | No |
| `~/.gemini/antigravity-cli/log/cli-*.log` | No usage figures | n/a | No |

The transcript is
`~/.gemini/antigravity-cli/brain/<conversation-id>/.system_generated/logs/transcript.jsonl`.
A `transcript_full.jsonl` sits beside it.

The [headless docs](https://antigravity.google/docs/cli/headless) list the `usage` fields, call
stream-json `usage` "Cumulative over the session", and do not define `total_tokens`. The local
`agy changelog` also mentions a status line `cost` field. The status line docs page does not list
it, and it was not checked live (that needs a status line script in the user's settings).

### Antigravity: live checks

- `agy -p "Reply with the word pong and nothing else" --output-format json`, then a second prompt
  with `--conversation <id>`. The first `usage`: 10,241 input, 27 output (26 thinking), 0 cache
  read, 10,268 total. The second: `num_turns: 2`, 20,718 input, 54 output, 20,772 total. Both turns.
  The transcript's two steps (10,241 + 10,477 input, 27 + 27 output) summed to the same figures.
- `total_tokens` was `input_tokens + output_tokens` each time, and `thinking_tokens` never exceeded
  `output_tokens`, so thinking is inside output. The transcript has no thinking field.
- Interactive `agy` in a ConPTY with `AGY_CLI_OSC7501=on`: one prompt, `/context`, `/usage`,
  `/help`, `/exit`. No screen showed a session token total, and the exit printed only the resume
  hint. The transcript held one step: 10,251 input, 0 cache read, 57 output.
- Whether `input_tokens` includes cache reads: in older transcripts on this machine, `input_tokens`
  stays at a few thousand per step while `cache_read_tokens` grows with the conversation (one
  step: 18,535 input and 0 cached; two steps later 2,645 input and 16,465 cached). So input excludes
  cache reads, and `input_tokens + cache_read_tokens + output_tokens` is the definition's total. No
  cache-write field exists.

### Antigravity: subagents and compaction

Transcript steps of other types (`CHECKPOINT`, `SYSTEM_MESSAGE`, tool steps) carry no token
fields. Whether a subagent's or a compaction's model calls appear in the parent transcript was not
established.

## Does Quay show a Claude token or spend figure?

Yes, two, and neither fits the test-run record.

- **The Token Spend pill and meter.** `StatusStrip` (`src/slices/stage/StatusStrip.tsx`) and `Rail`
  (`src/slices/rail/Rail.tsx`) show the all-time "API-equivalent Claude spend". Clicking either
  calls `onOpenTokenSpend`, and `App` opens `TokenSpendModal`
  (`src/slices/metrics/TokenSpendModal.tsx`). That shows spend, input, output,
  cache-read and cache-write tokens for today (UTC), 7 days, 30 days and all time. The data comes
  from the `get_claude_stats` command, through `compute_stats` in
  `src-tauri/src/slices/sessions/commands.rs`. It scans every `~/.claude/projects/**/*.jsonl`
  (subagent files included), reads `assistant` lines' `message.usage`, dedupes by `message.id` +
  `requestId` (`parse_line` and `refresh_usage` in `src-tauri/src/slices/sessions/usage.rs`),
  prices them at list price (`cost_usd` in `src-tauri/src/slices/sessions/pricing.rs`), and keeps
  per-day totals in `token-ledger.json`. Older history comes from Claude Code's `stats-cache.json`.
  It is machine-wide, has no per-session view, and misses the background calls that only
  `cost-state` records.
- **Machina work-order spend.** `measure` in `src-tauri/src/slices/machina/spend.rs` prices the
  Claude transcripts under one worktree's project folder, through `transcript_dir_spend` in
  `usage.rs`. It returns US dollars and a response count, not tokens. Any other agent is
  `measured: false` ("only Claude Code transcripts can be priced").

So the answer to #44's "Quay's spend figure, or the CLI itself?" is the CLI itself.

## For the test-run record

Read each figure after the agent's session has ended (Claude: after `/exit`). Write the total and
its parts. The session id comes from the CLI's exit line.

| CLI | Where to read it | Number to write down | In the Tokens tile? |
| --- | --- | --- | --- |
| Claude Code | Last `"type":"cost-state"` line of `~/.claude/projects/<encoded cwd>/<session-id>.jsonl`. For a quick check, `/usage` before `/exit` (rounded) | Sum over every model in `modelUsage` of `inputTokens + outputTokens + cacheReadInputTokens + cacheCreationInputTokens`. Add another session if the learner ran `/clear` | Yes |
| Codex | Last `token_count` event of `~/.codex/sessions/YYYY/MM/DD/rollout-*-<thread-id>.jsonl`, plus each subagent rollout whose `parent_thread_id` is that thread. Without subagents, the exit line gives the same number | `info.total_token_usage.total_tokens`, summed over parent and subagents. From the exit line: `total` + `cached` | Yes |
| OpenCode | `opencode export <sessionID>`, for the session and for each child session (`parentID`) | `info.tokens.input + output + reasoning + cache.read + cache.write`, summed over parent and children | Yes |
| Antigravity | `~/.gemini/antigravity-cli/brain/<conversation-id>/.system_generated/logs/transcript.jsonl` | Sum over `PLANNER_RESPONSE` lines of `input_tokens + cache_read_tokens + output_tokens` | Yes. Subagent and compaction calls may be missing |

For the tile generator: an agent whose test-run entry says `Tokens: not reported` is left out of
the sum and named after it, as in "`{CLI}` not counted". On the versions checked here every agent
reports tokens, so that branch is only needed if a later CLI version drops its figure.

## Not established

- **Claude Code:** whether `cost-state` is written when the terminal is closed instead of
  `/exit`. That compaction calls are in it is inferred from one session, not tested directly.
- **Codex:** whether `cache_write_input_tokens` is inside `input_tokens`; it was 0 in every rollout
  here. Whether the compaction request's own tokens are in `total_token_usage`.
- **OpenCode:** this ticket did not drive the TUI live. Its sessions are stored and summed by the
  same code as `opencode run` (`applyUsage`), and #44 read the TUI's sessions through the same
  server API.
- **Antigravity:** whether subagent and compaction calls appear in the parent transcript. Whether
  the status line `cost` field from the changelog exists in the payload. That `input_tokens`
  excludes cache reads rests on the step pattern, not on docs.
- **Versions:** `agy` updated itself from 1.4.3 to 1.4.4 during this research. Codex was read at
  `main`, not at the 0.163.0 tag; the parts used here were confirmed live on 0.163.0.

## Sources

- Claude Code: <https://code.claude.com/docs/en/costs>,
  <https://code.claude.com/docs/en/statusline>, <https://code.claude.com/docs/en/commands>
- Codex: <https://github.com/openai/codex> (`codex-rs/protocol/src/protocol.rs` `TokenUsage`,
  `TokenUsageInfo`, `TokenUsageRecord`, `FinalOutput`; `codex-rs/tui/src/token_usage.rs`;
  `codex-rs/tui/src/status/card.rs` `StatusHistoryCell`; `codex-rs/exec/src/exec_events.rs`
  `Usage`; `codex-rs/exec/src/event_processor_with_jsonl_output.rs` `usage_from_last_total`;
  `codex-rs/cli/src/main.rs` exit-message tests)
- OpenCode: <https://opencode.ai/docs/cli/>, <https://opencode.ai/docs/tui/>,
  <https://github.com/anomalyco/opencode/tree/v1.19.3>
  (`packages/opencode/src/session/session.ts` `getUsage`;
  `packages/core/src/session/projector.ts` `applyUsage`;
  `packages/tui/src/feature-plugins/sidebar/context.tsx`;
  `packages/opencode/src/cli/cmd/stats.ts`)
- Antigravity: <https://antigravity.google/docs/cli/headless>,
  <https://antigravity.google/docs/cli/statusline>, local `agy --help` and `agy changelog`
- Live runs: `claude -p --output-format json` (and `--resume`), interactive `claude`;
  `codex exec --json` (and `exec resume`), interactive `codex -c
  check_for_update_on_startup=false`; `opencode run --pure --format json`, `opencode export`,
  `opencode serve`; `agy -p --output-format json` (and `--conversation`), interactive `agy`. The
  TUIs were driven in a ConPTY with pywinpty from throwaway git repos, with no permission-skipping
  flags.
