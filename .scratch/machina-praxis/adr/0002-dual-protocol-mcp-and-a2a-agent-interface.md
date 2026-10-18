# ADR 0002: Dual Protocol Bridge (Loopback MCP Tools & A2A v1.3.0 Agent Card)

- **Status**: Accepted, amended by [ADR 0005](0005-quay-native-factory-engine.md) (2026-10-18)
- **Date**: 2026-10-16
- **Source Ticket**: [02: Research: A2A v1.3.0 & Loopback MCP Dual-Binding Contract](../issues/02-research-a2a-mcp-dual-binding-contract.md)

## Context

Quay 2 hosts 10 diverse AI coding CLIs (Claude Code, Antigravity, Kiro, OpenAI Codex, GitHub Copilot, OpenCode, Pi, Gemini, Grok, Aider). Interactive CLI sessions interact best with Model Context Protocol (MCP) tools, whereas autonomous multi-agent swarms delegate work over Quay's Agent-to-Agent (A2A) bus.

## Decision

1. **Loopback Axum MCP Proxy (5 Governed Tools)**: Extend Quay's embedded Axum server (`src-tauri/src/slices/orchestrator/mcp.rs`) with 5 governed tools (`machina_submit_work_order`, `machina_get_stage_status`, `machina_claim_attempt`, `machina_submit_deliverable`, `machina_resolve_hold`) that validate caller identity (`X-Quay-Terminal-Id`) and forward JSON-RPC payloads to the Praxis loopback HTTPS host.
2. **A2A v1.3.0 Peer Agent Card (`machina-praxis`)**: Register Machina Praxis as a first-class virtual peer on Quay's A2A router speaking `@a2a-js/sdk@1.3.0` (`message/send`, `tasks/get`, `tasks/cancel`) with SQLite-backed task deduplication (`a2a_inbound_tasks`).
3. **Unified Admission Fencing**: Both protocols route through Praxis's `SupervisedAdmissionService` to enforce capability digests and ledger exposure caps before stage execution.

## Consequences

- **Positive**: Every CLI agent in Quay 2 can both initiate Work Orders and claim Stage Attempts without custom per-agent plugins.
- **Negative**: Axum must maintain an internal TLS client pool to the dynamic Praxis loopback port across sidecar restarts.
