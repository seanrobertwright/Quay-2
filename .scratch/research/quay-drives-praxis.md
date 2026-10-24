# Research: what it takes for Quay to start and talk to Praxis today

Ticket: Quay-2 #225, on the map "Wayfinder map: Praxis visual builder in Quay" (#227).
Researched 2026-10-23 against AI-WS-SDK `origin/main` at `eb4ce83` and Quay `origin/master` at `3381f8d`.

## Question

What would Quay need to do, and as which kind of client, to submit definitions, start runs, read
their progress and leave every decision to the human owner? What in AI-WS-SDK is still missing for
that? Should Quay supervise the Praxis process, or attach to one the user runs?

## Answer

- **Today Quay cannot drive Praxis at all.** The engine on `main` has no route that creates a run or
  accepts a definition, ships no identity adapter that a real human can use, and only accepts human
  sessions. Everything the "Praxis CLI and workflow templates" spec (AI-WS-SDK #148) decided is
  still unbuilt, and the spec has not been split into build tickets yet.
- **Kind of client: a CLI-style `AGENT` session, not an owner browser session.** Quay should hold
  the same decision-free session `praxis login` gives a terminal: start catalog runs, read the
  catalog, the operator view, hold cards and binding reviews, and nothing else. Every decision
  (approve, accept, resume, pause, cancel, hold exits) opens the run's page in the user's system
  browser through the web view's deep link, as `praxis open` does. Quay should not hold the
  owner's browser session, in an embedded webview or otherwise.
- **Authentication and pinning:** through the connection descriptor in the installation's
  `identity` directory, exactly as the spec has `praxis login` do it: a device-code login started
  by an owner-only local request file, confirmed in the browser with a fresh passkey assertion, and
  a certificate pin taken from the descriptor, never from a flag or a URL. The simplest way to get
  all of that right is to run the `praxis` CLI as a subprocess with `--json`. A native Rust client
  is possible but would reimplement the profile, the refresh lock, pending creations and the
  rollover-statement check, none of which is specified for a second implementation.
- **Attach, don't supervise.** Quay should find and attach to a host the user starts with
  `praxis serve`. At most it offers to run that command in one of its own terminals, where the user
  sees and answers it. ADR 0001's supervisor (ephemeral TLS, `port: 0`, respawn with backoff,
  Quay-side epoch bumps in the engine database) contradicts decisions made since.
- **Submitting definitions has no path, even in the decided design.** Template runs take a template
  name the host already holds in its private configuration. User story 32 of AI-WS-SDK #148 says
  clients and agents must not be able to change what the host will run. A builder that submits
  graphs needs the paired map's "Decide: How does a client submit, list and replace definitions
  over the control API?" (AI-WS-SDK #245), and that decision must say who may submit.

## What exists today (AI-WS-SDK `main`)

### Starting a host

- `engine/src/control-host.ts` `startControlHost` takes a trusted configuration module. It opens
  the runner, creates only the `plans` listed in the configuration, and binds
  `ControlHttpServer.listen` on `127.0.0.1` only, `port: 0` by default. Its loop (`tick`) steps
  only those configured plans, so a run created after startup would never be stepped.
- `engine/src/deployment-host.ts` `startDeployment` wraps it with the installation layout,
  `acquireInstallationLock` (one host per installation), `probeDeployment` and a trusted
  `verifyHost` check. Run as a script, it prints one JSON line with `origin`, the probe's
  `profile` (`aiws-deployment-probe/1`) and `certified: false`.
- TLS comes only from configuration: `engine/src/host-tls.ts` `loadHostTls` requires
  `tlsKeyFile` with `tlsCertificateFile`, or a `tlsProvider`. Nothing generates a certificate.
- `ownerBootstrap` (`engine/src/owner-setup-host.ts`) is the Windows native owner setup only, and
  `startControlHost` refuses it alongside configured plans (`OWNER_SETUP_REQUIRES_IDLE_HOST`).

### Identity

- `engine/src/control-service.ts` `ControlIdentityAdapter` is the trust boundary: `authenticate`,
  `authorize`, `authMethod` and an optional `handleLogin` for `GET /auth/start` and
  `/auth/callback`. No usable adapter ships in `engine/src`. The packaged host fixture
  (`engine/scripts/package-host-fixture.mjs`) uses one that authenticates nobody, and the tests use
  simulated ones.
