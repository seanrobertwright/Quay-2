# Contracted read models

Status: source-only engine profile. Decided in [Which read models get a contract that outside clients can rely on?](https://github.com/seanrobertwright/AI-WS-SDK/issues/248).

A contracted read model is a host read model or profile message that a decision-free client session can read, with a schema and fixtures here that an outside client can rely on. Inspect, list, `commandResult` and capabilities are already contracted by wire 1.1.0. Anything a client session cannot read stays host-internal and may change without notice.

## Form

- read-models.schema.json (not in this pack) holds one `$def` per contracted record. A `$def` that names a format in `x-aiws-format` is a contracted record, and `x-aiws-stability` gives its stability. Every contracted record carries `format: "<name>/<N>"`; a client refuses a format it does not know and never guesses. The one exception is the run creation request, a closed profile message the client sends, which names its format in `profile`, as the hold-exit request does; its `$def` says so in `x-aiws-format-field`.
- read-models.fixtures.json (not in this pack) holds accepting and refusing shape fixtures for each contracted record. The engine spec check (`npm run spec:engine:check`) validates them with Draft 2020-12.
- Objects are open: a client ignores fields it does not know. The engine's own tests apply the schema in strict mode, every object that declares fields allowing no other, to what the routes actually emit, so an undeclared field fails the engine suite.
- Embedded records that have a contract of their own, such as readiness reports and requirements, are declared as objects here and validated against their own schema ([READINESS.md](./READINESS.md)).

## Stability

- `PROVISIONAL`: a schema and the strict-mode engine test, with no promise across commits.
- `STABLE`: changes within a format version are additive only (new optional fields a client may ignore). Removing or renaming a field, changing a field's type or meaning, making a field required, or adding a value to a closed enum needs the next format version, served beside the old one.

A read model is promoted to `STABLE` in the change that records its milestone or slice Complete.

## Contracted records

| Format | `$def` | Route | Stability | Contract |
|---|---|---|---|---|
| `aiws-workflow-catalog/1` | `WorkflowCatalog` | `GET /engine/workflow-catalog/v1` | `PROVISIONAL` | [WORKFLOW-TEMPLATES.md](./WORKFLOW-TEMPLATES.md) |
| `aiws-workflow-catalog/1` | `WorkflowTemplateDetail` | `GET /engine/workflow-catalog/v1/templates/<name>` | `PROVISIONAL` | [WORKFLOW-TEMPLATES.md](./WORKFLOW-TEMPLATES.md) |
| `aiws-workflow-runs/1` | `WorkflowRuns` | `GET /engine/workflow-catalog/v1/templates/<name>/runs` | `PROVISIONAL` | [WORKFLOW-TEMPLATES.md](./WORKFLOW-TEMPLATES.md) |
| `aiws-workflow-run/1` | `WorkflowRunRequest` | `POST /engine/workflow-runs/v1` (request) | `PROVISIONAL` | [WORKFLOW-TEMPLATES.md](./WORKFLOW-TEMPLATES.md) |
| `aiws-workflow-run-result/1` | `WorkflowRunResult` | `POST /engine/workflow-runs/v1` (result) | `PROVISIONAL` | [WORKFLOW-TEMPLATES.md](./WORKFLOW-TEMPLATES.md) |
| `aiws-workflow-run-error/1` | `WorkflowRunError` | `POST /engine/workflow-runs/v1` (error) | `PROVISIONAL` | [WORKFLOW-TEMPLATES.md](./WORKFLOW-TEMPLATES.md) |

The other records the decision contracts (the operator view, the hold card, the attempt history and the binding review) get rows here when their schema entries are written. The discovery route `GET /engine/read-models/v1` and `?format=` negotiation are not built yet; until they are, each route serves its one format.
