# M1: handoff and resumable-hold specification package

Start with [CONTRACT.md](./CONTRACT.md). It defines the candidate `aiws-handoff/1` protocol, including 18 requirement IDs, seven wire record types, ten command variants, state transitions, atomic boundaries, authority and accounting rules, and migration from SDK 0.3.0.

| File | Use |
|---|---|
| [CONTRACT.md](./CONTRACT.md) | Normative candidate and explicit open decisions |
| schema.json (not in this pack) | Closed JSON Schema Draft 2020-12; does not extend the released schema |
| fixtures.json (not in this pack) | 24 positive wire examples and 29 invalid shape mutations |
| scenarios.json (not in this pack) | 40 semantic acceptance vectors for native implementations |
| VALIDATION.md (not in this pack) | Actual M1 checks and tests still required |

From the repository root:

```sh
npm ci
npm run spec:handoff:generate
npm run spec:handoff:check
```

The generator and validator are development tools, not a workflow engine or SDK handoff implementation. Scenario actions identify semantic boundaries; M2 runners must supply explicit setup and bind them to TypeScript, Rust and Python APIs. Every vector currently says `NOT_RUN_M1`. Passing the shape/coverage check must never be reported as passing those 40 runtime scenarios.

M2 must first implement the same-run receipt/hold state machine, atomic persistence and fencing, with independent native tests. Any partial scope support must reject unsupported scope kinds before execution. M3 must resolve work-order hierarchy and multi-scope accounting with the user. The candidate includes no silent mapping from work orders to missions/runs and no command that lets an agent increase its own limits or permissions.
