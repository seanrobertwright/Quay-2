# Capacity qualification

> **Praxis naming:** This page documents **Praxis**, the AIWS workflow engine. Existing `engine/*` source paths, `/engine/...` routes, `aiws-engine/*` protocol identifiers, and existing script names remain unchanged for compatibility.

**Milestone status:** M6 is complete for the D-M6-01 supervised Windows 11 x64 / Node 24 / local SQLite developer profile. M8 is now active (not in this pack): its plan is complete; qualification and expanded release/support claims remain open.

M6 slice 9 has a reproducible **component qualification runner**, including bounded
CP-01 waiting-population, CP-02 provider-I/O, CP-03 CPU-worker, CP-04 contention/fairness,
CP-05 retained-history, CP-06 streamed-artifact, CP-07 recurring-recovery and CP-08
pressure/control adapters, plus a resumable exact-matrix campaign orchestrator. M6 is
complete for the bounded D-M6-01 Windows 11 x64 / Node 24 / local SQLite developer profile;
full release qualification remains open under M8.
A passing short run is evidence for the operations it exercised, not a supported
workflow ceiling or a long-duration reliability claim.

## Run a baseline

For the combined reference workload, use `npm run qualify:capacity:reference`: a dedicated
server process holds the waiting population and retained history on one database while
local provider requests overlap real authenticated HTTPS inspect/pause/resume/cancel.
The separate client checks the supplied certificate and hostname. It does not contact
external providers or spend AI API tokens.

Start with `--mode smoke --output <new-directory> --tls-key <test-key.pem> --tls-cert
<test-cert.pem>`. Qualification additionally requires fixed reference/constrained VM
allocation evidence, 120-second warmup, 600-second measurement and 1,000 samples per
required action. Threshold misses return a failing exit code. See the repository's
`docs/CAPACITY-REFERENCE-RUNBOOK.md` for Windows commands and VM evidence format.
The smoke fixture is not capacity qualification; simulated-provider dispatch is not
governed production admission and server RSS includes its SQLite and evidence I/O threads.

All three combined reference-VM reports from 2026-09-17 (seeds 1729/3253/7919, Windows
build 26200, fixed 4 vCPUs / 8 GiB) pass all seven numerical gates and the full sampling
protocol. Each completed 2,400 control cycles without misses and reconciled 100,000 seed
events and wakeups after restart. Event-loop p99 ranged from 21.725 to 22.184 ms.
All uploaded reports were reviewed, have identical source fingerprints and host evidence,
and show non-overlapping run times. This completes the three-report reference milestone;
raw latency/resource/progress logs and VM proof have now also been reviewed. Database
replay and reconstruction of the unretained event-loop histogram remain outside that review. The simulated providers
missed 24.62–25.99% of timer offers, so these reports do not establish sustained
100-offers/s throughput. Constrained runs, broader acceptance and soaks remain open.
See `docs/evidence/m6-slice9/reference-windows-seed-1729`,
`docs/evidence/m6-slice9/reference-windows-seed-3253`,
`docs/evidence/m6-slice9/reference-windows-seed-7919` and `docs/M6-CAPACITY.md`.

D-M6-01 acceptance is complete for the supervised Windows 11 x64 / Node 24 / SQLite
developer profile. Raw-evidence handoff review is complete. The local Linux restart discrepancy
was isolated to stale WAL sidecar restoration/re-exposure after the engine process had exited,
not an engine persistence write, and the final Engine plus SDK/documentation CI reruns passed.
Broader platform, capacity and endurance qualification remains tracked for M8; no production or long-duration readiness claim is made.

Use Node 24 from the repository root after `npm ci`:

```sh
npm run qualify:capacity -- --output capacity-evidence --seconds 60 --restart 15
```

The destination must not exist. Every attempt keeps its report, raw latency samples,
resource samples and SQLite database, including on failure. Use a private scratch
volume with sufficient free space. The runner generates synthetic data; it never opens
an existing installation or contacts an external provider.

