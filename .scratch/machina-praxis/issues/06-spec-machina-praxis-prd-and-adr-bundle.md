# Ticket 06: Spec: Machina Praxis PRD, Domain Glossary (CONTEXT.md), and ADRs

**Label**: `wayfinder:task`
**Mode**: AFK
**Status**: closed
**Assignee**: Antigravity
**Parent**: [Machina Praxis Map](../00-map.md)
**Blocked by**: None (Resolved [03: Spec: Sidecar Supervisor Daemon & Health Monitoring in Rust](03-spec-praxis-sidecar-supervisor-lifecycle.md), [04: Spec: Two-Tier Worktree Holdback & Correction Validation Engine](04-spec-two-tier-validation-and-holdback-engine.md), [05: Prototype: Factory Station Cockpit UI (Ctrl+B F)](05-prototype-factory-station-cockpit-ui.md))

---

## Question

Synthesize and produce the full formal architectural documentation bundle for Machina Praxis in `.scratch/machina-praxis/`, establishing the canonical reference for implementation.

Specifically:
1. `PRD.md`: Full product requirements document detailing the user stories, architecture diagrams, component breakdown, and engineering milestones.
2. `CONTEXT.md`: Ubiquitous domain language and shared glossary unifying AIWS/Praxis terminology with Quay 2 concepts.
3. Architecture Decision Records (`adr/`):
   - `0001-machina-praxis-supervised-sidecar.md`
   - `0002-dual-protocol-mcp-and-a2a-agent-interface.md`
   - `0003-two-tier-holdback-validation-pipeline.md`
   - `0004-factory-station-operator-cockpit.md`

---

## Deliverable

The canonical PRD, CONTEXT.md, and ADR bundle in `.scratch/machina-praxis/`.

---

## Resolution

Synthesized and published the complete Machina Praxis specification bundle:
- **[`PRD.md`](file:///E:/Projects/Quay2/.scratch/machina-praxis/PRD.md)** — Full Product Requirements Document, system architecture diagram, functional specifications across all 4 slices, and 4-milestone execution roadmap.
- **[`CONTEXT.md`](file:///E:/Projects/Quay2/.scratch/machina-praxis/CONTEXT.md)** — Canonical Ubiquitous Domain Glossary unifying `@aiws/engine` Praxis concepts and Quay 2 multi-agent cockpit concepts.
- **[`adr/0001-machina-praxis-supervised-sidecar.md`](file:///E:/Projects/Quay2/.scratch/machina-praxis/adr/0001-machina-praxis-supervised-sidecar.md)** — Supervised Node 24 Praxis Sidecar with Epoch-Fenced Crash Recovery.
- **[`adr/0002-dual-protocol-mcp-and-a2a-agent-interface.md`](file:///E:/Projects/Quay2/.scratch/machina-praxis/adr/0002-dual-protocol-mcp-and-a2a-agent-interface.md)** — Dual Protocol Bridge (Loopback MCP Tools & A2A v1.3.0 Agent Card).
- **[`adr/0003-two-tier-holdback-validation-pipeline.md`](file:///E:/Projects/Quay2/.scratch/machina-praxis/adr/0003-two-tier-holdback-validation-pipeline.md)** — Two-Tier Worktree Holdback Vault & Sanitized Correction Loop.
- **[`adr/0004-factory-station-operator-cockpit.md`](file:///E:/Projects/Quay2/.scratch/machina-praxis/adr/0004-factory-station-operator-cockpit.md)** — Unified 3-Zone Factory Station Operator Cockpit (`Ctrl+B F`).
