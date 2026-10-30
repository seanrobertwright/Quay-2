# Code review: ticket-372, Topos overlay shell and git version gate

**Stats:**

- Files Modified: 9
- Files Added: 7
- Files Deleted: 0
- New lines: 626
- Deleted lines: 2

## Issues

```text
severity: low
file: src/slices/git/topos/ToposIcon.tsx
line: 8
issue: The docstring cited logos/topos/topos-icon.svg, which is not tracked in the repo.
detail: The logo concepts exist only as untracked files in one checkout, so the path leads nowhere for other readers.
suggestion: Name the approved mark and the spec that approves it instead of a path. Fixed in this change.
```

```text
severity: low
file: src/slices/git/topos/gitVersion.ts
line: 15
issue: MIN_GIT_VERSION "2.36" duplicates the Rust floor constant.
detail: If the floor moves, the message and the gate could disagree. The ticket fixes the payload as TooOld { found }, so the floor isn't sent.
suggestion: Keep it for now, since the type comment names its Rust twin. A later ticket can add the floor to the payload if it changes.
```

Checked and found sound:

- Escape closes the overlay through the overlay stack. The panel is the stack's own dialog, and closing removes the stack entry.
- Only the newest version check sets state, so a Retry can't be overwritten by a slow first check.
- `git --version` is bounded at 10 s, and a NotFound spawn maps to Missing.
- Spawn failures aren't cached, so a later open tries again.
- The payload key test fails for a variant without camelCase.
