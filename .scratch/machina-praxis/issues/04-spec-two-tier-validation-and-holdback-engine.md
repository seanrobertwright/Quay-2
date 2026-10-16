# Ticket 04: Spec: Two-Tier Worktree Holdback & Correction Validation Engine

**Label**: `wayfinder:grilling`
**Mode**: HITL
**Status**: closed
**Assignee**: Antigravity
**Parent**: [Machina Praxis Map](../00-map.md)
**Blocked by**: None (Resolved [01], [02])

---

## Question

How does Machina Praxis coordinate the two-tier verification gate—provisioning isolated git worktrees, executing implementation nodes, evaluating blind holdback tests, and triggering automated correction loops?

Specifically:
1. **Worktree Provisioning**: How are ephemeral worktrees (`.machina/worktrees/<work_order_id>/`) scaffolded with clean attempt environments (platform baseline only, no ambient variables)?
2. **Blind Holdback Test Storage & Isolation**: How are validation suites hidden from the authoring agent during the implementation stage node to prevent overfitting?
3. **Validation Stage Execution**: When the implementation node emits an artifact digest handoff, how is the validation node dispatched (whether headless test runner, linters, or a distinct verification agent)?
4. **Correction Ordinal Loop**: When validation fails, what exact failure context (test diffs, stderr, compiler output) is passed to the correction ordinal node, and what is the policy for attempt limits and backoff?

---

## Deliverable

Architectural specification for the Two-Tier Worktree Holdback & Automated Correction loop in Machina Praxis.

---

## Resolution

### 1. Ephemeral Worktree Provisioning & Vault Extraction
- **Worktree Creation**: When a work order enters `IMPLEMENTATION`, Quay provisions an isolated Git worktree at `.machina/worktrees/<work_order_id>/` branched from the target base ref.
- **Clean Attempt Environment**: ConPTY / worker processes spawned for the attempt receive strictly the AIWS Platform Baseline environment (`PATH`, `HOME`, `USERPROFILE`, `SYSTEMROOT`, `TEMP`, `TMP`, plus Windows process baseline variables) and any explicitly leased HC-09 credential. Zero ambient host variables or secrets are inherited.
- **Physical Holdback Stripping**: Prior to granting the attempt claim lease, Quay computes the SHA-256 manifest of `.machina/holdbacks/<work_order_id>/` (or shared `.machina/holdbacks/`), copies the suite into Praxis's protected vault at `%LOCALAPPDATA%\Quay2\praxis\holdbacks\<work_order_id>\`, and physically removes `.machina/holdbacks/` from the `.machina/worktrees/<work_order_id>/` working tree. Even an agent running unconstrained shell commands in `skip` mode cannot read or grep the holdback suite.

### 2. Strict Output-Path Confinement & Composite Validation Gate
- **Output-Path Confinement**: When `machina_submit_deliverable` is called, Quay inspects the worktree diff (`git status --porcelain`). Any modifications, additions, or deletions outside the work order's reviewed `outputPaths` (such as weakening existing unit tests, editing linter rules, or altering build configs) are automatically reverted and flagged as a `SCOPE_VIOLATION` before validation begins.
- **Composite Validation Execution**:
  1. **Holdback Overlay**: The protected holdback suite from `%LOCALAPPDATA%\Quay2\praxis\holdbacks\<work_order_id>\` is verified against its pinned SHA-256 digest and mounted into an isolated validation sandbox alongside the deliverable artifacts.
  2. **Deterministic Verification**: Executes the work order's `validation: string[]` command array (typecheck, linters, unit tests, and blind holdback suite).
  3. **Built-in Security Gate**: Automatically runs Quay's Pre-PR Secret & API-Key Leak Audit (`run_pre_pr_audit`) against the deliverable diff.
  4. **Optional Adversarial Reviewer**: Supports binding a distinct catalog agent (e.g., a dedicated review agent) to the `VALIDATION` stage node to evaluate semantic adherence to `criteriaRef`.

### 3. Correction Ordinal Loop & Tiered Diagnostic Sanitization
- **Holdback Re-Stripping**: Before transitioning from a failed `VALIDATION` stage to `CORRECTION` (Ordinal $1 \dots N$), the mounted holdback files are immediately purged from the worktree.
- **Tiered Diagnostic Envelope**:
  - **Tier 1 (Standard Build / Linter / Repo Unit Tests / Leak Audit)**: Full compiler errors, stack traces, line numbers, and `stderr` are passed to the `CORRECTION` stage so the agent can resolve syntax, typing, and regression errors without friction.
  - **Tier 2 (Blind Holdback Failures)**: Output is sanitized by stripping holdback file paths, source code snippets, and raw secret input/output literals. The agent receives only the failed invariant name and behavioral contract description (e.g., `Holdback Invariant Failed: [rate_limit_window_boundary] — Expected burst exceeding limit within 1000ms window to return 429`), forcing root-cause logic fixes rather than literal overfitting.
- **Bounded Retries & Hold Escalation**: Each failed validation increments the correction ordinal (`1..maxCorrections`). If `ordinal >= maxCorrections`, Praxis transitions the work order to `HELD` (`MAX_CORRECTIONS_EXCEEDED`) and emits an `aiws-hold-card/1` to the Quay Factory Station Cockpit for human intervention.

