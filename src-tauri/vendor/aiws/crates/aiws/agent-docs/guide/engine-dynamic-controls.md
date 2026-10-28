# Native dynamic workflow controls

> **Praxis naming:** This page documents **Praxis**, the AIWS workflow engine. Existing `engine/*` source paths, `/engine/...` routes, `aiws-engine/*` protocol identifiers, and existing script names remain unchanged for compatibility.

M7 slice 8 exposes governed workflow decisions through the opt-in `aiws-dynamic-controls/1` HTTPS profile, version 1.0.0. TypeScript, Python and Rust clients speak the same closed contract. Use current GitHub source; baseline SDK binaries and source downloads do not contain these APIs.

## Connect a host

Configure `startControlHost` with `dynamic: {}` and your verified identity adapter. Supply independent replacement/reconciliation verifiers and installed agent adapters for those capabilities. Authorize dynamic operations and command actions per work order. The existing [human control surface](./engine-controls-handoffs.md) remains available, with separate stage approval and deliverable acceptance.

Fetch `/engine/dynamic/v1/session` over verified loopback HTTPS to obtain installation, namespace and current epochs. Keep credentials outside persisted messages. REVIEW returns exact material and impact; it does not confer approval. An explicit verified human decision permits CHALLENGE, followed by the identical EXECUTE command. Replacement requires the assigned agent to acknowledge its exact handoff. Reconciliation still requires independent host evidence.

## Native clients

| Language | Import | Prepare and send |
|---|---|---|
| TypeScript | `@aiws/sdk/dynamic-controls` | `DynamicClient`, `dynamicRequest`, `dynamicHttpsTransport` |
| Python | `aiws.dynamic_controls` | `DynamicClient`, `dynamic_request`, `https_transport` |
| Rust | `aiws_sdk::dynamic_controls` | `DynamicClient`, `dynamic_request`, `https_transport` |

Each client separates preparation from sending so the exact request can be persisted first. The supplied executables read `{ "authorization": "Bearer …", "request": {…} }` from protected stdin and take only the HTTPS origin and CA filename as arguments:

```sh
node examples/dynamic-client.ts https://127.0.0.1:7443 host-ca.pem < protected-input.json
python examples/dynamic_client.py https://127.0.0.1:7443 host-ca.pem < protected-input.json
cargo run --locked -p aiws-sdk --example dynamic_client -- https://127.0.0.1:7443 host-ca.pem < protected-input.json
```

Protect credential input using your host's secret handling. The complete reproducible three-language HTTPS demonstration is `npm run test:dynamic:transports`. It uses labeled test identities, commits one binding and recovers that exact receipt through both other clients. Binding leaves execution awaiting fresh human stage approval.

## CLI and web

The CLI reads `{ "authorization": "Bearer …" }` from protected stdin. `dynamic-session` fetches context; `dynamic-requests` sends a previously saved envelope:

```sh
node engine/src/control-cli.ts https://127.0.0.1:7443 host-ca.pem dynamic-session < credential.json
node engine/src/control-cli.ts https://127.0.0.1:7443 host-ca.pem dynamic-requests request.json < credential.json
```

In the local web interface, inspect work, prepare a binding or paste a SDK-produced command, then **Review change**. Inspect the displayed identities, revision, material and evidence before **Authorize and execute**. Editing the command requires another review. Cookies and CSRF stay within the configured origin.

## Recovery

The web interface saves the exact execute envelope in sessionStorage before transmission. After an uncertain response, use **Retry saved request** or **Look up saved result** as the original actor. Reloading the tab retains pending identity; download the request before closing the tab. Native clients and CLI require the caller to retain the prepared file. No client retries automatically.

A restart invalidates old sessions, envelopes and unused review proofs. Obtain fresh context and LOOKUP the original requestId. A committed receipt survives restart. If commitment remains uncertain, resolve it before issuing a new decision. Activation never refunds prior attempts, reservations or correction history.

The optional database component is additive and guarded. Existing workflows remain unchanged until explicitly bound. Follow the established offline backup/restore policy for upgrades. The shared schema, all eleven actions, exact message limits and authority rules are in `spec/engine-v1/DYNAMIC-CONTROLS.md` in the repository.

## Verification scope

The shared corpus contains 271 cases checked natively in three languages, including valid actions, missing/extra fields, version and JSON failures. Live HTTPS tests and engine recovery tests qualify the local source profile. M7 slice 9 covers integration acceptance. The bounded D-M6-01 local developer profile is complete; broader platform and long-duration qualification remains open in M8.
