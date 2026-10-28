# Authentication and enrollment — engine v1

Status: finalized M4 specification baseline, 2026-09-09. Product defaults below are
design choices, not claims that a standard mandates those timeout values.

## Trust model and transport

Authentication establishes verified identity; authorization checks the exact requested
action; approval records a human decision over exact material. All three are independent.
Default workflow execution is supervised. Every permission or resource-limit change
(increases, reductions and partition transfers alike) and every UNKNOWN reconciliation
requires a verified human decision. A service, agent, access token,
user-editable human flag or possession of the setup secret cannot establish humanity.

Local native and organization-managed installations default to the same loopback HTTPS
API. An owner may explicitly enable remote human CLI/web access through a configured
organization HTTPS gateway with pinned origins, trusted proxy configuration and the same
identity/CSRF/approval checks. A gateway must authenticate its connection to the engine;
forwarded headers are never proof of user identity. Setup/recovery and worker endpoints
remain local/private and are not proxied. Multi-machine execution remains excluded.
Organization identity providers may be external; coordinator and workers remain on one
machine. Docker defaults to host-loopback exposure; workers run in the coordinator's
container/process namespace with private inherited IPC. Remote human access does not
authorize remote workers or external database writers.

Generate installation identity and TLS key in the OS-protected installation directory.
CLI/SDK read an owner-readable connection descriptor and pin the host's leaf
certificate; every rotation generates a new key, so pinning the leaf pins the
installation public key. Browser setup explicitly trusts the local certificate through
the OS/browser trust mechanism. Never disable TLS verification or silently install a
system-wide CA. Certificate rotation requires old-key-authenticated rollover or explicit
local owner re-enrollment of the new fingerprint. Private keys use OS ACLs, never
repository files.
Advertise exact origin/port; enforce Host and Origin allowlists against DNS rebinding.
Bind supported loopback stacks explicitly by default, never wildcard interfaces. The
organization gateway uses a publicly/organizationally trusted certificate and approved
external origin; it cannot relax the local engine's certificate or origin validation.

Browser sessions use Secure, HttpOnly, SameSite=Strict host-only cookies, no Domain,
with exact origin checks and session-bound CSRF tokens for every state-changing request.
OIDC callback uses a separate one-time state/nonce transaction; it must not depend on
a cross-site Strict cookie arriving. No credentials in URL fragments/query parameters,
localStorage, process argv, logs or history. Standard OAuth authorization codes in the
provider callback are the sole URL exception: short-lived, one-use, PKCE-bound, redacted
from access logs, immediately exchanged and redirected to a clean URL.

