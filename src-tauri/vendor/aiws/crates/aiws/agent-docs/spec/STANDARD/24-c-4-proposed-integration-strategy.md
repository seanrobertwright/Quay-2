# C.4 Proposed integration strategy

These are design candidates, not normative bindings delivered by this edition.

| Existing specification family | Candidate reuse | Additional AIWS obligation |
|---|---|---|
| BPMN / CMMN / DMN | Business process, case structure, and deterministic decisions | Intent/evidence contract and governed dynamic changes |
| Open Workflow | Execution constructs and reusable conformance patterns | Authority and outcome enforcement at the selected runtime boundary |
| MCP | Tool and context access | Versioned extension requirements, dispatch authorization, effect reconciliation |
| A2A | Remote task interaction | Parent-child lineage, attenuated authority, binding-specific resend guarantees |
| AG-UI | Human-facing interaction events | Attributable, scoped, expiring approval records |
| OpenTelemetry | Operational traces and metrics | Complete, protected authoritative control ledger |
| Arazzo / OpenAPI / AsyncAPI | API workflow and interface descriptions | Workflow intent, authority, and external-effect obligations |
| Agent Spec / OASF | Agent configuration and capability descriptions | Enforced eligibility and semantic mapping; declared capability does not grant authority |

# Annex D — Sources and review boundary (informative)

Primary sources were initially accessed on 7 September 2026; AG-UI was refreshed to its released 1.0 specification on 1 October 2026. Links to `latest` or `main` pages are mutable; implementers must pin the actual revision before claiming a binding. The sources below support the narrow landscape observations in Part A. The normative AIWS requirements are original proposed design requirements, not statements that the cited organizations already impose them.

