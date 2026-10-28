# Tests and coverage

Install Python with `python -m pip install ./packages/python`, then run `python -m unittest discover -s packages/python/tests -v`, `npm test`, `cargo test --locked` and `npm run test:parity`. The shared corpus covers authority attenuation, revocation, approvals, budgets, uncertain effects, recovery epochs, waits, trigger identity/limits, scheduling, graph structure, every node kind, and material schemas.

The parity runner compares error codes and a canonical state digest after every accepted or rejected command. All three language suites also replay the journal and check independently specified expectations. Persistence tests inject transaction failures, reopen databases, conflict on expected revisions and detect changed journal entries. Coordinator tests exercise a lost external response and recovery without redispatch.

See the source archive's `TEST-REPORT.md` for the release results and `COVERAGE.md` for requirement mapping. Passing this suite establishes the tested implementation profile; it does not certify authenticated source integrations, external network enforcement, evidence truth, or every deployment requirement in the formal proposal.

Release 0.3.0: 70 TypeScript tests, 62 Python tests, six Rust test functions, and 57 shared scenarios with three-language state parity. Local HTTP tests in every language check transient failure, restart and partial success. See [observability](./observability.md) for the precise delivery and alert boundaries.
