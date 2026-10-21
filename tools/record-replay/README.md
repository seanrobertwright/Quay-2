# Record and replay

A real agent run is recorded once and replayed by a fake CLI that drives a real Quay, so
tutorial screenshots and clips show real output. One exe does both. Copied onto a fixture's
`PATH` under an agent CLI's name (`claude.exe`, `codex.exe`, ...), it stands in for that CLI
in the mode the environment selects:

| Variable | Mode |
| --- | --- |
| `QUAY_RECORD_DIR=<folder>` | **Record.** Runs the real CLI of the same name, found further along `PATH`, and records its terminal and its bridge calls into the folder. |
| `QUAY_REPLAY_DIR=<folder>` and `QUAY_REPLAY_STATE=<folder>` | **Replay.** Plays the CLI's next recording from the first folder into the terminal and re-issues its bridge calls against the live bridge. |

Setting both, or neither, is an error.

## Build

```text
cargo build --release --manifest-path tools/record-replay/Cargo.toml
```

The exe is `tools/record-replay/target/release/quay-record-replay.exe`. Under its own name it
takes the capture script's subcommands:

```text
quay-record-replay mark <recordings folder> <NN-what>
quay-record-replay finish <recordings folder>
```

## How Quay picks it up

Through the fixture workspace's saved `env_vars`, not the capture process's `PATH`. On
Windows, portable-pty rebuilds a terminal's environment from the registry, so a folder put
first on the capture process's `PATH` never reaches the terminal. Quay merges a project's
saved `env_vars` into every terminal it opens for the project, Swarm launches included, and
looks the CLI up on that `PATH`.

Copy the exe into a folder of its own as each CLI it stands in for, then name that folder
first in the fixture's `workspaces.json`. For a record run, the real CLI's folder comes after
it:

```json
{
  "active_project": "C:\\tutorials\\demo-project",
  "projects": [
    {
      "path": "C:\\tutorials\\demo-project",
      "name": "demo-project",
      "env_vars": {
        "PATH": "C:\\tutorials\\fake-cli;C:\\Users\\tester\\.local\\bin;C:\\Windows\\system32",
        "QUAY_RECORD_DIR": "C:\\src\\Quay-2\\tools\\record-replay\\recordings\\a2a-1-hello-a2a",
        "CLAUDE_CONFIG_DIR": "C:\\tutorials\\claude-config"
      }
    }
  ]
}
```

A replay fixture names only the tool's folder and the system folder on `PATH`, and sets
`QUAY_REPLAY_DIR` and `QUAY_REPLAY_STATE` in place of `QUAY_RECORD_DIR`.

## Record

The tool runs the real CLI in a pseudo-terminal of its own, at the terminal's size and with
the environment Quay gave it, and passes everything through both ways: output, keystrokes,
resizes and the exit code. The CLI's `CLAUDE_EVENTS_URL` and the URL in its `--mcp-config`
point at a proxy on loopback that forwards every request to the live bridge as it came,
token included, and passes the bridge's answer back. On the way it records the terminal
stream and every bridge call. The CLI behaves as it does without the tool.

A record run of Claude Code needs a `CLAUDE_CONFIG_DIR` that is past onboarding; an empty one
puts Claude Code on its theme chooser.

A capture:

1. Empties the tutorial's recordings folder. Recordings are numbered per CLI in the order
   terminals start, so old ones would shift the numbering.
2. Starts Quay on the record fixture and, at the start of each step, runs
   `quay-record-replay mark <folder> NN-<what>`. The name is the step's screenshot name,
   two digits, a hyphen and lower-case words joined by hyphens, such as `06-reply-quoted`.
   Every terminal being recorded marks it at that moment; a terminal that starts later marks
   the latest step at its start.
3. Closes Quay, then runs `quay-record-replay finish <folder>`. A terminal whose CLI was still
   running when Quay closed it leaves its files uncompressed; `finish` gzips them and removes
   the markers file.

