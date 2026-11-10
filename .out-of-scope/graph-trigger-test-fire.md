# Test fire for a graph trigger

Quay does not offer a "test fire" or "send a test event" action for a graph
trigger in the Praxis Builder.

## Why this is out of scope

A test fire needs one of two things, and Quay has neither by design.

**Praxis has no manual fire for a graph trigger.** The engine contract refuses
a trigger of kind `MANUAL` on a graph workflow with the finding
`MANUAL_USE_GRAPH_RUNS` (AI-WS-SDK `spec/engine-v1/GRAPH-TRIGGERS.md`), and its
conformance suite requires that refusal. The `praxis triggers` commands check,
submit, list, show, read fires, withdraw, disable and retire a trigger. None of
them fires one.

**Posting events is a relay's job, not Quay's.** An event-driven trigger fires
when an event source delivers an event to the Praxis host. Quay is an authoring
and observing client: it submits trigger candidates and reads their fires. If
Quay posted a synthetic event, it would act as an event source, and the fire it
caused would be indistinguishable on the host from a real one.

The need behind the request is already met. An author who wants to see a graph
workflow run starts a graph run by hand from the Runs view. That is the path
Praxis itself names in the `MANUAL_USE_GRAPH_RUNS` refusal. An author who wants
to know whether a trigger is well formed gets that from `praxis triggers check`,
which the builder runs before a submit.

## What would change this

Reconsider if Praxis contracts a sanctioned test-fire path for graph triggers,
one the host can tell apart from a real fire. Without that, a test fire in Quay
would have to work around the engine's own refusal.

## Prior requests

- #485, "Watch: test fire for a graph trigger". It was left by the Praxis
  visual builder map (#227) and came from the trigger authoring decision (#469).
