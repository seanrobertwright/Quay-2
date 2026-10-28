# Praxis API, CLI and web controls

> **Praxis naming:** This page documents **Praxis**, the AIWS workflow engine. Existing `engine/*` source paths, `/engine/...` routes, `aiws-engine/*` protocol identifiers, and existing script names remain unchanged for compatibility.

The engine source now exposes the composed coding workflow through a common **HTTPS API, CLI client and web control page**. A trusted host supplies identity verification and TLS configuration. Approval, pause, resume, cancellation requests and acceptance use the same transaction boundary regardless of interface.

This is the `aiws-local-coding-controls/1` implementation profile of the checked-in engine wire schema **1.1.0**, built in M5 and complete for its local Node 24 + SQLite profile. The profile operates host-created local workflows; it is not the complete engine command catalog, a standalone enrollment installer, or a released SDK package.

An interactive [control API decision lifecycle](./diagrams.md#control-api-decision-lifecycle) diagram traces inspect, approval challenge, command, receipt and exact-retry replay.

## What is available

| Interface | Implemented behavior |
|---|---|
| Capabilities | Authenticated codec/storage/approval capabilities; exact schema and profile headers |
| Queries | Inspect a pinned work-order revision; list a single complete inventory page; retrieve your durable command receipt |
| Approval challenge | Recently verified human, exact proposal/material, principal and session binding, two-minute maximum expiry |
| Commands | Approve a plan/correction, accept validated work, pause, resume and request cancellation |
| Artifacts | Authorized download of the current projection, plan and deliverable manifest/files |
| CLI | Verified loopback TLS, credential input over a protected pipe, persisted request JSON, structured responses |
| Web | Inspect plan/evidence, see current revision and status, make explicit decisions, retry the same uncertain command |
| Local host | Starts HTTPS and polls configured workflows sequentially; no execution before approval |

Acceptance is an `approve` command over the current acceptance proposal, not an extra unversioned wire command. `APPROVAL` and `WORK_ORDER` references share the local work-order ID in this profile, with distinct kinds and an exact workflow revision. Inspect details supplies the authoritative proposal reference and binding. The immutable local execution contract is the approved plan identified by `local-plan:<planDigest>`; general definition/contract registration and additional runs are not exposed here.

`GET /engine/v1/capabilities` returns only installed profile features. Every response includes `AIWS-Schema-Version: 1.1.0` and `AIWS-Control-Profile: aiws-local-coding-controls/1`. Unsupported commands, enrollment, historical codecs, event streaming and pagination continuations fail explicitly. Advertising the codec means its shapes are understood; it does not mean every catalog operation is implemented.

## Start a configured host

The source requires Node 24. Supply a trusted configuration module, outside request-controlled workspaces. It exports a `ControlHostOptions` object:

```ts
// host-config.ts — schematic wiring; your adapter must verify real identities.

export default {
  database: '/protected/aiws/engine.sqlite',
  workspaceRoot: '/work/aiws',
  artifactRoot: '/protected/aiws/artifacts',
  namespace: 'local',
  tlsKeyFile: '/protected/aiws/tls-key.pem',
  tlsCertificateFile: '/protected/aiws/tls-cert.pem',
  port: 7443,
  identity: identityAdapter,
  plans: JSON.parse(await readFile('/protected/aiws/plans.json', 'utf8')),
} satisfies ControlHostOptions;
```

```sh
node engine/src/control-host.ts ./host-config.ts
```

Paths above are placeholders. Use native protected paths and OS ACLs for your platform. The host listens on **127.0.0.1 and [::1]** on one port, never a wildcard address, and fails to start when another process holds either; it starts without [::1] only on a machine with no IPv6 loopback. It serves either configured TLS material (key and certificate files, or `tlsProvider`) whose certificate names both `127.0.0.1` and the browser host, or, with `identityDirectory` and no TLS material, a key and leaf it generates there on first start. A certificate missing either name fails startup with `TLS_CERTIFICATE_NAMES`, naming both, and an expired one with `TLS_CERTIFICATE_EXPIRED`. It prints two addresses on that port:

- `AIWS controls:` is the **control address**, `https://127.0.0.1:<port>`, for the CLI, the SDK dynamic-control transports and every other non-browser client. It refuses any request that carries a Cookie or Origin header and serves neither the web view nor the `/auth` sign-in routes.
- `Praxis web view:` is the **browser origin**, `https://praxis-<label>.localhost:<port>`, for the web view, sign-in and cookie sessions. The label is the first ten base32 characters of the SHA-256 of the installation ID, fixed for the installation's life. An Origin sent there must equal the browser origin exactly; `https://localhost:<port>` and `https://127.0.0.1:<port>` are refused.

Any other Host is refused, so a DNS-rebinding page, which sends its own name, cannot reach the API. It then prints `Certificate SHA-256:`, the served leaf's fingerprint, and `Certificate trust:`, a read-only check of whether the current user's trust store holds it on Windows and macOS (`unknown on this platform` on Linux). Certificate warnings, such as a bring-your-own certificate within 30 days of `NotAfter`, go to standard error. With `identityDirectory` the host also writes the connection descriptor there on each start; see [Deployment platforms](./engine-deployment-platforms.md#host-certificate-and-connection-descriptor). The host does not disable certificate verification, install a certificate authority or change a trust store. Configure browser trust explicitly; the CLI pins the served leaf as its CA file, which for a generated leaf is `host-certificate.pem` in the identity directory. During a generated leaf's rollover it also prints `Next certificate SHA-256:` with the date the next leaf takes over, `Next certificate trust:`, and that a client pinning a CA file needs the next certificate after the switch; the deployment platforms page describes the stages. Remote gateways are not implemented in this slice.

### Deliver an API key from a secret manager

An API-key agent's reviewed projection names a credential reference: a host credential provider and a nonsecret name. Praxis never reads a key from the host's environment. To deliver one, install a `SecretCommandProvider` under the provider name the reference uses. Per reference, it runs an argv command that prints the secret. This is a source-only engine profile ([M10 credential delivery](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/docs/M10-CREDENTIAL-DELIVERY.md#the-secret-manager-command-provider)).

```ts
// In host-config.ts, beside the options above.

const secretManager = new SecretCommandProvider({
  // The key is the reference name in the agent's reviewed projection.
  'openai/praxis': {
    argv: ['op', 'read', 'op://Praxis/OpenAI/credential'],
    timeoutMs: 15000,
    variable: 'OPENAI_API_KEY', // the attempt receives the key in this variable
    scope: openAiScope,         // exactly the reviewed scope, values and markings
  },
});

export default {
  // ...the options above...
  credentialProviders: { 'credprov:secret-command': secretManager },
} satisfies ControlHostOptions;
```

Other secret managers follow the same shape: `['vault', 'kv', 'get', '-field=key', 'secret/praxis/openai']`, or on Windows `['pwsh', '-NoProfile', '-NonInteractive', '-Command', 'Get-Secret -Name OpenAI -AsPlainText']`.

- **No shell is added and no argument carries the secret.** Praxis starts the executable directly. A `.cmd` or `.bat` file needs `cmd.exe`, so it is refused; name the executable it calls. If you name an interpreter yourself, as PowerShell's `Get-Secret` needs, its command text is part of your reviewed host configuration and must not contain the secret.
- **The command runs headless.** It gets no standard input and no window, so unlock the secret manager beforehand: for example a Vault token in the user's token file, or a SecretStore vault that needs no password. No secret manager is qualified yet, so check yours headless before relying on it.
- **It sees only the platform baseline and its own variables.** It receives the attempt environment's baseline (`PATH`, `HOME` or `USERPROFILE`, `SYSTEMROOT`, the temporary and locale variables, and on Windows the variables Node's process launcher supplies) and the literal values in an optional `environment` object, such as `{ VAULT_ADDR: 'https://vault.example' }`. No other host variable reaches it. A CLI that reaches a desktop agent or keyring through a session variable, such as `XDG_RUNTIME_DIR`, `DBUS_SESSION_BUS_ADDRESS`, `APPDATA` or `LOCALAPPDATA`, needs that variable in `environment`.
- **It runs at admission, once per attempt, before the attempt commits.** `timeoutMs` is at most 30 seconds, half the attempt's lease margin, because the command runs after the attempt's scheduler claim is taken. Its standard output, less trailing line breaks, is the secret. It is kept in memory and handed to the attempt only at spawn. Standard error is discarded unread. If the command fails to start, exceeds `timeoutMs`, exits nonzero, prints nothing, prints more than 64 KiB, prints something that is not UTF-8 or prints fewer than 16 characters (UTF-16 code units), the credential is unavailable. The node then holds `CREDENTIAL_REQUIRED` before commit, with no attempt counted. Nothing the command printed is logged.
- **The scope is checked.** The provider reports the digest of the `scope` you configure. It must be the reviewed scope, values and markings, or admission refuses with `READINESS_BLOCKED`.
- **It cannot revoke or expire a key.** A print command reports no expiry, so the reviewed `lifetime` is only your statement: state the lifetime the secret manager actually gives the key (`STATIC` for a long-lived one). A per-attempt credential's release is recorded as valid until the secret manager expires it. Recheck on a hold card runs the command again.

The host creates the configured immutable plans at startup, and a host with a workflow template directory creates runs from its templates on request. Reopening the same work-order identity preserves its plan and accounting. The loop steps the configured plans and the stored template runs: it waits for a recorded approval and executes one local step at a time; paused, held or unapproved work cannot bypass admission. After restart, log in again and use the human resume decision before continuing eligible work. This sequential runner is an implementation slice, not a product concurrency ceiling.

### Bind a Claude Code agent

A Claude Code 2.1.287 agent with a delivered key needs its harness's trusted code installed by the host, keyed by the harness name `claude-code`: the usage reporter, which turns each attempt's output into its model usage report, and the usage meter, which the host meter uses to stop an attempt whose running cost reaches its node's stop threshold. The agent's manifest declares the host meter, but nothing installs the meter for a configured host: the configuration module does, beside the reporter. Without it, the binding review says the host installed no usage meter, and only the active-time bound stops an attempt. This is a source-only engine profile ([M10 host meter](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/docs/M10-HOST-METER.md)).

```ts
// In host-config.ts, beside the options above.

export default {
  // ...the options above, with the agent catalog, the ClaudeCodeDispatchAdapter and the credential provider...
  modelUsageReporters: { 'claude-code': claudeCodeUsageReport },
  modelUsageMeters: { 'claude-code': claudeCodeUsageMeter },
  modelUnavailabilityRecognisers: { 'claude-code': claudeCodeUnavailability },
} satisfies ControlHostOptions;
```

### Set up a subscription login

A Claude Code 2.1.287 agent can run on a subscription login instead of a delivered key. Its host configuration (`ClaudeCodeAgent`) names a `login`, the login directory's id and the login's reviewed scope, in place of `credential`, and its `configDirectory` is the login directory: a path outside the workspace and artifact roots that no other agent names and that does not exist yet. Install `ClaudeCodeDispatchAdapter` for it as for a delivered key; the adapter holds the login directory. The agent catalog entry pins the manifest the inspector observes once setup has written the reviewed configuration. This is a source-only engine profile ([M10 agent setup](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/docs/M10-AGENT-SETUP.md)).

Agent setup needs the installation-scoped `agent-setup` permission, which the identity adapter's `authorize` receives as action `agent-setup` with no work order. Each step is prepared, reviewed and confirmed once:

```sh
# The setup screen: whether the login directory is set up, by whom and when, and the latest sign-in check.
verified-login-helper | node engine/src/control-cli.ts \
  https://127.0.0.1:7443 /protected/aiws/tls-cert.pem agent-setup claude-code-sub

# Prints the review: the directory, the reviewed configuration and its forceLoginMethod lock, and the sign-in command.
verified-login-helper | node engine/src/control-cli.ts \
  https://127.0.0.1:7443 /protected/aiws/tls-cert.pem agent-setup claude-code-sub create
# The same command followed by --confirm DIGEST creates the directory once.
```

The account holder then signs in personally, on the host, with the sign-in command the review shows: the tool's own `auth login --claudeai` with `CLAUDE_CONFIG_DIR` set to the login directory. Praxis never runs it and never reads, copies, stores or delivers the login. `agent-setup claude-code-sub check`, confirmed the same way, runs the tool's status probe, `claude auth status --json`, with only the directory pointer in its environment, and checks the login against the reviewed scope; it keeps only the sign-in state, the login method and the account boundary. A run can bind the agent once a check finds it signed in under the reviewed scope. The web page's Agent setup section shows the same screens and confirms a prepared step with one button; it never starts a sign-in.

Before each attempt commits, the probe runs again. A signed-out login holds the node `CREDENTIAL_REQUIRED` before commit, with no attempt and no reservation, and its hold card shows the sign-in command; a login on another account or with another method refuses dispatch with `READINESS_BLOCKED`, which signing in again cannot clear.

Once the account holder has signed in again, an `agent-setup` holder takes the hold card's Reconnect exit (`RECONNECT`) with `control-cli hold-exit WORK_ORDER_ID RECONNECT`, then the same command followed by `--confirm` and the subject digest, or with the web view's button. Praxis runs the status probe and the scope check again. Signed in under the reviewed scope clears the hold and records who reconnected, when and the hold; no attempt starts until the node's next step. A login on another account or method is refused with `READINESS_BLOCKED`, "another account or method cannot be reconnected; replace the agent", and the run stays blocked, also after a restart. Still not signed in leaves the hold open and says why.

## The identity adapter is a trust boundary

`ControlIdentityAdapter` lives in `engine/src/control-service.ts`. The host installs it directly; public callers cannot choose the provider or submit trusted identity facts.

| Method or field | Host obligation |
|---|---|
| `authenticate(credential, context)` | Verify the protected Authorization header or browser cookie against the configured issuer, audience, signature, revocation and session policy; return a verified human session or null |
| `authorize(session, action, workOrderId, context)` | Evaluate the exact operation and target under current host policy; inventory access needs namespace-wide list permission and inspect permission for every returned work order. M10 adds the `upgrade-preflight` action for the upgrade preflight, `agent-setup` for a hold exit such as Recheck (on the work order) and for agent setup (with no work order), `ledger-adjust` for Raise limits, and `approve` for Discard and Admit of a held result; slice 4 adds `model-register-view` and `model-register` for the register's reads and writes, `agent-picker` and `authoring-preview` with no work order, and `binding-review` on the work order, which the web view reads on every inspection, so a human without it cannot inspect a run in the web view |
| `authMethod` | Identify the installed local user-verification or OIDC/PKCE method |
| Optional `handleLogin(request, response, context)` | Implement `/auth/start` and `/auth/callback` GET routes on the browser origin, which `context.origin` names, including interactive verification, PKCE/state/nonce checks and protected session-cookie issuance |

The engine validates session expiry, verified-human evidence, installation boot epoch and durable auth epoch. Elevated approval/resume decisions require verification within five minutes. Authorization leases last at most five seconds and are checked again inside the SQLite transaction. A host can revoke all current control authority through the internal `controlRevoke` operation; the new auth epoch invalidates earlier sessions/challenges. Provider-specific logout, per-session revocation and refresh policy remain the adapter's responsibility.

The adapter must independently establish human identity. **A bearer token, a test fixture string, or an object containing `kind: "HUMAN"` is not sufficient proof.** Session and CSRF secrets never enter command JSON, workflow state or command receipts. Browser cookies must be Secure, HttpOnly, host-only and SameSite=Strict, and are accepted only on the browser origin. Cookie-authenticated POSTs require the browser origin as Origin and session-bound `X-AIWS-CSRF`; Authorization and cookie credentials cannot be combined.

Owner enrollment, invitation flows, recovery enrollment and production provider implementations remain open. `startControlHost` is for integration with an already provisioned trusted host. It does not claim to implement the entire [M4 authentication design](./engine-design.md). Tests use explicit simulated identity providers and real HTTPS/SQLite/subprocesses.

## Inspect before deciding

All POST bodies use the selected envelope, including installation ID from capabilities, namespace and a fresh request ID. Quantities and revisions use canonical decimal strings. The server rejects unknown fields, duplicate JSON keys, malformed UTF-8, unpaired surrogates, unsafe numbers, excessive depth and unsupported versions.

An inventory query discovers current references without guessing their revisions:

```json
{
  "protocol": "aiws-engine/1",
  "schemaVersion": "1.1.0",
  "kind": "query",
  "installationId": "INSTALLATION_ID_FROM_CAPABILITIES",
  "namespace": "local",
  "requestId": "inventory-request-1",
  "query": {
    "name": "list",
    "payload": {
      "kind": "WORK_ORDER",
      "parent": null,
      "pageCursor": null,
      "pageSize": 1000
    }
  }
}
```

This initial inventory implementation returns a complete page or rejects the request if it cannot fit. It never silently truncates. More than 1,000 stored work orders can exist; multi-page inventory queries remain unimplemented. `inspect` takes the exact returned `WORK_ORDER` reference. A stale revision receives `STALE_REVISION`; refresh inventory and review changed material.

A record's `details` blob contains the complete local workflow projection, current controls, attempts, scope exposure, handoffs and holds. Its `approvalSubject` and `binding` define the decision material. Download it using:

```text
GET /engine/v1/artifacts/<encoded-work-order-id>/<details-digest>
```

The download rechecks work-order authorization and permits only currently referenced artifacts. Old projection/archive retrieval is not advertised; refresh the inventory if the current projection changed. A digest does not grant read access. Work orders project as OPEN, SUSPENDED or CLOSED, and close as COMPLETED only after acceptance. Cancellation remains CANCEL_PENDING until the remaining responsibility is resolved; it never asserts that a running process stopped.

## Make a human decision

For initial/correction approval or acceptance:

1. Inspect the current work order, its plan, validation and deliverable manifest.
2. POST `ApprovalChallengeRequest` to `/engine/v1/approval-challenges`, copying the current `APPROVAL` subject and binding with `action: "approve"`.
3. Persist an exact `CommandRequest` with `command.name: "approve"`, the proposal, binding and returned challenge ID. `expectedRevisions` contains the corresponding `WORK_ORDER` reference.
4. POST that file to `/engine/v1/commands`. The server consumes the challenge, applies the decision, records audit state and stores the command receipt in one transaction.

The challenge expires within two minutes and cannot move to another session, principal, revision or material. An approval is a durable decision: its approval window runs 60 minutes from the decision, or less under host policy, to the first dispatch it releases, whatever happens to the session afterwards. A resume and a hold exit that returns the run to READY open a fresh window. A run whose window closes with nothing dispatched returns to `AWAITING_APPROVAL` with reason `APPROVAL_LAPSED`; inspect shows it lapsed at once, and one fresh approval through the same challenge lets it proceed. Renewal is never done by silently creating a new identity.

For `pause`, send the pinned target; for `resume`, send the target and its current binding; for `cancel`, send the target and a reason code. These commands use the same expected-revision and durable-receipt rules. Resume requires recent human verification and refuses unresolved uncertain actions or terminal/canceling work. Pause prevents new admissions; existing execution evidence remains available for settlement. Cancellation is a request, not forceful process termination.

## CLI usage and uncertain responses

`engine:control` (`npm run engine:control`, or `node engine/src/control-cli.ts`) is the wire-level client for every control API route, with a credential supplied from outside. It serves hosts whose identity adapter issues bearer credentials: the simulated adapters in tests and examples, and later organisation adapters. Its decision routes are for a human-held credential on such a host. To run catalog workflows, use the [`praxis` CLI](/engine-praxis-cli/), which has no decision verbs. On a passkey host, once one exists, the tools are `praxis` and the web view: human sessions there are browser cookies, `engine:control` has no credential and never reads the `praxis` profile, and its requests fail `UNAUTHENTICATED`.

```sh
# The trusted login helper writes {"authorization":"Bearer ..."} to its pipe.
# Never put a real credential into this command line or a request file.
verified-login-helper | node engine/src/control-cli.ts \
  https://127.0.0.1:7443 /protected/aiws/tls-cert.pem queries ./inspect.json

verified-login-helper | node engine/src/control-cli.ts \
  https://127.0.0.1:7443 /protected/aiws/tls-cert.pem commands ./decision.json
```

`verified-login-helper` is an integration placeholder for your configured authenticator, not a bundled utility. The CLI validates TLS, sends the credential in the Authorization header, prints the structured response and returns a nonzero exit status for engine errors. It requires a persisted request file for mutations and does not invent another request ID after a timeout.

A receipt means the database accepted the decision, not that execution finished. If the response is lost or `commitStatus` is UNKNOWN, query `commandResult` with the original request ID and the same verified issuer/subject. You may retry the **identical request file**. The engine checks the durable key/digest before stale revisions or consumed challenges; an exact retry returns REPLAYED, while changed material under that ID returns REQUEST_ID_CONFLICT. Canonical request bytes use RFC 8785 key ordering without changing historical SDK/domain digests.

The web page uses these same commands and a separate explicit confirmation before each decision. It retains an uncertain request in memory for exact retry and warns before leaving the page. It does not persist sessions in browser storage. For recoverability across closing/reloading the page, use the CLI with a persisted request file; durable browser request recovery is still open. No command receipt or lookup from another principal is disclosed.

## Administer the model register

The model register holds the provider and model identifiers a model set may contain: their pins, offer status and prices. When a coding run is bound, every member of its agent's model set must be a registered, pinned, listed identifier, or authoring refuses the binding with `MODEL_SET_REFUSED`. This is an M10 source-only engine profile: slice 4 built the register, and slice 7 withdrawal and retirement dates. Corrections and register proposals are not built yet.

Reading needs `model-register-view`. Writing needs the installation-scoped `model-register` permission, which the identity adapter's `authorize` receives as action `model-register` with no work order, and only a verified human session can hold it. Every change is prepared, reviewed and then confirmed once:

```sh
# The identifier list, then one identifier's detail page with its attributed history.
verified-login-helper | node engine/src/control-cli.ts \
  https://127.0.0.1:7443 /protected/aiws/tls-cert.pem register
verified-login-helper | node engine/src/control-cli.ts \
  https://127.0.0.1:7443 /protected/aiws/tls-cert.pem register-entry openai gpt-5-2025-08-07

# Prints the review and the subject digest; nothing is written.
verified-login-helper | node engine/src/control-cli.ts \
  https://127.0.0.1:7443 /protected/aiws/tls-cert.pem register-action register openai gpt-5-2025-08-07 \
  --documentation https://platform.openai.com/docs/models --checked-on 2026-10-01 --note "Dated snapshot"
# The same command followed by --confirm DIGEST sends it once.
```

`register-action delist PROVIDER MODEL --reason TEXT` delists an identifier: new bindings refuse it and runs already bound keep dispatching. `register-action prices PROVIDER MODEL --unit USD_MICRO --tier standard --price OUTPUT=15000000 --price CACHE_WRITE:5m=3750000` appends a price sheet; each price states its unit, and one in a unit other than the ledger's is refused. For a local server, `register-action register PROVIDER NAME --operator-pin OLLAMA` uses the weights identity the host's `modelRegister.observeWeights` callback reads from host-owned files; nothing typed is accepted.

`register-action withdraw PROVIDER MODEL --reason TEXT` withdraws an identifier that was never safe to pin: an availability notice then holds, before commit, every bound node whose model set contains it, and the review lists those nodes. `register-action register` on a withdrawn identifier reverses the withdrawal; it needs a fresh pin basis, a citation checked on or after the day of the withdrawal or a newly observed weights identity, and it clears the notice. `register-action retire PROVIDER MODEL --retires-at 2027-01-15T00:00:00Z --source-ref URL [--not-sooner-than true]` enters a provider's retirement date. From that date new bindings refuse the identifier and a notice holds every node whose primary model it is; before it, the binding review warns the approver. A date at or before now holds those nodes at once, so it also needs `--hold-now true`. If the identifier changes between the review and `--confirm` (for a price sheet, if anything in the register changes), the CLI refuses and you review again. The web page's Model register section offers the same screens with forms, shows the same review text and confirms the prepared request with one button.

A host may also configure `agentCatalog`, an `aiws-agent-catalog/1` list that pins each agent by capability digest. Listing an agent grants it nothing; when a catalog is configured, a new binding needs an offered entry whose digest matches the agent the host observes.

## Verification and remaining scope

The engine test suite (`npm run test:engine`) includes the control API, codec and host checks. The control tests exercise the selected wire schema, real loopback TLS, command transactions, CLI subprocess, host execution, CSRF/origin/Host checks, authorization expiry/revocation, session-bound challenges, artifact changes, command replay and database reopen. The runtime codec checks all 429 current/historical shape fixtures; the runtime advertises only 1.1.0.

The control page's static assets and HTTP boundaries are tested. Visual browser verification is unclaimed because the available browser could not reach the local checkout. Full enrollment/provider integration, streamed artifact IO, event/paged history, dynamic policies, cancellation finalization, held-work remediation, retention, capacity and platform qualification remain future work. Continue with the [composed workflow](./engine-coding-workflow.md) and [persistence evidence](./engine-persistence.md).
