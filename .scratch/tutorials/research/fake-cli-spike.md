# Spike: the fake-CLI replay path against a built Quay

Ticket #48 on the "Swarm and A2A tutorials" wayfinder map (#2), a task ticket that
unblocks the recording wrapper decided in #38. Run on 2026-10-18 against the release
build `src-tauri/target/release/tauri-app.exe` built the same afternoon. The only spawn
or bridge code change after that build is the default PTY size in `PtySession::spawn`.

Throwaway code sits beside this file in `fake-cli-spike/`: a std-only Rust stub that
impersonates an agent CLI, and a Node driver that launches Quay, opens terminals through
the real UI and checks the reaction over CDP. Nothing here ships.

## Answer in brief

- **PATH pickup works, but not through the capture process's PATH.** On Windows,
  portable-pty 0.9.0 rebuilds the child's environment from the registry, so a stub
  first on the launcher's PATH launched the real Claude Code and the real Codex. What
  works with no app change: the fixture `workspaces.json` carries
  `env_vars: { "PATH": "<stub folder>;..." }` on the fixture project. Quay merges a
  project's saved env vars into every spawn, Swarm included, and the command builder
  resolves the bare program name against that PATH.
- **Replayed bridge traffic drives the UI exactly as a real agent does.** Status
  events posted to `/v1/events` moved the rail badge and status strip through
  Starting, Working, Working: Read, Ready with the task title. MCP calls to `/mcp`
  with the handed token were attributed to the right terminal. A `quay_send_message`
  with `wait_for_reply` from one stub was typed into the other stub's PTY, answered,
  and showed in Mission Control as Alpha → Beta, Completed, with the reply.
- **Codex terminals pick up the stub the same way but get no bridge.** OpenCode
  cannot be replaced this way on a machine where OpenCode is installed through bun,
  because Quay launches it by absolute path.

## 1. PATH pickup

### Why the launcher's PATH is ignored

`PtySession::spawn` in `src-tauri/src/slices/pty/session.rs` builds
`CommandBuilder::new("claude.exe")`. In portable-pty 0.9.0 (`src/cmdbuilder.rs`):

- `CommandBuilder::new` seeds the environment from `get_base_env()`.
- On Windows, `get_base_env` starts from the process environment, then overlays every
  value under `HKLM\System\CurrentControlSet\Control\Session Manager\Environment` and
  `HKCU\Environment`. For `PATH` it joins the machine and user values. An inherited
  `PATH` is replaced, not merged.
- `cmdline()` resolves a bare program name through `search_path`, which reads `PATH`
  from the builder's own map and tries each directory with each `PATHEXT` extension.

So the PATH the CLI is found on is the registry PATH, whatever the capture script set.
Two runs confirmed it: with the stub folder first on the driver's PATH, Quay launched the
real Claude Code (it showed the first-run theme chooser, because `CLAUDE_CONFIG_DIR`
pointed at an empty fixture folder) and the real Codex (it asked whether to trust the
directory).

### What works: the fixture workspace's env vars

`spawn_terminal` in `src-tauri/src/slices/pty/commands.rs` looks up the project's saved
settings and fills `request.env_vars` from them. `PtySession::spawn` applies those with
`cmd.env(k, v)` after the base environment, and `search_path` reads the builder's map.
A fixture `workspaces.json` therefore controls the lookup:

```json
{
  "active_project": "C:\\tutorials\\demo-project",
  "projects": [
    {
      "path": "C:\\tutorials\\demo-project",
      "name": "demo-project",
      "env_vars": { "PATH": "C:\\tutorials\\stub-bin;C:\\Windows\\system32" }
    }
  ]
}
```

With that in place, two Claude terminals and one Codex terminal all launched the stub
from the stub folder. The override is per project, which matches one fixture per
tutorial, and it reaches Swarm launches because they go through the same command.

