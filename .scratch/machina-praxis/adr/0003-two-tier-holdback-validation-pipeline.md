# ADR 0003: Two-Tier Worktree Holdback Vault & Sanitized Correction Loop

- **Status**: Accepted
- **Date**: 2026-10-16
- **Source Ticket**: [04: Spec: Two-Tier Worktree Holdback & Correction Validation Engine](../issues/04-spec-two-tier-validation-and-holdback-engine.md)

## Context

In autonomous AI software factories, coding agents given unrestricted shell access inside a repository can inspect test files, hardcode expected test vectors, or weaken existing unit tests ("reward hacking"). At the same time, when a legitimate failure occurs, the agent needs actionable diagnostic feedback to self-correct within a bounded retry loop.

## Decision

1. **External Holdback Vault & Physical Stripping**: During Stage 2 worktree scaffolding (`.machina/worktrees/<wo_id>/`), Quay hashes `.machina/holdbacks/` (`sha256`), extracts the files to `%LOCALAPPDATA%\Quay2\praxis\holdbacks\<wo_id>\`, and **physically deletes** `.machina/holdbacks/` from the authoring worktree before any agent claims Stage 3.
2. **Strict Output-Path Confinement**: Before running Stage 4 verification, Quay checks `git status --porcelain` against the Work Order's `outputPaths` globs. Modifications outside `outputPaths` (such as edits to existing repo test files) are rejected (`SCOPE_VIOLATION`) and reverted.
3. **Composite Verification Sandbox**: Stage 4 clones the confined diff into an ephemeral verification sandbox, mounts the Holdback Vault, and executes Tier 1 build/unit checks, Tier 2 blind holdback suites, and Quay's Pre-PR Secret/Leak Audit (`run_pre_pr_audit`).
4. **Tiered Diagnostic Sanitization**: Tier 1 failures pass full `stderr`/`stdout` to `CORRECTION` ordinals; Tier 2 holdback failures are sanitized to expose only the failed invariant ID/title and behavioral assertion summary, redacting holdback source code and raw test vectors.

## Consequences

- **Positive**: Eliminates test-reading and test-tampering reward hacking while preserving high-signal self-correction loops.
- **Negative**: Adds lightweight filesystem copy overhead when initializing the ephemeral Stage 4 verification sandbox.
