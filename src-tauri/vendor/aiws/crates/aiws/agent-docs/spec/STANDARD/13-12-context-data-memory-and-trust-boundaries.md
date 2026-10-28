# 12 Context, data, memory, and trust boundaries

**X-01 — Data provenance.** Material inputs, tool results, retrieved documents, and memory used in decisions SHALL carry source references, revisions or capture times, trust classification, and access restrictions sufficient to determine permitted use. The runtime SHALL distinguish policy/instructions from untrusted task data and SHALL NOT promote retrieved text or tool output into authority merely because a model follows it.

**X-02 — Context handoff.** Before participant replacement or context compaction, the runtime SHALL retain or reconstruct the intent and definition revisions, applicable constraints, active task obligations, unresolved issues, relevant evidence references, and current authority. A natural-language summary SHALL NOT replace authoritative grant, approval, budget, or effect records. Missing mandatory context SHALL block affected work pending restoration.

**X-03 — Data protection.** The owner SHALL specify permitted data sources, destinations, audiences, retention, and access roles. The deployment SHALL enforce these restrictions across tool calls, delegation, evidence export, and memory writes. Credentials SHALL use protected references and SHALL NOT be copied into ordinary checkpoints or telemetry. Cross-tenant use SHALL require explicit authority and isolation controls.

**X-04 — Memory and conflict.** Persistent memory updates SHALL have a defined write authority, provenance, retention policy, and correction mechanism. Conflicting authoritative inputs SHALL be resolved by declared precedence or escalated; the runtime SHALL NOT choose a convenient source silently. The system SHALL record which source version governed the decision.

**X-05 — Minimization.** Evidence and event retention SHALL preserve required accountability with the minimum authorized sensitive content. Authorized deletion or redaction SHALL leave a protected disposition record where permitted, and SHALL identify any verification claim that can no longer be substantiated. Append-only control history does not require indefinite retention of raw personal content.