- `ControlService.authenticate` rejects any session whose `kind` is not `HUMAN`. The
  `VerifiedControlSession` type already allows `AGENT`, but the coding controls refuse it, so a
  decision-free client session cannot exist yet.
- The control API page (`src/content/docs/engine-control-api.md`) still describes the CLI as fed by
  a `verified-login-helper` "integration placeholder", and says owner enrollment and production
  providers remain open.

### Routes (`engine/src/control-http.ts` `ControlHttpServer.handle`)

- Unauthenticated: `GET /` and the web view's static assets, plus the adapter's `/auth` routes.
- Reads: `GET /engine/v1/capabilities`, `/engine/v1/session` (cookie sessions),
  `/engine/operator-view/v1/<workOrderId>`, `/engine/binding-review/v1/<id>`,
  `/engine/readiness/v1/<id>`, `/engine/context/v1/<id>`, `/engine/handoff-diagnostics/v1/<id>`,
  `/engine/upgrade-preflight/v1`, `/engine/agent-picker/v1`, `/engine/notices/v1`, the model
  register reads and `/engine/v1/artifacts/<id>/<digest>`.
- Wire messages: `POST /engine/v1/queries` (`inspect`, `list`, `commandResult`), and
  `POST /engine/v1/commands`, where `ControlService.command` accepts only `approve`, `pause`,
  `resume` and `cancel`. `POST /engine/v1/approval-challenges` issues approval challenges.
- Profile writes: hold exits, notice clearing, model register prepare and commands, and
  `POST /engine/authoring-preview/v1`, which previews a draft plan and creates nothing.
- **Missing:** any route that creates a work order or run, accepts a definition, or lists
  templates. `/engine/workflow-runs/v1` and `/engine/workflow-catalog/v1` do not exist in the
  source tree.
- Every response sets `Content-Security-Policy` with `frame-ancestors 'none'`, so the web view
  cannot be framed inside another page, Quay's included.

### Progress

- The operator view (`engine/src/operator-view.ts`, served by `ControlService.operatorView`) gives a
  coding run's status, stage, milestones, exposure, evidence, attempt history
  (`aiws-attempt-history/1`) and hold cards (`aiws-hold-card/1`). It is shaped for a `CodingPlan`
  run (implementation, validation, correction), not for graph nodes. Polling is the only way to
  follow a run; there is no event stream.

## Decided but not built (AI-WS-SDK #148 and its map, #149)

