# Ticket 05: Prototype: Factory Station Cockpit UI (Ctrl+B F)

**Label**: `wayfinder:prototype`
**Mode**: HITL
**Status**: closed
**Assignee**: Antigravity
**Parent**: [Machina Praxis Map](../00-map.md)
**Blocked by**: None (Resolved [03: Spec: Sidecar Supervisor Daemon & Health Monitoring in Rust](03-spec-praxis-sidecar-supervisor-lifecycle.md), [04: Spec: Two-Tier Worktree Holdback & Correction Validation Engine](04-spec-two-tier-validation-and-holdback-engine.md))

---

## Question

How should the Machina Praxis "Factory Station" Cockpit (`Ctrl+B F`) look, feel, and behave inside Quay 2's dark design system?

Specifically:
1. **Pipeline DAG Visualization**: How does the visual pipeline represent the work order stages (Ingestion -> Scaffold -> Implementation -> Holdback Validation -> Correction Loop -> Human Acceptance)?
2. **Interactive Hold Cards**: How are Praxis governed holds (`CREDENTIAL_REQUIRED`, `PRICE_REQUIRED`, `OVERRUN_HOLD`) rendered with actionable 1-click exit buttons?
3. **Ledger & Budget Monitors**: How are exposure allowances, real-time token spend, and stop thresholds tracked per attempt and per work order?
4. **Agent Binding & Navigation**: How does the user observe which agent CLI is bound to which stage node, and seamlessly jump to its active ConPTY terminal pane?

---

## Deliverable

Interactive UI mockup and component prototype ([`src/slices/machina/FactoryStationModal.tsx`](file:///E:/Projects/Quay2/src/slices/machina/FactoryStationModal.tsx) and [`src/slices/machina/types.ts`](file:///E:/Projects/Quay2/src/slices/machina/types.ts)) matching Quay 2's Tailwind / React / Lucide iconography standards.

---

## Resolution

Built, verified (`pnpm build` passing with 0 errors), and wired the **Unified 3-Zone Factory Station Cockpit + Quick-Dispatch Composer** (`Ctrl+B F`, Left Rail button, Stage header button, and `Ctrl+K` Command Palette):
1. **Top Cockpit Header**: Displays `@aiws/engine v1.0 • Node 24 SQLite` telemetry pill (`READY` / `RESTARTING`, `Epoch #`, `PID`, `TLS 1.3 :54192`), interactive **Test Epoch Crash Recovery** simulator button, and **+ New Work Order** toggle.
2. **Left Zone — Supervised Admission Ledger & Work Order Queue**: Tracks real-time workspace spend against budget allowances, active governed holds, active epoch-bound credential leases, and 6-stage mini progress indicators per Work Order.
3. **Center Zone — Interactive 6-Stage Pipeline DAG + Governed Hold Card (`aiws-hold-card/1`) + Two-Tier Holdback Vault Inspector**:
   - Interactive 6-stage node cards (`Ingestion & Admission` -> `Worktree & Vault Scaffold` -> `Agent Implementation` -> `Two-Tier Holdback Gate` -> `Correction Ordinal Loop` -> `Human Merge Acceptance`).
   - High-visibility `aiws-hold-card/1` Governed Hold banner with 1-click exit options (`Grant Ephemeral Lease & Resume`, `Resume with Offline Mock Profile`, `Deny & Abort Work Order`).
   - Holdback Vault & Confinement Guard panel (`%LOCALAPPDATA%\Quay2\praxis\holdbacks\<id>` SHA-256 manifest, `STRIPPED FROM WORKTREE` badge, `allowedOutputPaths` scope guard) + Sanitized Tier 2 Holdback Invariant cards (`[HOLDBACK SOURCE & TEST VECTORS REDACTED]`).
4. **Right Zone — Stage ConPTY Binding Inspector & Quick-Dispatch Work Order Composer**:
   - Allows rebinding any stage to any of Quay's 10 agent CLIs (`claude`, `antigravity`, `kiro`, `codex`, `copilot`, `opencode`, `pi`, `gemini`, `grok`, `aider`), 1-click jumping/spawning the bound ConPTY pane, or dispatching the sanitized stage prompt contract over ConPTY.
   - Includes a Quick-Dispatch Work Order Composer pre-loaded with `.machina/templates/` (`feature-holdback-tdd`, `security-hardening-gate`, `autonomous-bugfix`).