The defaults seed 1,000 work orders with ten parked tasks each, run 1,000 deterministic
indexed waiting-task inspections, and create 10,000 durable audit events through the
normal storage API. CP-01 also records logical SQLite and RSS growth, restarts storage to
time its first checked inspection, proves waiting records consume no execution slots, and
drains the exact population in bounded batches. The measurement loop offers 20 cycles/second;
each cycle commits one command, inspects its state, inspects a seeded waiting task and
reads a bounded history page. Each completed measured cycle also offers one deterministic
local-provider request and one deterministic CPU task. Post-measurement CP-04 through
CP-08 probes check persisted scheduler fairness, transactional admission accounting, hot,
snapshot and archived-prefix history behavior, bounded artifact publication/read,
retention references, interrupted-upload cleanup and verified backup inventory. Waiting tasks
must not be claimable. Clean storage-worker
restarts verify state and idempotent command replay. CP-07 restarts a separate schedule
database, recovers every fixed-UTC catch-up policy in bounded pages, and proves real
`UNKNOWN` dispatch exposure remains owned and reserved across another restart. Final paged verification checks
every event ID in order; a wakeup burst must fire every parked task exactly once in
batches of at most 100.

CP-08 uses the authenticated `ControlService` path during delayed provider and SQLite
write pressure. It requires durable pause/resume/cancel results, explicit failure without a
false state transition when a storage deadline is exceeded, low-disk admission blocking,
live-reference retention, and a persisted high-to-low worker-capacity drain with no killed
authorized effects or oversubscription.

## Plan and resume the full host campaign

Planning is the default and never launches a measurement. It writes an immutable matrix
and a derived status file:

```sh
npm run qualify:capacity:matrix -- \
  --output capacity-campaign-reference \
  --mode plan \
  --host-profile reference \
  --host-evidence /private/host-evidence/reference.json \
  --host-note "4 cores; 8 GiB; SSD details; fixed power policy; applied limits"
```

The qualification matrix has 36 ascending cells and 108 logical runs: three fixed seeds,
120 seconds of warmup, 600 seconds of measurement, and at least 1,000 controls per cell.
After reviewing the plan and provisioning the default 16 GiB per-attempt evidence budget,
execute it:

```sh
npm run qualify:capacity:matrix -- \
  --output capacity-campaign-reference \
  --mode execute \
  --host-profile reference \
  --host-evidence /private/host-evidence/reference.json \
  --host-note "4 cores; 8 GiB; SSD details; fixed power policy; applied limits" \
  --acknowledge-long-run YES
```

Run the same command to resume. Passed attempts are skipped. Failures remain immutable and
stop all remaining workloads in that campaign pending diagnosis; after inspection, `--retry-failed true`
creates the next numbered attempt. Use different roots for reference and constrained
hosts. PostgreSQL plans are supported, but execution is deliberately blocked until the
candidate adapter exists. A completed host campaign still reports
`PASS_HOST_CAMPAIGN_NOT_CERTIFIED`.

Qualification execution now requires `--host-evidence` using the fixed-VM format in
`docs/CAPACITY-REFERENCE-RUNBOOK.md`. Preflight checks exact guest CPU allocation, fixed
RAM (within 5%), no lower process memory cap, disabled dynamic memory and an SSD/power
policy declaration. The nonempty VM configuration proof (at most 1 MiB) is hashed into
the immutable plan. Missing or mismatched allocation exits 2 before any measured attempt.
Plan mode remains available on an oversized host, but such plans are local previews: generate
the executable plan inside the actual guest with its proof. Source, runtime, allocation or
proof changes require a new campaign directory. Smoke mode remains explicitly unqualified.
These checks verify guest allocation plus operator evidence, not dedicated physical cores
or absence of competing host load. Retain the original configuration proof for review.
Then validate and compact the campaign without copying its multi-gigabyte raw artifacts:

```sh
npm run summarize:capacity:campaign -- \
  --input capacity-campaign-reference \
  --output capacity-campaign-reference-summary
```

The summarizer checks the plan digest, report count and hashes, common source/environment
provenance, target-specific protocol flags and declared-versus-observed host capacity.
Its output remains explicitly non-certified.

## Recorded full campaign

The first complete Windows campaign passed all 108 attempts across 36 cells and three
fixed seeds. Every CP-01 through CP-08 protocol flag and component safety assertion
passed, including the 1,000,000-event, 1-GiB artifact, 100,000-schedule/128-`UNKNOWN`,
64-contender/depth-16 and 1,000-control cells.

