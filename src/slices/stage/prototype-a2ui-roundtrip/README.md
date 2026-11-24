# PROTOTYPE: surface round trip (#693)

Throwaway. None of this is the build.

**Question:** does a surface really make the round trip in Claude Code, Codex and Antigravity,
over the chosen carrier (a tool on Quay's MCP server) and return path (the call waits, then the
answer is typed in)?

**Verdict:** yes, in all three, both halves. The findings are in the resolution comment on #693.

## What is here

- `src-tauri/src/slices/orchestrator/a2ui_proto.rs`: the `quay_surface_proto` tool. It takes
  `{"messages": [...]}` and an optional `wait_seconds`, shows the surface, waits, and logs each
  step. An answer after the wait is typed into the terminal as an operator message.
- `RoundTripProto.tsx`: a crude card, bottom right of the real app in dev builds, with one button
  per A2UI `Button`.
- `tools/prototype-a2ui-relay/relay.mjs`: the stdio relay for a CLI that takes only static
  configuration. It forwards each JSON-RPC line to `QUAY_MCP_URL` with `QUAY_A2A_TOKEN`.
- `proto_knobs` in `src-tauri/src/slices/pty/session.rs`: per-CLI launch arguments, variables
  and Claude's MCP `timeout`, read at each launch from the JSON file `QUAY_A2UI_PROTO_KNOBS` names.
- `question.json`: the fixed question. `run-2026-11-23.*.txt`: Quay's and the relay's logs of the run.

## Run it

```
QUAY_A2UI_PROTO_LOG=<file> QUAY_A2UI_PROTO_KNOBS=<file> pnpm tauri dev
```

Launch an agent terminal in a folder holding `question.json` and ask it to call
`quay_surface_proto` with that file's `messages`. For Antigravity, first run
`agy mcp add quay node <repo>/tools/prototype-a2ui-relay/relay.mjs`, and remove it afterwards.

## OpenCode and PiG (#708)

The same prototype, with the spec's 100 s wait and 150 s limit. Findings:
`docs/research/a2ui-findings-708.md`.

- `quay_reject_proto` always answers with the spec's rejection object as an `isError` result.
- `QUAY_A2UI_PROTO_INSTRUCTIONS` names a file whose text goes out as the handshake's `instructions`.
- The knobs take a `config` object for `opencode`, laid over `OPENCODE_CONFIG_CONTENT`.
- `quay-pig-bridge` registers a 150 s timeout (`QUAY_A2UI_PROTO_PIG_TIMEOUT` overrides it) and, with
  `QUAY_A2UI_PROTO_PIG_WIRE`, writes each request PiG sends its model to a file.
- `tools/prototype-a2ui-wire/scripted-model.mjs` is a loopback model that calls the tool it is told to
  and writes down each request it gets. `wire.mjs` is a logging proxy; a hosted provider refused it,
  and no result rests on it.
- `run-2026-11-24.ticket-708.quay-log.txt`: Quay's log of the run.