CLI uses external system browser and authorization-code flow with S256 PKCE, validated
state/nonce, exact issuer/audience and registered loopback redirect; embedded password
collection and OAuth implicit/password grants are excluded. Headless CLI uses a
configured verified local authenticator or organization-supported secure login adapter;
it does not silently downgrade to an unverified human claim. API credentials are carried
in Authorization headers, not command payloads. Session/refresh secrets reside in the
OS credential store or configured organization provider, never plaintext fallback.
The one exception is the simulated CLI session of the `praxis` example (see "CLI
sessions and simulated identity"). It can decide nothing and authenticates only against
its own temporary host, and it is kept in an owner-only profile inside that host's
installation.

### Rotation of the generated host certificate

A host with no configured TLS material generates a self-signed `CA:FALSE` leaf, valid
for 800 days: under the 825-day limit Apple sets for every TLS server certificate,
including those trusted through user-added roots. Every renewal generates a new key, so
a renewal is always a rotation. The lifetime and the two lead times below are engine
constants, not configuration. The host moves to a new leaf in stages, at start and,
while it runs, when each stage falls due:

1. Prepare: from 60 days before the current leaf's `NotAfter`, generate the next key and
   leaf in the `identity` directory and add the next leaf, with its rollover statement,
   to the connection descriptor.
2. Advertise: the startup output and a web-view banner name the next leaf's fingerprint
   and the date it takes over, and suggest `praxis trust`.
3. Switch: from 14 days before `NotAfter`, serve the next leaf, without a restart when
   running, and delete the retired key.
4. Never expired: a start whose current leaf has expired switches to the prepared next
   leaf, or generates a fresh leaf with no rollover statement when there is none or it
   has expired too.

The rollover statement (`praxis-rollover/1`) is the old-key-authenticated rollover above,
for the CLI. The current key signs it when the next leaf is prepared. It names the
installation id, the SHA-256 of the current and next leaves' public keys, the next
leaf's `NotBefore` and `NotAfter`, and the switch date. The descriptor keeps the most
recent statement until the next rollover replaces it, so a client pinned to the previous
leaf can still verify it. For the browser, `praxis trust` showing the new fingerprint
and asking for confirmation is the owner's explicit re-enrollment of it. It changes only
the current user's trust store and refuses a bring-your-own certificate, whose trust and
renewal stay the operator's. CA-file clients such as `engine:control` do not follow a
rollover: after the switch they fail closed until their CA file names the new leaf.

## Installation state and owner enrollment

Installation states: UNENROLLED → ENROLLING → ENROLLED; failed/expired enrollment returns
to UNENROLLED. RECOVERY_LOCKED admits inspection and owner recovery only. Durable state
transitions use compare-and-swap; there can be exactly one winning initial owner.

1. Local installer creates an isolated directory with owner-only access, installation
   fingerprint and a random 256-bit one-use setup capability, valid for five minutes.
   Deliver it through a protected OS handle/interactive setup channel, never argv or
   a printed copyable URL. Before enrollment, ordinary commands/dispatch are disabled.
2. The initiating OS user selects/configures a trusted identity adapter locally. The
   setup capability only admits this setup transaction. Public visitors cannot select
   an issuer, replace the provider or become first owner. Bind challenge to installation
   fingerprint, initiating OS identity, session, intended owner role and exact origin.
3. Obtain independent interactive user verification: an OS-backed local authenticator
   (user verification required, installation-bound challenge, protected public-key
   registration) or the configured organization identity provider with an appropriate
   assurance policy. User-presence alone is insufficient. Provider claims are validated
   against trusted issuer keys/configuration, not caller-supplied metadata.
4. Present installation fingerprint, owner permissions and recovery policy to the
   verified human. The provider creates an ephemeral identitySessionHandle for this
   exact completed verification. EnrollmentRequest references that handle/challenge;
   it contains no trusted identity claims. Server consumes the setup capability,
   challenge and handle atomically with owner grant, auth epoch and audit event.
5. Issue a new session after commit. Replayed/expired/other-origin/other-installation
   challenges fail; concurrent losers cannot create another owner. A lost response is
   resolved by the enrolled identity logging in, not reopening initial setup. Crash
   before commit grants nothing; crash after commit leaves ENROLLED durably intact.

Do not offer a local owner path on a platform where the configured authenticator cannot
provide user verification. Provide a clear setup failure and a supported organization
provider option. OS-admin control of the host remains a deployment trust assumption;
the engine is not a defense against an administrator replacing its executable.

## Login, user enrollment and session lifecycle

Subsequent login verifies the configured provider and maps issuer/subject to durable
principal ID. User enrollment requires an existing human owner's exact scoped invitation
plus independently verified identity; enrollment never copies an invitation's identity
claims. Default role has no workflow permissions until the owner grants explicit scope.
Organization group mapping is a pinned authorization policy, not blanket human approval.

| Control | Default and rule |
|---|---|
| Setup/enrollment challenge | Five minutes, single use, bound to identity session/installation/origin |
| Human session | 30-minute idle expiry, eight-hour absolute expiry; activity never extends absolute expiry |
| API access token | At most five minutes, installation audience and auth epoch bound |
| Refresh | Rotate one-use refresh credential on use; expires with underlying session; reuse revokes its family |
| Elevated human decision | Verified authentication age at most five minutes; one-use challenge expires after two minutes and binds exact command/material |
| Authorization decision | At most five seconds and never beyond session/underlying credential expiry; recheck revisions/epoch at commit |
| Worker enrollment | 60-second one-use launcher challenge over protected inherited IPC |
| Worker lease | 30 seconds, heartbeat every ten seconds; epoch fencing and separate effect reconciliation |

Default timeouts may be shortened by a host policy. Lengthening human authorization
windows requires an owner-approved policy change and an audit record. Expiry uses
trusted engine time, never caller timestamps; clock anomalies fail closed. Logout,
provider revocation, owner removal and recovery revoke affected sessions immediately
in the local store. A provider must declare revocation freshness and fail closed if it
cannot meet configured policy; token expiry alone is not a revocation check. Check local
revocation/auth epoch at every command commit and protected read. Unexpected coordinator
restart invalidates sessions/worker credentials and begins recovery holds; users log in
again. No persisted bearer token restores execution permission after a crash.

Human approve/reject and mandatory escalation UI shows target lineage, old/new limits
and grants, exact material digest/revisions, unresolved exposure and disposition.
Changing material invalidates the challenge/decision. An ALLOW from an authorization
adapter never satisfies this approval. Pausing/stopping dispatch does not wait for a
new budget approval, but still requires authenticated, authorized control permission.

## Worker enrollment and credentials

Coordinator launches a child with private bidirectional pipes/Windows handles, binding
OS process handle, boot ID, installation and enrollment challenge in its pending table.
Do not trust a worker-supplied PID. WorkerLaunch must match this table and channel;
consume challenge atomically, then create a SERVICE principal with attempt-only grants.
No browser session, owner capability or human refresh credential enters the worker.
Other local processes and workers from an earlier boot cannot enroll with copied IDs.

Task secrets arrive just in time through a separate protected channel/credential delivery
adapter. The JSON deliveryHandle is scoped to the assigned attempt, audience, grants and
expiry and cannot be redeemed by another worker. Renewals revalidate current authority
and never widen it. A stopped worker's handles are revoked and private channels closed.
Loss of heartbeat revokes dispatch authority but retains UNKNOWN exposure until real
effect evidence is reconciled. Inherited pipes alone do not sandbox task filesystem or
network access; capability advertisement requires an appropriate containment adapter.

## Owner loss and recovery

At setup, require a verified recovery method: an organization recovery policy or an
offline recovery credential stored separately from the database and ordinary backups.
Recovery requires both local OS-administrator action while normal dispatch is disabled
and verified human identity plus configured recovery proof. Possessing a database copy
or setup file alone is insufficient. If proof is unavailable, fail closed; provide
authorized forensic export, not an undocumented reset-to-owner command.

Recovery enters RECOVERY_LOCKED, records all outstanding attempts, fences old boot/auth
epochs, verifies backup/history integrity and enrolls the replacement human. Atomically
revoke old sessions and grants as policy requires, increment auth epoch and record the
recovery decision. Preserve workflow IDs, budgets, evidence and UNKNOWN responsibilities.
Reopening the UI does not resume work: each affected workflow passes recovery and
material-bound human approval. Normal login must never run the owner recovery flow.

## CLI sessions and simulated identity

A CLI session is the session the `praxis` CLI holds. Its session kind is `AGENT`: it
carries no human verification, whoever holds it. The control service accepts that kind
only for the CLI session scope:

| Action | What it covers |
|---|---|
| `capabilities` | The capabilities route |
| `workflow-catalog` | The workflow catalog list and template detail |
| `workflow-run` | Creating a run of a catalog template |
| `inspect`, `list` | The wire queries, including the attempt history in a run's details, and a run's evidence artifacts |
| `commandResult` | Looking up a command's result |
| `operator-view` | The operator view, including the hold card |
| `binding-review` | A run's binding review |

Every other action fails `HUMAN_REQUIRED` in the engine before the identity adapter's
`authorize` is asked. That covers every decision (approve, accept, resume, pause, cancel
and each hold exit) and every other elevated route: ledger adjustment, agent setup, the
model register, notices, the agent picker, the authoring preview, readiness, context,
handoff diagnostics and upgrade preflight. The adapter's `authorize` is a second layer,
not the guard. A permit for a CLI session names the owner as its principal and the CLI
session as its actor, and carries no human evidence. Storage therefore admits it only
to reads and to run creation, and refuses it every write that records a human decision.
Run creation (`workflow-run`) takes its principal and actor from that permit: the
creation receipt of a run created through a CLI session records the owner as its
principal and the CLI session as its actor, and no human decision. The run still waits
for a human's approval. The dynamic workflow routes (`/engine/dynamic/v1/`)
are a separate service with their own rule for `AGENT` sessions, and the `praxis`
example host does not serve them.

A simulated identity adapter signs anyone in as the owner without proof. It is not a
human gate: nothing decided under one is a human decision, even through a session of
kind `HUMAN`. Only tests and the `praxis` example (`example:engine:praxis`) use one.

- The adapter declares itself simulated (`simulated: true`). The deployment launcher
  refuses such an adapter with `SIMULATED_IDENTITY` before it opens the installation.
  No flag, configuration key or environment variable selects one.
- A host using one marks its connection descriptor `simulatedIdentity: true`. Its web
  view shows a standing banner saying that nothing decided on it is a human decision,
  and offers **Continue as the simulated owner** in place of sign-in.
- The example runs on a new temporary installation. It writes its simulated CLI
  session to a profile inside that installation, bound to its installation id, and
  never to the per-user `cli` directory. Stopping it deletes the installation, profile
  included.
- An adapter that signs in without proof but does not declare itself is a change to
  the host's trusted configuration. It is outside every engine check, as is any other
  change made by a process running as the installation's OS user.

## Required implementation checks

Before shipping: race two owner enrollments; replay each challenge; test expired,
wrong-origin, wrong-installation, wrong-issuer/audience and revoked credentials; CSRF
and DNS rebinding; service-as-human attempts; refresh reuse; restart invalidation;
foreign/stale child IPC; provider outage; owner-loss recovery; stale human approval
after a limit change; and secret scanning of logs, snapshots, argv and worker outputs.
These are required runtime checks, not results of the wire shape validator.

Protocol references: [OAuth native apps, RFC 8252](https://www.rfc-editor.org/rfc/rfc8252.html),
[OAuth security BCP, RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html), and
[WebAuthn](https://www.w3.org/TR/webauthn-3/) for adapters using verified authenticators.

## Passkey owner enrollment and verification (Tier 2 / Claim B)

The Tier 2 native identity architecture implements hardware-attested passkey owner
enrollment, WebAuthn browser authentication, 5-minute decision reverification windows,
and device-code CLI sessions.

### Allowlist format (`praxis-passkey-allowlist/1`)

Owner enrollment accepts only hardware-backed authenticators verified against the FIDO
Metadata Service (MDS3) allowlist or recognized Windows Hello TPM AAGUIDs. The allowlist
is defined by the JSON schema `praxis-passkey-allowlist/1`:

```json
{
  "schema": "praxis-passkey-allowlist/1",
  "mdsSerialNo": 1234,
  "mdsNextUpdate": "YYYY-MM-DD",
  "generatedAt": "YYYY-MM-DD",
  "windowsHelloAaguids": ["08987058-CADC-4B81-B6E1-30DE50DCBE96"],
  "entries": [
    {
      "aaguid": "01020304-0506-0708-0102-030405060708",
      "description": "Authenticator Name",
      "keyProtection": ["hardware", "secure_element"],
      "attestationTypes": ["basic_full"],
      "attestationRootCertificates": ["<base64-der-cert>"]
    }
  ]
}
```

The shipped allowlist is embedded in the engine binary and cannot be disabled or relaxed
via environment variables or runtime flags.

### Passkey refusal classification (`PASSKEY_NOT_QUALIFIED`)

Authenticators failing hardware qualification are refused with status code 400 and
error code `PASSKEY_NOT_QUALIFIED`, accompanied by one of five explicit refusal reasons:

1. `NO_USER_VERIFICATION`: The authenticator did not verify the user with a PIN or biometric (UV flag 0 in authenticator data).
2. `ATTESTATION_WITHHELD`: The browser withheld the authenticator's attestation details (`none` attestation format received).
3. `SYNCED_PASSKEY`: The passkey was stored in a syncing credential manager (AAGUID all zeroes `00000000-0000-0000-0000-000000000000`).
4. `WINDOWS_HELLO_UNATTESTED`: Windows Hello gave no hardware TPM attestation statement.
5. `NOT_ON_ALLOWLIST`: The authenticator's AAGUID or attestation certificate chain does not anchor to any trusted entry in the FIDO MDS3 allowlist.

### Passkey storage boundary

All passkey credentials and ceremonies are recorded via `BoundedStorageExecutor` transactions into SQLite:
- `owner_passkey_credentials`: Stores `credential_id`, `cose_public_key`, `aaguid`, `aaguid_description`, `fmt`, `initial_sign_count`, `backup_eligible`, `backup_state`, and `attestation_chain_digest`.
- `owner_passkey_challenges`: Ephemeral single-use ceremony challenges bound to origin, auth epoch, boot ID, coordinator epoch, and creation timestamp.
- `owner_passkey_uses`: Monotonic counter audit log recording `sign_count`, `backup_state`, `used_at`, and `reference_id`.
- `owner_passkey_revocations`: Records revoked credentials with incremented auth epoch.

Up to 8 active authenticators (1 initial owner authenticator + up to 7 backups) may be
enrolled (`MAX_OWNER_PASSKEY_CREDENTIALS = 8`). Removing the last active authenticator is
strictly disallowed (`PASSKEY_CREDENTIAL_NOT_ACTIVE`).

### Browser sessions and decision reverification window

- **Idle timeout:** 30 minutes of inactivity revokes the session.
- **Absolute lifetime:** 8 hours maximum lifetime from creation.
- **CSRF protection:** `x-aiws-csrf` header matching session token required on all non-GET requests.
- **Fresh verification window:** Elevated decision actions (approve, hold exit, etc.) require that the session's passkey verification occurred within the last 5 minutes (300,000 ms). If expired, the web UI triggers a `VERIFY_DECISION` WebAuthn assertion ceremony (`/identity/browser/reverify`).

### CLI sessions (device code flow)

- Initialized via `praxis login` writing an owner-only request file to `<stateDir>/identity/login/<id>`, where `<id>` is
  a lowercase UUID, and sending the id and the file's value to `/identity/cli/login/begin`. The host consumes the file
  and answers with a `handle` and a user code; the CLI polls `/identity/cli/login/poll` with that `handle`.
  `praxis setup` does the same through `<stateDir>/identity/setup/<id>` and `/identity/setup/begin`.
- The user completes authorization by entering the user code in the browser and confirming with their passkey.
- CLI tokens rotate every 5 minutes (`/identity/cli/token/refresh`). Token reuse immediately revokes the session.
- Maximum 16 active CLI sessions permitted per host; a further login is refused with `CLI_SESSION_LIMIT_REACHED` until one is revoked.
- CLI sessions hold `kind: 'AGENT'` and cannot approve decisions (`HUMAN_REQUIRED`).