It is retained as **unconstrained-host component evidence**, not as the reference cell.
The plan described 4 cores / 8 GiB, while the reports observed 24 logical CPUs and
31.07 GiB with no resource-enforcement proof. Separate component proxies were below the
provisional thresholds, but the required combined 10,000-workflow + provider-ceiling-32 +
100,000-event cell was not executed. The constrained/reference target hosts, HTTP/TLS
transport, split coordinator/worker RSS, allocated disk, PostgreSQL comparison and real
soaks remain open. See the repository's compact
`docs/evidence/m6-slice9/windows-unconstrained-campaign-01` record.

## Choose a measurement budget

| Option | Default | Meaning |
|---|---|---|
| `--workflows` | 1000 | Parked work orders, ten tasks each; up to 100000 |
| `--waiting-inspections` | 1000 | CP-01 deterministic indexed waiting-task samples; 1–10000 |
| `--target-workload` | ALL | Isolate `CP-01` through `CP-08`; campaign runs set this automatically |
| `--events` | 10000 | Initial retained events; up to 1000000 |
| `--warmup` | 0 | Warmup seconds, excluded from measured cycles |
| `--seconds` | 10 | Measurement seconds; up to 604800 (seven days) |
| `--rate` | 20 | Offered cycles/second, up to 1000 |
| `--restart` | 60 | Seconds between clean storage-worker restarts |
| `--max-mib` | 1024 | Stop when sampled evidence-directory bytes exceed this budget |
| `--max-rss-mib` | 1024 | Stop when sampled whole-process RSS exceeds this budget |
| `--seed` | 1 | Published deterministic waiting-task selection seed |
| `--host-note` | not recorded | Record disk medium, power policy and host resource constraints |
| `--provider-concurrency` | 8 | CP-02 approved active ceiling; 1–128 |
| `--provider-fast-ms` | 100 | Seeded provider's normal service time |
| `--provider-slow-ms` | 1000 | Seeded provider's slow service time |
| `--provider-slow-every` | 10 | Deterministically make every Nth provider request slow |
| `--cpu-concurrency` | min(2, logical CPUs) | CP-03 worker-thread ceiling; 1–8 |
| `--cpu-iterations` | 20000 | Fixed SHA-256 operations per CPU task |
| `--effect-queue` | 1000 | Maximum queued requests per effect adapter |
| `--contention` | 16 | CP-04 continuously eligible contenders; 2–64 |
| `--contention-depth` | 4 | Ancestor depth per contender; 1–16 |
| `--contention-rounds` | 2 | Complete fairness rounds; 2–100 |
| `--contention-slots` | min(8, contenders) | Shared-root cost/active admission limit |
| `--contention-connections` | min(8, contenders) | Concurrent SQLite authorization connections |
| `--history-events` | 100 | CP-05 retained events; required ladder is 10000/100000/1000000 |
| `--history-page-events` | 100 | Maximum events per verification/export page |
| `--history-seed-batch` | 1000 | Events per legal fixture-seeding command |
| `--history-segment-events` | 1000 | Maximum events per archived segment |
| `--history-archive-percent` | 80 | Percentage packed in the archived-prefix variant |
| `--history-payload-bytes` | 64 | Deterministic payload padding per retained event |
| `--artifact-bytes` | 1048576 | CP-06 bytes per immutable object; required ladder is 1 MiB/100 MiB/1 GiB |
| `--artifact-chunk-bytes` | 65536 | Maximum publication/read chunk; 1 byte–4 MiB |
| `--artifact-concurrency` | 4 | Artifact stream concurrency; 4 runs both the 1 and 4 cells |
| `--schedules` | 1000 | CP-07 overdue schedules; required ladder is 1000/10000/100000 |
| `--schedule-backlog-ticks` | 10 | Due ticks presented to each catch-up policy after restart |
| `--schedule-interval-ms` | 1000 | Fixed-UTC interval used by the deterministic fixture |
| `--schedule-batch` | 100 | Maximum overdue schedules recovered per storage call |
| `--schedule-occurrence-batch` | 100 | Maximum occurrences emitted per schedule recovery |
| `--schedule-replay-limit` | 32 | Human-approved `BOUNDED_REPLAY` limit |
| `--unresolved-attempts` | 32 | Real `UNKNOWN` attempts retained across restart; 0–128 |
| `--control-samples` | 1000 | CP-08 authenticated control mutations; 4–10000 |
| `--pressure-ceiling` | 8 | Initial approved active worker ceiling; 2–128 |
| `--pressure-reduced-ceiling` | 4 | Reduced ceiling after drain; must be below the initial ceiling |
| `--pressure-queued` | 8 | Ready tasks retained behind the filled ceiling |
| `--pressure-provider-concurrency` | 8 | Deterministic delayed-provider operations overlapping controls |
| `--pressure-provider-delay-ms` | 250 | Delay per CP-08 provider-pressure operation |
| `--pressure-storage-delay-ms` | 50 | Independent SQLite write-lock duration; 20–1000 ms |

