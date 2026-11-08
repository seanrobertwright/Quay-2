# ADR 0006: Machina Stays Beside Praxis

- **Status**: Accepted
- **Date**: 2026-11-08
- **Amends**: [ADR 0005](0005-quay-native-factory-engine.md)
- **Source**: [Decide: Does Quay's Machina factory move onto Praxis, or stay beside it?](https://github.com/seanrobertwright/Quay-2/issues/470), resolved 2026-11-01

## Context

ADR 0005 made Machina run inside Quay and deferred the Praxis sidecar from ADR 0001, naming it the target for the governance features it removed. Since then Quay has gained a Praxis Builder that authors Praxis definitions, including workflow templates (Praxis coding plans), and drives a Praxis host through the `praxis` CLI. That raised the question of whether a Machina work order should become a Praxis template or graph run.

Moving Machina onto Praxis would add a running host, passkey sign-in and a browser approval to every work order. Praxis also has nothing for what makes Machina work: hidden holdbacks with `HOLDOUT_FAIL:`-only feedback, worktree scaffolding, protected paths, and squash-merge on Accept.

## Decision

Machina and Praxis stay side by side for good.

- **Machina is Quay's local factory.** It needs no host, no sign-in and no browser. Every decision on a work order, from admitting it to resolving a hold to Accept, is made in Quay.
- **Praxis is for work that needs a governed host.** Its runs and its decisions belong to the host, and decisions are made in the host's browser page.
- **A Machina work order never becomes a Praxis template or graph run.** Moving Machina onto Praxis is out of scope; it would come back only as a fresh effort with its own decision.
- **The Praxis sidecar from ADR 0001 is retired, not deferred.** Quay will not spawn or supervise `@aiws/engine` for Machina.
- **The features ADR 0005 lists under "Removed"** (credential leases, the `CREDENTIAL_REQUIRED` and `PRICE_REQUIRED` holds, the TLS origin, mutation calibration, the `MISSION.md` bootstrap writer, and agent-side hold resolution) return only if they are built inside Machina.
- **Each engine keeps its own surface and its own words.** Machina says "work order", "hold" and "Accept". Praxis says "run" and "decision". Neither surface uses the other's words. A Praxis run the host reports as `HELD` keeps the host's own label, Held, and its way out is still a decision made in the browser. There is no shared run list and there are no cross-links between the Factory Station and the Praxis Builder.
- **Each surface says which engine it is and where it runs.** The Factory Station's title reads "Machina: local", and the command palette's Machina entry and the stage's Factory button say the same. The Praxis Builder's host chip already does the same for Praxis: it shows the condition of the project's Praxis host.

## Consequences

- An operator can tell the two engines apart by the surface they are on and the words it uses, without a combined view.
- Machina's governance stays what ADR 0005 built. Anything more, such as credential leases, is Machina work, not a reason to bring back a sidecar.
- The Praxis Builder never needs to model work orders, holdbacks or Accept, and Machina never needs a host, a sign-in or a browser.
- The Rail's Machina button still shows the "Folded P" mark (from #282), which is Praxis's mark. Whether it should get its own mark is left to a separate decision.
