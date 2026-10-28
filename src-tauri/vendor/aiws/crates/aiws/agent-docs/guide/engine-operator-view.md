# Operator run view

> **Praxis naming:** This page documents **Praxis**, the AIWS workflow engine. Existing `engine/*` source paths, `/engine/...` routes, `aiws-engine/*` protocol identifiers, and existing script names remain unchanged for compatibility.

The native control page now opens with a run overview. Sign in through the configured host identity provider, enter a work order and choose **Inspect work**. The view reads one transactional engine snapshot and pairs it with the same workflow revision's decision evidence. It grants no execution authority.

Three independent milestones: produced output, current validation and human acceptance, with a correction loop after failed validation. (not in this pack)

## Read the overview

| Area | What it tells you |
| --- | --- |
| Status and current stage | Where the workflow is now, separately from its execution control state |
| Three milestones | Whether output exists, current durable validation passed, and a human accepted the work |
| Next decisions | Approval, acceptance, restart review, agent acknowledgment, reconciliation or paused/cancellation control work. While approval is pending, `humanApproval` gives its reason and, for an approval whose window lapsed (`APPROVAL_LAPSED`), the time the window closed |
| Ownership | Assigned agent, active workers and latest context session kind |
| Readiness binding | For a pinned run, the readiness version it is bound under (`1.0.0` for a run bound before the readiness 2.0.0 upgrade, which keeps it until it ends) and its manifest digest; otherwise not pinned |
| Nodes | Each bound node row (`nodes`), its assigned agent and model set, and the `Price changed since binding` info badge when a price entry for its model set changed after the price table version shown at approval; expanding the badge lists each changed entry (model, tier, category, old and new price, effective time) and says the allowance is unchanged |
| Resource exposure | Attempts used; active time and cost used plus reserved; configured limits and unsettled responsibility; the run's exposure declaration (`declaration`), such as cost not applicable with its justification, or null |
| Evidence | Plan reference, input digest, validation attempt, definition revision and deliverable file hashes |
| Attempt history | Latest 100 retained attempts, with delivery, assessment and historical invalidation shown separately, and each attempt's cost: the settlement basis, the priced and settled costs, the rule that settled it and its flags, with its priced lines on expand |

Cost values use the engine's configured units. They are not currency estimates. A stopped attempt can still carry unsettled exposure. The view preserves those reservations until the authoritative settlement path releases them. Historical passing assessments cannot satisfy current acceptance.

## Refresh and decide

**Inspect work** refreshes the view; there is no live push stream. A load-time label makes the snapshot's age visible. Reload restores this tab's selected work order and reads the engine again. Editing the selection, a failed inspection or a dynamic workflow change clears the old decision evidence. If the workflow revision changes between reads, refresh again before deciding.

For a run with a node assignment, the binding review (`control-cli binding-review`) shows above the Approve button, and the page refuses to approve when the review on screen names a different approval subject; inspect again first. Approve, pause, resume and cancellation use the existing scoped control service. Accepting validated work remains a distinct, explicitly confirmed human action. The server checks current revision, binding, identity and authorization when it handles the command.

Before sending a decision, the page saves its exact request in this tab's session storage. If the response is lost, **Retry saved decision** resends the same request ID and body; **Look up saved decision** retrieves its durable result. Both require a fresh authenticated connection under the original actor and installation. A later rejection does not erase an earlier uncertain outcome. Saved bodies contain neither session credentials nor CSRF tokens. Closing the tab or clearing browser storage can remove this local recovery copy; engine receipts remain authoritative.

## Host and CLI access

In a host with an opened coding runner:

```ts
const snapshot = await runner.operatorView('work-order-id');
// snapshot.format === 'coding-operator-view/1'
// snapshot.authorized === false
```

The host exposes `GET /engine/operator-view/v1/{workOrderId}` and authorizes the scoped `operator-view` action before and after the read. CLI credentials still arrive through protected standard input:

```sh
node engine/src/control-cli.ts https://127.0.0.1:PORT /secure/host-ca.pem operator-view work-order-id < /secure/credential.json
```

