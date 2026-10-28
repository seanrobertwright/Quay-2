# Portable worker access policy

M8 slice 4A defines a portable access-policy contract. It validates what workflows and
nodes request; it does not authorize execution or enforce operating-system isolation.
The existing accepted developer profile and D-M6-01 remain unchanged.

## Where policy belongs

Installation policy establishes the maximum permitted scope. A workflow declares its
reviewed access scope; each node declares the subset it needs. Host adapters resolve
logical resources and enforce restrictions on Windows, macOS or Linux. Missing host
capabilities must block the future governed execution path rather than weaken it.

A separate `WorkflowAccess` document identifies the work order/run, contains a versioned
`Policy`, and lists `NodeAccess` entries. Resources use logical names, such as `workspace`
or `package-registry`. The policy pins the resource catalog by digest; paths, account
identities and secret handles belong in protected host configuration. Nodes cannot
invent additional rights or place plaintext credentials in the document.

| Kind | Actions | Example |
| --- | --- | --- |
| FILESYSTEM | READ, WRITE | Task workspace or source snapshot |
| TOOL | EXECUTE | Reviewed build tool and invocation |
| NETWORK | CONNECT | Approved package registry |
| CREDENTIAL | USE | Credential reference scoped to one attempt |
| ARTIFACT | PUBLISH | Local governed output collection |
| EXTERNAL_EFFECT | COMMIT | Explicitly authorized code push or deployment |

Empty lists mean no access. Missing fields, wildcards, duplicate entries, unknown fields,
invalid actions and node requests beyond workflow scope are rejected. No access is
implied by a tool name, an output path, an agent instruction or an existing desktop login.

## Source SDK APIs

These experimental source modules provide strict decode, validate, canonical encode and
SHA-256 digest operations. They are not included in already published SDK binaries.

| SDK | Module | Decode / encode / digest |
| --- | --- | --- |
| TypeScript | `@aiws/sdk/access-policy` | `decodeAccessPolicy`, `encodeAccessPolicy`, `accessPolicyDigest` |
| Python | `aiws.access_policy` | `decode_access_policy`, `encode_access_policy`, `access_policy_digest` |
| Rust | `aiws_sdk::access_policy` | `decode_access_policy`, `encode_access_policy`, `access_policy_digest` |

Each operation accepts a document kind: `WorkflowAccess`, `Policy`, `NodeAccess`,
`Grant` or `BindingPreview`. TypeScript/Python default to `WorkflowAccess`; Rust requires
the kind argument. Generated records accompany the codecs. Runtime validation remains
required even when a language's record type accepts a value.

A `BindingPreview` lists proposed definition, policy, catalog and attempt pins. Its
`authorized` and `enforced` fields must both be `false`. Validation checks shape and
workflow/node consistency; it cannot establish that a catalog exists, a human approved
it, a host permits it or a sandbox actually enforces it.

## First example

The [example access document](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/examples/access-policy/build-workflow.json)
models preparation, build/test and artifact collection. Preparation can request registry
access; build/test has no network grant; collection can publish local artifacts. It has
no live credentials or external publication authority. Its catalog digest is a fixture
placeholder, and it is not executable deployment configuration.

## Delivery sequence

- **4A:** portable contract, schema, SDK parity, binding rules and example.
- **4B:** shared admission/enforcement integration, resource resolution, approval and attempt binding, policy changes and revocation.
- **4C:** real platform identity, secrets, permissions, IPC and containment adapters. Existing Windows DPAPI is an initial component here.
- **4D:** integrated positive/negative qualification per platform.

Existing workflow/control schemas and runtime behavior remain unchanged in 4A. Wiring
this policy into execution requires an explicit reviewed transition in 4B; existing
workflows do not acquire permissions or isolation claims automatically. Agent context
policy remains instruction/evidence selection and cannot enforce access restrictions.

See the [contract and mapping](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/spec/engine-v1/ACCESS-POLICY.md)
and M8 qualification plan (not in this pack).


## Initial engine preflight (4B)

4A contract checks passed in [hosted CI](https://github.com/seanrobertwright/AI-WS-SDK/actions/runs/36834514327).
4B is in progress. The engine can now compare the host ceiling and workflow/node
requests against a pinned catalog of binding references and an exact workflow definition.
Missing resources, changed catalogs, excessive scope and identity/node mismatches block
the report. Even COMPATIBLE reports retain `authorized:false` and `enforced:false`.
The preflight checks references, not native resource existence or OS enforcement.

The internal dispatch material can carry an access-policy digest, which changes its
approval-bound material. Such requests are deliberately held before readiness checks
or reservation until the full enforcement path exists. Removing that digest cannot
reuse an approval recorded with it. Existing unmarked developer flows remain unchanged.
This is not a new executable workflow field or public control API.

Concrete descriptor validation and durable reviewed-intent records are now implemented.
Coding-plan binding and worker delivery/revocation fences are also implemented. Executable
attempt permits, native probes, current principal scope and OS cancellation remain open. See the
[4B execution record](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/docs/M8-SLICE4B-POLICY-ENFORCEMENT.md).


### Concrete host bindings and reviewed intent

Protected host configuration now describes canonical filesystem roots and identity pins,
exact tool executable hashes and arguments, specific HTTPS destinations, scoped credential
references, governed artifact stores and explicitly approved external operations. Catalog
hashes pin those descriptions. The engine rejects changed descriptions, unresolved entries
and external actions missing their per-node network or credential dependencies.

This validates declared constraints; it does not inspect real filesystem permissions,
classify resolved network addresses or establish a sandbox. Those checks require the
platform adapters. Credentials remain opaque references delivered through an attempt
channel; tool arguments and environment configuration must never carry secret values.

A trusted storage operation can record the reviewed pins together with matching approval
material, authorization revision and coordinator epoch in one transaction. Changing a
registered task requires a fresh approval ID and the expected review revision. Registered
tasks remain blocked at the repository even if a caller removes the optional policy marker.
Revocation preserves the historical reviews and revokes the matching dispatch approval.

These records represent reviewed intent, not running attempts. OS termination and actual
credential revocation remain open. The optional storage component is checked on reopen;
older binaries do not understand its hold, so using an older candidate on this data is
not a supported downgrade. No production or expanded platform claim is enabled.

### Bind a coding plan before approval

Trusted host code can preview and bind access policy before initial human approval using
`previewAccessPolicy` and `bindAccessPolicy`. The binding covers the plan, workspace,
exact stage commands and output paths, and changes the approval subject. The coding
interpreter currently uses one composite node whose scope covers all three stages;
separate stage scopes are not implemented. Bound plans cannot be edited or assigned a
replacement agent without creating separately reviewed work.

`revokeAccessPolicy` requires verified human identity and authorization for `REVOKE_ACCESS`
over the current subject. It holds the workflow and fences queued worker delivery. Late
worker results remain evidence with UNKNOWN responsibility, preserving reservations even
when the worker reports success. It does not yet terminate native processes or revoke
provider credentials. Policy-bound execution stays blocked pending platform enforcement.

Bindings store nonsecret host configuration and immutable history. The optional coding
access storage component must not be opened by an older candidate that ignores its hold.
