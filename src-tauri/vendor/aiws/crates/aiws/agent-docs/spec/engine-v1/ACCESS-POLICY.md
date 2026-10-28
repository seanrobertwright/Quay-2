# Portable worker access policy — experimental contract 1.0.0

Status: M8 slice 4A contract candidate. SDK codecs validate declarations; no engine
admission, dispatch, credential delivery or OS sandbox is enabled by this document.
Q06 and D-M6-01 are unchanged. Runtime integration is 4B, native adapters 4C,
and integrated qualification 4D. This profile is separate from SDK finite-v1.

## Mapping to current contracts

| Requirement | Current integration point | 4A definition / later implementation |
| --- | --- | --- |
| Workflow scope | Dynamic definition authorityDigest and limitsDigest | WorkflowAccess document; 4B binds its digest into reviewed authority material without changing historical digests |
| Node access | DefinitionTask taskId/materialDigest | NodeAccess by exact task identity; 4B binds its digest into task material and requires exact definition/node coverage |
| Commands and outputs | CodingPlan commands/outputPaths; codingMaterial | Logical tool/workspace/output resources; outputPaths alone are not access grants |
| Credentials | DispatchMaterial credentialRefs (currently empty in coding material) | CREDENTIAL/USE references; 4B/4C resolve scoped attempt credentials through HC-09, never secret values in JSON |
| Budgets | Existing admission/reservation and coding time/attempt limits | Reuse existing limits; policy does not duplicate or override resource accounting |
| Readiness | Capability requirements and independently verified evidence | Required enforcement must be verified for the exact adapter/profile; readiness is not authority |
| Approval | approvalSubject and dispatch material digest | 4B includes policy/catalog revisions, prevents stale approvals and rechecks authorization at commit |
| Attempts | Immutable ExecutionBinding and coordinator epoch | BindingPreview specifies proposed pins; 4B implements actual transactional records, leases and revocation |
| Agent context | ContextPolicy | Remains instruction/evidence selection only, never a sandbox or permission grant |

Relevant existing contracts: [authentication](./AUTHENTICATION.md),
[host contracts](./HOST-CONTRACTS.md), [execution bindings](./EXECUTION-BINDINGS.md),
[platform requirements](./PLATFORMS.md), and [readiness](./READINESS.md).

## Data model

The authoritative structural definitions are in access-policy.schema.json (not in this pack).
All fields are required and unknown fields rejected. Missing grants never mean unrestricted
access. Empty grant/requirement lists declare no access. An empty action list is invalid.
Version/profile constants reject unknown versions. Revision values are positive canonical
decimal strings; identities remain opaque case-sensitive strings. Logical resource aliases
are bounded lowercase ASCII names, not OS paths, URLs, wildcards or secret values.

- **Grant:** kind, resource alias and action list. Each (kind, resource) occurs once per
  list and actions are unique. Multiple entries cannot hide an additive grant.
- **Policy:** policyId, revision, resourcesDigest and grants. This record can describe a
  host ceiling or workflow scope; possession of either is not evidence of approval.
- **NodeAccess:** taskId and requirements. Requirements must be a subset of the containing
  workflow policy for the same kind/resource, with each requested action present.
- **WorkflowAccess:** workOrderId, runId, policy and nodes. Node IDs must be unique.
  It intentionally excludes a definition digest: the future definition references this
  document's digest, avoiding a circular hash. Dependencies stay in the workflow definition.
- **BindingPreview:** work/run/task/attempt identities, definition, host policy, workflow
  access, node access and resource catalog digests, authorization revision and coordinator
  epoch. Both authorized and enforced are fixed to false. This is a review DTO, not a
  dispatch permit, durable binding, proof of identity or verified enforcement receipt.

| Kind | Allowed actions | Required meaning of the bound resource |
| --- | --- | --- |
| FILESYSTEM | READ, WRITE | Exact task-scoped input/work/temp tree; WRITE includes create/modify/delete within that tree, never escape through links |
| TOOL | EXECUTE | Approved executable identity/version and invocation constraints; interpreter arguments and descendants cannot bypass the sandbox |
| NETWORK | CONNECT | Reviewed destination/protocol/port policy including redirects, DNS/address handling and proxy behavior |
| CREDENTIAL | USE | Opaque provider reference scoped to attempt, audience, actions and expiry; no broad account/session access |
| ARTIFACT | PUBLISH | Governed local artifact output destination; not package publication or an arbitrary filesystem write |
| EXTERNAL_EFFECT | COMMIT | Named external action such as a code push or deployment, subject to independent authorization and applicable human approval |

