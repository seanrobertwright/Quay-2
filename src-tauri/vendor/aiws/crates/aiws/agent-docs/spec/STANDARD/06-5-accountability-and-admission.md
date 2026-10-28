# 5 Accountability and admission

**G-01 — Roles.** The adopting organization SHALL identify a workflow owner, definition/policy approval authority, runtime operator, and verification authority. It SHALL document any combined roles and enforce separation where the workflow's approved risk policy requires independent approval or verification.

**G-02 — Risk assessment.** Before activation, the owner SHALL classify the workflow's consequences, affected parties and data, external effects, uncertainty, reversibility, and operating environment. The resulting versioned policy SHALL identify required gates, evidence quality, verifier independence, and escalation routes. Numeric model confidence alone SHALL NOT determine whether consequential work is authorized.

**G-03 — Admission.** The runtime SHALL validate the definition, referenced policy, participant eligibility, required capabilities, budgets, persistence availability, and verification arrangements before entering READY. Missing authority or unresolved required fields SHALL prevent dispatch. Rejection SHALL have a recorded reason.