While a run is held with a hold record, the view carries its hold card as `holdCard` (`aiws-hold-card/1`, [agent binding §7](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/spec/engine-v1/AGENT-BINDING.md#hold-cards-and-exits)): the reason with its code, the cause, the phase, what was consumed, the next clock expiry and the exits, each marked available or not. Since M10 slice 3 the `CREDENTIAL_REQUIRED` hold has one, before commit and after a counted attempt; after an attempt the card also shows what the attempt's evidence records and what it consumed. Since M10 slice 4 the `PRICE_REQUIRED` hold, a priced overrun's `EXPOSURE_EXCEEDED` hold and the `BINDING_VIOLATION` hold have one too, and since slice 7 the `MODEL_UNAVAILABLE` hold after an attempt; an attempt that ran past its maximum duration still holds `EXPOSURE_EXCEEDED` without a card. The card is built for the human reading it: an exit whose command needs a permission they lack is marked unavailable and names whom to ask. The web view shows it under Next decisions, and the CLI prints the same lines, or the read model with `--json`:

```sh
node engine/src/control-cli.ts https://127.0.0.1:PORT /secure/host-ca.pem hold-card work-order-id < /secure/credential.json
```

Recheck, the `RECONNECT` exit of a delivered credential's hold, is a prepared command, and so is Reconnect, the same exit of a login directory's hold, whose card also shows the sign-in command the account holder runs personally; the web view only shows that command, and neither surface runs it. In the web view one confirmation of its review sends it. `hold-exit` prints its review and subject digest; running it again followed by `--confirm` and that digest sends the request, and a Recheck or Reconnect that changes nothing exits nonzero:

```sh
node engine/src/control-cli.ts https://127.0.0.1:PORT /secure/host-ca.pem hold-exit work-order-id RECONNECT < /secure/credential.json
```

Both post the prepared `aiws-hold-exit/1` request to `POST /engine/hold-exits/v1`, which for Recheck and Reconnect needs the `agent-setup` and `inspect` permissions on the run and returns `aiws-hold-exit-result/1`.

Add price, the `ADD_PRICE` exit of a `PRICE_REQUIRED` hold, opens the model register's price sheet pre-filled with the missing keys. In the web view its action opens the register screen with the price sheet form filled in except for the prices, and a cache write's lifetime or a server tool's name where the sheet lists one; preparing the sheet shows its review, and one confirmation sends the exit with the prepared sheet. In the CLI, `hold-exit` prints each pre-filled sheet as a `register-action prices ... --hold work-order-id` command; completing its prices, reviewing it and confirming it with `--confirm` takes the exit:

```sh
node engine/src/control-cli.ts https://127.0.0.1:PORT /secure/host-ca.pem register-action prices openai gpt-5-mini-2025-08-07 --unit USD_MICRO --tier standard --price UNCACHED_INPUT=250000 --price OUTPUT=2000000 --hold work-order-id < /secure/credential.json
```

The request carries the register command as `priceSheet` and needs the installation's `model-register` permission and `inspect` on the run. The engine appends the sheet as the register would, then clears the hold if the price table version in effect prices every key the hold named; otherwise the hold stays open and the result names the keys still missing.

Since M10 slice 4 an attempt whose priced cost is above its reservation holds the node `EXPOSURE_EXCEEDED` ([agent binding §6](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/spec/engine-v1/AGENT-BINDING.md#settlement)). Its true cost and overrun are recorded at once, nothing settles and the reservation is kept. The card's notes show each scope from the node to the root with its bound, its use excluding the attempt and whether it absorbs the true cost. Raise limits, the `RAISE_LIMIT` exit, is the human ledger adjustment: it pre-fills each bounded scope with the least bound that absorbs the true cost, and once the bounds are raised the attempt settles at its true cost and the run moves on. Refusing instead leaves the node held, and the run can only be cancelled. In the web view each bound is a field beside a Refuse button; in the CLI `--bound SCOPE_ID=AMOUNT` replaces a pre-filled bound and `--refuse` takes the refusal:

```sh
node engine/src/control-cli.ts https://127.0.0.1:PORT /secure/host-ca.pem hold-exit work-order-id RAISE_LIMIT --bound SCOPE_ID=200000 < /secure/credential.json
```

A usage report entry outside the agent's model set holds the result `BINDING_VIOLATION` ([agent binding §5](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/spec/engine-v1/AGENT-BINDING.md#held-results)). The attempt keeps its outcome and its consumption settles; the card shows each violation with its usage report entry, whether the agent is unchanged since the attempt, and that admitting never widens the model set. Discard, the `DISCARD_RESULT` exit, needs no reason and lets the stage run a fresh attempt under the normal attempt limits. Admit, the `ADMIT_RESULT` exit, needs a written reason, given in the card's field in the web view or with `--reason` in the CLI, which is recorded on the result:

```sh
node engine/src/control-cli.ts https://127.0.0.1:PORT /secure/host-ca.pem hold-exit work-order-id ADMIT_RESULT --reason "Reviewed by hand." < /secure/credential.json
```

Raise limits and its refusal need the `ledger-adjust` permission on the run, and Discard and Admit need `approve`, each with `inspect`. Each decision is recorded once per hold. Replace is listed on the held result card but is not available yet; the overrun card offers Raise limits and Cancel only. The view's `admittedWithViolation` lists each result admitted with violation; the web view shows them beside the milestones they mark, and the attempt history marks the row.

Since M10 slice 7 a failed or UNKNOWN attempt that the adapter recognised as model unavailability holds the node `MODEL_UNAVAILABLE` ([agent binding §5](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/spec/engine-v1/AGENT-BINDING.md#model-unavailability)). A host installs the recogniser with each harness, as it installs a usage reporter; for Claude Code 2.1.287 it is `claudeCodeUnavailability`. The attempt keeps its outcome and counts against the attempt limit; a FAILED one settles as any other attempt does, and an UNKNOWN one keeps its reservation whole. The card shows the cause (retired or not found, rate limited, overloaded, plan limit or spend limit) with the model, the tool's signal as evidence, any reported reset time, labelled "shown, never acted on", with whether waiting until it fits before the next clock expires, and the availability notice the attempt recorded for a plan limit, a spend limit or a retired or unknown model of the bound model set. Its exits are Reconcile, on a run bound to a workflow definition, Replace, which opens the reconcile-then-replace stepper, and Cancel. Nothing retries by itself, and nothing is scheduled for the reset time. An availability notice holds siblings before commit with no attempt and no reservation.

Each attempt in the history also carries `credentialRelease`, the nonsecret record of how its delivered credential was released, or null. A release the engine made when it restarted, for an attempt whose process stopped before releasing, has `processStopProven: false`.

Since M10 slice 4 each attempt also carries `cost`, what it reserved, the price table version its reservation pinned and what it settled at, and `settlement`, the priced settlement record (`aiws-attempt-settlement/1`) of an attempt of a model-using node, or null ([agent binding §6](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/spec/engine-v1/AGENT-BINDING.md#settlement)). An attempt whose model usage report is COMPLETE settles at the report's cost, priced line by line at the pinned version and rounded up once; one whose report is INCOMPLETE or missing, or has a line that version does not price, settles at its full allowance; an UNKNOWN attempt settles nothing and keeps its reservation whole, and its record's outcome is `HELD_UNKNOWN`, with no rule or settled cost; an attempt priced above its reservation shows its `HELD_OVERRUN` record until a human raises the bounds, then the settlement at its true cost, with the overrun. The tool's own cost estimate is shown as evidence only and never settles. An attempt whose result was held for a binding violation also carries `heldResult`: its violations, of the model set or of the reviewed credential source, and the human's decision on it.

The view's `attemptHistory` (`aiws-attempt-history/1`) is the attempt history both surfaces render: its columns (Attempt, Worker, Responsibility, Delivery, Assessment, Basis, Priced, Settled, Rule and Flags), one row of cells per retained attempt, and each row's expanded lines: the pinned version's digest, the basis and rule, an incomplete report's reason, the priced lines grouped by model and tier, with a model whose served identity was not observed marked so, the coverage gaps, and the tool's estimate. The flags are "incomplete report", "possible real spend", "cumulative baseline unknown: whole total charged", "lines not priced at this version", the overrun, and "binding violation", whose row's assessment says whether the result is held, discarded or admitted with violation. Since M10 slice 6 each row of a run bound to a subscription login also expands to the credential source the tool reported, with the field it came from and whether it is the reviewed login, or says none is recorded; the basis of a login's settlement is `LIST_EQUIVALENT`. The web view expands each row to its lines; `control-cli attempt-history work-order-id` prints each row with its lines indented below it, with the same origin, CA file and credential input as the commands above, and `--json` prints the raw read model.

### Availability notices

`GET /engine/notices/v1` (permission `notice-list`) returns the installation's notice list (`aiws-notice-list/1`): every live availability notice and those that ended in the last week, each with its source, expiry, the holds that cite it and whether Clear is offered. `control-cli notices` prints the list's `lines` and the web Notices section shows them. A notice offers Clear only where [agent binding §5](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/spec/engine-v1/AGENT-BINDING.md#clearing) permits one: a live account notice, or a retired-or-not-found identifier notice, to a holder of `notice-clear`. `control-cli notice-clear` and the web view's second click send `POST /engine/notice-clear/v1`; a notice only the model register may clear is refused with `NOTICE_CLEARED_BY_REGISTER_ONLY`. The register raises such a notice when an identifier is withdrawn, or when its retirement date is reached; a retirement-date notice is listed from that date on. The hold card of a node it holds names who withdrew the identifier or entered the date, and when.

```sh
node engine/src/control-cli.ts https://127.0.0.1:PORT /secure/host-ca.pem notices < /secure/credential.json
node engine/src/control-cli.ts https://127.0.0.1:PORT /secure/host-ca.pem notice-clear notice-id < /secure/credential.json
```

The operator response is a local engine inspection format; it adds no general workflow wire command or external integration.

### Price changed since binding

When a run with a bound model set is approved, its approval records the price table version shown in the binding review at approval (`state.approval.priceTable`, or null when the register had no prices in the ledger cost unit yet). Each bound node row in `view.nodes` carries `priceChangedSinceBinding`: null while the node's model set prices in effect match that approval version, or an info badge (`Price changed since binding`) when any price entry for a member of the node's model set changed after approval ([agent binding §7](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/spec/engine-v1/AGENT-BINDING.md#7-operator-view)). Expanding the badge lists each changed entry (model, tier, category, old and new price, effective time) and says the allowance is unchanged, so the same allowance covers fewer or more tokens and the stop threshold may be reached sooner. It never creates a hold and never blocks dispatch. The web view renders each node row under **Nodes** with the expandable badge; `control-cli node-rows work-order-id` and `control-cli operator-view work-order-id --text` print the same lines, and `node-rows work-order-id --json` prints the raw node rows.

## Qualification

Engine regression and DOM interactions against the real authenticated HTTPS engine cover reload, exact replay after a lost committed response, distinct validation/acceptance and clearing stale evidence. Playwright headless Chromium then verified the same engine in an actual browser: authenticated inspection, a lost reply with reload and exact retry, validation separate from acceptance, acceptance surviving reload, and full-page captures at 1280 px and 390 px with no horizontal overflow on mobile. Reproducible DOM and Playwright checks are `engine/scripts/verify-operator-ui.mjs` and `engine/scripts/verify-operator-browser.mjs`; static TypeScript checking and the site build also passed. S5 is qualified; M6 platform and M8 release gates remain separate.

## Application identity

The Praxis operator app and SDK documentation share the same SVG mark as their
header logo and browser favicon. The app serves the icon locally, and the candidate
bundle includes it with the web assets; no external image service is required.
