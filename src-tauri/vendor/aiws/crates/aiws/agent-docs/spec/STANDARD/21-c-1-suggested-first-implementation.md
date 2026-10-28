# C.1 Suggested first implementation

Start with one bounded document-review or corrective-action workflow. Implement the definition contract, dispatch authorization, approval binding, durable effect records, and criterion-based verification together. Use a simulated external write target that can commit an update while dropping its acknowledgment; this exposes failures that an ordinary successful demo will miss.

Select one existing runtime after evaluating its enforcement, persistence, and adapter boundaries. Prefer an existing orchestration language and test kit where they can meet the contract. Do not begin by implementing every protocol binding or moving live runs between unrelated runtimes.