Rejected routes: putting the stub folder in the registry PATH of the capture account
(machine state outside the fixture), and a Quay code change to honour the process PATH
(portable-pty's registry merge is deliberate, so GUI launches see PATH edits).

### What the stub received

For a Claude terminal in Skip mode:

| What | Value |
| --- | --- |
| Working directory | the project path |
| Arguments | `--dangerously-skip-permissions --mcp-config <temp>\quay-mcp-<terminal id>.json` |
| `CLAUDE_EVENTS_URL` | `http://127.0.0.1:<bridge port>` |
| `CLAUDE_EVENTS_TOKEN` | a 65-character token, one per terminal |
| `CLAUDE_EVENTS_TAG` | the terminal id (`term-<32 hex>`) |
| `CLAUDE_EVENTS_TOOLS` | `full` |
| `CLAUDE_EVENTS_PERMISSIONS` | `off` (Skip mode) or `host` (Normal) |

The `--mcp-config` file holds one server, `quay`, of type `http`, URL
`http://127.0.0.1:<bridge port>/mcp`, with an `Authorization: Bearer <token>` header
carrying the same token as the environment variable. The file is written to the user's
temp folder before every spawn and is not removed afterwards.

## 2. Replayed bridge traffic

### Status events

`POST /v1/events` with `{"events": [envelope, ...]}`. Each envelope needs `v`, `boot`,
`seq`, `ts`, `sessionId`, `tag`, `type` and `data`; `tag` must be the terminal id or the
event is recorded but moves nothing. All five posts returned 200, and the UI reacted
immediately (status polled through `list_terminals` and read from the DOM):

| Event | `data` used | Rail and status strip |
| --- | --- | --- |
| `session.started` | none | Starting... becomes Ready |
| `turn.started` | `prompt` (or `text`, `query`, `user_input`) | Working; the first line becomes the task title, and the rail row's title reads "Alpha — Add a health route" |
| `tool.started` | `tool`, `input.file_path` (or `command`, `path`, `pattern`, `query`, `prompt`) | "Working: Read (src/server.ts)" and a tool badge in the rail |
| `tool.finished` | none | back to "Working..." |
| `turn.completed` | `answer` | "Ready — Task: "Add a health route"", chime, and the answer resolves any pending `wait_for_reply` on this terminal |

Facts the replayer must know:

- `/v1/events` checks only that `Host` is loopback and that no `Origin` header is
  present. It does not check the token today. The bridge-auth item on the fix-first list
  will add a Bearer check, so send `Authorization: Bearer <CLAUDE_EVENTS_TOKEN>` on
  events from day one. The stub did, and the bridge ignored it.
- `data.answer` of `turn.completed` is the text a waiting peer receives. The
  wrong-replies fix on the fix-first list will resolve only with a turn that starts
  after delivery, so a replayed reply must post `turn.started` after the injected prompt
  arrives, then `turn.completed`, in that order.

### MCP calls

`POST /mcp` with JSON-RPC, `Authorization: Bearer <token>`, `Host` loopback, no
`Origin`:

- `initialize` returned the requested `protocolVersion` and `serverInfo` `quay-a2a`
  `1.0.0`. It also sets the calling terminal to Idle and emits `session.started` for it,
  so replay `initialize` only where the recording has it, which for Claude Code is at
  startup.
- `tools/list` returned the four `quay_*` tools.
- `tools/call` `quay_list_agents` returned every terminal with id, name, task title,
  run kind, status, current tool, auto-approved count and project path. The caller was
  attributed by token: the response showed the caller's own auto-approved count.
- `tools/call` `quay_send_message` with `wait_for_reply: true` and
  `target_terminal_id: "Beta"` (names resolve, not just ids) made Quay type
  `[Peer agent (Alpha)]: please review the health route` into Beta's PTY, with Enter
  250 ms later. The Beta stub read that line from stdin, posted `turn.started` then
  `turn.completed` with an answer, and the call returned
  `Reply from Beta:\n<answer>`. The HTTP response held open for the wait, under the
  60-second limit.

The caller of an MCP request is the terminal whose token matches, not the `tag`; a
replayer therefore needs no tag on MCP calls, only the token Quay handed it.

### Mission Control and the rest of the UI

- The trail showed "Alpha → Beta", "Completed", the delegation text and the reply, and
  a card "Alpha → Beta DONE" with "View Terminal" appeared top-right.
- The rail showed the injected prompt's first 32 characters as Beta's task title, and
  Alpha's as `send Beta please review the heal`.
- Observed once and not investigated: the dispatch form's "To Agent" list labelled
  Beta `[WORKING]` while `list_terminals` reported `idle` for it.
- `list_terminals` returned Beta before Alpha in one run and Alpha first in another:
  the random terminal order already on the fix-first list.

## 3. Codex and OpenCode terminals

- **Codex.** `CommandBuilder::new("codex.exe")`, bare name, so the same fixture PATH
  override reaches it. The stub received only `--dangerously-bypass-approvals-and-sandbox`
  and the project path as working directory: no `CLAUDE_EVENTS_*` variables, no
  `--mcp-config`. Its rail row stayed at "Starting..." for the whole run because nothing
  reports for it. The Codex peer design in #12 (a bundled sidecar helper reporting turn
  end) will change this launch; the sidecar must receive the bridge port, tag and token
  some way, and a Codex replay then replays whatever the sidecar sends.
- **OpenCode.** Quay launches `%USERPROFILE%\.bun\bin\opencode.exe` when that file
  exists, and only otherwise the bare `opencode.exe`. On a machine with OpenCode
  installed through bun, which the capture account will be, the absolute path wins and no
  PATH override applies. Not exercised. The OpenCode peer build from #12 should resolve
  OpenCode by PATH, or honour an override, or replay has to hide the bun install.
- **Others.** Antigravity is `agy.exe` by bare name; Pi and Gemini run through
  `cmd.exe /c`; Grok, Kiro and Copilot use an absolute path when the usual install
  exists. All are listeners under #12, so replay for them is a matter of terminal
  output only.

## 4. Other facts for the record run

- A record run needs a `CLAUDE_CONFIG_DIR` that has finished onboarding; an empty
  fixture folder puts Claude Code on its theme chooser.
- `taskkill /T` on the Quay process took the stubs down with it; no stray processes.
- Terminal rows are selected by clicking the name; typing goes to the visible xterm
  pane. Escape did not close Mission Control in the driver, so the driver reads what it
  needs while the panel is open.

## How to re-run

```text
cargo build --release --manifest-path fake-cli-spike/stub/Cargo.toml
node fake-cli-spike/spike.cjs --exe <tauri-app.exe> --work <empty folder> --port 9333 --stub <quay-fake-cli.exe> --pw <folder with node_modules/playwright-core>
```

The driver writes `out/report.json` and six screenshots under the work folder. Those
outputs stayed outside the repo: they carry the temp folder's user-profile path.

## Not established

- OpenCode: the absolute-path launch was read from the code, not exercised.
- Replay timing: the stub answered commands on demand. Replaying an asciicast at
  recorded offsets, and re-issuing bridge calls at theirs, is the wrapper's job and was
  not built.
- Why the Mission Control dispatch list showed a stale status for Beta.
- Normal mode: every terminal here ran in Skip mode, so `/v1/permission` was not
  exercised.
