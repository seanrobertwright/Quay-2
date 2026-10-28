# Capability manifests and readiness — S1

Status: implemented for the opt-in local coding runner and native TypeScript, Python and Rust source SDKs. Versions 1.0.0 and 2.0.0: 2.0.0 is the current record schema, and 1.0.0 is frozen and still readable; SDK readiness evaluation takes 1.0.0 inputs only. This supplements standalone AIWS; no Archon installation or adapter is required.

M10 amends this contract: agent binding (not in this pack) specifies readiness 2.0.0 (§9 (not in this pack)), the `MODEL` capability kind (§2 (not in this pack)) and one readiness binding per node assignment (§4 (not in this pack)). These amendments are specified and, apart from readiness 2.0.0 in SDK 0.4.0 (TypeScript, Rust and Python) and in the engine, which reads both versions and binds new coding runs under 2.0.0 ([Readiness versions in the engine](#readiness-versions-in-the-engine)) and, for an observed 2.0.0 manifest with a non-empty model set, adds a VERIFIED `MODEL` requirement for each model confinement condition, not implemented; each sentence below that names readiness 2.0.0 or a node assignment states the amended rule, and the rest describes version 1.0.0 as built.

## Records and trust

The 1.0.0 schema, frozen as `spec/engine-v1/readiness.schema-1.0.0.json` and carried by the SDKs as `readiness.schema-1.0.0.json`, is self-contained and closed; its codec and semantic fixtures are `readiness.fixtures-1.0.0.json`. Native codecs reject unsupported versions, missing/extra fields, invalid Unicode, duplicate JSON keys, unsafe integers and duplicate capability identities. A capability identity is its exact `(kind, name)` pair. Arrays preserve order in digests; reordering a manifest changes its pin. All collection fields are bounded to 256 entries, names to 512 characters, and encoded input to the existing 1 MiB parser bound. Each new profile is separate from existing finite-v1, handoff, limits and dynamic-control formats.

| Record | Profile | Meaning |
|---|---|---|
| Manifest | aiws-capabilities/1 | Selected agent, provider/model, implementation digest and declared capability support |
| Requirements | aiws-requirements/1 | Required agent and capabilities, each with DECLARED or VERIFIED assurance |
| Snapshot | aiws-capability-snapshot/1 | Manifest plus observation validity and independent host evidence references/expiry |
| Binding | aiws-readiness-binding/1 | Immutable manifest digest and requirements selected for a coding run |
| Report | aiws-readiness/1 | READY/BLOCKED explanation, observed capabilities, checks and digest comparisons; authorized is always false |

Readiness 2.0.0 (`$id` `https://aiws.dev/readiness/2.0.0`) moves every record to its `/2` profile: `aiws-capabilities/2`, `aiws-requirements/2`, `aiws-capability-snapshot/2`, `aiws-readiness-binding/2` and `aiws-readiness/2`. The 2.0.0 manifest drops `provider` and `model` and carries `modelSet`, the inline model-relevant `configuration` projection, `usageReporting` and named `gaps` (§2 (not in this pack)). `spec/engine-v1/readiness.schema.json` is the 2.0.0 schema, with shape fixtures in `readiness.fixtures.json` generated from the accepted record shapes. It is the current version: SDK 0.4.0 carries it as each SDK's `readiness.schema.json`, and the TypeScript, Rust and Python codecs decode 2.0.0 and 1.0.0, encode only 2.0.0 and evaluate only 1.0.0; `npm run test:readiness:parity` compares all three on both versions (§9 (not in this pack)). The engine decodes and evaluates both versions ([below](#readiness-versions-in-the-engine)). The 1.0.0 schema is frozen beside it as `readiness.schema-1.0.0.json`.

Capability kinds are TOOL, OUTPUT, CONTEXT and ISOLATION; readiness 2.0.0 adds MODEL, whose names are the model confinement conditions plus the optional `served-model-reported` (§2 (not in this pack)). Names are exact strings; S1's built-in inspector uses `node`, `file-artifacts`, `text`, `fresh`, `provider-resume`, `filesystem-sandbox` and `network-deny`. ISOLATION requirements must request VERIFIED assurance; in readiness 2.0.0 so must MODEL requirements, and DECLARED never dispatches a model-using agent. Other requirements can explicitly ask only about declared support; that does not verify an implementation or grant permissions.

A snapshot is data, not proof of its own origin. The pure native evaluator cannot authenticate its input. An evidenceRef, a VERIFIED requirement or a caller-authored supported flag cannot establish host trust. Execution obtains observations only through the built-in local inspector or the host-installed `capabilityInspector(agentId, version)` callback. The callback must inspect the selected installed agent independently, be read-only and keep effective configuration stable through admission/delivery. It must not accept client-supplied verification claims as evidence.

## Deterministic evaluation

`evaluateReadiness` / `evaluate_readiness` validates inputs, hashes the canonical manifest and requirements, compares selected agent and optional expected manifest digest, and evaluates each requirement at explicit `nowMs`.

| Check status | Meaning | User action |
|---|---|---|
| SATISFIED | Requested declaration or current host evidence is present | Continue to human review; no approval is implied |
| MISSING | Agent declares no matching capability | Install/select a supporting agent |
| UNSUPPORTED | Agent explicitly lacks support | Select a supporting implementation |
| UNVERIFIED | Support is declared but requested host evidence is missing | Obtain independent host verification |
| EVIDENCE_EXPIRED | Required evidence expires at or before now | Refresh verification |
| STALE | Snapshot is expired or observed in the future | Refresh the snapshot |

A snapshot is fresh only while `observedAtMs <= nowMs < validUntilMs`; its validity interval must be nonempty. Expiry equality blocks. Duplicate declarations/requirements/evidence and evidence naming an undeclared capability are rejected. Wrong agent or manifest pin blocks even when all individual capabilities are satisfied. Stale empty requirements cannot yield READY. Report reasons explain global failures; each check includes the requirement, observed support, evidence reference and corrective action.

## Local host observations

The built-in inspector reads and hashes the actual Node executable, local worker source, executable path, runtime/platform/architecture and effective process environment. Environment values are not returned or persisted by readiness; in 1.0.0 only their combined implementation fingerprint is included. In readiness 2.0.0 `implementationDigest` covers adapter code and tool binary only and no longer hashes environment values; the settings that decide which provider and model a request reaches are pinned through the manifest's configuration projection instead (§2 (not in this pack)). A changed worker source requires restart. Executable access is checked without running a discovery command. No provider calls, tool installation, workflow execution, approval or accounting change occurs during inspection.

It reports the exact current Node executable's support, file artifact output, text output and fresh-process context. It explicitly reports provider-session resume, filesystem sandboxing and denied network access as unsupported. A workspace/cwd guard is not an OS sandbox. Other executables, including a bare PATH-based `node` command, require a suitable host inspector; S1 does not discover or execute them automatically. Built-in observations expire after five seconds.

Host attestation is not an OS enforcement mechanism. Host integrations must serialize configuration changes and implement any claimed containment. S1 observes and checks configuration; it does not freeze arbitrary external files or prevent a privileged host from changing them after a check.

## Runner API and pinning

- `runner.previewReadiness(plan, requirements?, expectedManifestDigest?)` inspects a proposed plan without creating work. It evaluates under 2.0.0 and refuses 1.0.0 requirements with `READINESS_VERSION_RETIRED`.
- `runner.readiness(workOrderId, requirements?, expectedManifestDigest?)` explains current work without changing its state, under the version of the run's binding; caller requirements of another version are refused with `READINESS_VERSION_MISMATCH`.
- `runner.create(plan, binding?)` optionally creates work with an immutable readiness binding. It remains AWAITING_APPROVAL. A new binding must be 2.0.0; a 1.0.0 binding is accepted only as an exact retry of a run bound before the upgrade.
- `startControlHost` accepts `readinessBindings[workOrderId]` and an optional trusted `capabilityInspector(agentId, version)`. Supply the same bindings on restart for plans listed in host configuration.

### Readiness versions in the engine

The engine reads readiness 1.0.0 and 2.0.0 and evaluates each run under the version its binding names; an unpinned run is inspected under the version of the caller's requirements, 2.0.0 by default. Both versions use the same check statuses, reasons and remediation, and a report has the version of its inputs; a snapshot and requirements of different versions are refused, never converted. Authoring builds 2.0.0 bindings only.

A run bound under 1.0.0 before the upgrade keeps its reviewed binding and 1.0.0 semantics until it ends (agent binding §9 (not in this pack)): its snapshots, minimum requirements, pin and reports stay 1.0.0, and the built-in inspector's 1.0.0 implementation digest still covers the effective process environment. A host inspector is asked for the version of the run it inspects and must return a snapshot of that version; a snapshot of another version blocks with a reason naming both versions. The operator view (`coding-operator-view/1` field `readiness`, its CLI JSON and the web view) shows the version and manifest digest of each pinned run.

The runner adds minimum VERIFIED requirements for implementation, validation, applicable correction and inserted commands, file artifacts and fresh context. An empty or weaker caller list cannot remove those requirements. Under readiness 2.0.0 the minimums are per node: one TOOL requirement per node command, `OUTPUT file-artifacts` and `CONTEXT fresh`, plus a VERIFIED MODEL requirement for each confinement condition when the node's agent has a non-empty model set (§4 (not in this pack)). Until node assignments exist, a coding run has one agent and one binding, so the engine applies these minimums to the run as a whole, adding the MODEL requirements whenever the observed 2.0.0 manifest has a non-empty model set. It checks that the snapshot identifies the actual selected agent and that an assigned adapter is installed with its reviewed capability digest. Inspection failures block with a sanitized explanation.

Pinned requirements and the effective manifest digest enter the human approval subject and dispatch material digest. They are stored both in workflow state and a guarded immutable record. Under readiness 2.0.0 the binding is a record of its node assignment: one immutable binding per node assignment, stored one row per node assignment, with requirements per node rather than merged across nodes (§4 (not in this pack)). The binding a run was created with is its work-order row in `coding_readiness_bindings`; the binding of each node assignment an agent replacement activated is its row in `coding_assignment_bindings`, beside the manifest the binding pins and the assignment it superseded. Removing or altering the state copy is detected. Exact create retries preserve the binding; changing or omitting it on a retry fails.

Readiness is rechecked before acknowledgment/claim, after the host's beforeDispatch gate and again before actual delivery. It never replaces human approval, accounting admission, ownership or artifact checks. A change before admission blocks without a dispatch charge. A change after admission fences execution and preserves UNKNOWN responsibility and resource exposure for existing reconciliation rules. Restart does not clear the pin, even if the custom inspector is omitted.

A readiness binding is replaced only through agent replacement (§4 (not in this pack)): one human approval writes a successor node assignment and readiness binding for each named node, after the successor meets the activation bar, and `READINESS_PINNED` is no longer raised. Restoring the exact reviewed configuration still satisfies the current pin without a replacement. M10 slice 7 implements this route for a coding run's one node ([agent replacement](./AGENT-REPLACEMENT.md)); a successor binds under readiness 2.0.0, so replacement also moves a run bound under 1.0.0 onto 2.0.0. Unpinned runs retain their prior execution behavior. Plan changes retain the immutable bindings, add current minimum checks, and still require the existing exact review and approval rules; an inserted node gets its own node assignment and readiness binding and meets the same activation bar (§4 (not in this pack)).

## Authenticated inspection and CLI

`GET /engine/readiness/v1/<encoded-work-order-id>` returns a Report through the existing verified loopback TLS host. Host authorization action `readiness` is scoped to the work order and checked before and after inspection. This initial HTTP surface uses existing HUMAN sessions. It does not accept a caller's snapshot, mutate work or issue an approval. Authentication may update existing clock/context bookkeeping; report evaluation itself is read-only.

```sh
node engine/src/control-cli.ts https://127.0.0.1:7443 host-ca.pem readiness work-order-id < protected-credential.json
```

Credentials remain protected stdin input, as in other control commands. HTTP transport success is distinct from `report.status`; consumers must inspect READY/BLOCKED and cannot treat READY as permission to execute. SDKs can validate the report with the native readiness codec; the existing verified HTTPS control surface retains its session and origin policies.

## Storage and compatibility

The optional component is `coding_readiness_version=1`. Table creation, immutable guards, binding insertion and workflow creation share a transaction. Inspection alone does not initialize it. Unknown versions, missing tables or missing guards fail closed. Existing schema/wire versions are not silently reinterpreted. Storing the first 2.0.0 binding moves the component to `coding_readiness_version=2`, which admits 2.0.0 records in the same one-row-per-work-order table; existing 1.0.0 rows are never rewritten, and a binary that reads only version 1 refuses the database. Readiness 2.0.0 moves binding storage from one row per work order to one row per node assignment (§9 (not in this pack)): the first binding an agent replacement stores moves the component to `coding_readiness_version=3`, which adds the guarded immutable `coding_assignment_bindings` table, one row per node assignment, beside the work-order rows, which are never rewritten. A binary that reads only versions 1 and 2 refuses the database. Runs bound under 1.0.0 keep their reviewed binding and 1.0.0 semantics until they end; agent replacement is their route onto a 2.0.0 binding (§9 (not in this pack)). Use existing offline consistent backup/restore procedures; unsupported older binaries must not open upgraded state.

Run source from the current repository. No registry package release, platform certification or baseline source ZIP regeneration is implied. M6/M8 gates and real browser verification remain open; S1 does not change web components.
