# Deployment and platform qualification

> **Praxis naming:** This page documents **Praxis**, the AIWS workflow engine. Existing `engine/*` source paths, `/engine/...` routes, `aiws-engine/*` protocol identifiers, and existing script names remain unchanged for compatibility.

**Milestone status:** M6 is complete for the D-M6-01 supervised Windows 11 x64 / Node 24 / local SQLite developer profile. M8 is now active (not in this pack): its plan is complete; qualification and expanded release/support claims remain open.

M6 slice 8 adds deployment tooling for the local Node 24 + SQLite engine. Its implementation and local Ubuntu checks are delivered; **platform qualification remains open**. Windows, macOS, other Linux architectures/distributions and Docker must pass their native acceptance gates before release claims change. The released native SDK packages are unchanged.

The [Windows native helper pipeline](./diagrams.md#windows-native-helper-pipeline) diagram shows how the signed helper is built, signed and manually qualified.

## Install and launch a candidate bundle

From a reviewed source checkout using the chosen Node 24 patch:

```sh
npm run engine:package -- build ./engine-candidate
npm run engine:package -- verify ./engine-candidate
node scripts/smoke-engine-package.mjs ./engine-candidate ./package-smoke.json
```

The packager refuses to overwrite a destination. It copies the current Node executable, engine sources, web assets and wire schema into a separate bundle; users do not need a global Node/TypeScript installation to launch it. `manifest.json` records runtime, architecture, OS, SQLite/schema versions and every payload's size and SHA-256. Verification rejects missing, extra, altered and symlink payloads. Approve the manifest digest independently: an unsigned manifest is not an authenticity guarantee. The packager does not establish that the selected runtime is the latest security patch or produce signatures/notarization.

Use `launch.sh /private/config/host.mjs` on Unix or `launch.cmd C:\private\config\host.mjs` on Windows. The configuration is trusted executable code. Start from `deploy/engine/host.example.mjs`; its identity adapter denies all requests and its capability verifier rejects startup until the host integration is implemented. Production identity enrollment, TLS certificates/trust, secret providers, durable local storage and task containment must be supplied and verified by the host. Never replace those checks with agent assertions.

The bundle's `praxis` (Unix) and `praxis.cmd` (Windows) launchers run the [`praxis` CLI](/engine-praxis-cli/) on the bundle's runtime; it reaches a host that is already running. `npm run engine:deploy -- /private/config/host.mjs` launches directly from source. The lower-level `engine:serve` and runner APIs remain host-building primitives; applications using them must implement equivalent deployment ownership and capability checks.

## Keep installation state separate

| Location | Contents and rule |
|---|---|
| Bundle directory | Reviewed read-only code, web assets, schemas and runtime; replace as a unit |
| Private configuration directory | Host module, TLS files, identity/secret-provider configuration; outside task workspaces |
| `stateRoot/identity` | Installation writer-lock database, the generated TLS key and leaf, and the connection descriptor; preserve its pathname while an owner runs |
| `stateRoot/database` | Engine SQLite database, WAL and shared-memory companions |
| `stateRoot/artifacts` | Immutable content-addressed evidence |
| `stateRoot/workspaces` | Approved task execution directories |

The launcher checks canonical directories and rejects symlink/junction paths. Every state directory is owner-only, through the one owner-only helper (`engine/src/owner-only.ts`). A directory the launcher creates gets mode 0700 on Unix and, on Windows, an access list protected from inheritance whose one rule gives the service identity full control: `icacls /inheritance:r /grant:r *<SID>:(OI)(CI)F`, with the SID from `whoami /user`, read back with `icacls /save`. An existing directory with broader access is refused with `UNSAFE_STATE_PERMISSIONS` rather than silently changed, and the message names the `chmod` or `icacls` command that fixes it; a Windows installation made before this check needs that fix once. On Windows the check reads the access list, not the owner, which `icacls /save` does not export, and an administrator can take ownership of any file regardless. Native Windows qualification of these checks remains a required host verifier check. Do not place state on shared/synchronized folders or allow task tools to modify identity/database/artifact directories. The local worker executes approved commands as the service identity and is not itself a sandbox.

An exclusive SQLite writer transaction on the separate `identity/owner.sqlite` file prevents duplicate launchers without blocking normal engine database writes. The lock is held through shutdown and is released by the OS on process death. Do not unlink or replace that file to bypass a live owner. After a crash, retained engine epochs and recovery holds still apply; acquiring the launcher lock does not reconcile uncertain outcomes.

Startup probes file write/fsync/read, Unix directory fsync, SQLite WAL/FULL settings, independent-process writer exclusion and durable reopen. Their report includes runtime, OS, filesystem and free space, with `certified:false`. These are capability probes, not power-loss proof. The trusted host must still verify volume semantics, private IPC, certificates, identity/secret providers and containment.

## Host certificate and connection descriptor

A configuration with no TLS material (no `tlsKeyFile`, `tlsCertificateFile` or `tlsProvider`) makes the launcher generate a key and a self-signed leaf certificate on first start, in `identity/host-key.pem` and `identity/host-certificate.pem`, written atomically and owner-only. Later starts reuse them. The leaf is ECDSA P-256, `CA:FALSE`, for server authentication only, valid for 800 days, and covers exactly the browser host name and `127.0.0.1`. No certificate authority is generated: a leaked leaf can impersonate only this host. When the key or leaf is missing, or they do not belong together, as after an interrupted generation, the next start generates both again.

The generated leaf rolls over to a new leaf with a new key in stages. The 800-day lifetime and both lead times are engine constants, not configuration, and the host takes each stage at start and, while it runs, at the moment the stage falls due:

1. *Prepare.* From 60 days before the current leaf's `NotAfter`, the host writes the next key and leaf to `identity/next-host-key.pem` and `identity/next-host-certificate.pem`. It signs a rollover statement with the current key and adds the next leaf and the statement to the connection descriptor.
2. *Advertise.* The startup output names the next leaf's fingerprint and the date it takes over, and the web view shows a banner saying the same and suggesting `praxis trust`.
3. *Switch.* From 14 days before the current leaf's `NotAfter`, the host serves the next leaf. A running host swaps it in without a restart; a stopped one switches at its next start. The next key replaces the retired key, so the retired key file is gone.
4. *Never expired.* At a start where the current leaf has expired, the host switches to the prepared next leaf, or generates a fresh pair, with no rollover statement, when there is none or it has expired too.

The rollover statement, `praxis-rollover/1`, names the installation ID, the SHA-256 of the current and next leaves' DER public keys, the next leaf's `NotBefore` and `NotAfter`, and the switch date. Its signature is ECDSA with SHA-256, in base64, over the statement's RFC 8785 canonical JSON. The descriptor keeps the most recent statement after the switch, until the next rollover replaces it. `engine:control` and other CA-file clients do not follow a rollover: after the switch they fail closed until their CA file names the new leaf.

A bring-your-own certificate stays supported. Startup checks that it names `DNS:praxis-<label>.localhost` and `IP:127.0.0.1` as subject alternative names and fails with `TLS_CERTIFICATE_NAMES`, naming both, when it does not. An expired bring-your-own certificate fails startup with `TLS_CERTIFICATE_EXPIRED`. From 30 days before a bring-your-own certificate's `NotAfter`, startup warns; its renewal is the operator's.

On each start, and at each rollover stage, the launcher writes the connection descriptor, `identity/connection.json`, atomically and owner-only. It holds the control address, the browser origin and the served leaf in PEM, never a key. `generatedCertificate` is present only when the leaf is the generated one. During a rollover `nextCertificate` holds the next leaf, and `rollover` holds the most recent rollover statement with its signature:

```json
{
 "format": "praxis-connection/1",
 "controlAddress": "https://127.0.0.1:<port>",
 "browserOrigin": "https://praxis-<label>.localhost:<port>",
 "certificate": "-----BEGIN CERTIFICATE-----\n...",
 "generatedCertificate": true
}
```

The launcher refuses an identity adapter that declares itself simulated, one that signs anyone in as the owner without proof, with `SIMULATED_IDENTITY` before it opens the installation. Only tests and the `praxis` example host (`npm run example:engine:praxis`) start a host with one, outside the launcher. That host's descriptor adds `"simulatedIdentity": true`, and its web view shows a standing banner saying that nothing decided on it is a human decision.

The launcher's JSON startup line adds `certificateSha256`, the leaf's SHA-256 fingerprint, and `certificateTrust`, a read-only check of the current user's trust store: `TRUSTED` or `NOT_TRUSTED` on Windows (`Cert:\CurrentUser\Root`) and macOS (`security verify-cert`), and `UNKNOWN` on Linux, where browsers keep their own stores. During a rollover it adds `nextCertificateSha256`, `nextCertificateSwitchAt` and `nextCertificateTrust` for the next leaf. `warnings` lists certificate warnings. Neither the launcher nor the check ever changes a trust store. `engine:control` and other CA-file clients use `identity/host-certificate.pem` as their CA file against the control address.

`praxis trust [--remove] [--state DIR]` is the explicit step that trusts the generated leaf in a browser. It reads the descriptor, lists each change by SHA-256 fingerprint and names, and asks one confirmation before it changes anything. It adds the current leaf, and during a rollover the next one, to the current user's store only: `CurrentUser\Root` on Windows, which shows its own warning; the login keychain with SSL trust on macOS, which asks for the user's password; and `~/.pki/nssdb` for Chrome and Chromium on Linux, with printed steps for each Firefox profile that name the fingerprints to import and to delete. It removes this installation's retired leaves, the certificates naming its browser host whose fingerprint is neither current nor next. `--remove` removes all of this installation's leaves. Neither form touches any other certificate or a machine store, and `praxis trust` refuses a bring-your-own certificate, whose trust is the operator's. It exits 0 when it made the changes or had none to make, and 1 when they were declined or failed.

## Low disk and shutdown

The human sets `minimumFreeBytes`; the template uses the accepted 10 GiB starting allowance. Before each new coding dispatch, the launcher checks available bytes on database, artifact and workspace volumes. Failure leaves the claim releasable, consumes no new dispatch attempt and keeps the control server available. Restoring space permits later admission. No automatic cleanup or permission expansion occurs.

This is an admission check, not a filesystem quota or reserved disk partition: another writer or a running task can consume space after the check. Actual disk exhaustion may still block SQLite/control writes. Configure workload quotas and reserve policy through the trusted host; capacity measurements remain slice 9.

SIGINT/SIGTERM requests stop new host ticks, close controls, wait for the current execution and close storage before releasing ownership. A supervisor's forced timeout may interrupt an effect; restart must honor the resulting UNKNOWN/recovery state. Templates do not auto-restart an installation. Inspect and reconcile before resuming after an abnormal stop.

## Docker and service candidates

`deploy/engine/Dockerfile` requires a reviewed Node 24 Debian 13 image reference ending in `@sha256:…`. Its build check rejects a mutable reference or wrong runtime/distribution. Pinning gives reproducible base bytes; updates still need review and rebuilding. See [Docker's image-pinning guidance](https://docs.docker.com/build/building/best-practices/#pin-base-image-versions).

```sh
# Set AIWS_NODE_IMAGE to the reviewed immutable image reference.
# Set AIWS_HOST_CONFIG to a private, already provisioned configuration directory.
docker compose -f deploy/engine/compose.yaml build
docker compose -f deploy/engine/compose.yaml up
```

The Compose candidate uses UID/GID 10001, a read-only image/configuration, dropped capabilities, a bounded temporary filesystem, no restart policy and the `engine-state` named volume at `/var/lib/aiws`. Provision readable private configuration and use a local volume with tested durability. Preserve the named volume across upgrades; `down --volumes` removes it and is not part of normal shutdown. These settings follow the [Compose service reference](https://docs.docker.com/reference/compose-file/services/).

Networking is disabled by default. HTTPS remains loopback-only inside the container, so host-browser access is intentionally unavailable in this template. An operator can use the existing CLI inside the container with a provisioned CA and trusted credentials. Host-browser access requires a separately reviewed loopback TCP forwarding arrangement that preserves TLS, Host and Origin checks; do not simply bind the engine publicly or disable TLS verification. Approved task egress also requires a host-selected network/containment configuration.

The candidate `aiws-engine.service` supplies a dedicated service identity, private persistent state, read-only system paths and explicit shutdown behavior for systemd. Provision the user, reviewed bundle and host verifier before installation. Windows/macOS console launchers are supplied; native service installation, signing/notarization and OS-specific containment remain platform qualification work. No service or container was installed on the user's infrastructure.

## Native qualification and remaining targets

```sh
npm run qualify:platform -- ubuntu-24.04-x64 ./platform-run-001
```

Run on the actual matching OS/architecture with a fresh evidence directory. The script rejects hardware/process emulation mismatches and incorrect minimum distributions. Windows requires a workstation edition of Windows 11 build 26200, matching [Microsoft's 25H2 release identity](https://learn.microsoft.com/en-us/windows/release-health/windows11-release-information); Windows Server and newer unqualified versions are not substitutes. macOS 15 must run natively on the requested hardware.

The manual `engine-platforms.yml` workflow targets provisioned self-hosted runners labeled `aiws-qualification` and the exact matrix cell. It retains logs even on failure. Runner owners supply reviewed Node 24, OpenSSL, platform tooling and isolation. No missing runner is silently replaced by an emulated or differently versioned machine. Docker checks additionally require host-recorded immutable image identity and container-runtime version.

| Target | Current evidence |
|---|---|
| Ubuntu 24.04 x64 | Local container source checks: 276 tests/typecheck; bundled runtime, TLS/web shell, shutdown and restart passed. Not native-install/device certification |
| Ubuntu arm64; Debian 13 x64/arm64 | Unverified; matching native runners required |
| Windows 11 25H2 x64/arm64 | Unverified; native workstation runners, ACL/process and installer checks required |
| macOS 15 Intel/Apple Silicon | Unverified; native runners, signing/notarization and lifecycle checks required |
| Docker Debian 13 amd64/arm64 | Templates supplied; image build and durable-volume tests not run because Docker is unavailable here |

`deploy/engine/platform-matrix.json` therefore certifies zero cells. A successful automated run is `CHECKS_PASSED_NOT_CERTIFIED`, not a platform release approval. Sleep/wake, machine restart, persistent-volume restore, device durability, host integrations and minimum/newest release coverage remain mandatory evidence. Slice 8 stays open for those checks; [failure injection](./engine-failure-injection.md) and [backup/restore](./engine-backup-restore.md) supply the reusable lower-level tests.

## Repeatable package acceptance

The platform runner now also builds and checks an unsigned embedded-runtime candidate. It verifies package tamper detection, TLS/web assets, denied unauthenticated controls, exclusive coordinator ownership, graceful restart and recovery after coordinator termination. Retained work must remain unapproved and its plan artifact readable after both restarts.

On the target machine, install the project dependencies and run the matching platform ID with a new evidence directory:

```sh
npm ci
npm run qualify:engine:platform -- windows-11-25H2-x64 docs/evidence/m6-slice8/windows-local-01
```

The report binds tested source and runtime hashes, full engine results and package evidence. `CHECKS_PASSED_NOT_CERTIFIED` means the automated checks passed. Exit code 2 means recorded platform gaps; exit code 1 means a failure. Native certification is never granted automatically.

The worker-termination probe runs on Windows too. If an effect is durable but a terminated worker looks like a normal failure, the report names that gap instead of skipping the probe. Windows directory durability remains a separate gate. Signed installation, real ACL/containment adapters, machine restart/sleep/wake and device durability still need evidence from the actual target machines. S5 browser qualification does not replace these M6 requirements.

## M8 native delivery preparation

Slice 3 is in progress for platform inventory and delivery preparation. See the
[preparation record](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/docs/M8-SLICE3-DELIVERY.md)
for each target cell's access/signing blockers, schema-edge inventory and native
install/upgrade handoff. Full package signing and supported migration execution
remain separate from the existing automated signed-helper checks. Heavy local
testing was deferred while the same physical host ran slice 2 capacity measurements,
which finished on 2026-10-06.
No platform support claim or D-M6-01 boundary changes.

## Pinned M8 candidates and offline delivery

Candidate tooling now records exact source, runtime and helper identities. From a
clean reviewed Git checkout, collect inputs with:

```sh
node scripts/package-engine.mjs inputs
```

Save and independently review the resulting JSON, add `candidateVersion` (for
example `0.0.0-m8.1`), and use that approved file:

```sh
npm run engine:package -- build-pinned /private/new-candidate /private/approved-pins.json
npm run engine:package -- verify /private/new-candidate
```

The pinned builder rejects dirty package inputs and mismatched source/runtime/helper
hashes. The final manifest remains unsigned; authenticate its digest through the
approved signing/review procedure. A signed helper alone does not authenticate the
complete package. Development `build` bundles remain available but cannot be
registered by the delivery tool.

The following administrative commands stage candidates without starting the engine:

```sh
npm run engine:delivery -- install /private/new-candidate APPROVED_MANIFEST_SHA256 /private/new-install /private/external-state
npm run engine:delivery -- replace /private/next-candidate NEXT_MANIFEST_SHA256 /private/new-install PREVIOUS_MANIFEST_SHA256
npm run engine:delivery -- uninstall /private/new-install CURRENT_MANIFEST_SHA256
```

Use absolute paths and an owner-controlled parent with native owner-only ACLs. The
package, installation and external state paths must not overlap or contain symlinks
or junctions. Install creates a new directory, verifies the copied package and records
a HELD selection. Replace requires the exact previous manifest digest, retains the
old payload, and selects a new HELD candidate. Uninstall deregisters the selection;
it retains package bytes, journals and all external state. It neither stops a running
service nor deletes its files. Do not use this offline tool as a live-service updater.

No command opens the engine database, executes host configuration, starts a process
or runs a schema migration. Selection metadata does not enforce a hold on manually
invoked launchers. Before manually launching a replacement, complete the reviewed
quiescence, backup/held-restore, component-schema compatibility and native acceptance
procedure. Equal schema `1` labels do not authorize an upgrade. No schema migration
edge is implemented, and these tools make no automatic rollback/resume promise.

On failure after locking, preserve `delivery.lock`, the attempt journals and partial
candidate. Do not remove the lock and retry blindly. Review selection and manifests,
then use a fresh installation root for a reviewed retry. Delivery interruption tests
are distinct from database migration phases and machine/device durability tests.

Docker now includes all three runtime schemas: wire, dynamic controls and readiness.
Hosted CI tests actual pinned runtime bundles on Windows and Ubuntu; those tests do
not qualify the native platform matrix. Signing, native install/upgrade and production
host integrations remain open under M8 (not in this pack).

## Windows candidate catalog verification

The manual **Signed Windows x64 candidate** workflow runs only from `main` on a
hosted Windows runner. It pins Node 24.19.0 against the vendor checksum, signs the
helper through the existing Azure OIDC identity, builds the pinned payload, and
signs a SHA-256 Windows catalog covering the complete payload and manifest.
The expected publisher comes from the previously reviewed signing identity.

The catalog remains outside `payload/` to avoid circular hashes. The payload's
`signed:false` field continues to describe its unsigned JSON manifest; authenticate
that manifest and all payload files through the external signed catalog. Require
valid Authenticode trust, a timestamp, the expected publisher, exact catalog/file
hash agreement and ordinary package inventory verification. Do not trust a publisher
name or manifest digest taken only from the downloaded candidate itself.

From a reviewed source checkout and trusted Node installation, before running any
bundled code, use `scripts/verify-windows-candidate.ps1` with `-PackagePath`,
`-CatalogPath`, independently approved `-ExpectedPublisher`, and a new `-ReportPath`.
The workflow performs these checks before and after acceptance of the exact supplied
payload, including the favicon and catalog tamper rejection. It retains the payload,
catalog, input pins, signature reports and package/lifecycle evidence as a private
workflow artifact. Failed workflow artifacts are diagnostic evidence, not candidates
approved for installation.

Hosted Windows Server acceptance is not Windows 11 native qualification. Held
same-payload replacement is not a database upgrade. Native enrollment, upgrade,
service uninstall, OS-specific paths and machine/storage recovery remain open. This
workflow publishes no registry package or public release and does not touch the
capacity measurement host.


## Windows protected TLS provider

M8 slice 4 adds `WindowsDpapi` (`engine/src/windows-dpapi.ts`) and
`dpapiTlsProvider` (`engine/src/host-tls.ts`). This is an initial component integration;
the deployment template still refuses startup until a trusted host verifier supplies
the missing identity, ACL, private IPC and containment guarantees.

A trusted host configuration can supply `tlsProvider` instead of both `tlsKeyFile`
and `tlsCertificateFile`. Supplying both forms is an error. Provider credentials are
validated before the control host opens its engine database or creates work. The
outer deployment launcher can still create layout/lock/probe files before this check.
An unavailable provider, invalid certificate or mismatched key fails closed with a
redacted error; it never falls back to file credentials. Existing file configuration
remains an explicit option for the accepted supervised developer profile.

For Windows, construct `WindowsDpapi` with an absolute protected `helperPath`, an
independently authenticated `helperSha256`, a nonsecret `installationId` and a
nonsecret `purpose` such as `tls-key`. Obtain the pin from reviewed signed-package
evidence; hashing an untrusted executable does not establish trust. Protected parent
directories must prevent replacement between verification and execution. The old
slice 3 candidate predates this adapter; it cannot supply the new helper commands.

`protect(Buffer)` returns CurrentUser DPAPI ciphertext and `unprotect(Buffer)`
returns plaintext. Both require the same account/profile and installation/purpose
context. Plaintext is limited to 64 KiB, ciphertext to 256 KiB, and helper calls time
out after five seconds by default. Data travels through binary parent-child pipes;
arguments contain only the operation and context. There is no LocalMachine mode
or interactive prompt. The caller owns input/output buffers and should erase
plaintext as soon as it is no longer needed; no command-line secret input is provided.

Connect `dpapiTlsProvider(codec, loadProtectedKey, loadCertificate)` to `tlsProvider`.
The callbacks return fresh buffers containing ciphertext and the public PEM certificate.
The provider erases its ciphertext buffer after decryption. The host takes ownership
of the returned private-key buffer and erases it after creating the TLS context, or
on startup failure. Never return shared/cached key buffers. TLS necessarily retains
key material internally while serving; this does not protect against memory dumps,
a compromised same-account process, administrators or the operating system.

Real Windows CI covers CurrentUser component behavior with generated fixture data.
Separate-account rejection, chosen service/session-0 profile availability, rotation,
backup exclusion and full host integration still require native acceptance. No new
production or platform support follows from these component checks.
