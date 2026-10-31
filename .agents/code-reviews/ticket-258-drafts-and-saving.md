# Code review: ticket-258, drafts, dirty state and saving a graph

**Stats:**

- Files Modified: 20
- Files Added: 3
- Files Deleted: 0
- New lines: 1948 (1388 in modified files, 560 in new files)
- Deleted lines: 115

Checked: `cargo test --lib praxis` (72 pass), `npm test` (186 pass), `tsc --noEmit` and
`eslint "src/**/*.{ts,tsx}"` clean.

## Resolution of earlier findings

The previous Medium finding (No error badge for an invalid graph after save) was addressed
when #257 merged into master and was incorporated into this branch:
`PraxisBuilderModal` records SDK validation verdict via `onValidated` and `ListRow` badges
invalid graphs in the list with `CircleAlert`.

## Findings

```text
severity: low
file: src-tauri/src/slices/praxis/store.rs
line: 470
issue: The conflict check and the write are not atomic against other programs.
detail: SAVE_LOCK serializes Quay's own saves, but an editor that writes the file between
  the hash check and write_atomic is overwritten. #221 has no file watcher in v1 and
  nothing on Windows gives a portable compare-and-swap rename.
suggestion: Accept for v1 and note it in the PR's known limits.
```

```text
severity: low
file: src/slices/praxis-builder/PraxisBuilderModal.tsx
line: 562
issue: A clean draft whose file was deleted stays in the list (struck through) for the session.
detail: Showing it lets the user write it back, but nothing removes it short of quitting.
suggestion: Fine for this ticket. Delete (#222) will drop drafts. Revisit if it confuses.
```

```text
severity: low
file: src-tauri/Cargo.toml
line: 27
issue: serde_json preserve_order is now on for the whole binary.
detail: It's needed so config keys keep the file's order on read and write. It changes the
  key order of every serde_json::Map in the app from sorted to insertion order. All Rust
  tests pass, and nothing found compares serialized maps as strings.
suggestion: Keep it, and mention it in the PR.
```
