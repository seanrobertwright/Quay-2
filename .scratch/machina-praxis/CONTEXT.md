# Machina Praxis — Ubiquitous Domain Glossary (`CONTEXT.md`)

This document defines the canonical domain language for **Machina Praxis**, unifying the terminology of the **Praxis Workflow Engine** (`@aiws/engine` in `E:\Projects\AI-WS-SDK`) with the **Quay 2 Multi-Agent Cockpit** (`E:\Projects\Quay2`).

---

## 1. Core Architectural Entities

| Term | Canonical Layer | Definition |
| :--- | :--- | :--- |
| **Machina Praxis** | Quay 2 + Praxis | The local-first AI Software Factory integrated into Quay 2. It combines Praxis's deterministic workflow state machine, ledger governance, and SQLite durability with Quay 2's ConPTY multi-agent multiplexer, Git worktree isolation, and Pre-PR security auditing. |
| **Praxis Sidecar (`@aiws/engine`)** | Node 24 Daemon | A zero-npm-dependency TypeScript runtime (`node:sqlite` + native type-stripping) spawned headlessly by Quay's Rust backend via `deployment-host.ts`. Praxis never calls LLM APIs directly; it pins contracts, enforces budgets, mints leases, and verifies deliverables. |
| **Sidecar Supervisor (`PraxisSupervisor`)** | Quay Rust (`src-tauri/src/slices/machina/`) | The Tokio background supervisor in Quay 2 that manages the Node 24 child process (`CREATE_NO_WINDOW`), parses the line-1 stdout probe (`aiws-deployment-probe/1`), runs 5s liveness / 15s readiness checks, and executes Epoch-Fenced Crash Recovery. |
| **Factory Station (`FactoryStationModal`)** | Quay React (`src/slices/machina/`) | The operator cockpit (`Ctrl+B F`) inside Quay 2 providing a 3-Zone view of active Work Orders, the 6-stage Pipeline DAG, Governed Hold Cards, Two-Tier Holdback Vault diagnostics, and Stage-to-ConPTY agent bindings. |

---

## 2. Work Order & Pipeline Lifecycle Terms

| Term | Canonical Layer | Definition |
| :--- | :--- | :--- |
| **Work Order (`MachinaWorkOrder`)** | `.machina/work-orders/` & Praxis SQLite | A governed unit of software factory work (`WO-104`) bound to a specific `.machina/templates/*.json` pipeline definition, a budget allowance (`budgetAllowanceUsd`), confined `outputPaths`, and a blind holdback suite. |
| **6-Stage Factory DAG** | Pipeline Contract | The standard software factory progression: (1) *Ingestion & Admission* $\rightarrow$ (2) *Worktree & Vault Scaffold* $\rightarrow$ (3) *Agent Implementation* $\rightarrow$ (4) *Two-Tier Holdback Gate* $\rightarrow$ (5) *Correction Ordinal Loop* $\rightarrow$ (6) *Human Merge Acceptance*. |
| **Attempt (`attempt_id`)** | Praxis Engine | A single bounded execution of a pipeline stage by a claimed agent CLI. Each attempt is tagged with an `attemptKind` (`INITIAL` or `CORRECTION`) and a 1-indexed `attemptOrdinal` (`1..maxCorrections`). |
| **Correction Ordinal (`CORRECTION`)** | Praxis Engine | A structured retry attempt automatically scheduled when a stage deliverable fails Tier 1 or Tier 2 validation, up to `maxCorrections`. |
| **Epoch (`engine_meta.epoch`)** | Praxis SQLite | A monotonically increasing integer incremented on every Sidecar Supervisor startup or crash recovery. Used to fence stale attempts and revoke orphaned credential leases from prior process lifetimes. |

---

## 3. Governance, Admission & Hold Terms

| Term | Canonical Layer | Definition |
| :--- | :--- | :--- |
| **Supervised Admission (`SupervisedAdmissionService`)** | Praxis Engine | The admission gate that verifies caller identity, capability digests, and workspace/work-order exposure budgets before allowing a Work Order or Stage Attempt to proceed. |
| **Governed Hold (`aiws-hold-card/1`)** | Praxis + Quay UI | A deterministic pause state (`ON_HOLD`) triggered when an attempt hits a policy boundary: `CREDENTIAL_REQUIRED`, `PRICE_REQUIRED`, `EXPOSURE_EXCEEDED`, or `MAX_CORRECTIONS_EXCEEDED`. Rendered as an interactive banner in the Factory Station with 1-click exit options. |
| **Credential Lease (`lease_*`)** | Praxis SQLite | An ephemeral, epoch-fenced capability token or environment grant minted when an operator approves a `CREDENTIAL_REQUIRED` hold. Automatically revoked on stage completion, work order abort, or epoch bump. |

---

## 4. Two-Tier Verification & Holdback Vault Terms

| Term | Canonical Layer | Definition |
| :--- | :--- | :--- |
| **Authoring Worktree** | `.machina/worktrees/<wo_id>/` | An isolated Git worktree where the bound Author Agent implements code changes. The `.machina/holdbacks/` directory is physically stripped from this worktree prior to Stage 3 so the agent cannot read or grep holdback tests. |
| **Holdback Vault** | `%LOCALAPPDATA%\Quay2\praxis\holdbacks\<wo_id>\` | The external, SHA-256-pinned directory outside the Git repository where Quay extracts `.machina/holdbacks/` during Stage 2 scaffolding. Mounted only inside the ephemeral Stage 4 verification sandbox. |
| **Output-Path Confinement (`allowedOutputPaths`)** | Quay Git Validator | A pre-validation guard that inspects `git status --porcelain` and `git diff --name-only` in the authoring worktree, rejecting (`SCOPE_VIOLATION`) any modification outside the Work Order's declared `outputPaths` globs (preventing agents from weakening existing tests). |
| **Tier 1 Diagnostics (Raw)** | Validation Gate | Compiler, linter, and standard unit test output (`tsc`, `cargo test`, `vitest`). Passed in full (`stderr`/`stdout`) to `CORRECTION` ordinals. |
| **Tier 2 Diagnostics (Sanitized Holdback)** | Validation Gate | Behavioral invariant results from the blind Holdback Vault. Sanitized before reaching any `CORRECTION` ordinal so only the failed invariant ID/title and behavioral assertion summary are exposed—never holdback source code, line numbers, or raw test vectors. |
