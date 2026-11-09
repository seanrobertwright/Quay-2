# Code review: Praxis CLI runner commands for graph triggers (#474)

**Stats:**

- Files Modified: 11
- Files Added: 5
- Files Deleted: 0
- New lines: 1838, most of them the recorded fixture
- Deleted lines: 65

## Scope

The `praxis triggers` verbs in the runner (`outcome.rs`, `runner.rs`), the
saved-trigger operands (`trigger.rs`), nine Tauri commands (`commands.rs`,
`lib.rs`), the `triggerInvalid` outcome on the frontend (`praxisHost.ts`,
`runStart.ts`), and the recorders and fixture for the fake `praxis`.

Checked against what AI-WS-SDK #662 shipped (`engine/src/praxis-triggers.ts`):
command words, operand order, `--format` pins, exit 9 formats, the name
grammar and the `--before FIREID` grammar all match. Two mutation runs, one
removing a verb from the name guard and one mapping submit's exit 9 to
`BundleInvalid`, each failed a trigger test, and so did removing the
`triggerInvalid` message on the frontend.

## Issues

severity: low
file: src/slices/praxis-builder/praxisHost.ts
line: 41
issue: The `unknown` docstring said every write but a run creation carries a `requestId`.
detail: An `unknown` from a timeout or an undocumented exit code carries none. Only one praxis confirms as `OUTCOME_UNKNOWN` does.
suggestion: Say the `requestId` comes when praxis says it couldn't confirm the write. Fixed.

severity: low
file: src-tauri/src/slices/praxis/host/trigger_tests.rs
line: 120
issue: The fires test read the `--before` cursor as `args[6]` of the recorded case.
detail: Re-recording with a different operand order would read the wrong argument, and the test would fail for an unrelated reason.
suggestion: Find the value after `--before`. Fixed.

No security issues: every operand goes to `node` as an argument vector with no
shell. Names, the `--after` name and the fire cursor are parsed before
`praxis` runs, and the trigger path is the saved file's own path.