| Source | Primary reference | Use in this review |
|---|---|---|
| S0 | Supplied `deep-research-report.md`, *Workflow Standards for AI and Agentic Systems*, 4 September 2026 | Complete research basis and design proposal reviewed. |
| S1 | [AAIF Workflows & Process Integration charter](https://github.com/aaif/wg-workflows-and-process-integration/blob/main/charter/charter.md) | Scope, dependencies, work products, and distinction between primary artifacts and stretch-goal specifications. |
| S2 | [A2A Protocol specification](https://a2a-protocol.org/latest/specification/) — sections on idempotency, task states, and bindings | Terminal versus interrupted states; optional send-message idempotency; protocol boundary. |
| S3 | [MCP specification, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28) | Stateless core, per-request capability negotiation, and optional extensions. |
| S4 | [Open Workflow Specification repository](https://github.com/open-workflow-specification/specification) | Existing DSL, runtimes, and conformance test kit. |
| S5 | [AG-UI 1.0 specification](https://github.com/ag-ui-protocol/ag-ui/tree/main/spec/1.0) | Stable human-facing event protocol scope and schema. |
| S6 | [OpenTelemetry GenAI agent spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md) | Observability integration context. |
| S7 | [NIST AI Agent Standards Initiative](https://www.nist.gov/artificial-intelligence/ai-agent-standards-initiative) | Institutional initiative and identity/authorization context. |
| S8 | [Arazzo specification](https://spec.openapis.org/arazzo/latest.html) | API workflow integration context; inspected page identifies v1.1.0. |
| S9 | [OMG CMMN 1.1](https://www.omg.org/spec/CMMN/1.1/About-CMMN) | Adaptive case-management prior art. |

Historical release dates, the report's complete protocol portfolio, and every matrix rating were not independently reverified. This draft avoids making its core conformance obligations depend on those claims. No runtime conformance tests were executed as part of authoring this document; Annex A defines the tests an implementation must subsequently perform.

**Revision record:** Edition 0.1 — initial reviewed draft. Edition 0.2 — research-driven revision of mission continuity, authority comparison/errors/freshness, waits, approvals, dispatch consistency, replay, acceptance, and assessment roles. Edition 0.3 — adds TR-01–TR-07, ND-01–ND-06 and AT-42–AT-52; introduces trigger and node assessment roles. Companion SDK profile tests have been run; they do not constitute a full deployment conformance assessment.


# Annex E — Edition transition and research references (informative)

For an edition 0.1 import, create an explicitly mapped mission and contract revision, preserving original run and operation identities. Carry consumption and unsettled reservations forward; do not invent missing approval, authority, or evidence. A missing acceptance decision becomes NOT_REQUESTED, never ACCEPTED. Convert each old single wait into a WaitCondition and inspect concurrent work for omitted waits. Classify replay entrypoints into the three named modes. Reassess authority profiles, policy diagnostics, freshness, and dispatch consistency before enabling edition 0.2 execution. Preserve the original edition and conversion report; incomplete conversion supports archival viewing, not an unsupported execution claim.

Strengthened requirements include I-02, L-01/L-02, AU-05, B-02/B-03, E-04, D-04, V-04, EX-01, and O-02. New requirements are C-03, M-03/M-04, L-06, AU-07/AU-08, H-04, E-09, V-07/V-08, and T-05. AT-31 through AT-41 extend the original scenarios. Execution transition additions support aggregate READY/WAITING and zero-work completion; they do not reopen terminal states.

| Primary source | Design use |
|---|---|
| [RFC 8693](https://www.rfc-editor.org/rfc/rfc8693.html), [RFC 9396](https://www.rfc-editor.org/rfc/rfc9396.html) | Delegation identity versus authorization; profile-specific permission comparison. |
| [RFC 7009](https://www.rfc-editor.org/rfc/rfc7009.html), [RFC 7662](https://www.rfc-editor.org/rfc/rfc7662.html) | Revocation and introspection-cache freshness. |
| [Cedar authorization](https://docs.cedarpolicy.com/auth/authorization.html) | Explicit mandatory-check diagnostic handling. |
| [Temporal workflow definition](https://docs.temporal.io/workflow-definition), [activity definition](https://docs.temporal.io/activity-definition) | Recorded decisions and deterministic recovery around nondeterministic work. |
| [Stripe idempotency](https://docs.stripe.com/api/idempotent_requests), [AWS transactional outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html) | Target-specific retry contracts and internal/external transaction boundary. |
| [WS-HumanTask 1.1](https://docs.oasis-open.org/bpel4people/ws-humantask-1.1-spec-cs-01.html), [OWASP transaction authorization](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html) | Approval ownership and binding to material actions. |
| [W3C PROV-O](https://www.w3.org/TR/prov-o/), [OMG SACM 2.3](https://www.omg.org/spec/SACM/2.3/PDF), [RFC 9334](https://www.rfc-editor.org/rfc/rfc9334.html) | Evidence provenance, support rationale, appraisal and acceptance separation. |
| [W3C SCXML](https://www.w3.org/TR/scxml/), [W3C specification guidelines](https://www.w3.org/TR/qaframe-spec/) | Parallel-state semantics and scoped conformance assertions. |
| [Mission-bound authorization draft](https://datatracker.ietf.org/doc/draft-mcguinness-oauth-mission/) | Experimental comparison, not a core dependency or adopted standard. |

# Annex F — Minimum role allocation (normative)

Roles are D: definition/policy producer; R: integrated runtime and dispatch boundary; E: evidence producer/consumer and verifier/acceptance service as applicable; B: binding implementer; M: migration pair; A: assessor; O: adopting operator; S: specification maintainer. A deployment may combine roles but SHALL retain their obligations. Multiple roles in a row indicate shared obligations: the assessment SHALL attribute the individual mandatory assertions to their executing party. A component that cannot fulfill a dependent obligation SHALL identify the integrating component; it cannot silently mark that obligation inapplicable.

| Requirements | Minimum responsible roles |
|---|---|
| N-01, C-01–C-03 | All claimants and A |
| M-01–M-04 | R; D supplies immutable definition/contract identity |
| G-01, G-02 | O; D captures approved policy |
| G-03 | R |
| I-01 | D |
| I-02, P-01–P-03 | R; D declares envelope and dependency rules |
| L-01–L-06 | R |
| AU-01–AU-08 | R; D/O specify authoritative policy and profiles |
| H-01–H-04 | R; D/O define eligibility and approval policy |
| B-01–B-03 | D declares limits; R enforces; O authorizes allocations |
| E-01–E-09 | R and relevant B; D supplies capability contracts |
| D-01–D-04 | R |
| X-01–X-05 | R/E for controlled handling; O for data policy |
| V-01–V-08 | E and R; D/O specify methods and acceptance authority |
| O-01–O-04 | R and record-producing E/B |
| EX-01, EX-02 | E; R validates executable imports |
| BI-01 | B with integrating R |
| MG-01–MG-03 | M with source/target R; only if claimed |
| T-01–T-05 | A and assessed claimant |
| CH-01, CH-02 | O and affected component owners |
| CH-03 | S |
| TR-01–TR-07 | D declares trigger contract; R enforces admission/deduplication; B authenticates and normalizes sources; O authorizes policy |
| ND-01–ND-06 | D supplies graph/node contracts; R and B enforce execution; E supplies evidence assessment where required |

Feature exclusions apply only under C-02. A core execution claim includes its required external services inside the assessed responsibility boundary, even if those services are separate products. An assessment SHALL expand ranges and produce a row for every applicable requirement and its mandatory subassertions.


# Annex G — Companion implementation profile (informative)

SDK release 0.3.0 provides native TypeScript, Rust and Python implementations targeting edition 0.4 under the finite-v1 profile. All three include checked command records, pure semantic reduction, native SQLite stores, trusted coordinator interfaces, trigger admission, fixed UTC schedules and the 13 node kinds. The source package includes the shared schema, executable examples, shared scenarios, persistence tests, a coverage mapping and a test report.

Profile choices include exact finite authority sets, integer accounting units, immutable per-mission contracts, explicit ALL/ANY joins, bounded loop constructs, local JSON schemas and conservative UNKNOWN-effect accounting. The default node material shape is a JSON object unless an explicit schema narrows it. Context, authority, budget, deadline, responsibility and evidence obligations may be explicitly inherited from an approved enclosing definition; absence must never be interpreted as a grant of unrestricted behavior.

The finite-v1 library is not a hosted ingress service. Authentication of event producers, durable disposition of rejected deliveries, transport acknowledgments, domain input compatibility, authoritative assessment, subworkflow parent/authority mapping and provider/environment enforcement remain declared binding responsibilities. The coordinator has no permissive authorization default. A successful local shape check or state transition is insufficient evidence for these responsibilities.

The release does not claim calendar cron/DST support, arbitrary authorization-policy comparison, live cross-runtime migration, external exactly-once effects or built-in adapters for every provider. Unsupported requirements must be rejected before execution. An organization adopting this profile must assess its complete composed deployment against all applicable requirements, including the controls supplied outside the SDK.

Archon's pinned workflow implementation informed the review of graph preflight, structured output handoffs, bounded context loops, separate outcome state and atomic gate resolution. These are reuse recommendations, not incorporation of Archon's wire schema or a finding that Archon conforms to AIWS. See the companion `ARCHON-RECOMMENDATIONS.md` for source links, priorities and important differences.
