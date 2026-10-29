# Code review: ticket-274 graph binding checks

Graph binding submission checks, attach checks per contract, criteria coverage and the
worst-case preview (#274).

**Stats:**

- Files Modified: 23
- Files Added: 4
- Files Deleted: 0
- New lines: 1561
- Deleted lines: 137

## Issues

```text
severity: medium
file: src/slices/praxis-builder/RunsAsForm.tsx
line: 42
issue: When the attach check fails, the worst case shows a "With no contract" row and the coverage section says no contract lists the graph
detail: contractRows and CoverageSection treat a failed check, and contracts that couldn't be read, as "no contract". The figure then uses only entry maxAttempts and the coverage text is false: the graph may well be under a contract.
suggestion: Return null rows for a failed check and say the contracts couldn't be checked. List an unreadable contract as such rather than dropping it.
```

```text
severity: medium
file: src/slices/praxis-builder/useBindingAttach.ts
line: 39
issue: The last result is kept across a switch to another binding, so another graph's warnings and coverage show under the new binding until its check returns
detail: The stale-while-revalidate result is keyed by project only. Switching from binding A (graph g) to binding B (graph h) merges A's CRITERIA_UNCOVERED and LIMIT warnings, with g's node ids, into B's Problems list for one round trip.
suggestion: Key the kept result by project and binding id too, so only rechecks of the same binding keep the last result.
```

```text
severity: low
file: src-tauri/src/slices/praxis/graph_bindings.rs
line: 330
issue: DATA_SCHEMA messages can embed the whole payload
detail: jsonschema's error text quotes the failing instance, so a type error on a large payload puts the payload in the Problems row.
suggestion: Cap each reason's length.
```

```text
severity: low
file: src-tauri/src/slices/praxis/binding_attach.rs
line: 148
issue: The binding's entries map is cloned once per contract
detail: check_contract clones `nodes` for every contract on every keystroke check. Borrowing is enough.
suggestion: Borrow the map, falling back to an empty one.
```

```text
severity: low
file: src/slices/praxis-builder/ProblemsPanel.tsx
line: 66
issue: A warnings-only summary is drawn grey, like "No problems"
detail: The summary is red for errors and grey otherwise, so "2 warnings" doesn't stand out.
suggestion: Use the warning colour when there are warnings but no errors.
```

```text
severity: low
file: src-tauri/src/slices/praxis/binding_attach.rs
line: 112
issue: Every saved binding file is read on each attach check of a graph under a contract
detail: Costs grow with the project's binding count, up to MAX_BINDINGS_SCANNED, and the check reruns on every edit. Binding files are named by binding id, not graph, so all must be scanned to find a graph's. It is bounded, and realistic projects hold few bindings.
suggestion: Leave as is. If it shows up, read only the listed bindings whose graphId is one of the contract's graphs.
```

## Checked and fine

- The stale-digest warning compares against the graph draft's content, which is the file's
  content as read (`createGraphDraft`), so a clean graph's digest equals its pin.
- The payload check compiles `inputSchema` with the SDK's `data_validator`, which refuses
  non-local `$ref`, so no network fetch.
- Warnings never set the verdict, so a binding with only warnings saves.
- Severity rendering was swept: FieldMessages, ProblemsPanel, RunContextPanel and GraphCanvas
  all handle `warning`.

## Fixes applied after the review

- Medium, failed check shown as "no contract": `contractRows` returns no rows unless the check
  is done, an unreadable contract gets its own row, and the coverage section says when the
  check failed or a contract can't be read.
- Medium, another binding's result kept: `useBindingAttach` keys the kept result by project
  and binding id.
- Low, long payload messages: each schema reason is cut to 200 characters. A test covers it.
- Low, entries cloned per contract: borrowed.
- Low, warnings-only summary in grey: drawn in the warning colour.
- Low, every binding file read per check: left as is, as the review suggests.
