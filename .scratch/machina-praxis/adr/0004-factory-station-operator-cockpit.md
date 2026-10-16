# ADR 0004: Unified 3-Zone Factory Station Operator Cockpit (`Ctrl+B F`)

- **Status**: Accepted
- **Date**: 2026-10-16
- **Source Ticket**: [05: Prototype: Factory Station Cockpit UI (Ctrl+B F)](../issues/05-prototype-factory-station-cockpit-ui.md)

## Context

Operators supervising multiple concurrent Work Orders need immediate visibility into Praxis sidecar health, workspace ledger spend, pipeline stage progression, governed holds (`aiws-hold-card/1`), blind holdback invariant results, and which ConPTY agent terminal is bound to each stage.

## Decision

Implement and wire the **Unified 3-Zone Factory Station Cockpit** (`src/slices/machina/FactoryStationModal.tsx`) accessible via `Ctrl+B F`, the Left Rail, the Stage Header, and the `Ctrl+K` Command Palette:
1. **Top Telemetry Bar**: Displays live Praxis sidecar status (`READY`/`RESTARTING`, `Epoch #`, `PID`, `TLS 1.3`), an interactive Epoch Crash Recovery trigger, and the `+ New Work Order` toggle.
2. **Left Zone (Queue & Ledger)**: Displays the `SupervisedAdmissionService` spend meter, active hold/lease counters, and the selectable Work Order queue with 6-stage mini progress bars.
3. **Center Zone (6-Stage DAG, Governed Hold Card & Vault Inspector)**: Renders clickable cards for all 6 factory stages, an interactive `aiws-hold-card/1` banner with 1-click hold resolution buttons, and side-by-side Tier 1 (raw) and Tier 2 (sanitized holdback) validation inspectors.
4. **Right Zone (ConPTY Agent Binding & Quick-Dispatch Composer)**: Allows rebinding any stage to any of Quay's 10 agent CLIs, 1-click jumping/spawning the bound ConPTY terminal, dispatching stage contracts over ConPTY, or composing new Work Orders from `.machina/templates/`.

## Consequences

- **Positive**: Operators can triage holds, inspect sanitized holdback diagnostics, and jump to active agent terminals from a single screen without context switching.
- **Negative**: Requires a wide viewport (`max-w-[1380px]`) for optimal 3-zone density.
