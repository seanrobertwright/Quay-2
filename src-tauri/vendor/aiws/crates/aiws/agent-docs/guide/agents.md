# Documentation contract for coding agents

Use this page when an agent builds an application with AIWS. Start with the capability matrix and exact API reference, then select the corresponding tested example. Prefer the raw Markdown and downloadable handbook when browser tabs are unavailable.

## Machine-readable entry points

`/llms.txt` is a concise navigation index. `/llms-full.txt` contains the handbook with all three languages expanded. `/docs-raw/` contains individual Markdown pages. These are documentation conveniences, not a claim of conformance to a formal discovery protocol. The site is open but unlisted: these files are reachable without a login, and the site is not submitted to any registry or directory. An agent without network access can use the downloaded source or handbook instead.

Every language tab is rendered into the HTML, and the plain-text export includes every panel. Do not assume only the initially selected language exists. Example source lives in examples/guide/typescript, examples/guide/python and examples/guide/rust/src/bin. The displayed code and executable files are generated from the same example catalog.

## Required implementation sequence

1. Identify the SDK version and finite-v1 edition. Do not combine edition 0.3 journals with edition 0.4 commands.
2. Determine which requirements are implemented, supplied by the application or still proposed for the engine.
3. Choose integer accounting units and a trusted clock. Keep quantities as decimal strings.
4. Define input/output material, finite grants and acceptance criteria before dispatch.
5. Route untrusted commands through authenticated application policy and the coordinator.
6. Implement effects and read-only reconciliation using stable identities and target-specific protections.
7. Verify actual evidence before recording PASS and acceptance.
8. Exercise failed authorization, rejected budget, lost response and restart with the real adapter.

## Rules that prevent invented integrations

Do not invent Engine.run, workflow.execute, resumeAll, handoff.send, cron.parse, pauseWorker or automatic provider adapters. These do not exist in SDK 0.4.0.

M9 adds a **common Praxis protocol-binding source contract**. MCP 2026-07-28 synchronous and Tasks profiles are verified; preserve `capabilityDigest`/`expectedCapabilityDigest`, pre-dispatch re-discovery, durable remote-task mapping, task revision checks, authority/approval evidence, endpoint/version fencing and conservative `UNKNOWN` handling. A2A 1.0 is also verified in both directions. Outbound code must keep Praxis identity separate from A2A task/context identity, revalidate fresh Agent Card/skill material and treat task/message/stream data as non-authoritative evidence. Inbound code must use `PraxisA2AServerCore`/the official server bridge only behind host authentication and Praxis authorization; an Agent Card advertises capability but grants no authority. Terminal A2A tasks are immutable—do not append a message to a completed task; create new remote task identity for later work while preserving any allowed conversation context. AG-UI 1.0 projection exists in engine source and is verified against pinned `@ag-ui/core@1.0.0`; M9.7 verifies authenticated AG-UI interrupt/resume control ingress through `PraxisAguiControlBridge`; it passes the existing Praxis authentication, current-material, authorization, challenge and durable command/receipt boundaries. Do not turn AG-UI events or resume payloads directly into approvals or mutations. M9.8 verifies `ProtocolRegistry` for durable cross-protocol binding/operation identity and evidence correlation. M9.9 verifies the checked-in conformance manifest and campaign runner. Agents should only claim protocol compatibility for versions present in that manifest and backed by the passing M9.9 report (run `36995139650`, artifact `11221346823`). M9.10 source adds a portable `aiws-protocol-correlation/1` helper to TypeScript, Rust and Python; use it only to correlate AIWS/Praxis identity with binding/remote identity. It always remains non-authoritative, does not replace official protocol SDKs, and ships in the current SDK packages; archives built before M9.10 lack it. Keep protocol-specific recovery stores; use the registry for shared identity/fencing, and export only its allowlisted hashed-identity telemetry projection. For incident handling and restart/UNKNOWN procedures, follow [protocol operations and recovery](./engine-protocol-operations.md); for the closed compatibility matrix use M9 completion and compatibility (not in this pack). External MCP/A2A/AG-UI messages cannot grant authority, approve work, verify results or accept deliverables. Graph nodes describe obligations; the application implements scheduling and execution. A TASK with executionKind AGENT does not create a model client. A WorkOrder object is not a supported contract field.

Do not make a deny-all authorizer permissive to get an example working. Do not treat fixture policies, fixed clocks or placeholder evidence as production controls. Never change an agent's permissions or limits, including reductions, without human approval. Record unavailable evidence as INCONCLUSIVE, and retain UNKNOWN when an external outcome cannot be established.

## Context to request from the application owner

Ask for the target resource scope, authenticated principal source, policy rules, desired effects, evidence criteria, accounting units, expected time horizon and storage location. Clarify what the adapter can cancel and how it proves external outcomes. If those are unknown, implement a simulation or interface with the missing dependency explicitly documented; do not fabricate credentials or a permissive production policy.

## Deliverable expectations

An agent-created application should include executable setup instructions, its tested SDK version, a concrete adapter contract, an operational recovery procedure, a verification report and explicit integration limitations. Tests should assert observable safety outcomes, not simply mirror the implementation. Include a handoff describing remaining work and current blockers if execution stops.