## Replay

Each replay takes the next recording of the CLI it is named after, in the order they were
recorded: the first terminal Quay opens as `claude.exe` plays `claude-1`, the second
`claude-2`, and a `codex.exe` terminal plays `codex-1`. The takes are files in
`QUAY_REPLAY_STATE`, which must be an empty folder at the start of each capture. A terminal
with no recording left says so and exits.

The replay plays the terminal stream at its recorded offsets and re-issues each bridge call
at its recorded offset, so badges, Mission Control and the trail run on real Quay code. It
follows the wire rules:

- Every call carries `Authorization: Bearer <CLAUDE_EVENTS_TOKEN>`, the live token Quay
  handed the fake exe. MCP calls are attributed by that token.
- Every event envelope carries `tag` set to the live terminal id, and its time is now.
- Only recorded calls are sent, so `initialize` goes out only where the recording has it.
- Where the recording has Enter pressed, the replay waits until Enter is pressed in the live
  terminal and carries on from there. A turn the prompt started, `turn.started` then
  `turn.completed`, goes out after the injected prompt arrives, however late that is.
- Anything recorded after a bridge call answered waits for the replayed call to answer, so a
  slower live bridge pushes the rest of the run back rather than reordering it.

When the recorded CLI exited, the replay exits with its exit code; otherwise it stays on the
last screen until Quay closes the terminal. A call the live bridge refuses is listed in
`<QUAY_REPLAY_STATE>/<recording>.errors`, since the terminal is the replay's screen.

## Recording format

Two gzipped files per terminal, named after the CLI and the terminal's place in the order
terminals of that CLI started:

- `<cli>-<n>.cast.gz`, the terminal stream as an asciicast v2 file. Its header carries the
  terminal's `width` and `height` in columns and rows. Its events are output (`o`),
  keystrokes as the text they type (`i`), resizes (`r`), step markers (`m`) and, when the CLI
  exited by itself, its exit code (`x`, as asciicast v3 names it).
- `<cli>-<n>.http.jsonl.gz`, the terminal's calls to the bridge, one JSON object a line in the
  order they arrived: `t` (seconds into the run) and `d` (seconds until the bridge answered),
  `method`, `path`, `headers`, `body`, and the bridge's `status` and `response`. Bodies that
  are JSON are kept as JSON.

No recording holds an authentication header or the token: the `Authorization` header is not
kept, the token is blanked wherever else it appears, and the HTTP log writes the recorded
terminal's id as `{{tag}}`.

## Where recordings live

Beside the tool, one folder per tutorial: `tools/record-replay/recordings/<tutorial>/`, never
under `docs/`. The tool refuses a recordings folder under a `docs` folder. Recordings are made
on the neutral project path, since the terminal stream shows whatever paths the agent prints.
They go into plain git; Git LFS only if the folder outgrows it.

A recording is re-made whenever its tutorial is re-run, and never otherwise. A Quay release
alone replays the existing recordings.

## Limits

- Codex terminals get no bridge from Quay today, so a Codex recording holds the terminal
  stream and an empty HTTP log, and its replay sends nothing. Once Codex reports through a
  sidecar, a Codex replay replays whatever calls its recording holds; the recorder sees only
  calls made to the URLs in the CLI's environment and arguments.
- Quay launches OpenCode, Grok, Kiro and Copilot by absolute path when their usual install
  exists, which no `PATH` entry overrides.

## Tests

```text
cargo test --manifest-path tools/record-replay/Cargo.toml
```

The tests run on Windows. They open terminals through ConPTY the way Quay does, with the
command looked up on the `PATH` the test hands the terminal, and use a stub agent CLI
(`src/bin/stub-agent.rs`) and a stand-in bridge. The round trip records the stub's run,
replays it with no agent CLI on `PATH` against a new bridge, and compares what both bridges
received and what both terminals showed. The `Record and replay` workflow runs them.
