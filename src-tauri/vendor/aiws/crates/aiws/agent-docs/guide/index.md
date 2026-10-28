# AI Workflow Standard

Build workflows whose authority, spending, external effects and outcomes remain inspectable. SDK 0.4.0 implements the finite-v1 profile of our AIWS-001 edition 0.4 proposal in native TypeScript, native Rust and native Python.

All three libraries include trigger admission, every node kind, SQLite persistence, authorization hooks, recovery fencing and audit replay. Shared scenarios compare the exact state after every accepted and rejected step.

[Understand the standard](./standard.md) · [Start with the examples](./quickstart.md) · [Read the implementation profile](./profile.md) · Download the standard (not in this pack)

## Implementation handbook

Follow a complete coordinator tutorial, then use the task-focused chapters for authorization, exact accounting, external effects, scheduling, every node kind, verification and recovery. Every worked application example has synchronized TypeScript, Rust and Python tabs. The source implements every recipe, in all three languages, as an executable program, and the documentation checks run every one.

- [What the AI Workflow Standard requires](./standard.md) and the research behind it (not in this pack)
- [Application tutorial](./tutorial.md) and [example cookbook](./cookbook.md)
- [Interactive architecture and workflow diagrams](./diagrams.md) of the SDKs, Praxis and delivery pipeline
- [Native API reference](./api-reference.md) and [every wire command and record](./wire-reference.md)
- [Handoff mechanism](./handoffs.md) and [accepted Praxis design decisions](./engine-design.md)
- [Agent integration](./agents.md), plain-text index (not in this pack) and complete plain-text guide (not in this pack)
- Download the implementation handbook (not in this pack)
- Download the engine handoff design (not in this pack)

Handoff delivery ships in the SDK 0.4.0 packages; the scoped local engine is available from source. M6 is complete only for the approved D-M6-01 supervised Windows 11 x64 / Node 24 / local SQLite developer profile; M7 scoped local acceptance is complete. M8 release qualification (not in this pack) is active; its chapter records which qualification slices are complete. The [capability matrix](./capabilities.md) identifies which behavior the SDK packages provide, which the application must supply, and which remains engine design work.

## Downloads

- Complete source, all three SDKs and Astro docs — ZIP (not in this pack)
- TypeScript package — TGZ (not in this pack)
- Rust library package — CRATE (not in this pack)
- Python package — WHEEL (not in this pack)
- Python source distribution (not in this pack)

The standard is a proposal. Application conformance also depends on the identity, policy, credentials, adapters and evidence assessment supplied by its operator. These packages are available here; they have not been published to npm, crates.io or PyPI.

All three SDKs include correlated control events, metrics, alert evaluation and durable OTLP/HTTP JSON export. [Configure observability](./observability.md).
