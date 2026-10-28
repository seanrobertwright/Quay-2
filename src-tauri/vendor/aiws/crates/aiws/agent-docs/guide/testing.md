# Test recipes and release gates

A passing SDK suite establishes the tested implementation profile. An application also needs evidence that its authorizer, target adapters, storage and assessment logic behave correctly under failure. Documentation examples use local simulations and do not certify a production provider.

## Run the documented examples

```sh
npm ci
npm run build:sdk
python -m pip install ./packages/python
node scripts/check-guide-examples.mjs
```

The command runs every TypeScript and Python example and compiles/runs every Rust example. It stops on the first failed assertion or process error. `AIWS_PYTHON` and `AIWS_CARGO` select nondefault executables. Each code tab is backed by one of those source files. Isolated source simulations deliberately supply recorded outcomes and make no external calls.

## Run the SDK tests separately

```sh
npm test
python -m unittest discover -s packages/python/tests -v
cargo test --locked
npm run test:parity
```

The shared corpus checks positive and negative command sequences, expected state values and exact canonical state hashes across languages. It also checks shared SQLite state and representative observability projections. A test passing in one language is not evidence that an unexecuted example in another language compiles.

## Adapter fault matrix

| Injection point | Required observable result |
|---|---|
| Authorizer rejects | No external call; state does not advance through rejected action |
| Reservation exceeds allowance | No dispatch; prior accounting unchanged |
| Commit fails before dispatch | No adapter call and no orphan committed outbox intent |
| Target applies effect, response lost | UNKNOWN retained; no blind resend |
| Restart with PREPARED attempt | Old ownership cannot dispatch after recovery |
| Approval expires before retry | Retry/dispatch rejected until a valid authorized path exists |
| Duplicate delivery | No duplicate semantic work; changed material rejected |
| Artifact modified after assessment | Reassessment or invalidation before accepted use |
| Collector returns transient failure | Persistent export retry, no repeated workflow effect |
| Collector partially accepts | Failure retained, no full-request resend |
| Disk unavailable | No dispatch that depends on an uncommitted control event |

Use real target readback in adapter tests. A mock returning CONFIRMED_APPLIED without examining anything verifies only plumbing. For coding, compare repository revisions and test artifacts before and after a simulated lost response. For remote systems, use their request identity or audit receipt.

## Deployment gates

Measure ledger growth and transaction latency under expected mission histories, test backup/restore with WAL, verify credential isolation and configure alert evaluation and queue retention. Require meaningful evidence for claimed cancellation and budget caps. A successfully built documentation site is not a load test or a deployment conformance assessment.

## Documentation release checks

DOCS-VALIDATION.md is the historical record of the documentation gates as they ran on 2026-09-08, kept separate from historical SDK tests. Every program in that run passed, and TypeScript also passed strict type checking. The site checker verifies displayed/source equality, chapter links, tab-panel references and generated agent-readable downloads. It also fails when a chapter types a count of recipes, programs, node or trigger kinds, or diagrams, names an SDK version other than the current one outside an allowlisted historical phrase, leaves a package export or module off its language page, or names a CLI subcommand that the CLI's usage text does not list. CI runs these checks on every push and pull request.
