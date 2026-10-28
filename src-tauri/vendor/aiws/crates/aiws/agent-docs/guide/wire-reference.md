# Wire schema reference

Generated from spec/schema.json for SDK 0.4.0 / proposed standard 0.4. Field tables describe structure; state-dependent authorization, ordering and proof requirements also apply. All command families include optional Context. JSON below is schema data, not language-specific application code. Use the tabbed tutorials for executable native programs.

Download the exact schema (not in this pack).

## Contract

Shared validated record. Consult the concept guide for the trust and lifecycle meaning of its fields.

| Field | Required | Shape and bounds |
|---|---|---|
| id | Yes | string; minLength=1; maxLength=256 |
| missionId | Yes | string; minLength=1; maxLength=256 |
| aiwsEdition | Yes | constant "0.4" |
| profile | Yes | constant "finite-v1" |
| budget | Yes | string; pattern ^(0\|[1-9][0-9]*)$; maxLength=100 |
| deadline | Yes | string; pattern ^(0\|[1-9][0-9]*)$; maxLength=100 |
| criteria | Yes | array of string; minLength=1; maxLength=256; maxItems=1000; uniqueItems=true |
| actions | Yes | array of string; minLength=1; maxLength=256; maxItems=1000; uniqueItems=true |
| resources | Yes | array of string; minLength=1; maxLength=256; maxItems=1000; uniqueItems=true |
| requiresApproval | Yes | boolean |
| maxAttempts | Yes | string; pattern ^(0\|[1-9][0-9]*)$; maxLength=100 |
| maxAuthorizationAgeMs | Yes | string; pattern ^(0\|[1-9][0-9]*)$; maxLength=100 |
| features | Yes | array of "triggers" / "graphs"; uniqueItems=true |

<details>
<summary>Exact Contract schema</summary>

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "missionId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "aiwsEdition": {
      "const": "0.4"
    },
    "profile": {
      "const": "finite-v1"
    },
    "budget": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]*)$",
      "maxLength": 100
    },
    "deadline": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]*)$",
      "maxLength": 100
    },
    "criteria": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 256
      },
      "uniqueItems": true,
      "maxItems": 1000
    },
    "actions": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 256
      },
      "uniqueItems": true,
      "maxItems": 1000
    },
    "resources": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 256
      },
      "uniqueItems": true,
      "maxItems": 1000
    },
    "requiresApproval": {
      "type": "boolean"
    },
    "maxAttempts": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]*)$",
      "maxLength": 100
    },
    "maxAuthorizationAgeMs": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]*)$",
      "maxLength": 100
    },
    "features": {
      "type": "array",
      "items": {
        "enum": [
          "triggers",
          "graphs"
        ]
      },
      "uniqueItems": true
    }
  },
  "required": [
    "id",
    "missionId",
    "aiwsEdition",
    "profile",
    "budget",
    "deadline",
    "criteria",
    "actions",
    "resources",
    "requiresApproval",
    "maxAttempts",
    "maxAuthorizationAgeMs",
    "features"
  ],
  "additionalProperties": false
}
```

</details>

## Grant

Shared validated record. Consult the concept guide for the trust and lifecycle meaning of its fields.

| Field | Required | Shape and bounds |
|---|---|---|
| id | Yes | string; minLength=1; maxLength=256 |
| parentId | No | string; minLength=1; maxLength=256 |
| subject | Yes | string; minLength=1; maxLength=256 |
| profile | Yes | string; minLength=1; maxLength=256 |
| actions | Yes | array of string; minLength=1; maxLength=256; maxItems=1000; uniqueItems=true |
| resources | Yes | array of string; minLength=1; maxLength=256; maxItems=1000; uniqueItems=true |
| notBefore | Yes | string; pattern ^(0\|[1-9][0-9]*)$; maxLength=100 |
| expiresAt | Yes | string; pattern ^(0\|[1-9][0-9]*)$; maxLength=100 |
| limit | Yes | string; pattern ^(0\|[1-9][0-9]*)$; maxLength=100 |
| canDelegate | Yes | boolean |
| depth | Yes | string; pattern ^(0\|[1-9][0-9]*)$; maxLength=100 |

<details>
<summary>Exact Grant schema</summary>

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "parentId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "subject": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "profile": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "actions": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 256
      },
      "uniqueItems": true,
      "maxItems": 1000
    },
    "resources": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 256
      },
      "uniqueItems": true,
      "maxItems": 1000
    },
    "notBefore": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]*)$",
      "maxLength": 100
    },
    "expiresAt": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]*)$",
      "maxLength": 100
    },
    "limit": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]*)$",
      "maxLength": 100
    },
    "canDelegate": {
      "type": "boolean"
    },
    "depth": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]*)$",
      "maxLength": 100
    }
  },
  "required": [
    "id",
    "subject",
    "profile",
    "actions",
    "resources",
    "notBefore",
    "expiresAt",
    "limit",
    "canDelegate",
    "depth"
  ],
  "additionalProperties": false
}
```

