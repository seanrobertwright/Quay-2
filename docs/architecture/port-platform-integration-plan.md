# Quay 2 + Praxis + Open Platform: integration program (PROPOSAL)

Status: Proposed; owner architecture approval required before implementation.
Created: 2026-10-25.
Tracking rule: Do not treat this document as completion of Quay, AIWS, Praxis M8/M10, or existing Wayfinder tickets. Existing repository plans and ADRs remain authoritative until explicitly amended.

## Goal
Deliver a local-first open-source agentic engineering platform: Quay 2 as desktop cockpit, Praxis (AI-WS-SDK) as governed workflow authority, and independently deployable catalog/context/connectors for later browser/team use. Preserve Quay's terminal/worktree/testing functionality and Praxis's autonomous roadmap.

## Confirmed baseline and conflicts
- Quay: Rust/Tauri 2 + React 19, local agent/ConPTY, MCP peer bus, GitHub support, Machina factory. Accepted ADR 0005 (2026-10-18) selects Quay-native JSON-backed factory and defers Praxis sidecar. Do **not** misrepresent existing Machina as Praxis.
- Quay active work: Praxis visual builder Wayfinder #227, builder UX decision #248, security #229 (CSP), engineering hygiene #233, and other bug/tutorial tracks.
- AI-WS-SDK: standard + TS/Rust/Python SDK 0.4.0, Praxis local Node 24/SQLite execution, M9 interoperability done in scoped profile; M8 platform qualification active; M10 model binding in progress, slice 5 reported complete on 2026-10-24; open engine/CLI/templates issues #247, #276–284 and M12-related planning #270.
- Both projects already own overlapping workflow concepts. No second authoritative execution, approval or spend ledger may be introduced.
- Commercial Port feature parity is NOT a prerequisite for a useful initial local product.

## Component ownership (target)
| Domain | Authority/implementation |
|---|---|
| Work order state, acceptance, approval, exposure, effect uncertainty, audit | Praxis only for Praxis-governed workflows |
| Terminals, worktrees, agent process invocation, verification adapters, Git changes | Quay |
| Catalog entities/relations, provenance, cross-project search | New independent context service |
| GitHub ingestion, webhook replay, reconciliation | New connector worker; Quay existing GitHub UI can be reused |
| Desktop UI | Quay; separate web client later |
| Organization/user auth | New platform identity/OIDC service; trusted adapters into Praxis |
| Model binding and native engine support | AI-WS-SDK milestone owners, not Quay duplicates |

## Design constraints
1. Local-first Windows developer profile first. No claim of unattended production, multi-tenant isolation, arbitrary distributed execution, or M8 qualification.
2. Do not replace ADR 0005 immediately. Maintain Machina behavior in parallel until migration semantics and recovery are verified; feature-flag new Praxis integration.
3. Pin AI-WS-SDK commit/release and protocol versions. Only use documented control APIs; no direct SQL writes to Praxis.
4. Reject unauthorized work at the Praxis boundary; never promote UI/A2A/MCP messages to human approval. Preserve UNKNOWN and reservation during ambiguous effects.
5. Contract test startup, TLS/mTLS or authenticated local trust, caller identity, workspace containment, retries, restarts, holds, revocations, and evidence correctness.
6. Catalog records retain source, timestamp, tenant scope and reconciliation status. Do not treat inferred relations or agent output as verified facts.
7. A separate service must work while the desktop is closed; avoid relying on Quay Tauri as a cloud API.
8. Keep public Quay AGPL-3.0 obligations and private AI-WS-SDK IP/publication rights explicit; no source import or relicensing without license review.

## Workstream A — existing Quay (continue independently)
- Finish critical security/quality fixes first (notably CSP #229 and lint #233).
- Continue Wayfinder #227 Praxis visual builder, but use versioned AIWS schema/definition contract; editing UI must not invent executable semantics.
- Stabilize Machina Rust worktree, gate and Git adapters behind interface; capture existing tests and regression fixtures.
- Label the existing native factory as Machina, not certified Praxis, until actual adapter runs exist.

## Workstream B — existing AI-WS-SDK (continue independently)
- Maintain M8 Q02-Q07 qualification gates and scoped support claims.
- Continue M10 remaining slices/credential-cost controls and M11/M12/finite-v1 general graph and CLI/templating work according to their owners' plans.
- Identify the minimum stable external APIs for a Quay integration; any missing APIs belong on the AI-WS-SDK roadmap, not copied into Quay.
- Add an externally consumable compatibility contract and deterministic fixture suite before expanding surface.

## Workstream C — integration (new, gated; no coding until Architecture Gate I0)
I0: Contract reconciliation and ADR — map Quay Machina states/holds, git effects, cost and recovery against exact Praxis work-order/attempt/event/approval states; map existing Quay visual-builder work. Decide ADR 0005 amendment and authority cutover. Gate: reviewed behavior table, no unrepresentable state silently converted.
I1: Read-only adapter — Quay displays real Praxis work orders/holds/evidence from pinned engine profile, with authentication and no write APIs. Gate: disconnected/restarted/unauthorized tests and zero false success.
I2: Governed single work order — Quay submits a reviewed plan, human approves through Praxis, Quay executes one worktree operation and provides verification evidence, Praxis settles and accepts. Gate: real Git/agent path, negative-path tests including UNKNOWN, changed plan, crash and stale result; no mocked approval.
I3: Cutover and migration — distinguish legacy Quay-native work orders from Praxis-governed work orders, no silent JSON-to-SQLite conversion; explicit migration or archive procedure and operator action. Gate: rollback, crash recovery, ledger/evidence reconciliation.
I4: Catalog MVP — independent service, Postgres initially, repository/project/owner/team/relation and provenance, GitHub incremental ingestion; render catalog in Quay. Gate: idempotent webhook replay, permission filtering, stale-source indicators, delete and ownership changes.
I5: Workflow actions + visual builder — bind catalog actions and templates to versioned Praxis definitions (respect engine general graph maturity). Gate: round-trip authoring/validation, permission-specific views, changed definition invalidates approvals.
I6: Shared browser/team deployment — OIDC, tenancy, secrets, event projection, service auth and deployment hardening. Gate: multi-user authorization/tenant isolation testing, backups and M8 named-profile qualification prerequisites.
I7: Port-like expansion — service scorecards, plugin ecosystem, dependency intelligence, natural-language agent with approval; measure against Port capability matrix.

## Initial vertical slice
Connect a GitHub repository, display metadata and ownership in Quay, select 'analyze and propose improvement', submit Praxis-governed work order, human approves reviewed model/tools/plan, Quay terminal executes in worktree, run tiered verification, show immutable result/evidence, human accepts, optionally open PR. A local user with Windows/WSL2 can complete the slice without an external hosted platform.

## Definition of done for each increment
- PR has scope and source commit pins; test cases/negative paths; exact commands/results; docs and screenshots if UI; limitations and security review; acceptance evidence.
- Source and regression tests for changed repo pass; cross-repo contract tests pin both commit SHAs.
- Do not mark a milestone complete or move another project's gates based on design alone.
- No direct commits to main from this proposal. Owner review and feature branch/PR for implementation.

## Immediate next tickets (proposed)
1. Quay: I0 Machina ↔ Praxis state, effects, authority, and recovery compatibility matrix.
2. AI-WS-SDK: minimal external control/definitions/observations API inventory and pinned schema contract for Quay.
3. Quay: test harness for Machina current behavior, real Git worktree/holdback fixtures.
4. Joint: ADR reviewing 0005 and the visual builder #227 ownership.
5. New platform: catalog MVP entity schema and GitHub connector threat model.
