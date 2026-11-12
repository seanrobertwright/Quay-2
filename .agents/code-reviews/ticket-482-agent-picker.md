# Code review: catalog agent picker for Runs as and workflow templates (#482)

**Stats:**

- Files Modified: 8
- Files Added: 10 (this review included)
- Files Deleted: 0

Reviewed the Rust read (`host/outcome.rs` `Verb::Agents`, `host/commands.rs`
`praxis_host_agents`, its registration in `lib.rs`), the recorder and its recorded outputs, the
picker module (`agentPicker.ts`), the shared field (`AgentIdField.tsx`), the hook
(`useAgentPicker.ts`), the two forms and the builder wiring, and the feature doc.

## Fixed during review

```text
severity: low
file: src/slices/praxis-builder/TemplateForm.tsx
symbol: the file's opening comment
issue: the comment said the Agent field alone reads a host
detail: The form also shows the template's host state and its runs, so "alone" was wrong.
suggestion: Say only that the Agent field takes its suggestions and warnings from the agent
  picker. Done.
```

## Checked and left as they are

```text
severity: low
file: src/slices/praxis-builder/agentPicker.ts
symbol: createAgentPickerReads
issue: a reread can join a `praxis agents` process that an earlier read started
detail: The runner shares identical reads in flight (`PraxisCli::cancel` keeps the process while
  another identical call waits on it). A reread sent while the cancel of the read before it is
  still on its way may be answered by that earlier process, so its answer can be a moment older
  than the press. The answer is still the host's, and the next check reads again.
suggestion: None. Leaving the runner's sharing alone keeps every host read on one rule.
```

```text
severity: low
file: src/slices/praxis-builder/agentPicker.ts
symbol: agentSuggestions
issue: a field suggests at most MAX_AGENT_SUGGESTIONS ids
detail: With a catalog larger than the cap, the project's own ids fall off the end of the list.
  Warnings read the whole catalog, so they are not affected, and the field stays free text.
suggestion: None for now. The cap is documented in the feature doc.
```

No logic, security or performance issue was found. The picker's warnings are built apart from
the record's validation issues and never reach the verdict that allows a save.
