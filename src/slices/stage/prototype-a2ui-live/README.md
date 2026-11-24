# PROTOTYPE: one typed surface in the running app (#711)

Throwaway. None of this is the build. The findings are in `docs/research/a2ui-findings-711.md`.

**Question:** does the spec's cut of a typed surface, run so far in Node and happy-dom, work in a
real Tauri webview with the unsent answer held in Rust?

## What is here

- `catalog.tsx`: Quay's catalog on engine 0.16.1, derived from the basic catalog. Its `Column` reads
  the frame's layout from React context.
- `ask.ts`: `expand` and `collapse` for `quay_ask`.
- `live.ts`: the check on a scratch engine, one live engine per surface outside React, the unsent
  answer, and the rebuild after a load.
- `SurfaceView.tsx`: the companion's Surface view, the frame and the question card's layout.
- `src-tauri/src/slices/orchestrator/a2ui_live.rs`: the store, the check round trip, the wait.
- `engine-probe.mjs`: what the engine alone says, in Node.
- `bundle.mjs`: the bundle's growth, from vite's release profile.
- `drive/`: the scripts that drove the built app over CDP, as they were run except that local paths
  now read `C:/scratch/q711` and `C:/scratch/quay-worktree`. `call.mjs` and `gocall.mjs` are the fake
  CLI and run inside a Quay terminal.
- `run-2026-11-24.quay-log.txt`: the prototype's log of the runs, UTC.

Two changes outside the prototype were made to prove a fix: `a2ui711_checks` hands unanswered checks
to a page that has just loaded, and `useTerminal.ts` leaves the focus in a field being typed in when
a terminal first prints.

## Run it

Build with `npx vite build`, then `cargo build --release --features tauri/custom-protocol` in
`src-tauri`. Launch with `drive/launch.sh`, then `drive/t1-setup.mjs`, then any other script.