</details>

## Approval

Shared validated record. Consult the concept guide for the trust and lifecycle meaning of its fields.

| Field | Required | Shape and bounds |
|---|---|---|
| id | Yes | string; minLength=1; maxLength=256 |
| runId | Yes | string; minLength=1; maxLength=256 |
| approver | Yes | string; minLength=1; maxLength=256 |
| fingerprint | Yes | string; minLength=1; maxLength=256 |
| expiresAt | Yes | string; pattern ^(0\|[1-9][0-9]*)$; maxLength=100 |
| uses | Yes | string; pattern ^(0\|[1-9][0-9]*)$; maxLength=100 |

<details>
<summary>Exact Approval schema</summary>

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "approver": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "fingerprint": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "expiresAt": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]*)$",
      "maxLength": 100
    },
    "uses": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]*)$",
      "maxLength": 100
    }
  },
  "required": [
    "id",
    "runId",
    "approver",
    "fingerprint",
    "expiresAt",
    "uses"
  ],
  "additionalProperties": false
}
```

</details>

## Action

Shared validated record. Consult the concept guide for the trust and lifecycle meaning of its fields.

| Field | Required | Shape and bounds |
|---|---|---|
| capability | Yes | string; minLength=1; maxLength=256 |
| resource | Yes | string; minLength=1; maxLength=256 |
| payload | Yes | object |
| preconditions | Yes | object |

<details>
<summary>Exact Action schema</summary>

```json
{
  "type": "object",
  "properties": {
    "capability": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "resource": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "payload": {
      "type": "object"
    },
    "preconditions": {
      "type": "object"
    }
  },
  "required": [
    "capability",
    "resource",
    "payload",
    "preconditions"
  ],
  "additionalProperties": false
}
```

</details>

## Trigger

Shared validated record. Consult the concept guide for the trust and lifecycle meaning of its fields.

| Field | Required | Shape and bounds |
|---|---|---|
| id | Yes | string; minLength=1; maxLength=256 |
| revision | Yes | string; minLength=1; maxLength=256 |
| kind | Yes | "MANUAL" / "SCHEDULED" / "EVENT" / "RESOURCE_CHANGE" / "CONDITION" / "WORKFLOW_LIFECYCLE" / "EXTERNAL_RESPONSE" |
| source | Yes | string; minLength=1; maxLength=256 |
| eventType | Yes | string; minLength=1; maxLength=256 |
| contractId | Yes | string; minLength=1; maxLength=256 |
| action | Yes | "START_RUN" / "RESUME_WAIT" |
| waitId | No | string; minLength=1; maxLength=256 |
| enabled | Yes | boolean |
| notBefore | Yes | string; pattern ^(0\|[1-9][0-9]*)$; maxLength=100 |
| expiresAt | Yes | string; pattern ^(0\|[1-9][0-9]*)$; maxLength=100 |
| maxAgeMs | Yes | string; pattern ^(0\|[1-9][0-9]*)$; maxLength=100 |
| maxConcurrent | Yes | string; pattern ^(0\|[1-9][0-9]*)$; maxLength=100 |
| rateLimit | Yes | string; pattern ^(0\|[1-9][0-9]*)$; maxLength=100 |
| rateWindowMs | Yes | string; pattern ^(0\|[1-9][0-9]*)$; maxLength=100 |
| maxDepth | Yes | string; pattern ^(0\|[1-9][0-9]*)$; maxLength=100 |
| conditionMode | No | "EDGE" / "LEVEL" |
| schedule | No | object; closed object |
| filter | No | object; closed object |

<details>
<summary>Exact Trigger schema</summary>

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "revision": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "kind": {
      "enum": [
        "MANUAL",
        "SCHEDULED",
        "EVENT",
        "RESOURCE_CHANGE",
        "CONDITION",
        "WORKFLOW_LIFECYCLE",
        "EXTERNAL_RESPONSE"
      ]
    },
    "source": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "eventType": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "contractId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "action": {
      "enum": [
        "START_RUN",
        "RESUME_WAIT"
      ]
    },
    "waitId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "enabled": {
      "type": "boolean"
    },
    "notBefore": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]*)$",
      "maxLength": 100
    },
    "expiresAt": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]*)$",
      "maxLength": 100
    },
    "maxAgeMs": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]*)$",
      "maxLength": 100
    },
    "maxConcurrent": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]*)$",
      "maxLength": 100
    },
    "rateLimit": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]*)$",
      "maxLength": 100
    },
    "rateWindowMs": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]*)$",
      "maxLength": 100
    },
    "maxDepth": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]*)$",
      "maxLength": 100
    },
    "conditionMode": {
      "enum": [
        "EDGE",
        "LEVEL"
      ]
    },
    "schedule": {
      "type": "object",
      "properties": {
        "startMs": {
          "type": "string",
          "pattern": "^(0|[1-9][0-9]*)$",
          "maxLength": 100
        },
        "intervalMs": {
          "type": "string",
          "pattern": "^(0|[1-9][0-9]*)$",
          "maxLength": 100
        },
        "catchUp": {
          "enum": [
            "SKIP",
            "LATEST",
            "ALL"
          ]
        },
        "maxCatchUp": {
          "type": "string",
          "pattern": "^(0|[1-9][0-9]*)$",
          "maxLength": 100
        }
      },
      "required": [
        "startMs",
        "intervalMs",
        "catchUp",
        "maxCatchUp"
      ],
      "additionalProperties": false
    },
    "filter": {
      "type": "object",
      "properties": {
        "field": {
          "type": "string",
          "minLength": 1,
          "maxLength": 256
        },
        "equals": {}
      },
      "required": [
        "field",
        "equals"
      ],
      "additionalProperties": false
    }
  },
  "required": [
    "id",
    "revision",
    "kind",
    "source",
    "eventType",
    "contractId",
    "action",
    "enabled",
    "notBefore",
    "expiresAt",
    "maxAgeMs",
    "maxConcurrent",
    "rateLimit",
    "rateWindowMs",
    "maxDepth"
  ],
  "additionalProperties": false
}
```

