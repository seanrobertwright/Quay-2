# Praxis CLI

> **Praxis naming:** This page documents **Praxis**, the AIWS workflow engine. Existing `engine/*` source paths, `/engine/...` routes, `aiws-engine/*` protocol identifiers, and existing script names remain unchanged for compatibility.

`praxis` is the command-line front door for running catalog workflows. You type `praxis run <workflow>`, a governed run starts and waits for a human's approval, and `praxis follow` watches it until it needs you or ends. The host does all the work. `praxis` is a thin client over the host's authenticated loopback HTTPS control API: it never opens the engine database, never runs a workflow itself and never decides anything.

This is a source-only engine profile under S6 (Claims A and B in the build plan): workflow templates, the catalog, the `praxis` run commands, and passkey owner enrollment, sign-in and CLI sessions. No qualifying hardware authenticator has been checked live (source-only). It is not part of SDK 0.4.0 and is not published to any registry. The catalog, run list and run creation messages are host read models and profile messages at stability `PROVISIONAL`, not engine wire 1.1.0 records. The design is in [`spec/engine-v1/WORKFLOW-TEMPLATES.md`](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/spec/engine-v1/WORKFLOW-TEMPLATES.md) and [`spec/engine-v1/AUTHENTICATION.md`](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/spec/engine-v1/AUTHENTICATION.md).

Passkey owner enrollment (`praxis setup`), sign-in (`praxis login`), session logout (`praxis logout`), and hosting (`praxis serve`) are built and verified under S6 Claim B. Both the passkey host and the simulated host are available.

## Install it

`praxis` runs as TypeScript directly on Node 24 and has no runtime dependency. From a source checkout, link the private engine package once:

```sh
cd engine
npm link
praxis workflows list --state DIR
```

`npm link` puts a `praxis` shim in your npm global prefix: a `praxis.cmd` shim on Windows, a link on Unix. Without it, run `node engine/src/praxis.ts` from the repository root. A packaged engine bundle carries `praxis` (Unix) and `praxis.cmd` (Windows) launchers beside `launch.sh` and `launch.cmd`, which run the CLI on the bundle's own runtime.

## Try it on the simulated host

The simulated host, `example:engine:praxis`, is the only way to try the flow today. It starts a host on a new temporary installation with a simulated identity adapter, which signs anyone in as the owner without proof. **A host with simulated identity is not a human gate.** Nothing decided on it is a human decision, and it never runs real work: when it stops it deletes the temporary installation, with every run, decision and profile in it.

Save the templates you want to run in a directory first, then start the host with it. In one terminal:

```sh
npm run example:engine:praxis -- --templates ./my-templates
```

The host copies each template file into a private template directory inside its temporary installation and reviews it at startup; editing a template takes a restart. It prints its addresses and the state root to pass to `praxis`:

```text
Simulated identity: nothing decided on this host is a human decision.
AIWS controls: https://127.0.0.1:<port>
Praxis web view: https://praxis-<label>.localhost:<port>
State: <temporary directory>/installation
Use: praxis <command> --state <temporary directory>/installation
Stop with Ctrl-C or by closing standard input; the temporary installation and its profile are deleted.
```

In another terminal, use that state root:

```sh
praxis workflows list --state DIR
praxis run greeting --state DIR
```

Every command against this host prints `Simulated identity: nothing decided on this host is a human decision.` on standard error, and `--json` output carries the same flag. The host writes its simulated CLI session to a profile inside its own temporary installation, never to your per-user Praxis directory, and `praxis` uses that profile only against a host whose connection descriptor marks its identity as simulated. Open the web view address it prints and choose **Continue as the simulated owner** to approve and accept; the web view shows a standing banner that nothing decided there is a human decision. Your browser does not trust the host's generated certificate yet, and `praxis status` says so while a run waits for a decision in the web view. `praxis trust --state DIR` adds it to the current user's trust store after one confirmation, or on Linux prints the Firefox steps; run `praxis trust --remove --state DIR` before you stop the host, because the certificate is deleted with the installation. Without `--templates` the host offers no workflow catalog, and `praxis workflows list` says so.

## From `engine:author --template` to `praxis run`

