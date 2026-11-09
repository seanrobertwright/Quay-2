# Code review: graph trigger host state and Revisions panel (#475)

**Stats:**

- Files Modified: 17
- Files Added: 10
- Files Deleted: 0
- New lines: about 1,920 (204 in modified files, 1,717 in new files)
- Deleted lines: 30

Reviewed the Rust digest (`host/trigger.rs` `trigger_digest`, the `praxis_trigger_digest`
command, the listing's `enabled`), the trigger host model (`triggerHost.ts`), its views
(`triggerHostStatus.ts`, `TriggerHostPanel.tsx`), the shared `HostStateLine` taken out of
`GraphHostPanel.tsx`, and the builder wiring.

## Fixed during review

```text
severity: medium
file: src/slices/praxis-builder/triggerHost.ts
line: 288
issue: a digest answer for an older revision overwrote the current revision's
detail: The model kept one digest per trigger. A listing change during a read asked for the old
  reading's revision, which superseded the new revision's ask, so the new revision was never
  compared and Differs could not show until the next listing.
suggestion: Keep digests by revision and supersede only asks for the same revision. Done, with
  the test "a saved files' digest at another revision is never compared with the current one,
  whichever answer comes last", which failed before the change.
```

```text
severity: low
file: src/slices/praxis-builder/PraxisBuilderModal.tsx
line: 450
issue: every builder session read `praxis triggers list` even with no graph trigger listed
detail: The Triggers group counted as shown whenever the builder was open, so a project with no
  trigger with a saved target still sent the host a read whose answer nothing uses.
suggestion: Treat the group as shown only once it lists a graph trigger. Done; the same flag
  gates the group header's Check host.
```

```text
severity: low
file: src-tauri/src/slices/praxis/host/trigger_digest.fixture.json
line: 2
issue: provenance named an AI-WS-SDK commit that exists only on a ticket branch
detail: The fixture was first recorded at aba5764e, which isn't on master. engine/src is
  byte-identical at master 0e7f473d.
suggestion: Record it again citing 0e7f473d. Done; the digests are unchanged.
```

## Left as is

- `triggerHost.ts` repeats the list paging, show reads, candidate poll and generation handling
  of `graphHost.ts`. A shared reader would serve both, and #477's Withdraw for triggers, but
  it would change #461's code in a ticket that doesn't need it. Worth its own refactor once
  #477 lands.
- Each new listing digests every graph trigger with a current revision again, since the listing
  carries nothing that says the saved files changed. The count is bounded by the listing cap,
  and the asks share the model's two-at-a-time limiter.

Code review passed with the fixes above. No other technical issues found.