</details>

## TriggerEvent

Shared validated record. Consult the concept guide for the trust and lifecycle meaning of its fields.

| Field | Required | Shape and bounds |
|---|---|---|
| id | Yes | string; minLength=1; maxLength=256 |
| source | Yes | string; minLength=1; maxLength=256 |
| type | Yes | string; minLength=1; maxLength=256 |
| occurredAt | Yes | string; pattern ^(0\|[1-9][0-9]*)$; maxLength=100 |
| data | Yes | object |
| correlation | No | string; minLength=1; maxLength=256 |
| depth | Yes | string; pattern ^(0\|[1-9][0-9]*)$; maxLength=100 |

<details>
<summary>Exact TriggerEvent schema</summary>

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "source": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "type": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "occurredAt": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]*)$",
      "maxLength": 100
    },
    "data": {
      "type": "object"
    },
    "correlation": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "depth": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]*)$",
      "maxLength": 100
    }
  },
  "required": [
    "id",
    "source",
    "type",
    "occurredAt",
    "data",
    "depth"
  ],
  "additionalProperties": false
}
```

</details>

## Node

Shared validated record. Consult the concept guide for the trust and lifecycle meaning of its fields.

| Field | Required | Shape and bounds |
|---|---|---|
| id | Yes | string; minLength=1; maxLength=256 |
| kind | Yes | "TASK" / "DECISION" / "FORK" / "JOIN" / "LOOP" / "WAIT" / "APPROVAL" / "SUBWORKFLOW" / "VERIFICATION" / "ACCEPTANCE" / "RECONCILIATION" / "COMPENSATION" / "END" |
| dependsOn | Yes | array of string; minLength=1; maxLength=256; maxItems=1000; uniqueItems=true |
| config | Yes | object |
| inputSchema | No | object |
| outputSchema | No | object |

<details>
<summary>Exact Node schema</summary>

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "kind": {
      "enum": [
        "TASK",
        "DECISION",
        "FORK",
        "JOIN",
        "LOOP",
        "WAIT",
        "APPROVAL",
        "SUBWORKFLOW",
        "VERIFICATION",
        "ACCEPTANCE",
        "RECONCILIATION",
        "COMPENSATION",
        "END"
      ]
    },
    "dependsOn": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 256
      },
      "uniqueItems": true,
      "maxItems": 1000
    },
    "config": {
      "type": "object"
    },
    "inputSchema": {
      "type": "object"
    },
    "outputSchema": {
      "type": "object"
    }
  },
  "required": [
    "id",
    "kind",
    "dependsOn",
    "config"
  ],
  "additionalProperties": false
}
```

</details>

## Graph

Shared validated record. Consult the concept guide for the trust and lifecycle meaning of its fields.

| Field | Required | Shape and bounds |
|---|---|---|
| id | Yes | string; minLength=1; maxLength=256 |
| revision | Yes | string; minLength=1; maxLength=256 |
| nodes | Yes | array of Node; minItems=1; maxItems=1000 |

