# Code review: ticket-259, edit a graph on the canvas and in the inspector

**Stats:**

- Files Modified: 13
- Files Added: 6
- Files Deleted: 0
- New lines: 1607 (406 in modified files, 1201 in new files)
- Deleted lines: 137

The three issues below were found and fixed before commit. Typecheck, eslint and the full
`pnpm test` run (214 tests) pass after the fixes.

```text
severity: medium
file: src/slices/praxis-builder/ConfigForms.tsx
line: 44
issue: FieldMessages keyed each message by code, path and message
detail: Two diagnostics that say the same thing give two rows the same React key, so one can be dropped or reused. ProblemsPanel already numbered such duplicates with its own private withKeys.
suggestion: Moved withKeys to issues.ts, with a test, and used it in both places. (Fixed.)
```

```text
severity: low
file: src/slices/praxis-builder/Palette.tsx
line: 52
issue: A drag released back over the palette strip added a node under the strip
detail: The strip sits inside the canvas box, so a drop on it passed the "on the canvas" check.
suggestion: A release over the strip now calls the drag off. (Fixed.)
```

```text
severity: low
file: README.md
line: 89
issue: README and GraphCanvas's header said "bottom handle" for adding a dependency
detail: A DECISION's plain handle is on its right side, so the claim was wrong for decisions.
suggestion: Reworded to "one card's handle". (Fixed.)
```

Checked and found sound: an edit made while a save is in flight is kept (`markSaved`
compares the draft's content with the content sent); a rename or delete that the IdField
commits on blur runs before a click on another control; every edit keeps the draft
drawable (free ids, the 1000-node cap, legal rename ids), so `GraphDraftView`'s parse
can't fail.
