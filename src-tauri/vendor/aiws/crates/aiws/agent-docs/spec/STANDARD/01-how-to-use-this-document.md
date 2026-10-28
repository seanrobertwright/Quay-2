# How to use this document

The separate [M1 handoff and resumable-hold contract candidate](../handoff-v1/CONTRACT.md) proposes an opt-in `aiws-handoff/1` extension with closed records, atomic handoffs, delivery/receipt semantics, scoped intervention holds and explicit migration rules. It does not change this edition's released finite-v1 SDK behavior or reinterpret terminal histories. Its implementation and assessment remain M2 onward; work-order accounting/binding remains M3.

Part A explains the review findings and recommended improvements. Part B contains the proposed normative standard. Annex A specifies assessment scenarios; Annexes B–E provide an example, adoption guidance, and sources; Annex F assigns assessment roles and Annex G describes implementation-profile boundaries. Recommendations and examples are distinguished from mandatory requirements. The original research report remains the research basis; this document supplies a new, assessable specification.

# Part A — Research-driven revision and recommendations

Edition 0.4 adds correlated observability, metric definitions, alert governance, privacy controls and reliable export requirements O-05–O-09. SDK release 0.3.0 adds a native Python implementation alongside TypeScript and Rust.

Edition 0.3 adds trigger admission, event handling and a normative node catalog to the research-driven edition 0.2. The new requirements distinguish occurrence receipt from authorization, require atomic deduplication/admission, preserve wait correlation and make graph execution obligations explicit.

Edition 0.2 incorporated the additional research in *AI-Workflow-Standards-Supplemental-Research.md*. The contribution is an integrated, assessable workflow contract built on existing authorization, execution, human-task, provenance, and assurance work. It is not a claim to have invented those foundations. Requirements below are proposed design decisions; cited research supports their rationale, not external endorsement.

| Revision | Research finding | Decision in edition 0.2 |
|---|---|---|
| Durable mission | Runtime continuation and authorization lifetime are different concepts. | Introduce Mission, ContractRevision, and ExecutionSegment; preserve cumulative accounting across runs. |
| Computable authority | RFC 9396 does not define comparison of arbitrary permission objects. | Require a versioned authority profile and three-result containment procedure. |
| Policy errors | An authorization engine can return Allow while reporting errors. | Required check errors block the affected dispatch; inspect diagnostics explicitly. |
| Revocation freshness | Cached validity can be stale. | Declare measurable freshness, clock tolerance, propagation, and in-flight boundaries. |
| Replay | Audit playback, recovery continuation, and new execution have different effects. | Name all three modes and prohibit implicit replacement of recorded decisions. |
| Parallel work | One run-level wait reason cannot represent concurrent human and service waits. | Persist independent wait records and explicit ALL/ANY joins. |
| Approval lifecycle | A UI event omits ownership, eligibility, consumption, and material action binding. | Add quorum/claim/reassignment rules and action fingerprints. |
| External effects | Outbox and retry facilities do not prove exactly-once business effects. | Require a durable admission boundary, target-specific guarantees, and conservative uncertainty accounting. |
| Evidence and acceptance | Evidence appraisal and accountable acceptance are distinct. | Add AcceptanceRecord and acceptance state; require current acceptance for verified success. |
| Conformance | Schema validity, runtime control, task quality, and operational assurance are different claims. | Assign every requirement to assessment roles and separate the four test tracks. |

The supplemental report contains the complete source analysis and limitations. Annex D retains the original source register and adds the primary references used for this revision. OAuth, PROV, SACM, SCXML, and human-task specifications are reuse candidates. Mission-bound OAuth and delegation-receipt drafts remain experimental alignment candidates. None is silently made a mandatory core dependency.

**Implementation recommendation.** Develop a language-neutral semantic test corpus, followed by native TypeScript and Rust SDKs that validate the same contract and produce the same control decisions. Keep authoring helpers separate from the credential-bearing execution boundary. SDK use alone cannot demonstrate deployment conformance. The companion *AIWS-TypeScript-Rust-SDK-Design.md* specifies the proposed modules, interfaces, failure cases, and release gates.

**Compatibility.** Edition 0.2 changes the metamodel, accounting scope, wait representation, success predicate, and replay contract. An edition 0.1 record is not automatically an edition 0.2 record. Existing requirement identifiers retain their subject; strengthened semantics and additions are listed in Annex E. The companion SDK release 0.3.0 supplies a candidate finite-v1 wire schema and independently implemented TypeScript/Rust/Python libraries for edition 0.4. Its profile, coverage mapping and test report state what is implemented and what remains an application or deployment responsibility; this does not certify every requirement in this document. Edition 0.2 wire records must be explicitly reviewed and mapped before execution as edition 0.3; changing an edition label alone is not an approved migration.

# Part B — AIWS-001: Proposed formal standard
