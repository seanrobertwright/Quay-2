# Wayfinder Map: Machina Praxis Software Factory

**Title**: Machina Praxis — AI Software Factory Integration for Quay 2
**Label**: `wayfinder:map`
**Status**: closed (Destination Reached)

---

## Destination

A comprehensive architectural specification and implementation blueprint (`PRD.md`, `CONTEXT.md` domain glossary, and Architecture Decision Records in `.scratch/machina-praxis/`) defining the engine supervisor lifecycle, agent protocol contracts, two-tier validation pipeline, and operator cockpit before code execution.

---

## Notes

- **Domain**: AI Software Factory, Governed Agentic Workflows, Spec-Driven Development (SDD), Multi-Agent Orchestration.
- **Foundations**: 
  - `AI-WS-SDK` / `Praxis` (`@aiws/engine`, Node 24 + SQLite) in `E:\Projects\AI-WS-SDK`.
  - Quay 2 Multi-Agent Cockpit (`E:\Projects\Quay2`).
- **Standing Preferences**:
  - Supervised Sidecar architecture (Quay Rust backend supervises Praxis daemon).
  - Dual Protocol interface (MCP tools for interactive CLI agents + A2A Agent Card for swarm peer delegation).
  - Two-tier validation with isolated Git worktrees, blind holdback suites, and automated correction ordinals.
  - Dedicated "Factory Station" Cockpit (`Ctrl+B F`) in Quay UI with interactive Praxis Hold Cards.
  - Dual storage: Project `.machina/` in git repo + central Praxis SQLite database in `%LOCALAPPDATA%\Quay2\praxis\praxis.db`.
- **Governing Skills**: `/lril-wayfinder`, `/grilling`, `/domain-modeling`, `/prototype`.

---

## Decisions so far

<!-- the index — one line per closed ticket: enough to judge relevance, then zoom the link for the detail the ticket holds -->

- [[01: Research: Praxis Engine Node 24 Packaging & Headless Sidecar Runtime]](file:///E:/Projects/Quay2/.scratch/machina-praxis/issues/01-research-praxis-engine-packaging.md) — 0 npm runtime deps via Node 24 native `node:sqlite`/type-stripping, `aiws-engine-package/1` bundle, dynamic port discovery via stdout handshake, and `%LOCALAPPDATA%\Quay2\praxis` WAL storage.
- [[02: Research: Dual Protocol Bridge Specification (MCP Tools & A2A Agent Card)]](file:///E:/Projects/Quay2/.scratch/machina-praxis/issues/02-research-a2a-mcp-dual-binding-contract.md) — Defined 5 governed MCP tools (`machina_*`), `@a2a-js/sdk` Agent Card, Axum proxying, and ledger budget validation.
- [[03: Spec: Sidecar Supervisor Daemon & Health Monitoring in Rust]](file:///E:/Projects/Quay2/.scratch/machina-praxis/issues/03-spec-praxis-sidecar-supervisor-lifecycle.md) — Defined windowless child process spawning, TLS 1.3 loopback handshake, liveness/readiness polling, and epoch-fenced crash recovery with automatic restart.
- [[04: Spec: Two-Tier Worktree Holdback & Correction Validation Engine]](file:///E:/Projects/Quay2/.scratch/machina-praxis/issues/04-spec-two-tier-validation-and-holdback-engine.md) — Vault extraction & physical stripping of `.machina/holdbacks/` during authoring, strict `outputPaths` confinement, composite holdback + Pre-PR leak validation, and tiered diagnostic sanitization for correction loops.
- [[05: Prototype: Factory Station Cockpit UI (Ctrl+B F)]](file:///E:/Projects/Quay2/.scratch/machina-praxis/issues/05-prototype-factory-station-cockpit-ui.md) — Built and wired the Unified 3-Zone Factory Station Cockpit (`src/slices/machina/FactoryStationModal.tsx`, `Ctrl+B F`) with 6-stage Pipeline DAG, `aiws-hold-card/1` Governed Hold resolution, Two-Tier Vault telemetry, Epoch Crash Recovery simulator, and Quick-Dispatch Composer.
- [[06: Spec: Machina Praxis PRD, Domain Glossary (CONTEXT.md), and ADRs]](file:///E:/Projects/Quay2/.scratch/machina-praxis/issues/06-spec-machina-praxis-prd-and-adr-bundle.md) — Synthesized [`PRD.md`](file:///E:/Projects/Quay2/.scratch/machina-praxis/PRD.md), [`CONTEXT.md`](file:///E:/Projects/Quay2/.scratch/machina-praxis/CONTEXT.md), and ADRs 0001–0004 in `.scratch/machina-praxis/adr/`.

---

## Live Tickets (The Frontier)

- [x] [01: Research: Praxis Engine Node 24 Packaging & Headless Sidecar Runtime](file:///E:/Projects/Quay2/.scratch/machina-praxis/issues/01-research-praxis-engine-packaging.md) — Closed
- [x] [02: Research: Dual Protocol Bridge Specification (MCP Tools & A2A Agent Card)](file:///E:/Projects/Quay2/.scratch/machina-praxis/issues/02-research-a2a-mcp-dual-binding-contract.md) — Closed
- [x] [03: Spec: Sidecar Supervisor Daemon & Health Monitoring in Rust](file:///E:/Projects/Quay2/.scratch/machina-praxis/issues/03-spec-praxis-sidecar-supervisor-lifecycle.md) — Closed
- [x] [04: Spec: Two-Tier Worktree Holdback & Correction Validation Engine](file:///E:/Projects/Quay2/.scratch/machina-praxis/issues/04-spec-two-tier-validation-and-holdback-engine.md) — Closed
- [x] [05: Prototype: Factory Station Cockpit UI (Ctrl+B F)](file:///E:/Projects/Quay2/.scratch/machina-praxis/issues/05-prototype-factory-station-cockpit-ui.md) — Closed
- [x] [06: Spec: Machina Praxis PRD, Domain Glossary (CONTEXT.md), and ADRs](file:///E:/Projects/Quay2/.scratch/machina-praxis/issues/06-spec-machina-praxis-prd-and-adr-bundle.md) — Closed

---

## Not yet specified

<!-- Fog of war: in-scope decisions not yet sharp enough to ticket -->

- **Cross-Agent Capability Manifest Compiler**: Automatic translation between Quay's 10 supported agent CLIs (Claude, Antigravity, Kiro, Codex, etc.) and Praxis capability digests/manifests.
- **Enterprise Dark Factory Scheduled Runs**: Headless daemon execution of recurring work orders (CVE security patches, dependency bump validation) while user is away.
- **Distributed Remote Worker Fleet**: Offloading heavy test runs or digital twin environments to external machines beyond local Windows workstation.

---

## Out of scope

<!-- Rules beyond the destination -->

- **Writing a new custom LLM harness inside Praxis**: Praxis adheres strictly to its foundational rule: Praxis orchestrates, pins, and verifies; it never calls model APIs directly.
- **Replacing Git or GitHub**: Machina Praxis uses standard Git worktrees and GitHub PRs as the delivery medium.
- **Hosted Cloud SaaS Platform**: Machina Praxis is a local-first desktop software factory for Quay 2.