<details>
<summary>Exact Graph schema</summary>

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "revision": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "nodes": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/Node"
      },
      "minItems": 1,
      "maxItems": 1000
    }
  },
  "required": [
    "id",
    "revision",
    "nodes"
  ],
  "additionalProperties": false
}
```

</details>

## Context

Shared validated record. Consult the concept guide for the trust and lifecycle meaning of its fields.

| Field | Required | Shape and bounds |
|---|---|---|
| actor | Yes | string; minLength=1; maxLength=256 |
| policyRevision | Yes | string; minLength=1; maxLength=256 |
| decisionClass | Yes | "DETERMINISTIC" / "HUMAN" / "MODEL" / "DELEGATED" |
| correlationId | No | string; minLength=1; maxLength=256 |
| causationId | No | string; minLength=1; maxLength=256 |
| traceId | No | string; pattern ^[0-9a-f]{32}$ |
| parentSpanId | No | string; pattern ^[0-9a-f]{16}$ |

<details>
<summary>Exact Context schema</summary>

```json
{
  "type": "object",
  "properties": {
    "actor": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "policyRevision": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "decisionClass": {
      "enum": [
        "DETERMINISTIC",
        "HUMAN",
        "MODEL",
        "DELEGATED"
      ]
    },
    "correlationId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "causationId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "traceId": {
      "type": "string",
      "pattern": "^[0-9a-f]{32}$"
    },
    "parentSpanId": {
      "type": "string",
      "pattern": "^[0-9a-f]{16}$"
    }
  },
  "required": [
    "actor",
    "policyRevision",
    "decisionClass"
  ],
  "additionalProperties": false
}
```

</details>

## startRun

Creates a run record; it does not start a process.

| Field | Required | Shape and bounds |
|---|---|---|
| type | Yes | constant "startRun" |
| runId | Yes | string; minLength=1; maxLength=256 |
| context | No | Context |

<details>
<summary>Exact startRun schema</summary>

```json
{
  "type": "object",
  "properties": {
    "type": {
      "const": "startRun"
    },
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "context": {
      "$ref": "#/$defs/Context"
    }
  },
  "required": [
    "type",
    "runId"
  ],
  "additionalProperties": false
}
```

</details>

## continueRun

Records continuation and changes the recovery ownership epoch. Preserve unsettled exposure.

| Field | Required | Shape and bounds |
|---|---|---|
| type | Yes | constant "continueRun" |
| runId | Yes | string; minLength=1; maxLength=256 |
| segmentId | Yes | string; minLength=1; maxLength=256 |
| context | No | Context |

<details>
<summary>Exact continueRun schema</summary>

```json
{
  "type": "object",
  "properties": {
    "type": {
      "const": "continueRun"
    },
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "segmentId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "context": {
      "$ref": "#/$defs/Context"
    }
  },
  "required": [
    "type",
    "runId",
    "segmentId"
  ],
  "additionalProperties": false
}
```

</details>

## activatePlan

Checks the expected current plan revision before activation. This does not mutate an attached graph.

| Field | Required | Shape and bounds |
|---|---|---|
| type | Yes | constant "activatePlan" |
| runId | Yes | string; minLength=1; maxLength=256 |
| planId | Yes | string; minLength=1; maxLength=256 |
| expectedPlan | Yes | string; minLength=1; maxLength=256 |
| context | No | Context |

<details>
<summary>Exact activatePlan schema</summary>

```json
{
  "type": "object",
  "properties": {
    "type": {
      "const": "activatePlan"
    },
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "planId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "expectedPlan": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "context": {
      "$ref": "#/$defs/Context"
    }
  },
  "required": [
    "type",
    "runId",
    "planId",
    "expectedPlan"
  ],
  "additionalProperties": false
}
```

</details>

## missionState

Changes mission admission state subject to reducer rules; it is not an operating-system process control.

| Field | Required | Shape and bounds |
|---|---|---|
| type | Yes | constant "missionState" |
| state | Yes | "OPEN" / "SUSPENDED" / "CLOSED" |
| context | No | Context |

<details>
<summary>Exact missionState schema</summary>

```json
{
  "type": "object",
  "properties": {
    "type": {
      "const": "missionState"
    },
    "state": {
      "enum": [
        "OPEN",
        "SUSPENDED",
        "CLOSED"
      ]
    },
    "context": {
      "$ref": "#/$defs/Context"
    }
  },
  "required": [
    "type",
    "state"
  ],
  "additionalProperties": false
}
```

</details>

## grant

Registers a finite grant. The host must enforce authenticated human approval for changes to agent permissions or resource limits.

| Field | Required | Shape and bounds |
|---|---|---|
| type | Yes | constant "grant" |
| grant | Yes | Grant |
| context | No | Context |

<details>
<summary>Exact grant schema</summary>

```json
{
  "type": "object",
  "properties": {
    "type": {
      "const": "grant"
    },
    "grant": {
      "$ref": "#/$defs/Grant"
    },
    "context": {
      "$ref": "#/$defs/Context"
    }
  },
  "required": [
    "type",
    "grant"
  ],
  "additionalProperties": false
}
```

</details>

## revokeGrant

Revokes authority. Already-applied effects remain facts that may require separately governed compensation.

| Field | Required | Shape and bounds |
|---|---|---|
| type | Yes | constant "revokeGrant" |
| grantId | Yes | string; minLength=1; maxLength=256 |
| context | No | Context |

<details>
<summary>Exact revokeGrant schema</summary>

```json
{
  "type": "object",
  "properties": {
    "type": {
      "const": "revokeGrant"
    },
    "grantId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "context": {
      "$ref": "#/$defs/Context"
    }
  },
  "required": [
    "type",
    "grantId"
  ],
  "additionalProperties": false
}
```

</details>

## approve

Records approval of an exact action fingerprint; host authentication is required.

| Field | Required | Shape and bounds |
|---|---|---|
| type | Yes | constant "approve" |
| approval | Yes | Approval |
| context | No | Context |

<details>
<summary>Exact approve schema</summary>

```json
{
  "type": "object",
  "properties": {
    "type": {
      "const": "approve"
    },
    "approval": {
      "$ref": "#/$defs/Approval"
    },
    "context": {
      "$ref": "#/$defs/Context"
    }
  },
  "required": [
    "type",
    "approval"
  ],
  "additionalProperties": false
}
```

</details>

## withdrawApproval

Withdraws approval for future gated use; it does not undo an effect.

| Field | Required | Shape and bounds |
|---|---|---|
| type | Yes | constant "withdrawApproval" |
| approvalId | Yes | string; minLength=1; maxLength=256 |
| context | No | Context |

<details>
<summary>Exact withdrawApproval schema</summary>

```json
{
  "type": "object",
  "properties": {
    "type": {
      "const": "withdrawApproval"
    },
    "approvalId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "context": {
      "$ref": "#/$defs/Context"
    }
  },
  "required": [
    "type",
    "approvalId"
  ],
  "additionalProperties": false
}
```

</details>

## admit

Reserves exposure and creates an operation/attempt under current finite policy. It does not call an adapter.

| Field | Required | Shape and bounds |
|---|---|---|
| type | Yes | constant "admit" |
| runId | Yes | string; minLength=1; maxLength=256 |
| operationId | Yes | string; minLength=1; maxLength=256 |
| attemptId | Yes | string; minLength=1; maxLength=256 |
| grantId | Yes | string; minLength=1; maxLength=256 |
| subject | Yes | string; minLength=1; maxLength=256 |
| approvalId | No | string; minLength=1; maxLength=256 |
| action | Yes | Action |
| amount | Yes | string; pattern ^(0\|[1-9][0-9]*)$; maxLength=100 |
| authorizationCheckedAt | Yes | string; pattern ^(0\|[1-9][0-9]*)$; maxLength=100 |
| policy | Yes | "ALLOW" / "DENY" / "INDETERMINATE" |
| mandatoryChecksOk | Yes | boolean |
| context | No | Context |

<details>
<summary>Exact admit schema</summary>

```json
{
  "type": "object",
  "properties": {
    "type": {
      "const": "admit"
    },
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "operationId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "attemptId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "grantId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "subject": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "approvalId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "action": {
      "$ref": "#/$defs/Action"
    },
    "amount": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]*)$",
      "maxLength": 100
    },
    "authorizationCheckedAt": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]*)$",
      "maxLength": 100
    },
    "policy": {
      "enum": [
        "ALLOW",
        "DENY",
        "INDETERMINATE"
      ]
    },
    "mandatoryChecksOk": {
      "type": "boolean"
    },
    "context": {
      "$ref": "#/$defs/Context"
    }
  },
  "required": [
    "type",
    "runId",
    "operationId",
    "attemptId",
    "grantId",
    "subject",
    "action",
    "amount",
    "authorizationCheckedAt",
    "policy",
    "mandatoryChecksOk"
  ],
  "additionalProperties": false
}
```

</details>

## dispatch

Commits the attempt claim and rechecks gates. Use Coordinator.dispatch for the external-call boundary.

| Field | Required | Shape and bounds |
|---|---|---|
| type | Yes | constant "dispatch" |
| attemptId | Yes | string; minLength=1; maxLength=256 |
| nodeId | No | string; minLength=1; maxLength=256 |
| authorizationCheckedAt | Yes | string; pattern ^(0\|[1-9][0-9]*)$; maxLength=100 |
| policy | Yes | "ALLOW" / "DENY" / "INDETERMINATE" |
| mandatoryChecksOk | Yes | boolean |
| context | No | Context |

<details>
<summary>Exact dispatch schema</summary>

```json
{
  "type": "object",
  "properties": {
    "type": {
      "const": "dispatch"
    },
    "attemptId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "nodeId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "authorizationCheckedAt": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]*)$",
      "maxLength": 100
    },
    "policy": {
      "enum": [
        "ALLOW",
        "DENY",
        "INDETERMINATE"
      ]
    },
    "mandatoryChecksOk": {
      "type": "boolean"
    },
    "context": {
      "$ref": "#/$defs/Context"
    }
  },
  "required": [
    "type",
    "attemptId",
    "authorizationCheckedAt",
    "policy",
    "mandatoryChecksOk"
  ],
  "additionalProperties": false
}
```

</details>

## settle

Records a reported external outcome and actual cost. UNKNOWN preserves unresolved exposure.

| Field | Required | Shape and bounds |
|---|---|---|
| type | Yes | constant "settle" |
| attemptId | Yes | string; minLength=1; maxLength=256 |
| effect | Yes | "CONFIRMED_APPLIED" / "CONFIRMED_NOT_APPLIED" / "UNKNOWN" |
| actualCost | Yes | string; pattern ^(0\|[1-9][0-9]*)$; maxLength=100 |
| context | No | Context |

<details>
<summary>Exact settle schema</summary>

```json
{
  "type": "object",
  "properties": {
    "type": {
      "const": "settle"
    },
    "attemptId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "effect": {
      "enum": [
        "CONFIRMED_APPLIED",
        "CONFIRMED_NOT_APPLIED",
        "UNKNOWN"
      ]
    },
    "actualCost": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]*)$",
      "maxLength": 100
    },
    "context": {
      "$ref": "#/$defs/Context"
    }
  },
  "required": [
    "type",
    "attemptId",
    "effect",
    "actualCost"
  ],
  "additionalProperties": false
}
```

</details>

## retry

Prepares a new attempt only when the previous effect is confirmed not applied and limits allow it.

| Field | Required | Shape and bounds |
|---|---|---|
| type | Yes | constant "retry" |
| operationId | Yes | string; minLength=1; maxLength=256 |
| attemptId | Yes | string; minLength=1; maxLength=256 |
| amount | Yes | string; pattern ^(0\|[1-9][0-9]*)$; maxLength=100 |
| authorizationCheckedAt | Yes | string; pattern ^(0\|[1-9][0-9]*)$; maxLength=100 |
| policy | Yes | "ALLOW" / "DENY" / "INDETERMINATE" |
| mandatoryChecksOk | Yes | boolean |
| context | No | Context |

<details>
<summary>Exact retry schema</summary>

```json
{
  "type": "object",
  "properties": {
    "type": {
      "const": "retry"
    },
    "operationId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "attemptId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "amount": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]*)$",
      "maxLength": 100
    },
    "authorizationCheckedAt": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]*)$",
      "maxLength": 100
    },
    "policy": {
      "enum": [
        "ALLOW",
        "DENY",
        "INDETERMINATE"
      ]
    },
    "mandatoryChecksOk": {
      "type": "boolean"
    },
    "context": {
      "$ref": "#/$defs/Context"
    }
  },
  "required": [
    "type",
    "operationId",
    "attemptId",
    "amount",
    "authorizationCheckedAt",
    "policy",
    "mandatoryChecksOk"
  ],
  "additionalProperties": false
}
```

</details>

## wait

Creates a correlated wait record. It does not change run execution state or start a timer service automatically.

| Field | Required | Shape and bounds |
|---|---|---|
| type | Yes | constant "wait" |
| runId | Yes | string; minLength=1; maxLength=256 |
| waitId | Yes | string; minLength=1; maxLength=256 |
| correlation | Yes | string; minLength=1; maxLength=256 |
| deadline | Yes | string; pattern ^(0\|[1-9][0-9]*)$; maxLength=100 |
| kind | Yes | "INPUT" / "AUTHORIZATION" / "EXTERNAL" / "TIMER" / "RECONCILIATION" |
| context | No | Context |

<details>
<summary>Exact wait schema</summary>

```json
{
  "type": "object",
  "properties": {
    "type": {
      "const": "wait"
    },
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "waitId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "correlation": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "deadline": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]*)$",
      "maxLength": 100
    },
    "kind": {
      "enum": [
        "INPUT",
        "AUTHORIZATION",
        "EXTERNAL",
        "TIMER",
        "RECONCILIATION"
      ]
    },
    "context": {
      "$ref": "#/$defs/Context"
    }
  },
  "required": [
    "type",
    "runId",
    "waitId",
    "correlation",
    "deadline",
    "kind"
  ],
  "additionalProperties": false
}
```

</details>

## resume

Satisfies a matching wait; it does not grant general authority or execute the next step.

| Field | Required | Shape and bounds |
|---|---|---|
| type | Yes | constant "resume" |
| waitId | Yes | string; minLength=1; maxLength=256 |
| correlation | Yes | string; minLength=1; maxLength=256 |
| context | No | Context |

<details>
<summary>Exact resume schema</summary>

```json
{
  "type": "object",
  "properties": {
    "type": {
      "const": "resume"
    },
    "waitId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "correlation": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "context": {
      "$ref": "#/$defs/Context"
    }
  },
  "required": [
    "type",
    "waitId",
    "correlation"
  ],
  "additionalProperties": false
}
```

</details>

## join

Checks the supplied wait set under ALL/ANY semantics and can move a WAITING run to READY.

| Field | Required | Shape and bounds |
|---|---|---|
| type | Yes | constant "join" |
| runId | Yes | string; minLength=1; maxLength=256 |
| waitIds | Yes | array of string; minLength=1; maxLength=256; maxItems=1000; uniqueItems=true |
| mode | Yes | "ALL" / "ANY" |
| context | No | Context |

<details>
<summary>Exact join schema</summary>

```json
{
  "type": "object",
  "properties": {
    "type": {
      "const": "join"
    },
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "waitIds": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 256
      },
      "uniqueItems": true,
      "maxItems": 1000
    },
    "mode": {
      "enum": [
        "ALL",
        "ANY"
      ]
    },
    "context": {
      "$ref": "#/$defs/Context"
    }
  },
  "required": [
    "type",
    "runId",
    "waitIds",
    "mode"
  ],
  "additionalProperties": false
}
```

</details>

## transition

Changes execution state subject to allowed transitions and unsettled-work checks.

| Field | Required | Shape and bounds |
|---|---|---|
| type | Yes | constant "transition" |
| runId | Yes | string; minLength=1; maxLength=256 |
| to | Yes | "READY" / "RUNNING" / "WAITING" / "PAUSED" / "CANCELING" / "COMPLETED" / "FAILED" / "CANCELED" / "REJECTED" |
| context | No | Context |

<details>
<summary>Exact transition schema</summary>

```json
{
  "type": "object",
  "properties": {
    "type": {
      "const": "transition"
    },
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "to": {
      "enum": [
        "READY",
        "RUNNING",
        "WAITING",
        "PAUSED",
        "CANCELING",
        "COMPLETED",
        "FAILED",
        "CANCELED",
        "REJECTED"
      ]
    },
    "context": {
      "$ref": "#/$defs/Context"
    }
  },
  "required": [
    "type",
    "runId",
    "to"
  ],
  "additionalProperties": false
}
```

</details>

## verify

Records verification for the current subject and criteria. The host supplies truthful measured evidence.

| Field | Required | Shape and bounds |
|---|---|---|
| type | Yes | constant "verify" |
| runId | Yes | string; minLength=1; maxLength=256 |
| assessor | Yes | string; minLength=1; maxLength=256 |
| revision | Yes | string; minLength=1; maxLength=256 |
| results | Yes | object |
| evidence | Yes | array of string; minLength=1; maxLength=256; maxItems=1000; uniqueItems=true |
| rationale | Yes | string; minLength=1; maxLength=256 |
| context | No | Context |

<details>
<summary>Exact verify schema</summary>

```json
{
  "type": "object",
  "properties": {
    "type": {
      "const": "verify"
    },
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "assessor": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "revision": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "results": {
      "type": "object",
      "additionalProperties": {
        "enum": [
          "PASS",
          "FAIL",
          "INCONCLUSIVE"
        ]
      }
    },
    "evidence": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 256
      },
      "uniqueItems": true,
      "maxItems": 1000
    },
    "rationale": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "context": {
      "$ref": "#/$defs/Context"
    }
  },
  "required": [
    "type",
    "runId",
    "assessor",
    "revision",
    "results",
    "evidence",
    "rationale"
  ],
  "additionalProperties": false
}
```

</details>

## accept

Records an acceptance disposition for the current subject. The host authenticates the assessor.

| Field | Required | Shape and bounds |
|---|---|---|
| type | Yes | constant "accept" |
| runId | Yes | string; minLength=1; maxLength=256 |
| authority | Yes | string; minLength=1; maxLength=256 |
| verificationRevision | Yes | string; minLength=1; maxLength=256 |
| decision | Yes | "ACCEPTED" / "REJECTED" / "DEFERRED" |
| rationale | Yes | string; minLength=1; maxLength=256 |
| context | No | Context |

<details>
<summary>Exact accept schema</summary>

```json
{
  "type": "object",
  "properties": {
    "type": {
      "const": "accept"
    },
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "authority": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "verificationRevision": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "decision": {
      "enum": [
        "ACCEPTED",
        "REJECTED",
        "DEFERRED"
      ]
    },
    "rationale": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "context": {
      "$ref": "#/$defs/Context"
    }
  },
  "required": [
    "type",
    "runId",
    "authority",
    "verificationRevision",
    "decision",
    "rationale"
  ],
  "additionalProperties": false
}
```

</details>

## invalidate

Invalidates an assessment and propagates dependent assessment invalidation.

| Field | Required | Shape and bounds |
|---|---|---|
| type | Yes | constant "invalidate" |
| runId | Yes | string; minLength=1; maxLength=256 |
| reason | Yes | string; minLength=1; maxLength=256 |
| context | No | Context |

<details>
<summary>Exact invalidate schema</summary>

```json
{
  "type": "object",
  "properties": {
    "type": {
      "const": "invalidate"
    },
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "reason": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "context": {
      "$ref": "#/$defs/Context"
    }
  },
  "required": [
    "type",
    "runId",
    "reason"
  ],
  "additionalProperties": false
}
```

</details>

## tickTrigger

Computes and admits scheduled slots with the durable cursor in the same command transaction.

| Field | Required | Shape and bounds |
|---|---|---|
| type | Yes | constant "tickTrigger" |
| triggerId | Yes | string; minLength=1; maxLength=256 |
| context | No | Context |

<details>
<summary>Exact tickTrigger schema</summary>

```json
{
  "type": "object",
  "properties": {
    "type": {
      "const": "tickTrigger"
    },
    "triggerId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "context": {
      "$ref": "#/$defs/Context"
    }
  },
  "required": [
    "type",
    "triggerId"
  ],
  "additionalProperties": false
}
```

</details>

## registerTrigger

Registers a fixed trigger definition. No updateTrigger or disableTrigger command exists in this profile.

| Field | Required | Shape and bounds |
|---|---|---|
| type | Yes | constant "registerTrigger" |
| trigger | Yes | Trigger |
| context | No | Context |

<details>
<summary>Exact registerTrigger schema</summary>

```json
{
  "type": "object",
  "properties": {
    "type": {
      "const": "registerTrigger"
    },
    "trigger": {
      "$ref": "#/$defs/Trigger"
    },
    "context": {
      "$ref": "#/$defs/Context"
    }
  },
  "required": [
    "type",
    "trigger"
  ],
  "additionalProperties": false
}
```

</details>

## fireTrigger

Validates an event against its trigger and retains receipt identity. The host authenticates the event source.

| Field | Required | Shape and bounds |
|---|---|---|
| type | Yes | constant "fireTrigger" |
| triggerId | Yes | string; minLength=1; maxLength=256 |
| event | Yes | TriggerEvent |
| runId | Yes | string; minLength=1; maxLength=256 |
| context | No | Context |

<details>
<summary>Exact fireTrigger schema</summary>

```json
{
  "type": "object",
  "properties": {
    "type": {
      "const": "fireTrigger"
    },
    "triggerId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "event": {
      "$ref": "#/$defs/TriggerEvent"
    },
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "context": {
      "$ref": "#/$defs/Context"
    }
  },
  "required": [
    "type",
    "triggerId",
    "event",
    "runId"
  ],
  "additionalProperties": false
}
```

</details>

## registerGraph

Validates and registers the graph; this does not attach it or execute nodes.

| Field | Required | Shape and bounds |
|---|---|---|
| type | Yes | constant "registerGraph" |
| graph | Yes | Graph |
| context | No | Context |

<details>
<summary>Exact registerGraph schema</summary>

```json
{
  "type": "object",
  "properties": {
    "type": {
      "const": "registerGraph"
    },
    "graph": {
      "$ref": "#/$defs/Graph"
    },
    "context": {
      "$ref": "#/$defs/Context"
    }
  },
  "required": [
    "type",
    "graph"
  ],
  "additionalProperties": false
}
```

</details>

## attachGraph

Attaches a graph before graph-bound work. The current attached graph cannot be mutated.

| Field | Required | Shape and bounds |
|---|---|---|
| type | Yes | constant "attachGraph" |
| runId | Yes | string; minLength=1; maxLength=256 |
| graphId | Yes | string; minLength=1; maxLength=256 |
| context | No | Context |

<details>
<summary>Exact attachGraph schema</summary>

```json
{
  "type": "object",
  "properties": {
    "type": {
      "const": "attachGraph"
    },
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "graphId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "context": {
      "$ref": "#/$defs/Context"
    }
  },
  "required": [
    "type",
    "runId",
    "graphId"
  ],
  "additionalProperties": false
}
```

</details>

## completeNode

Records a node checkpoint after node-kind proof and schema checks. Completion does not imply final acceptance.

| Field | Required | Shape and bounds |
|---|---|---|
| type | Yes | constant "completeNode" |
| runId | Yes | string; minLength=1; maxLength=256 |
| nodeId | Yes | string; minLength=1; maxLength=256 |
| result | Yes | object |
| context | No | Context |

<details>
<summary>Exact completeNode schema</summary>

```json
{
  "type": "object",
  "properties": {
    "type": {
      "const": "completeNode"
    },
    "runId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "nodeId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "result": {
      "type": "object"
    },
    "context": {
      "$ref": "#/$defs/Context"
    }
  },
  "required": [
    "type",
    "runId",
    "nodeId",
    "result"
  ],
  "additionalProperties": false
}
```

</details>
