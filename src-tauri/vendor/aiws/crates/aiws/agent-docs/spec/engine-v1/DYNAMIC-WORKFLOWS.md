# M7 dynamic workflow contract — slice 1

Status: experimental `aiws-dynamic/1` definition and `aiws-change/1` proposal preflight implemented in the TypeScript engine source. This is not a finite-v1 SDK or engine wire-protocol extension. No live graph mutation is enabled by this slice.

## Scope and delivery order

The first executable capability is deterministic change validation and impact calculation. Future activation is supervised by default. Task insertion precedes plan/branch revision and agent replacement. Task removal is classified for review but is not an authorized deletion capability. Cycles, calendar scheduling, cross-machine recovery, changes to protected policy, automatic stale-result reuse and compensation are excluded from slice 1.

The preflight DAG describes task dependencies. It is not a new interpreter for every SDK node kind. Existing bounded correction loops remain in the coding engine; a future integration must explicitly map them into revisioned execution.

## Definition

All fields are required; additional fields are rejected.

| Field | Meaning |
|---|---|
| `format` | Exactly `aiws-dynamic/1` |
| `workOrderId`, `runId` | Stable identities; preserved across a change |
| `revision` | Positive safe integer; a candidate is exactly base + 1 |
| `parentDigest` | Null only at revision 1; otherwise a lowercase SHA-256 digest |
| `authorityDigest` | Digest of immutable authority policy material |
| `limitsDigest` | Digest of immutable limit configuration; not a resource ledger snapshot |
| `acceptanceDigest` | Digest of immutable acceptance requirements |
| `tasks` | Nonempty set of uniquely identified task records |

A task has exactly `taskId`, `materialDigest`, `agentId`, and `dependsOn`. Task material is an immutable host-resolved description of the intended work, including all effect-relevant command/input/output/credential bindings. The host must resolve and verify this material before approval or execution. A claimed digest alone proves neither its content nor authorization. Dependency identities must exist; duplicates, self-edges and cycles fail validation. Tasks sort by identity and dependency sets sort lexicographically, making their input order immaterial. Strings preserve their exact Unicode representation; no normalization or trimming changes identity.

## Proposal and preflight

A proposal has exactly `format: aiws-change/1`, `proposalId`, `baseDigest`, `proposedBy: {principalId, kind}`, `reason`, and `candidate`, and an agent replacement proposal may also name its `successor: {agentId, capabilityDigest}` (agent binding §4 (not in this pack)). `kind` is `HUMAN` or `AGENT`; it is an attribution claim, not verified identity or an approval. Reason is bounded at 4096 UTF-16 code units; identities at 256. Digests are 64 lowercase hex characters. Records reject accessors, symbol/unknown fields, missing fields and malformed scalar values; arrays must be dense data arrays.

`normalizeWorkflowDefinition(unknown)` validates and returns a detached canonical snapshot. `workflowDefinitionDigest(unknown)` hashes the UTF-8 bytes of `AIWS_DYNAMIC_DEFINITION_V1`, a newline, and canonical JSON. Canonical JSON recursively sorts object keys; strings use JSON escaping, numbers use JSON integer representation, and normalized set-valued arrays retain their sorted order. There is no whitespace or trailing newline in this JSON. The proposal digest uses `AIWS_DYNAMIC_PROPOSAL_V1` and binds the entire normalized proposal, including proposer, reason, request identity and candidate. These domain-separated hashes are specific to this experimental contract, not substitutes for existing finite-v1 material digests.

`preflightWorkflowChange(base, proposal)` requires the exact base digest, parent digest, stable identities and successor revision. It rejects changes to authority, limits or acceptance digests for both proposer kinds. Such changes require a separate future human-governed transition; changing a label to `HUMAN` never overrides this gate. Closed records cannot carry reset counters, new budgets or embedded approval flags. No-op revisions are rejected. A proposal that names a `successor` binds every task to the successor's agent id and changes nothing else; its candidate may name the same agent id as the base, which is a change of capability digest to every task, classified as agent replacement.

The result classifies insertion, removal, material revision, dependency/branch change and agent replacement. It returns sorted added, removed, modified, affected and unaffected task identities. The affected set starts at directly changed tasks and traverses downstream dependencies in the union of BOTH definitions. This preserves old-edge impact after removal or rewiring. `unaffected` means structurally unchanged, not approved for result reuse: shared external resources or opaque material may create additional dependencies that the host must assess.

Every result says `activation: NOT_AUTHORIZED` and `resultCompatibility: REJECT_UNLESS_EXPLICITLY_APPROVED`. Neither a successful preflight nor its digest authorizes dispatch, reuses evidence, authenticates a proposer, establishes quiescence, checks live authority, or validates an externally supplied result.

## Activation and later execution invariants

Slice 2 implements durable proposals/revisions, scoped host authorization, exact human approval/expiry, current-head/epoch checks and transactional retry/recovery for an UNBOUND registry. See [DYNAMIC-REGISTRY.md](./DYNAMIC-REGISTRY.md). It rejects existing executable work and preserves holds/history/accounting without mutation. Preflight itself remains pure; the repository is a separate host API.

Slice 3 must pin tasks, attempts and handoffs to definition revision/digest, including conservative migration of existing revision-1 coding runs. Slices 4–6 must define legal operations for queued, claimed, dispatched, uncertain and completed work before enabling any change. Slice 7 must invalidate dependent assessments, reject stale results, require explicit compatibility transitions and reconcile prior effects without refunding consumed resources or treating uncertainty as failure. Limits and human-only permission escalation remain enforced independently of graph edits.

## Compatibility and acceptance evidence

No database migration or wire codec change occurs here. Existing attached graphs, SDK 0.3.0 APIs, counters, holds and execution paths are unchanged. The accepted TypeScript engine language is used for this host-side preflight; native TypeScript/Rust/Python SDK bindings and parity belong to slice 8, after the persistent control contract is established. No native SDK implementation claim is made.

Focused evidence: `npm run test:engine:m7-contract` covers 17 tests, including malformed/closed records, order-stable hashing, material binding, identity/revision conflicts, policy protection, both-graph impact and a 10,000-task chain. `npm run example:engine:dynamic` is an executable preflight example. Persistence, atomic registry activation and process-termination tests are now supplied by Slice 2; see DYNAMIC-REGISTRY.md. Live execution binding and stale-result consumption remain later M7 obligations.

Slice 7 implementation: [CODING-RECONCILIATION.md](./CODING-RECONCILIATION.md) adds current-result applicability checks, conservative assessment invalidation and human-reviewed same-stage retry after independent effect verification. Stale results are rejected; no compatibility grant or refund is implemented.