These are benchmark input bounds, not product limits. Resource budgets are sampled,
not OS-enforced quotas; provisioning must allow headroom between samples. Seeding and
final reconciliation take additional time. SIGINT/SIGTERM request a stop at the next
budget check. A killed process can leave `RUNNING` evidence, which never counts as a pass.

For the specification's minimum component measurement duration, use `--warmup 120
--seconds 600` and repeat in three different output directories with published seeds.
At least 1,000 completed samples are required per measured cell. Start with the smallest
scale and stop on resource exhaustion or a failed invariant. The runner can also collect
24-hour (`--seconds 86400`) and seven-day component soaks. Those do **not** substitute
for the required full-workflow soaks with production adapters, controls and accounting.

## Interpret the evidence

`report.json` contains source hashes, Git baseline, Node/SQLite versions, CPU, OS,
filesystem type, workload inputs, counts and explicit unmeasured scope. `PASS` means
the exercised component assertions passed. `qualification: NOT_QUALIFIED` deliberately
remains separate. Protocol flags describe duration, warmup and sample sufficiency;
they cannot close the full acceptance gate.

`latencies.ndjson` preserves every timed operation, including warmup and seed stages.
Summary percentiles are **histogram bucket upper bounds**, in milliseconds; an overflow
bucket is explicitly named. `resources.ndjson` records whole-process RSS (including the
storage worker and CPU worker threads), CPU/resource counters, pending storage calls,
effect queue/active snapshots and evidence bytes. Worker-thread RSS is included in the
whole process rather than reported separately. Disk bytes are logical file lengths,
including raw evidence and WAL, not allocated physical blocks or a retention estimate.

The `waiting` section records the exact workflow/node population, indexed sample count,
logical SQLite growth and bytes per workflow, RSS delta, restart-to-first-inspection,
empty scheduler/dispatch execution exposure, and exact wake reconciliation. Its required
ladder cells are 1,000, 10,000, and 100,000 workflows with exactly ten nodes each.

Offered, completed and missed storage cycles are reported separately. There is one
outstanding storage cycle at a time, with missed offers counted rather than an unbounded
catch-up queue. Provider and CPU effects have separate bounded queues and report offered,
admitted, completed, backpressured and failed counts; dispatch and service timings are
separate. The `contention` section records persisted fairness across a mid-cycle storage
restart, shared-root capacity rejections, independent-root progress, exact reservations
and settlement. CP-04 uses the real scheduler and admission paths, but remains a component
probe rather than an authenticated control benchmark.
The `history` section records the verified seed snapshot and its hashes, snapshot-copy
costs, hot/snapshot/archived-prefix counts, normal command and current-state inspection
latency, bounded first-page cost, resumable verification, exact streaming replay, logical
database bytes and reopen-to-inspection. Seed snapshots are built through legal engine
commands and fully verified before reuse.
The `artifacts` section records immutable object digests, publication and bounded-read
timings, throughput, maximum chunks, RSS delta, injected interruption cleanup, retention
reference protection, and the exact verified backup inventory. Artifact publication,
backup hashing/copying and inspection use bounded streams. Logical bytes are reported;
allocated filesystem blocks and retained-capacity forecasts still require target-host
measurement.
The `recurring` section records schedule creation and bounded recovery timings, restart
to first inspection/eligibility, policy-specific emissions, skipped/coalesced ticks,
cursor advancement and occurrence uniqueness. Its unresolved-attempt probe records exact
before/after dispatch snapshots, reserved cost/active time and active ownership. A ready
probe task must remain blocked when `UNKNOWN` exposure fills the configured ceiling; the
zero-exposure cell must admit it.
The `pressure` section records authenticated control and inspection latency, provider-delay
overlap, storage commit failure versus durable success, low-disk admission, reference-safe
retention, and the capacity drain/refill sequence. The normal control path is measured at
the service boundary; HTTP/TLS transport latency remains a target-host qualification item.
Storage inspection latency must
not be presented as authenticated API latency; clean worker reopening is not a process
crash, whole-coordinator restart or power-loss test.

Full acceptance still requires execution of the planned CP-01–CP-08 workload matrix on
reference and constrained hardware, full provider/CPU and CP-04
2/16/64-contender by 1/4/16-depth ladders, the full
CP-05 10000/100000/1000000 history ladder, CP-06 1 MiB/100 MiB/1 GiB artifact ladder,
the CP-07 1000/10000/100000 schedule by 0/32/128 `UNKNOWN` cross-product, CP-08 target-host
transport/disk-pressure cells, repeated
measurements and real-time soaks.
The provisional 250 ms inspection, 500 ms durable-control, 100 ms event-loop and 1 GiB
RSS gates remain unchanged. See the repository's `spec/engine-v1/CAPACITY.md` and
`docs/M6-CAPACITY.md` for the acceptance checklist and recorded baseline.

Continue with [deployment qualification](./engine-deployment-platforms.md),
[bounded replay](./engine-replay-limits.md) and [failure injection](./engine-failure-injection.md).

## M8 slice 2 execution

Slice 2 is complete for the two measured guests (2026-10-06). The owner selected new
Ubuntu 24.04 fixed Hyper-V guests on the LIVING-ROOM host because the former Windows
reference VM is unavailable; their results are separate from Windows evidence. Each
complete ladder has 36 cells × three seeds: 21.6 hours of prescribed warmup/measurement
per host before seeding/reconciliation, and the two profiles ran one at a time on this
shared physical host. The enabled claim is measured component capacity on those two
guests only; no production, endurance or release capacity pass follows from it.


### Storage worker failure handling

The executor remembers a worker failure and rejects later requests instead of
queuing them to an exited worker. Unexpected exits, including exit code zero,
reject pending requests. Closing a failed executor does not wait for that worker.
An affected operation's commit outcome still requires reconciliation before retry.
This does not impose a deadline on a live worker or prove recovery from every stall.

The first Ubuntu campaign stayed pinned to its original candidate. Its CP-04 incident
and reviewed retry are recorded in `docs/M8-SLICE2-EXECUTION.md` in the repository.
The failure-handling fix is tested separately and does not inherit capacity
qualification from that campaign. D-M6-01 remains the bounded Windows developer
profile.

That campaign was stopped after a second contention stall, with 56 reference runs
completed. Separate diagnostics reproduced a telemetry connection timing out
during worker startup, followed by requests waiting on the dead worker. Telemetry
now uses the executor's configured SQLite busy timeout, alongside the terminal
worker-failure handling described above. This fixes a timeout mismatch; it does
not make lock contention impossible or retry an uncertain operation. The original
capacity evidence remains tied to its original candidate and cannot qualify this
changed engine. Host monitoring now runs through a Windows scheduled task with
lifecycle logging; gaps in the earlier host observations remain recorded.

A second campaign on the fixed engine completed one reference combined run before
its host monitor was lost; the run in progress was stopped and is not a pass. The
monitor's console had been handed to a terminal window and ended with it. The
monitor now runs under a headless console host, and a repeating trigger relaunches
it if it is killed. Both earlier campaigns are superseded and their evidence is
retained. The campaign that followed was pinned to a newer `main` commit and started
again from the first reference run, so nothing measured on an earlier candidate
counts toward it. Its three reference combined runs passed every numerical gate
and the operator's stage review; its 108-run reference ladder passed every run on
the first attempt in about 47 hours; the three constrained combined runs on the
2-vCPU/4-GiB guest passed; and its 108-run constrained ladder passed every run on
the first attempt in about 43 hours. The final Q01 review of 2026-10-06 reproduced
every ladder report from the raw samples, re-derived the combined runs' p95 values
from theirs, and found no stop condition, so slice 2 is complete with the
measured-component-capacity claim for those two guests. Every report keeps its
runner value, `qualification: false` for the combined runs and `NOT_QUALIFIED` for
the ladders; this is not a release or production pass.