The first contract deliberately has no optional requirements, wildcard matching,
implicit READ from WRITE, path-prefix grants, or automatic union/inheritance rules.
Array order is retained in canonical JSON and is digest-significant; object key order
is canonicalized. Canonical SHA-256 digests are identical across SDK codecs.

## Resource bindings and host boundary

resourcesDigest pins a reviewed resource catalog. Its executable schema/resolution is
4B work; this version only validates the digest's shape. The host must bind every alias
to exact constraints and immutable tool/input identities before dispatch. Raw machine
paths, SIDs, native secret handles and enforcement mechanisms belong to protected host
bindings, not portable workflow definitions. Catalog changes invalidate applicable
approval/bindings. A host may provide a restricted per-workflow catalog view: compare
host grants only after resolving equivalent identities; do not compare equal alias text
across different catalogs or silently remap a resource.

4A cannot verify catalog existence, host ceilings, definition membership, approval,
current authority, revocation, OS enforcement or binding-preview digest consistency.
An attacker can construct a structurally valid document; validity confers no authority.
These checks must be performed by trusted 4B admission and 4C adapters.

## Resolution and change rules for 4B

Every requested node grant must fit the approved workflow scope, the current host
ceiling and current principal/attempt authority. Do not silently drop required access
and run anyway. Block before launching the worker or delivering credentials if a
resource is unresolved, scope is exceeded, authority is stale, or enforcement cannot
be proved. Explain the missing requirement without revealing secrets.

Pin the canonical policy/catalog material into human review and attempt binding.
An access increase requires applicable fresh human approval. Even a reduction creates
new material: do not replay a stale binding as if it covered changed policy. Recheck
current authorization/epochs at dispatch and protected operations. Revocation must
fence affected attempts, revoke credentials and stop prohibited future work while
preserving records and UNKNOWN responsibility for effects already possible.

## Compatibility and migration

The existing dynamic workflow, CodingPlan, control wire and context schemas are
unchanged. This is an opt-in, standalone codec profile, not a newly accepted request
field or engine endpoint. Existing workflows keep their historical developer behavior
and are not relabeled isolated. Production access-policy execution will require explicit
migration/review in 4B, with supported versions negotiated and no silent grant defaults.
No executable database migration is included. SDK package version 0.3.0 is unchanged;
these are source additions, not a registry release or an expansion of released binaries.

## Example and acceptance

build-workflow.json (not in this pack) describes
prepare -> build/test -> collect. Preparation requests a package-registry connection;
build/test has no network or credential grants; collection requests artifact publication.
Dependencies are illustrative prose here and belong in the eventual executable definition.
The repeated-a catalog digest is a conspicuous fixture placeholder, not a provisioned
host catalog. Tools, inputs and concrete destinations must be resolved and reviewed
before this example can become executable under 4B/4C. No publishing credential or
external-write grant is present. Ordinary OS-required runtime access must also be
explicitly accounted for in the eventual host sandbox baseline.

4A acceptance: closed/versioned schema, mapping and change rules, generated native SDK
records, strict JSON decoding and semantic validation, identical canonical digests,
negative/compatibility fixtures, example, website and offline documentation. Tests must
reject missing/unknown fields, duplicate JSON keys/entries/actions, invalid kind/action
pairs, scope increases, invalid aliases/revisions/versions and authority assertions in
BindingPreview. Full runtime and adversarial native tests are later subslice gates.


## Implementation progression

4A codec/parity/documentation checks passed at source `92a1add` in
[run 36834514327](https://github.com/seanrobertwright/AI-WS-SDK/actions/runs/36834514327).
The initial 4B engine preflight now checks catalog-reference consistency, definition
coverage and host/workflow scope, but still does not establish current authority or
native enforcement. Policy-marked internal admission is deliberately held. The
4B record (not in this pack) tracks remaining runtime gates.