All of this is in the spec body of "Praxis CLI and workflow templates" (#148), corrected by the
closed tickets on "Wayfinder map: Praxis CLI and workflow templates" (#149). A search of
`origin/main` finds none of `workflow-runs`, `workflow-catalog`, `browserOrigin`,
`recordPasskeyVerification` or `APPROVAL_LAPSED` in `engine`, `spec` or the docs, and no
`praxis` bin or source file.

- **Host origin and certificate** ("Host browser origin and certificate trust", #151): a browser
  origin `https://praxis-<label>.localhost:<fixed port>` for the web view and sign-in, a control
  address `https://127.0.0.1:<port>` for every non-browser client, both loopback stacks bound, a
  generated self-signed leaf, and `praxis trust` adding it to the current user's store after
  confirmation. With the passkey adapter the port is fixed and `port: 0` is refused. Rotation and
  the rollover statement come from "Renewal and rotation of the host's generated certificate"
  (#164).
- **Connection descriptor:** written to the installation's `identity` directory at each start,
  owner-only, holding the control address, the browser origin and the certificate in PEM. CLI
  clients pin the host from it. `spec/engine-v1/AUTHENTICATION.md` already requires that "CLI/SDK
  read an owner-readable connection descriptor and pin the installation public key"; the engine
  does not write one yet.
- **Owner enrollment** ("Passkey owner enrollment", #152): `praxis setup` through an owner-only
  setup request file and a pairing code, with hardware attestation required. Per "Owner
  enrollment without a qualifying authenticator" (#188) this is the second build tier, and
  `example:engine:praxis`, a labelled host with simulated identity, is the only way to try the
  flow without a qualifying authenticator.
- **CLI sessions** ("CLI login, credential storage and session scope", #154): session kind
  `AGENT`, refused every decision with `HUMAN_REQUIRED` in the engine before the adapter is asked.
  Scope: capabilities, the catalog routes, `workflow-run`, inspect, list, `commandResult`, the
  operator view, the hold card, attempt history and the binding review. Device-code login started
  by a request file in `identity/login/<id>`; eight hours absolute, no idle expiry, ended by a host
  restart, logout, refresh reuse, an auth epoch change or revocation in the web view. One profile
  file per installation, under the per-user `Praxis\cli` directory; a successful login revokes that
  profile's previous CLI session; at most 16 active CLI sessions per installation.
- **Template runs** ("Wire contract for template runs", #155): templates are files in a directory
  the host configuration names, inside the private configuration, loaded at startup. Reads are
  `GET /engine/workflow-catalog/v1`, `.../templates/<name>` and `.../templates/<name>/runs`.
  Creation is `POST /engine/workflow-runs/v1` with a closed `aiws-workflow-run/1` request
  (`requestId`, `template`, `revision`, `reviewDigest`); the host generates the identities and the
  run waits in `AWAITING_APPROVAL`. Refusals for held or never-approved earlier runs come from
  "Runs that block a new run of a template" (#156).
- **Host step loop:** the loop steps eligible work orders read from storage, not only configured
  plans.
- **Tools** ("praxis versus engine:control and engine:author", #157): `praxis` is the decision-free
  front door on a passkey host; `engine:control` has no credential there. Templates are written
  offline with `engine:author --template NAME` and saved into the template directory by the
  operator.
- **Prerequisites:** the clock-race fix ("Clock race between control requests and steps", #153),
  so polling cannot fail a step with `CLOCK_STALE`, and approval windows ("Runs whose approval
  expired", #172).

## Which kind of client Quay should be

| Option | Fit |
| --- | --- |
| CLI-style `AGENT` session | Matches what Quay needs: start runs, read progress, never decide. The engine enforces the "never decide" part, so Quay's MCP bridge and the agents in its terminals gain no human authority through Quay. |
| Owner browser session in a Tauri webview | Rejected. It would make Quay a holder of human authority: the host application can read the webview's cookies and run script in the page, and Quay already exposes MCP tools to the agents it runs. `frame-ancestors 'none'` rules out framing, `AUTHENTICATION.md` excludes embedded password collection for CLI login, and whether WebView2 performs WebAuthn on a `*.localhost` RP ID and trusts a leaf in `CurrentUser\Root` was not checked. |
| Something new | Needed only for submitting definitions, which is the paired map's decision (#245), not a new Quay session kind. |

Decisions stay in the browser: Quay shows the run's state from the operator view and, when a run
waits for a human, opens the run's decision page on the browser origin with the system browser
(Quay already depends on `tauri-plugin-opener`).

### Subprocess or native client

- **Running `praxis` as a subprocess** (`workflows list --json`, `workflows show`, `run`,
  `status --json`, `runs`, `hold`, `open`) reuses the spec'd pinning, refresh lock, pending
  creation and rollover handling, and shares the user's CLI profile under the profile lock. It
  needs Node 24 and a source checkout linked with `npm link`, because `praxis` is a source-only
  profile. Its `--json` outputs become a contract Quay depends on (see "Missing in AI-WS-SDK").
- **A native Rust client** would need an HTTPS client that pins a leaf. Quay has none today: its
  `hyper` dependency has no TLS, and the Archon monitor (`src-tauri/src/slices/archon/monitor.rs`
  `archon_request`) shells out to `curl` over plain HTTP. It would also need its own profile, and
  the spec's "one profile file per installation" and "a successful login revokes the profile's
  previous CLI session" do not say what a second client does.

## Supervise or attach

Attach. The reasons, each from the decided spec or today's code:

- `praxis serve` is interactive at the edges: `praxis setup` prints a pairing code and waits,
  `praxis trust` asks for confirmation, and `praxis serve --new-certificate` refuses without a
  terminal.
- A restart is costly by design: it advances the engine epoch, ends every CLI session, and leaves
  active runs waiting for the human restart review. A supervisor that respawns on failure, as
  ADR 0001 describes, would turn every crash into a forced re-login and restart review.
- `acquireInstallationLock` allows one host per installation, so a host Quay starts and one the
  user starts would fight over the same state root.
- The browser origin is fixed for the installation and recorded at enrollment
  (`BROWSER_ORIGIN_CHANGED`), so Quay cannot pick ports or generate TLS material as ADR 0001
  planned.
- The CLI "never opens the engine database"; one host process owns the writer. ADR 0001's plan to
  bump `engine_meta.epoch` and revoke leases from Quay is the engine's own job.

Quay finds the host through the per-user Praxis directory (`%LOCALAPPDATA%\Praxis` on Windows,
default installation root `<dir>\installation`) and its connection descriptor, as the Archon slice
finds a running Archon by its port. If no host answers, Quay can offer to run `praxis serve` in one
of its own terminals, where the user sees its output.

### What this means for ADR 0001 and ADR 0005

ADR 0005 already superseded ADR 0001. Of the gaps ADR 0005 names, the spec now answers TLS material
(the generated leaf), the identity adapter (passkeys) and the owner bootstrap (`praxis setup`), but
none is built. The fourth, translating work orders into `CodingPlan`s, is unchanged and belongs to
the map's "Machina and Praxis" question. ADR 0001's details are also stale against today's code:
`GET /engine/v1/capabilities` needs an authenticated session, so it cannot serve as an
unauthenticated readiness probe.

## Missing in AI-WS-SDK

These are gaps a Quay client exposes, beyond building what #148 decided:

1. **Submitting definitions.** No route, decided or built, lets a client submit a graph, contract,
   grant, trigger or template, and the decided design keeps templates out of every client's reach.
   AI-WS-SDK #245 has to decide who may submit (a human in the web view, the operator through
   files, or a session) and how that squares with user story 32.
2. **Graph runs.** Praxis runs only `CodingPlan`s; graph runs are AI-WS-SDK #244 and #247.
3. **A read model of node states.** The operator view is coding-stage shaped, and polling is the
   only transport. #247 lists "Events and observability for graph runs" as not yet specified.
4. **An outside consumer of host read models.** #148's Records section gives the catalog and run
   messages closed parsers in engine code and no `*.schema.json` or SDK contract, "because nothing
   outside the engine consumes them". Quay would consume them, through `praxis --json` or the
   routes, so they need a stated stability rule or a schema.
5. **A second client of the CLI-session scope.** The profile format, its lock and the
   one-profile-per-installation rule are written for the `praxis` binary only. Either Quay is
   told to drive `praxis`, or a second client is specified. #148 puts Rust clients out of scope.
6. **The web view deep link.** Decided as "a deep link that preselects a work order", with no
   documented format a client other than `praxis open` could rely on.

## Open questions for the Quay map

- Does Quay drive the `praxis` CLI as a subprocess, or carry a native Rust client? This decides
  whether Quay needs Node 24 and a linked AI-WS-SDK checkout on the user's machine.
- Does Quay share the user's `praxis` CLI profile, or get one of its own? Sharing means one
  `praxis login` serves both, and a login from either revokes the other's session.
- Where does a graph authored in Quay go before #245 lands: saved as a template file for the
  operator to install and restart the host, or nowhere until a submission route exists?
- Does Quay's development and test loop use `example:engine:praxis`, the simulated host, which is
  the only host the spec lets anyone use without a qualifying authenticator?

## Sources

- Quay: `.scratch/machina-praxis/adr/0001-machina-praxis-supervised-sidecar.md`,
  `.scratch/machina-praxis/adr/0005-quay-native-factory-engine.md`,
  `src-tauri/src/slices/machina/supervisor.rs` `MachinaManager`,
  `src-tauri/src/slices/archon/monitor.rs` `archon_request`, `src-tauri/Cargo.toml`.
- AI-WS-SDK source: `engine/src/control-host.ts` `startControlHost`,
  `engine/src/deployment-host.ts` `startDeployment`, `engine/src/deployment.ts`
  `probeDeployment`, `engine/src/host-tls.ts` `loadHostTls`, `engine/src/control-http.ts`
  `ControlHttpServer`, `engine/src/control-service.ts` `ControlService` and
  `ControlIdentityAdapter`, `engine/src/owner-setup-host.ts` `startOwnerBootstrap`,
  `engine/src/operator-view.ts`, `engine/scripts/package-host-fixture.mjs`.
- AI-WS-SDK docs: `spec/engine-v1/AUTHENTICATION.md` ("Trust model and transport", "Login, user
  enrollment and session lifecycle"), `src/content/docs/engine-control-api.md`, `CONTEXT.md`
  (Browser origin, Control address, CLI session, Workflow template), `CLAUDE.md` "Non-negotiable
  semantics".
- AI-WS-SDK issues: "Praxis CLI and workflow templates" (#148), "Wayfinder map: Praxis CLI and
  workflow templates" (#149) and its closed tickets #151, #152, #153, #154, #155, #156, #157, #164,
  #172, #188; "Wayfinder map: Praxis runs finite-v1 graphs" (#247).
