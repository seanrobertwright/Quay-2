# Code review: ticket #265, create, rename and delete definitions

**Stats:**

- Files Modified: 13
- Files Added: 3
- Files Deleted: 0
- New lines: about 1,500 (1,020 in modified files, plus the three new files)
- Deleted lines: 72

Gates run before the review: `tsc --noEmit`, `eslint src/slices/praxis-builder/`,
`pnpm test` (376 pass), `cargo test --lib` (530 pass), clippy (no new warnings in
`slices/praxis`).

## Issues

```text
severity: medium
file: src-tauri/src/slices/praxis/lifecycle.rs
line: 216
issue: Rename and delete act on the canonical path, so a definition file that is a link has its target removed or trashed.
detail: confined_file returns the canonicalized path. A `.praxis/graphs/g.json` that links to
  `shared/g.json` inside the repo (allowed by the confinement check) would have
  `shared/g.json` removed by a rename, or sent to the trash by a delete, leaving the link
  dangling. The same applies to companion files (the layout).
suggestion: Keep confined_file as the check, but operate on `<dir>/<id>.json` itself, the
  path in the folder, so the link is what moves or goes to the trash.
```

```text
severity: low
file: src/slices/praxis-builder/PraxisBuilderModal.tsx
line: startDelete
issue: A draft whose file was deleted on disk can't be discarded through Delete.
detail: Only drafts with baseHash null take the discard-only path. A saved graph whose file
  was deleted outside Quay stays listed as an orphan with a non-null baseHash, so Delete goes
  to praxis_delete, which refuses with "doesn't exist", and the draft can never be dropped.
suggestion: Take the discard path for any draft that isn't in the listing, and word the
  prompt as "has no file on disk".
```

```text
severity: low
file: src/slices/praxis-builder/PraxisBuilderModal.tsx
line: runPending
issue: The list's invalid badge for a renamed or deleted id is left in the `invalid` map.
detail: `invalid` is keyed by project and definition and only updated when a graph is
  validated. After a rename or delete, a new definition that later takes the old id shows the
  old error badge until it is opened.
suggestion: Drop the old key from `invalid` when a rename or delete goes through.
```

```text
severity: low
file: src/slices/praxis-builder/PraxisBuilderModal.tsx
line: 1-4
issue: The header comment's edit left one line well past the file's wrap width.
detail: Purely cosmetic, but the rest of the file wraps comments at about 90 columns.
suggestion: Rewrap the comment.
```

## Checked and not an issue

- Ids and paths: every path is built in the backend from a `PraxisKind` and a
  `validate_id`-checked id. The frontend never sends a path.
- Case-only renames (`g` to `G`) rewrite in place and then rename, so a file system that
  ignores case doesn't lose the file. Covered by a test.
- Write order: every write and copy runs before any remove, and a failure stops with the
  steps done reported. Covered by tests for the order and for a failure part-way.
- A rename's dry run and its real run share one code path, so the confirmation lists exactly
  what the rename does.
- Values shown in prompts and notices are rendered as React text, so they're escaped.

## Resolution

All four issues were fixed in the same change.
