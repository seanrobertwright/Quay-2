# Code review: ticket 457, Rust tests clean up their temp folders

**Stats:**

- Files Modified: 44
- Files Added: 1
- Files Deleted: 0
- New lines: 471
- Deleted lines: 669

## What was checked

- Every removed `remove_dir_all` cleanup line was for a variable bound to a `TempDir`, or
  to a path under one. None was for a folder outside a guard.
- No guard is dropped early: no `let (_, ..)` or `let _ =` binds a `TempDir` producer, and
  `settings_file(..).1` keeps its tuple alive to the end of the statement.
- Struct fields that hold a guard (`Harness::_dir`, `Sandbox::dir`, `PigInstalls::root`)
  replace the hand-written `Drop` impls they had, with the same effect.
- The detached worktree in `graph/filter_tests.rs` used to be a sibling of the repo folder
  (`repo.with_extension("wt")`), outside any cleanup. It is now its own `TempDir`.
- `cargo test --locked`: 1032 passed, 0 failed, 10 ignored. A deliberately failing
  `staging_tests` test left no folder in `%TEMP%`.

## Issues

```text
severity: low
file: src-tauri/src/slices/workspace/manager.rs
line: 78
issue: The test build's storage_dir() still leaves one quay2-test-<pid> folder per test run
detail: In tests, storage_dir() is a per-process folder that the code under test writes to
  (sessions, ledger, settings). It is not a test's own folder, and a static is never dropped,
  so no TempDir can own it. The full run left exactly this one new folder.
suggestion: Remove it at process exit, or make it a fixed name swept on first use. Either
  goes beyond the helper this ticket asks for, so it is raised separately.
```
