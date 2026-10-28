# Architecture and workflow diagrams

> **Praxis naming:** This page documents **Praxis**, the AIWS workflow engine. Existing `engine/*` source paths, `/engine/...` routes, `aiws-engine/*` protocol identifiers, and existing script names remain unchanged for compatibility.


The interactive diagrams were first generated from the repository at commit `13f323f` with Archify. Each one is a self-contained page with light and dark themes, pan and zoom, search, relationship tracing, guided views and PNG or SVG export. The architecture pages link their nodes to the source files on GitHub. Use a diagram inside its frame, or open it full screen for the complete toolbar.

The JSON source of every diagram lives beside it under `docs/diagrams/` in the repository, together with the regeneration commands and the browser evidence from the last delivery.

## Facts the diagrams encode

- The engine under `engine/src` imports only Node built-ins. It does not depend on the SDK packages.
- The static control API accepts four commands: approve, pause, resume and cancel. The eleven governed dynamic-workflow decisions ride a separate `/engine/dynamic/v1/requests` plane.
- OTLP export is an SDK capability. The engine keeps a bounded telemetry queue but contains no OTLP code.
- A timeout, signal or null exit code is classified UNKNOWN on every platform. Only the signed Windows native helper can prove self-termination.
- The push and pull-request path of the native helper workflow builds and probes but never signs or uploads. Signing happens only on manual dispatch, and platform qualification is a manual step on a native Windows host.
- Every platform-matrix cell remains UNVERIFIED.

## System overview

The host application, the three native SDKs, the shared spec, the self-contained engine, this documentation site, CI and the signed Windows helper. Read with [engine decisions and implementation boundary](./engine-design.md) and the [capability matrix](./capabilities.md).

**Diagram: System Overview** (not in this pack). Host application, three native SDKs, shared spec, self-contained engine, docs site, CI and the signed Windows helper.

## Governed coding workflow

Human approval, implementation, validation, pinned evidence, bounded correction, holds and human resume. Read with [run a governed coding workflow](./engine-coding-workflow.md).

**Diagram: Governed Coding Workflow** (not in this pack). Human approval, implementation, validation, pinned evidence, bounded correction, holds and human resume.

## Control API decision lifecycle

Inspect, approval challenge, single-transaction command, receipt and exact-retry replay. Read with [engine API, CLI and web controls](./engine-control-api.md).

**Diagram: Control API Decision Lifecycle** (not in this pack). Inspect, approval challenge, single-transaction command, receipt and exact-retry replay.

## Coding work order lifecycle

The five `CodingStatus` values, bounded correction, holds and cancellation. Read with [run a governed coding workflow](./engine-coding-workflow.md) and [validation and correction](./engine-validation-correction.md).

**Diagram: Coding Work Order Lifecycle** (not in this pack). The five CodingStatus values, bounded correction, holds and cancellation.

## Engine internals

Control plane, identity adapter, runner, bounded storage executor, SQLite worker thread, clock gate and telemetry queue. Read with [engine decisions and implementation boundary](./engine-design.md) and [SQLite persistence and recovery tests](./engine-persistence.md).

**Diagram: Praxis Internals** (not in this pack). Control plane, identity adapter, runner, bounded storage executor, SQLite worker thread, clock gate and telemetry queue.

## Observability export pipeline

Event and trace intent committed together, leased outbox, OTLP/HTTP export, retained failures and alerts. Read with [observability, metrics and OTLP delivery](./observability.md).

**Diagram: Observability Export Pipeline** (not in this pack). Event and trace intent committed together, leased outbox, OTLP/HTTP export, retained failures and alerts.

## Windows native helper pipeline

Build and probe on push or pull request, Azure Artifact Signing and Authenticode verification on manual dispatch, then manual qualification on a native Windows host. Read with [deployment and platform qualification](./engine-deployment-platforms.md).

**Diagram: Windows Native Helper Pipeline** (not in this pack). Build and probe on push or pull request, Azure Artifact Signing and Authenticode verification on manual dispatch, manual qualification.

## Operation effect lifecycle

PREPARED, DISPATCHED, SUCCEEDED and CONFIRMED_APPLIED; UNKNOWN reconciliation, retry after CONFIRMED_NOT_APPLIED and epoch fencing. Read with [effects, operation identities and retries](./effects.md) and [recovery](./recovery.md).

**Diagram: Operation Effect Lifecycle** (not in this pack). PREPARED, DISPATCHED, SUCCEEDED and CONFIRMED_APPLIED; UNKNOWN reconciliation, retry after CONFIRMED_NOT_APPLIED and epoch fencing.

## Worker dispatch lease

Claim under the clock gate, supervised admission, acknowledge, execute without a shell and classify the outcome. Read with [worker dispatch and coding execution](./engine-worker-execution.md).

**Diagram: Worker Dispatch Lease** (not in this pack). Claim under the clock gate, supervised admission, acknowledge, execute without a shell and classify the outcome.

## Engine backup and restore

Checkpoint, sealed manifest, atomic publication, host-verified restore, RESTORE HOLD and human activation. Read with [engine backups and same-machine restore](./engine-backup-restore.md).

**Diagram: Praxis Backup and Restore** (not in this pack). Checkpoint, sealed manifest, atomic publication, host-verified restore, RESTORE HOLD and human activation.

## M9 protocol architecture package

M9.10 adds scalable SVG maps. These are intentionally visual documentation assets rather than Mermaid/ASCII diagrams.

### Protocol system map

Praxis protocol interoperability architecture (not in this pack)

### MCP / A2A / AG-UI mapping

Protocol mapping across MCP, A2A and AG-UI (not in this pack)

### Durable identity and registry

Durable protocol identity and registry (not in this pack)

### UNKNOWN and recovery

UNKNOWN and recovery lifecycle (not in this pack)

Read [Praxis protocol interoperability](./engine-protocol-interoperability.md), [protocol operations and recovery](./engine-protocol-operations.md) and M9 completion and compatibility (not in this pack) with these maps.

## Regenerating a diagram

Each `docs/diagrams/<name>.<type>.json` file is the source of truth. After editing one, validate and deliver it with the Archify CLI, then run the browser check. Architecture pages need `--repo-root` because they carry source-file evidence.

```sh
node <archify>/bin/archify.mjs validate <type> docs/diagrams/<name>.json --quality showcase [--repo-root .]
node <archify>/bin/archify.mjs deliver  <type> docs/diagrams/<name>.json docs/diagrams/<name>.html --quality showcase [--repo-root .]
node <archify>/bin/archify.mjs visual-check docs/diagrams/<name>.html
```

The site build copies the delivered HTML from `docs/diagrams/` into `public/diagrams/`, so a regenerated diagram appears here after the next `npm run build` or `npm run dev`. Adding a diagram means adding its entry to `docs/diagrams/index.json` and a section on this page.
