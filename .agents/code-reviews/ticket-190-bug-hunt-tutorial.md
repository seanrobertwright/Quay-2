# Code review: ticket-190, Swarm 5: Bug Hunt

**Stats:**

- Files Modified: 3 (`README.md`, `docs/tutorials/index.md`, `docs/tutorials/swarm/custom-swarm/index.md`)
- Files Added: 25 (`docs/tutorials/swarm/bug-hunt/index.md`, 7 `.webp` screenshots in `docs/tutorials/swarm/bug-hunt/`, `examples/tutorials/bug-hunt/*`)
- Files Deleted: 0
- New lines: 1887
- Deleted lines: 2

Checked:
- `pnpm docs:build` clean (exit code 0, no placeholder stills)
- `pnpm docs:test` (180 passed, 0 failed)
- `pnpm docs:typecheck` clean (exit code 0)
- `node scripts/starters-ci/check-starters.ts` (5 starters checked, all clean)
- `node --test "scripts/starters-ci/*.test.ts"` (30 passed, 0 failed)
- `pnpm test` (225 passed, 0 failed)
- `pnpm lint` (0 errors)
- `cargo test --manifest-path src-tauri/Cargo.toml` (497 passed, 0 failed)

## Findings

Code review passed. No technical issues detected.

- The `bug-hunt` starter and check suite (`check/cart.check.test.ts`) correctly isolate the three planted bugs (percent coupon on multiple items, duplicate SKU addition, and removing non-existent SKU) with visible tests passing on the buggy code while check tests fail 4 of 6, matching `expected-state.json`.
- Shortcut instructions throughout `docs/tutorials/swarm/bug-hunt/index.md` adhere to the latest `Ctrl+Shift+B` prefix chord convention and use the master Open Project dialog workflow.
- Predecessor linkage is correctly maintained: Swarm 4 (`custom-swarm`) links forward to Swarm 5 (`bug-hunt`), and Swarm 5 links to the `/tutorials/` index noting Swarm 6 is upcoming.
- `README.md` and `docs/tutorials/index.md` tables are cleanly synchronized using `pnpm docs:tutorials`.
