# Code review: ticket-360 Praxis Builder docs page

Scope: the new `docs/features/praxis-builder.md`, its sidebar entry in
`docs/.vitepress/config.mts`, and a link from the Praxis Builder row in
`docs/reference/shortcuts.md`. The change is docs only.

**Stats:**

- Files Modified: 2
- Files Added: 2
- Files Deleted: 0

## Method

Each statement on the page was checked against the code on master, not only
against the README's Praxis Builder section. The checks covered the builder's
key table (`KEY_ENTRIES`), the undo history (`MAX_STEPS` and the session
functions that drop a history), the clipboard envelope, `reconcileWithDisk`
and the conflict dialog, the node kind registry, the Rust `has_revision`
rule, `definitionIdProblem` and `takenIds`, and the graph binding checks in
`binding_attach.rs` and `bindingChecks.ts`.

## Issues found in the first draft, all fixed

```text
severity: medium
file: docs/features/praxis-builder.md
issue: The draft said deleting a node updates its graph binding entries
detail: `editGraph` rewrites binding keys on a node rename, but a node delete
  leaves the entries in place for a retarget to drop.
suggestion: Say what a rename does and what a delete leaves. Done.
```

```text
severity: medium
file: docs/features/praxis-builder.md
issue: The draft called the worst-case preview an info issue covering cost and time
detail: The preview is a section in Runs as and Binding, computed in
  `worstCase` as allowance × attempts × LOOP iterations: cost only.
suggestion: Describe it as a cost figure per contract. Done.
```

```text
severity: low
file: docs/features/praxis-builder.md
issue: The draft said no two definitions may share an id
detail: `takenIds` collects the ids of one kind, so the rule is per kind.
suggestion: Say "of the same kind". Done.
```

```text
severity: low
file: docs/features/praxis-builder.md
issue: The draft gave a hand-typed count of palette groups
detail: The global rules ban hand-typed counts in docs.
suggestion: Let the table show the groups. Done.
```

## Checks

- `pnpm docs:build` passes, and both new links render.
- markdownlint reports only MD013 (line length). Every existing docs page
  fails that rule too, since the docs keep one paragraph per line. With MD013
  off, both changed Markdown files have no issues.
- The README needed no change. Nothing in it contradicts the code; it just
  says less than the page does about node deletes and undo history.