A workflow template is a reviewed coding plan without work-order or run identities. Write one with the [guided author](./engine-authoring.md#write-a-workflow-template):

```sh
node engine/src/authoring-cli.ts --template greeting --input plan.json > my-templates/greeting.json
```

The author refuses a name that breaks the template name rule and input carrying `workOrderId` or `runId`. It prints the bare template to standard output only when the host's own startup review accepts it, and its preview to standard error. Save the template as `NAME.json` in the host's template directory, or in the directory you pass to `--templates`, and start the host. Then:

1. `praxis workflows list` lists each template with its revision, validity and description. `praxis workflows show NAME` prints its detail: its limits, its binding review, fresh readiness and the template review digest. A template whose agent is not ready is shown not runnable, with the reasons.
2. `praxis run NAME` asks the host to create a run. The host gives it fresh identities and pins the template revision, and the run waits for approval. `praxis` prints the run's binding review and the address of its decision page in the web view, `<browser origin>/#work-order=<work order id>`.
3. Approve the run in the web view. `praxis` has no approve verb.
4. `praxis follow RUN`, or `praxis run NAME --follow`, watches the run through each stage and stops where a human or a script must look. Accept the validated result in the web view.

A run keeps the plan and revision it was created from; editing the template changes only later runs. While an earlier run of the template is held or was never approved, `praxis run` creates nothing and exits 7, naming that run.

## Commands

| Command | What it does |
|---|---|
| `praxis workflows list` | The workflow catalog |
| `praxis workflows show NAME` | One template's detail, with fresh readiness |
| `praxis run NAME [--follow [--timeout DURATION]]` | Creates a run from the template and prints its decision page |
| `praxis runs NAME [--limit N]` | The template's runs, newest first; `--limit` is 1 to 100 |
| `praxis follow RUN [--timeout DURATION]` | Watches a run until it needs a human or ends |
| `praxis status RUN` | The run's operator view, its template and, while a decision is pending, its decision page |
| `praxis hold RUN` | Why a held run is held: its hold card, or its reason and the decisions pending |
| `praxis open RUN` | Opens the run's page in the browser, once the host confirms the run |
| `praxis trust [--remove]` | Trusts the host's generated certificate in the current user's trust store, or removes it; see [deployment platforms](./engine-deployment-platforms.md) |

Every command that reaches a host takes `--state DIR`, the installation's state root. Without it, `praxis` uses `<per-user directory>/installation`, where the per-user Praxis directory is `%LOCALAPPDATA%\Praxis` on Windows, `~/Library/Application Support/Praxis` on macOS and `${XDG_STATE_HOME:-~/.local/state}/praxis` on Linux. Every command but `open` and `trust` takes `--json`. Arguments are parsed strictly: an unknown flag is a usage error, and a duration needs a unit (`s`, `m` or `h`) between one second and 24 hours.

`praxis` sends every request to the control address, `https://127.0.0.1:<port>`, pinned to the host's certificate from its connection descriptor. It sets a deadline on every request and never follows a redirect. The addresses it prints are on the browser origin. The credential never appears in arguments, the environment or output.

If a creation's answer is lost, `praxis run` resends the identical request a bounded number of times. If the outcome is still unknown it exits 1 and says so, and the next `praxis run NAME` resends the same request, so a run that was created is replayed, never duplicated. There is no `--request-id` flag.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | The run was created (without `--follow`), the run SUCCEEDED (with `--follow`), the read succeeded, or `praxis trust` made its changes or had none to make |
| 1 | An engine, connection or authentication error, `praxis trust` changes declined, or no browser started by `praxis open` |
| 2 | A usage error |
| 3 | Awaiting acceptance |
| 4 | Held |
| 5 | Closed without success |
| 6 | `--timeout` elapsed; the run is unchanged |
| 7 | Not created: an earlier run of this workflow needs a human first (`WORKFLOW_RUN_HELD` or `WORKFLOW_RUN_PENDING_APPROVAL`). The output, and `--json`, names that run, the reason and its address in the web view |

`praxis follow` keeps waiting through the first approval, a correction re-approval, an approval that lapsed before work started, a restart review, a pause and a pending cancellation, and prints the decision page again each time the run starts to wait for one. It polls the operator view at most once a second. Interrupting it stops only the watch.

## No decision verbs

There is no `approve`, `accept`, `resume`, `pause`, `cancel` or hold-exit command. A coding agent may well be the one typing `praxis`, and it must never believe it approved something. Decisions are taken in the web view, each with its own click and confirmation. The host refuses every decision, pause and cancel through a CLI session with `HUMAN_REQUIRED` before the identity adapter is asked, whatever the adapter would allow. A CLI session reads the catalog, runs, operator views, hold cards and binding reviews, and creates runs; a created run still waits for a human.

## Which tool

`praxis` coexists with the engine CLIs. Each has its own job, and none is deprecated.

| Tool | Job |
|---|---|
| `praxis` | The front door for running catalog workflows: run, follow and read, and trust the host's certificate. It has no decision verbs |
| `engine:control` | The wire-level client for every [control API](./engine-control-api.md) route, with a credential supplied from outside. It serves hosts whose identity adapter issues bearer credentials, such as the simulated adapters in tests and examples. Its decision routes are for a human-held credential on such a host |
| `engine:author` | Offline authoring of a plan, and of a workflow template with `--template` |
| `engine:serve` | The direct host start used by examples and tests |

## Known gap

`praxis` automatically follows a certificate rollover: the client verifies the host's ECDSA SHA-256 signed rollover statement linking the pinned certificate to the new certificate and follows the new pin without requiring re-login.

`praxis` has no command for readiness, handoff diagnostics, context or the upgrade preflight. Read them in the web view or, on a host whose identity adapter issues bearer credentials, with `engine:control`. On a passkey host, once one exists, human sessions are browser cookies and `engine:control` has no credential, so these will be readable only in the web view.

## Owner authenticators

## Owner authenticators and passkey enrollment

The passkey adapter lets a real human enroll as a host's owner (`praxis setup`) and issue CLI sessions (`praxis login`). Under its decided policy, a qualifying owner authenticator is a hardware-backed FIDO2 security key with a PIN or a biometric (anchored to the FIDO MDS3 allowlist), or Windows Hello with a verified TPM attestation statement. In source-only qualification (Claim B), headless Chrome is driven over the Chrome DevTools Protocol with a virtual authenticator (`npm run qualify:engine:passkeys`). No qualifying hardware authenticator has been checked live (source-only). Live checks belong to Claim C.
