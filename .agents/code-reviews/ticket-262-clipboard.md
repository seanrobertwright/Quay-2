# Code review: ticket-262, copy, cut, paste and duplicate nodes

**Stats:**

- Files Modified: 4
- Files Added: 2
- Files Deleted: 0
- New lines: 767 (122 in modified files, 645 in new files)
- Deleted lines: 2

Code review passed. No technical issues detected.

Checked and found sound:
- `Mod+C`, `Mod+X`, `Mod+V`, and `Mod+D` are scoped strictly to `"canvas"` in `keymap.ts`, ensuring that form inputs and inspector fields preserve native text copy, cut, and paste.
- The clipboard envelope uses the versioned identifier `quay-praxis-nodes/1` and operates exclusively in-memory, without reading or writing the system clipboard.
- External dependencies in `dependsOn` are filtered out at copy time, and external DECISION branch targets (`then` and `else`) are blanked to `""`.
- Internal dependencies and branches are cleanly rewired during paste and duplicate across remapped IDs.
- ID clash remapping removes trailing `-<digits>` and takes the smallest free integer `n` (e.g. `task-3` becomes `task-5` when 1–4 are taken, and unnumbered `review` becomes `review-2`).
- Pasting within the same graph with originals in view offsets by 24 px and cascades on repeat; otherwise the fragment is centered within the viewport, with click-point placement supported for context menus.
- Cut is recorded as copy plus delete in one history step; each paste and duplicate is recorded as one history step and updates the selection to the newly pasted/duplicated nodes.
- Full test suite (322 tests) and TypeScript typecheck pass with zero errors.
