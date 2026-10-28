# Capacity, fairness and retention measurement plan

Status: finalized M4 test requirements. All numbers below are test inputs or provisional
engineering gates, not measured results or product task/workflow ceilings.

## Workload matrix

Run each workload first on SQLite, then on a PostgreSQL candidate with identical logical
inputs before comparing capacity. Use local storage on a recorded four-core/8 GiB RAM
reference machine with adequate SSD space, plus constrained two-core/4 GiB runs to test
backpressure. Record real CPU model, architecture, OS/filesystem, power policy, pinned
runtime/database settings and adapter versions; the labels alone are not reproducibility.
Actual task/LLM limits are human choices independent of the coordinator test machine.

| ID | Workload and scale ladder | Required observation |
|---|---|---|
| CP-01 waiting population | 1,000 / 10,000 / 100,000 stored waiting workflows; ten nodes each; no live effects | Indexed readiness, memory, inspection latency; waiting records consume no executing slots |
| CP-02 I/O concurrency | Human ceilings 1 / 8 / 32 / 128; seeded local provider with 100 ms median, 1 s p95 service time | Dispatch/control latency and throughput; no admissions above approved ceilings |
| CP-03 CPU workers | Ceilings 1 / 2 / 4 / 8; deterministic CPU task outside coordinator | Event-loop/control responsiveness and CPU saturation; queue safely when constrained |
| CP-04 shared ancestor | 2 / 16 / 64 contenders, depth 1 / 4 / 16, same bounded root; compare independent roots | Lock wait, fair progress, no oversubscription or double counting |
| CP-05 retained history | 10,000 / 100,000 / 1,000,000 events, plus snapshot and archived-prefix variants | Page/command/reopen costs; normal command must not replay whole history |
| CP-06 artifacts | 1 MiB / 100 MiB / 1 GiB immutable objects; stream concurrency 1 / 4 | Bounded memory, hashing/publication time, retention refs and interrupted upload cleanup |
| CP-07 wake/recovery burst | 1,000 / 10,000 / 100,000 overdue schedules; all catch-up policies; restart with 0 / 32 / 128 unresolved attempts | Recovery/first-inspection time, bounded occurrence batches, UNKNOWN ownership retained |
| CP-08 pressure and controls | Fill approved active ceiling, then reduce it; controlled disk quota and provider/storage delays | Safe drain, responsive pause/cancel/inspect, no retention-rule bypass to free space |

Run ascending ladders and stop a cell at its resource budget or first safety failure.
Unrun higher cells are NOT_MEASURED, not passing or unsupported by definition. Large
fixtures exceeding message/array limits are created in pages through legal operations
or a verified same-format seed snapshot. No special backend writes may bypass invariants
in a measured workflow path. Streaming artifacts remain outside JSON control messages.

## Admission fairness and overload

Initial policy: round-robin among eligible work orders at each constrained capacity
scope; within one work order, oldest eligible ready sequence first. Persist the last
served cursor/ready sequence with admission so restart does not repeatedly favor one
work order. Shared-ancestor/provider constraints use the same rotating selection for
eligible contenders. No user priority override in the initial profile. Held/ineligible
work does not consume a turn forever or block a runnable independent sibling.

With N continuously eligible work orders competing for a recurring single available
slot, each must receive an admission within N successful admission turns. This is a
fairness invariant, not a wall-clock completion deadline; a noninterruptible effect or
UNKNOWN may legitimately occupy a slot indefinitely. Adaptive throttling may reduce
admissions below the approved ceiling but never increase it. Reducing a ceiling blocks
new admissions until safe drain; it does not kill already authorized effects.

Bound ready pages, worker pool, in-memory notification queues, database waiters and
upload buffers by host settings, disclosed in test reports. Defaults for the test run:
ready page 100, timer page 100, worker control queue 1,000, storage wait timeout 5 s.
These are replaceable operational values, not task-count limits. Bounded retry with
jitter is only for proven rollback; unknown commit uses idempotent lookup. Keep a
separate bounded control queue and reserve storage capacity for settlement/holds and
inspection. Under storage failure, report inability to commit a control promptly;
never report PAUSED merely because its button was clicked.

## Measurement protocol and gates

Use real monotonic time for measurements, not FAKE-CLOCK.md. For each cell: load/verify
the seed, warm for two minutes, measure at least ten minutes and 1,000 completed control
requests, then drain/reconcile and reopen. If a slow workload cannot meet the sample
count within its declared run budget, report the sample and confidence limitation;
do not fabricate a percentile. Repeat three times with fixed published seeds. Retain
all attempts and raw histograms, including aborted/failed runs. Measure offered load
as well as completed work so a growing backlog cannot masquerade as stable throughput.

Record p50/p95/p99 API latency, durable pause/cancel latency, eligible-to-dispatch lag,
transaction wait/serialization retries, Node event-loop lag, throughput, queue depth
over time, coordinator/worker RSS separately, CPU, I/O, disk/WAL growth, recovery to
inspection, recovery to eligibility and bytes per event/workflow/artifact. IDs belong
in correlated evidence, not unbounded metric labels. Provider service latency is
reported separately from engine dispatch overhead.

Provisional reference-cell engineering targets (CP-01 at 10,000 workflows, CP-02 ceiling
32, history 100,000, local fake provider and no injected failures): p95 inspect <=250 ms,
p95 durable pause/cancel <=500 ms, p95 eligible-to-dispatch <=250 ms when capacity is
available, coordinator p99 event-loop lag <=100 ms, coordinator RSS <=1 GiB and first
authorized inspection after restart <=30 s. These are M5/M6 acceptance targets to measure,
not promises that all hardware/workloads meet them. A miss needs a recorded bottleneck
and changed implementation or explicit revised target before claiming the cell passes.

Safety gates are absolute at every load: zero oversubscribed ancestor reservations,
lost committed commands, unapproved dispatches, secret leaks, silently dropped required
handoffs or cleared UNKNOWN effects. Backpressure is acceptable; silent data loss is
not. Measure fairness separately from latency. Run 24-hour and seven-day real-time soaks
with controlled restarts at sustainable load before long-duration readiness claims.
Accelerated 30/90/365-day clock cases check retention/timer rules only; months-long
reliability remains unproven until equivalent operational evidence exists.

## Storage and retention sizing

Keep the accepted defaults: active/unresolved dependencies indefinitely; closed history
hot 90 days then archived through one year; routine logs 30 days/failure logs 90 days;
final artifacts with history; temporary work eligible seven days after closure only
after required outputs are preserved; daily backups for 30 days. Defaults are configurable
with audited human control, and live references always win.

Measure incremental logical and allocated bytes separately, accounting for WAL, indexes,
temporary files, workspaces, artifacts, backup compression/deduplication and archive
copies. Estimate hot history as observed closed workflows/day × observed events/workflow
× observed allocated bytes/event × 90, then add observed active pinned history and all
other categories. Archive the remainder of the one-year closed-history window; don't
assume pinned history or artifacts have the same compression ratio. Measure actual
backup bytes per daily snapshot rather than blindly multiplying database size by 30.
Reserve space for migration and restore probes plus a configurable safety margin.

Publish estimates with sample duration and uncertainty; no fixed database size can
guarantee retention when humans can admit more work. Low space stops admission safely
and requests intervention. Cleanup requires verified restoration and a final live-ref
check. PostgreSQL may offer a better measured concurrency cell; it does not remove
retention, shared-parent contention, disk or human-budget limits.
