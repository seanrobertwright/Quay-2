# Can one PiG terminal get Quay's MCP server without touching user config?

Research for #144 (map #141). Read on 2026-10-21 against PiG `main` at commit
[`3ee123c`](https://github.com/MichaelKinsy/PiG/tree/3ee123c6d5f4a754dd27ebb9190ab8e169354f13)
(2026-10-20, latest release `v0.5.1`). Everything below was read from source. Nothing was run.
Source links use the short form `PiG:<path>:<line>`, meaning
`https://github.com/MichaelKinsy/PiG/blob/3ee123c/<path>#L<line>`.

## Answer

**Yes.** Load an extension with `-e <path>` that calls `registerMcpServer("quay", …)`.
This is the only route that keeps to the #72 rule: it changes nothing in `~/.pig`, in Pi's
`~/.pi`, or in the user's project.

The extension can be the same few lines for every terminal. PiG expands `${NAME}` in header
values from the environment when it connects, so the token comes from `QUAY_A2A_TOKEN`, which
Quay already sets on every peer terminal. The token never touches disk or the command line,
just as with Claude today.

```ts
// quay-bus.ts: shipped with Quay, launched as `pig -e <abs path>/quay-bus.ts`
export default function (pi) {
  pi.registerMcpServer("quay", {
    type: "http",
    url: process.env.QUAY_MCP_URL,                          // set per terminal by set_quay_env
    headers: { Authorization: "Bearer ${QUAY_A2A_TOKEN}" }, // expanded by PiG at connect time
    exposure: "direct",  // the default, "codemode", hides the tools from the model
    timeout: 120,        // the default, 60 s, ties with Quay's 60 s wait_for_reply
    description: "Quay's A2A bus: list and message the other agent terminals",
  });
}
```

The same extension is the natural place for the turn-end hook that #145 is researching. That
gives PiG one Quay-owned file passed with `-e`, much like Codex's notify sidecar in #83.

## Route by route

### 1. A per-terminal `PIG_CODING_AGENT_DIR` or `PIG_HOME`: works, but loses the user's sign-in and settings. Rejected.

- The agent dir is `PIG_CODING_AGENT_DIR` if set. In shared mode it is `PI_CODING_AGENT_DIR`,
  else `~/.pi/agent`. Otherwise it is `<config root>/agent`
  (`PiG:internal/codingagent/settings.go:1796-1812`, `PiG:internal/codingagent/paths.go:45,68-73`).
  The config root is `PIG_HOME`, else `XDG_CONFIG_HOME/pig`, else `~/.pig`
  (`PiG:internal/configroot/configroot.go:49-65`).
- The global MCP file is always `<agent dir>/mcp.json` (`PiG:coding/mcpext/config.go:237-239`).
  So a per-terminal agent dir does give a per-terminal `mcp.json`.
- **The auth file can't be kept separately.** Every reader and writer opens
  `filepath.Join(agentDir, "auth.json")`. For example: `PiG:coding/cli/auth_run.go:31`,
  `PiG:internal/codingagent/auth_filter.go:67` and `PiG:coding/cli/auth_commands.go:102`. No env
  var or flag points at a different auth file. I searched every `PIG_*` and `PI_*` lookup in
  non-test Go code.
- The other ways round it are all bad:
  - **Copying `auth.json`** puts a second copy of the credentials on disk. It also escapes PiG's
    lock, which is a directory lock taken next to `auth.json` (`PiG:ai/auth.go:4`), so OAuth
    refreshes in the two copies drift apart.
  - **Linking `auth.json`** is fragile on Windows.
  - **API-key env vars** work, but the dev machine has none (#141).
- The other files move too. `settings.json` (default model and provider), `trust.json`, the
  user's global `extensions/`, `sessions/` and the npm or git package roots all live under the
  agent dir (`PiG:internal/codingagent/paths.go:80-99`). Sessions alone can be moved back with
  `--session-dir`, but the rest can't. The terminal would stop behaving like the user's PiG.
- **Shared mode does not help.** `PIG_USE_PI_DIRS=1` swaps in Pi's directories (`~/.pi/agent`
  and `.pi/`), so `mcp.json` is read from Pi's user config instead
  (`PiG:internal/codingagent/paths.go:29-41`, `settings.go:1800-1805`). Pointing
  `PI_CODING_AGENT_DIR` elsewhere has the same auth problem as above.

### 2. An extension loaded with `-e`: works. Recommended.

- `-e` and `--extension` take a path, and the flag can repeat (`PiG:coding/cli/args.go:318-320`).
  A local path is loaded with no trust check. Only `npm:` and `git:` sources get installed, into
  the agent dir (`PiG:coding/cli/configured_resources.go:125-164`), so Quay must pass a plain
  local path. `--no-extensions` turns off the built-in MCP extension too, while keeping `-e`
  paths (`PiG:docs/extensions.md:60`). Quay must not pass it.
- `registerMcpServer(name, config)` exists in every SDK.
  - **Go:** `PiG:extensions/sdk/mcp_servers.go:91-98`.
  - **Node:** the Pi-compatible `pi.registerMcpServer`, tested in
    `PiG:coding/extension/host/subprocess/runtime_node_extension_api_test.go:54`.
  - **Rust and Python:** `extensions/sdk-rs`, `extensions/sdk-py`.

  It takes the same shape as an `mcp.json` entry, is held for the session only and is "not
  saved". So nothing is written.
- The built-in MCP extension connects `mcp.json` servers and extension-registered servers. A
  registered name loses to the same name in `mcp.json`
  (`PiG:coding/mcpext/extension.go:465-480`). If a user has their own `quay` entry, theirs wins.
  Quay should pick a distinctive name, or accept this and warn in the docs.
- Header values and the URL may use `${NAME}`. The header expansion happens at connect time in
  `resolveHeaders` (`PiG:coding/mcpext/runtime.go:118-130`, documented at
  `PiG:coding/extension/mcp_servers.go:147`). The URL expansion is `ExpandMcpURL`
  (`mcp_servers.go:589-595`).
- **Exposure must be `direct`.** The default is `codemode`: "tools are callable from codemode
  scripts, but not declared to the model" (`PiG:extensions/sdk/mcp_servers.go:15-29,58`). With
  the default, the model would see only a namespace, not `quay_send_message`.
- **The timeout should be over 60 s.** PiG's per-request default is 60 s
  (`PiG:extensions/sdk/mcp_servers.go:66`). Quay's `quay_send_message` waits up to 60 s
  (`src-tauri/src/slices/orchestrator/mcp.rs`, `dispatch_and_wait(..., 60)`), so the two would
  race.
- **What runs the extension:**
  - **TypeScript or JavaScript** runs on `node` from PATH. PiG "itself downloads nothing"
    (`PiG:coding/extension/host/tsruntime/tsruntime.go:1-6,30`).
  - **A Go or Rust source extension** is built by PiG, so it needs that toolchain
    (`PiG:docs/extension-authoring.md:345`).
  - **A prebuilt native executable** is also accepted (`PiG:docs/extensions.md:22-32`). It needs
    no toolchain, but it ties Quay to PiG's subprocess wire protocol, which is pre-1.0.

  The simplest choice is a `.ts` file, but it needs Node on PATH. The npm install route implies
  Node. The `irm … | iex` and `go install` routes don't. The live check (#143) should confirm
  this.
- **The other version of this route: register tools that call Quay's bridge directly.**
  `registerTool` can wrap `POST /mcp tools/call`. That repeats the schemas of the seven
  `quay_*` and `machina_*` tools and has to track them by hand. `registerMcpServer` gets them
  from `tools/list` for free. Use this version only if PiG's MCP client turns out unusable
  against Quay.
- **MCP over HTTP against Quay's server.** PiG's client posts with
  `accept: application/json, text/event-stream` and handles a plain JSON reply
  (`PiG:mcp/streamable_http.go:294,317-345`). It is fine with no `Mcp-Session-Id`, and it offers
  protocol `2025-11-25`, which Quay echoes back (`PiG:mcp/types.go:11`). One mismatch:
  - After `notifications/initialized`, PiG opens a `GET` stream. It expects
    `text/event-stream`, or a `405` meaning "no stream" (`PiG:mcp/streamable_http.go:697-725`).
  - Quay's `GET /mcp` answers `200 application/json`
    (`src-tauri/src/slices/bridge/routes.rs:353-363`).
  - PiG reports that as a non-retryable error "that do[es] not close the connection"
    (`PiG:mcp/transport.go:16`, `streamable_http.go:675-682`). The tools should still work, but
    it may print a warning.
  - **The fix:** have Quay answer `405` to a `GET` whose `Accept` asks for `text/event-stream`.
    This is a small change. Confirm it in the live check.

### 3. The project's `.pig/mcp.json`: confirmed, it breaks the rule.

- It is read only when the project is trusted (`PiG:coding/mcpext/config.go:240-244`).
- `--approve` means "Trust project-local files for this run"
  (`PiG:coding/cli/help_upstream.txt:57`, `args.go:356-359`). It doesn't persist, but it trusts
  everything in `.pig/`, including project extensions and settings, not just the MCP file.
- It writes into the user's repository, where the file can be committed. It also applies to
  every PiG session in that project, including ones the user starts outside Quay, where
  `QUAY_*` isn't set.
- A project file can't use `auth` (`config.go:167-169`), though a `${QUAY_A2A_TOKEN}` header
  would still work.
- It fails #72 on two counts: it isn't per terminal, and it writes to a file the user owns.

### 4. An undocumented flag or env var for an MCP config file: none exists.

- **Flags:** the full set is in `parseArgs` (`PiG:coding/cli/args.go:210-411`). The only MCP
  flag is `--no-mcp`. PiG has no counterpart to Claude's `--mcp-config` or Codex's `-c`. Any
  other `--name value` is kept as an extension flag (`setUnknownFlag`, `args.go:393-403`), so a
  Quay extension could define its own flag. It doesn't need one, since the env vars are
  already set.
- **Env vars:** the MCP loader, client and built-in (`coding/mcpext`, `mcp`,
  `coding/extension/builtin`) read no environment variable outside tests. `LoadMcpConfig` reads
  exactly two files, `<agent dir>/mcp.json` and the trusted project's `mcp.json`
  (`PiG:coding/mcpext/config.go:237-250`). `pig diagnose` prints `PIG_CONFIG` and
  `PIG_AGENT_DIR` (`PiG:coding/cli/diagnose.go:156`), but nothing reads them. They are leftover
  names.
- **Packages:** packages can list MCP resources (`.mcp.json` or `mcp/`,
  `PiG:coding/packagecontent/packagecontent.go:2456-2464`). I found no path from them into
  `LoadMcpConfig`, and installing a package writes to the agent dir anyway.
- **Builds:** some builds leave MCP out (`pig_strip_mcp`,
  `PiG:coding/extension/builtin/mcp_off.go`). The live check should confirm the shipped `pig`
  has it, for example with `pig mcp list`.

## Compared with the other full peers

| CLI | How Quay's MCP gets in, per terminal | Token |
|---|---|---|
| Claude (in code) | `--mcp-config '<inline json>'` (`session.rs` `mcp_config_arg`) | `${CLAUDE_EVENTS_TOKEN}` expanded by Claude |
| Codex (#83, planned) | `-c mcp_servers.quay.url=…`, `bearer_token_env_var=QUAY_A2A_TOKEN`, `default_tools_approval_mode="approve"` | env var named in config |
| OpenCode (#84, planned) | `OPENCODE_CONFIG_CONTENT` env with a `remote` server | `{env:QUAY_A2A_TOKEN}` header |
| **PiG (proposed)** | `-e <Quay-shipped extension>` calling `registerMcpServer` | `${QUAY_A2A_TOKEN}` header expanded by PiG |

PiG is the only one with no inline-config flag or env var. The extension takes its place, and
it uses the same mechanism Quay will likely need for turn end anyway (#145). PiG has no
tool-call approvals (#141), so it needs nothing like Codex's approval override.

## Open points for the live check (#143) and the decision (#147)

1. Is `node` on PATH with the install route we pick? If not, choose between a prebuilt native
   extension and requiring Node.
2. Does the `GET /mcp` `200 application/json` reply print a visible warning in PiG? If it does,
   make Quay return `405` for SSE `GET`s.
3. Does `/mcp` inside PiG list `quay` as an extension server with seven direct tools?
4. Pick a server name that a user's own `mcp.json` is unlikely to shadow.
