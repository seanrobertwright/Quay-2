# Graph binding

Status: `PROVISIONAL` design contract. Praxis does not accept a graph binding yet. The schema and fixtures are published so clients can author and shape-check binding documents now. Decided in [Where do a TASK node's agent, commands and exposure live?](https://github.com/seanrobertwright/AI-WS-SDK/issues/249), on the [Wayfinder map: Praxis runs finite-v1 graphs](https://github.com/seanrobertwright/AI-WS-SDK/issues/247). The format stays `PROVISIONAL` until that map's milestone is Complete.

A finite-v1 graph says what kind of work each node does: a TASK's `config` holds only `executionKind`. What Praxis runs at that node (the agent, its commands and outputs, its exposure, or the protocol operation) lives in a separate Praxis document, the **graph binding** (`aiws-graph-binding/1`). The finite-v1 wire and the three SDKs do not change. Agent ids, exposure allowances and the ledger cost unit mean something only inside one Praxis installation.

| File | Purpose |
|---|---|
| graph-binding.schema.json (not in this pack) | Draft 2020-12 JSON Schema of the document, marked `"x-aiws-stability": "PROVISIONAL"` |
| graph-binding.fixtures.json (not in this pack) | Shape fixtures: accepted and refused documents, and a graph with its `graphDigest` |

## The document

One immutable document per binding revision. The document is closed: a field the schema does not name is refused.

| Field | Rule |
|---|---|
| `format` | `aiws-graph-binding/1` |
| `graphBindingId`, `graphBindingRevision` | The binding's identity and its append-only revision. The names differ from the protocol registry's `bindingId` and `bindingRevision` |
| `graphId`, `graphRevision`, `graphDigest` | The one graph revision this binding targets (see [Graph digest](#graph-digest)) |
| `costUnit` | Required. Must equal the ledger's cost unit |
| `maxTotalCost` | Optional cost bound for the RUN scope, in `costUnit`. Absent: the RUN scope inherits |
| `maxTotalActiveMs` | Required. The RUN scope's active-time limit |
| `contextPolicy` | Optional `coding-context-policy/1`: the run's one immutable context policy, received by every AGENT node |
| `nodes` | One entry per dispatched node, keyed by node id |

A graph revision may have several bindings, so one reviewed graph can run with different agents without a new graph revision. A run attaches exactly one pair of graph revision and binding revision, and keeps it. A bound run changes agent only through agent replacement (AGENT-BINDING.md (not in this pack) section 4), which writes new node assignments, never a new binding revision.

### Entries

Every TASK, LOOP and COMPENSATION node has exactly one entry; no other node kind has one. Each entry names its `executionKind`. A TASK entry's must equal the node's `config.executionKind`. A LOOP or COMPENSATION entry chooses its own, because the graph leaves it unset.

| `executionKind` | Fields |
|---|---|
| `AGENT` | `agentId`; `commands`, each an argument array as a coding plan stage command; `outputPaths`; `exposure`; optional `maxAttempts`; `maxTaskMs`; `requirements` (readiness 2.0.0 requirements above the runner's minimums, which are re-derived and never stored); `role` |
| `TOOL` | `protocolBindingId`; `action` and `resource` as in an admitted protocol operation; `payload`, a static reviewed JSON value; `exposure`; optional `maxAttempts`; `maxTaskMs`; `role` |
| `FUNCTION`, `HUMAN` | `executionKind` only. Well formed, but refused at submission until [How are HUMAN and FUNCTION tasks executed and evidenced?](https://github.com/seanrobertwright/AI-WS-SDK/issues/254) decides them; their fields will be added within `aiws-graph-binding/1` |

`role` is `WORK` or `VALIDATION`. A `VALIDATION` entry also carries `criteria`, a non-empty set of contract criterion names, and a `WORK` entry carries none. A VALIDATION attempt's outcome becomes a criterion result: SUCCEEDED is PASS, FAILED is FAIL, UNKNOWN is INCONCLUSIVE. A WORK outcome never feeds `verify`.

A binding pins no capability digest, protocol binding revision or authority grant. At run creation Praxis pins the agent's capability digest, or the protocol binding's revision and capability digest from a current discovery, in one `aiws-node-assignment/1` per entry. The grant comes from the contract and grants.

## Graph digest

`graphDigest` is the SDK `digest` of the finite-v1 `Graph` record exactly as passed to `registerGraph`: `sha256:` followed by the lowercase hex SHA-256 of its canonical JSON, with object keys sorted in UTF-16 code-unit order, no white space, and integers only. Each SDK exports it:

| SDK | Call |
|---|---|
| TypeScript | `digest(graph)` from `@aiws/sdk/sqlite` |
| Rust | `aiws_sdk::digest(&graph)` |
| Python | `aiws.digest(graph)` |

In the engine, `wireDigest` in `engine/src/control-wire.ts` hashes the same canonical text, without the `sha256:` prefix. `digestCommand` in `engine/src/sqlite-store.ts` does not: it sorts keys with `localeCompare`, so its result can differ, for example for a graph whose keys mix upper and lower case. The fixture graph has such keys, and the engine, Rust, TypeScript and Python tests check its digest.

## Checks

The schema checks shape only. Praxis also checks:

| When | Checks |
|---|---|
| Submission, against the graph | `graphDigest`; completeness and node kinds (`BINDING_INCOMPLETE` for a missing entry or an unknown node id, `BINDING_NODE_KIND` for an entry on another kind, `BINDING_KIND_MISMATCH`, `EXECUTION_KIND_UNSUPPORTED`); a TOOL `payload` against the node's `inputSchema`; `exposure` with `stopThreshold` no greater than `allowance`; and a context policy's unique reference names and summary `basedOn` |
| Attach, against the contract and the host | `COST_UNIT_MISMATCH`; `LIMIT_CONFIGURATION_INVALID` for `maxTotalCost` above `Contract.budget`; `CRITERIA_UNCOVERED` and `CRITERIA_UNKNOWN`; `maxAttempts` against `Contract.maxAttempts`; catalog agents and registered protocol bindings; readiness and credential checks per node assignment |

## Fixtures and tests

graph-binding.fixtures.json (not in this pack) has scope `SHAPE_ONLY`. A case marked valid has an accepted shape; it does not promise that submission or attach succeeds. Its `graphs` list holds a finite-v1 graph and its `graphDigest`, and every valid case targets that graph.

- `npm run spec:engine:check` validates every case with Python `jsonschema` and recomputes the digest.
- `engine/test/graph-binding-schema.test.ts` validates every case with Ajv in strict mode. It also checks that the schema and the engine's existing coding plan checks agree on every agent id, command, output path, exposure, cost amount and context policy in the fixtures. It lists the rules only submission can check, and keeps the schema's requirement definitions equal to readiness 2.0.0.
- `crates/aiws/tests/graph_binding.rs` validates every case with the `jsonschema` crate the Rust SDK uses, which is how a Rust client vendors the schema. The Rust, TypeScript (`packages/typescript/test/graph-binding.test.mjs`) and Python (`packages/python/tests/test_graph_binding.py`) SDK tests check the graph digest.
