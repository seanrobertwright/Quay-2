# 3 Conformance scope

This standard distinguishes the following claims:

| Claim | Object assessed | Meaning |
|---|---|---|
| Definition | A versioned workflow definition and referenced policy package | The contract contains the required information and internally consistent constraints. |
| Core execution | An identified deployment boundary including runtime, policy enforcement, persistence, and required adapters | The deployment enforces applicable core behavior for its declared feature set. |
| Evidence export | A producer or consumer and a declared export format | Required evidence and control records can be exported or consumed with declared fidelity. |
| Binding | A versioned integration specification and its implementation | Mapping to a named external protocol preserves the declared AIWS semantics. |
| Experimental migration | An identified source/target runtime pair and format | Ownership and eligible execution state can be transferred under Clause 15. |

**C-01 — Claim contents.** A claimant SHALL state the AIWS edition, assessed role, deployment or artifact version, enabled features, supported limits, external dependencies, exclusions, assessment date, and test-evidence references. A definition-only claim SHALL NOT be presented as runtime conformance. A passing run SHALL NOT alone establish implementation-wide conformance.

**C-02 — Unsupported features.** A runtime SHALL reject definitions requiring unsupported semantic features before execution. Optional feature absence is permitted only when the definition does not require the feature and the runtime prevents its use. A binding or migration claim SHALL name the tested format and versions; no universal interchange claim is implied by core execution conformance.

**C-03 — Responsibility assignment.** Every claim SHALL assign each applicable obligation to a named component and responsible operator. Annex F supplies the minimum role allocation. A library that validates records MAY claim tested support for those checks; it SHALL NOT claim core execution conformance unless the assessed deployment includes effective dispatch enforcement, persistence, and adapters. Operational assurance SHALL include G-01, G-02, CH-01, and CH-02 and SHALL be reported separately from library behavior. Migration remains an experimental profile in this edition.
