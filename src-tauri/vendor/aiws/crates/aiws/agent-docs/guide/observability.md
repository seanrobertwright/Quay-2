# Observability, metrics and OTLP delivery

Since SDK 0.3.0 / proposed standard edition 0.4. Implemented in TypeScript, Rust and Python.

An interactive [observability export pipeline](./diagrams.md#observability-export-pipeline) diagram traces the path from an accepted command to the OTLP collector.

## Events and trust

Every accepted command carries an `observation` envelope: deterministic event identity, committed sequence, timestamp, decision class, actor, policy/definition revision, causal/correlation references, trace/span IDs and applicable mission/contract/run/node/operation/attempt/trigger/wait references. Coordinator authorization supplies context and overrides caller attribution. Core/store calls without context explicitly use `local:unattributed` and `unattested`; they do not establish authenticated provenance. The immutable contract ID is the definition revision for this finite profile.

`context` requires `actor`, `policyRevision`, `decisionClass` (`DETERMINISTIC`, `HUMAN`, `MODEL`, `DELEGATED`). Optional fields are `correlationId`, `causationId`, a nonzero 32-lowercase-hex `traceId` and nonzero 16-lowercase-hex `parentSpanId`. An application must validate inbound trust before passing remote context. Trace context does not grant authority. Default traces group a mission, with causal event parents; these are control-event spans with identical start/end times. Actual model, tool and node execution spans require adapter instrumentation. No hidden reasoning or automatic provider instrumentation is collected.

Coordinator authorization denial, authorizer failure and reducer/storage failures after authorization produce a separate hash-chained diagnostic stream where storage remains available. These diagnostics do not advance mission revision. Argument validation and preflight misuse are not a universal security audit stream. SDK state hashes detect corruption and changed event envelopes; a digest does not authenticate an author who can rewrite the entire database. Protect access to the ledger and backups.

## API mapping

| Capability | TypeScript (`@aiws/sdk/observability`) | Rust (`aiws_sdk::observability`) | Python (`aiws.observability`) |
|---|---|---|---|
| Event projection | `tracePayload(event)` | `trace_payload(&event)` | `trace_payload(event)` |
| Metrics and alerts | `operationalSummary(state, now, thresholds?, exportState?)` | `operational_summary(&state, now, thresholds, export_state)` | `operational_summary(state, now, thresholds=None, export_state=None)` |
| OTLP metrics | `metricPayload(summary, now)` | `metric_payload(&summary, now)` | `metric_payload(summary, now)` |
| HTTP export | `OtlpHttpExporter(endpoint, headers?, timeoutMs?)` | `OtlpHttpExporter::new(endpoint, headers, timeout_ms)` | `OtlpHttpExporter(endpoint, headers=None, timeout_ms=10000)` |
| Queue metrics | `store.enqueueMetrics(now)` | `store.enqueue_metrics(now)` | `store.enqueue_metrics(now)` |
| Flush queue | `await store.flushTelemetry(exporter, now, limit?)` | `store.flush_telemetry(&mut exporter, now, limit)` | `store.flush_telemetry(exporter, now, limit=100)` |
| Queue health | `store.exportState()` | `store.export_state()` | `store.export_state()` |
| Diagnostic records | `store.diagnostics()` | `store.diagnostics()` | `store.diagnostics()` |

## Measurements and alerts

Metric names have the `aiws.` prefix. All ten count/accounting metrics are snapshot gauges, including those ending `_total`; do not sum repeated snapshots as new events. They describe one mission database. A multi-mission collector must add an appropriate bounded deployment/resource grouping or aggregate before merging series. The default exporter has only `service.name=aiws-sdk`; it does not identify a multi-tenant service instance automatically.

| Names | Meaning |
|---|---|
| `commands_total`, `attempts_total`, `retries_total`, `failed_runs_total` | Accepted commands, distinct attempts, retry commands, currently failed runs |
| `spent_units`, `reserved_units` | Exact application-defined accounting units; no implicit currency or token estimate |
| `unknown_effects`, `pending_waits` | Current unresolved operations and pending waits |
| `export_pending`, `export_failed` | Queue health supplied by the store; direct summary defaults to zero if omitted |
| `run_ms` | First run-related event to explicit terminal transition |
| `attempt_ms` | Dispatch to first settlement that resolves the effect |
| `approval_wait_ms` | AUTHORIZATION wait to correlated satisfaction |

Durations are cumulative histograms over completed observations retained in the mission ledger, in milliseconds, with one bucket. They include elapsed waiting where it falls between the declared boundaries. They do not provide latency percentiles; send individual activity measurements through adapter instrumentation if that is needed. Telemetry integer range is signed 64-bit; ledger quantities remain exact decimal strings. Wall-clock regression or an unsupported telemetry range is an error, never a reason to round accounting values.

Default thresholds (canonical decimal strings): `stalledAfterMs=300000`, `unknownAfterMs=60000`, `approvalAfterMs=3600000`, `budgetPercent=90`, `exportBacklog=1000`. Supply all five fields to override. Alerts: `WORKFLOW_STALLED`, `EFFECT_UNRESOLVED`, `APPROVAL_OVERDUE`, `BUDGET_NEAR_LIMIT`, `BUDGET_EXHAUSTED`, `EXPORT_UNHEALTHY`. Comparison is inclusive at the threshold. Stall detection means no recent run control event, so long-running legitimate actions need suitable thresholds. Re-evaluation returns the current conditions; the application owns notification deduplication, scheduling, recipients, acknowledgement and escalation. Alerts never execute remediation by themselves.

## Export and privacy

The SDK supplies OTLP/HTTP JSON at `/v1/traces` and `/v1/metrics`, with optional headers and a 10-second request timeout. HTTPS certificate validation is enabled; redirects are disabled. No collector is contacted until the application explicitly creates and invokes an exporter. Endpoint and header configuration are trusted operator inputs.

Default trace attributes allow only event type/identity, sequence, decision class and SHA-256 pseudonyms for policy and object IDs. Raw actor identity, correlation tokens, payloads, prompts, evidence contents and credentials are excluded. Hashes are linkable and guessable for low-entropy identifiers; this is not anonymization. The local ledger and audit bundle retain richer records and require their own access and retention policy.

A redacted trace export intent is committed in the same SQLite transaction as the control event. Metric snapshots are explicitly enqueued. Delivery occurs outside that transaction. Batches default to 100 records, maximum 1000; each row is leased for 30 seconds and acknowledgement is fenced by its attempt counter. Network errors and HTTP 429/502/503/504 retry with exponential backoff (1–60 seconds) and numeric Retry-After seconds, capped at 24 hours. HTTP-date Retry-After is not supported. At most eight delivery attempts are allowed. Partial acceptance is retained as FAILED without retrying the whole batch. Other permanent/malformed responses are FAILED. Export exceptions do not repeat workflow effects.

Delivery is at least once, not exactly once. A lost acknowledgement or expired lease may duplicate telemetry; use event IDs to deduplicate downstream. Batches are sent sequentially, so a slow batch can outlive a later row's lease and duplicate it. The outbox is disk-backed without a built-in capacity limit; monitor disk and queue growth. Failure to commit required ledger/outbox data blocks the command before effect dispatch. `purgeSentTelemetry` / `purge_sent_telemetry` deletes only SENT rows. FAILED rows remain in `telemetry_outbox` for operator diagnosis; automatic requeue is deliberately absent because partial acceptance is ambiguous. No background worker, notification service, hosted collector, dashboard or metrics backend is bundled.

## Inspect events, metrics and redaction

**Inspect telemetry without contacting a collector** (Executable example). Full program: [recipes/observability.rs](../recipes/observability.rs)

```rust
use aiws_sdk::*;
use aiws_sdk::{sqlite::SqliteStore,observability::*};
use serde_json::json;
fn main() -> std::result::Result<(),Box<dyn std::error::Error>> {
    let contract=Contract::parse(&std::fs::read_to_string("examples/guide/contract.json")?)?;
    let mut store=SqliteStore::open(":memory:",Some(&contract))?;
    let state=store.apply(&Command::from_value(json!({"type":"startRun","runId":"r","context":{"actor":"private:actor","policyRevision":"policy:1","decisionClass":"HUMAN"}}))?,"10",None)?;
    assert!(!trace_payload(&state.as_value()["events"][0])?.to_string().contains("private:actor"));
    let summary=operational_summary(&state,"4000000",None,Some(&store.export_state()?))?;
    println!("{}",metric_payload(&summary,"4000000")?);
    Ok(())
}

```

This executable example checks the trace projection's privacy boundary and inspects a mission summary without network access. Activity spans around model, tool and file operations belong inside your adapter instrumentation. Link those spans to the applicable control event and avoid recording secret inputs in attributes.

## Exercise exporter recovery

**Retry a telemetry delivery without re-running workflow work** (Executable application recipe). Full program: [recipes/exporter.rs](../recipes/exporter.rs)

```rust
use aiws_sdk::*;
use aiws_sdk::{sqlite::SqliteStore,observability::*};
use serde_json::{json,Value};
struct FakeCollector{calls:usize}
impl TelemetryExporter for FakeCollector{
    fn send(&mut self,_:&str,_:&Value)->Value{
        self.calls+=1;
        classify_response(if self.calls==1{503}else{200},"{}",None)
    }
}
fn main()->std::result::Result<(),Box<dyn std::error::Error>>{
    let contract=Contract::parse(&std::fs::read_to_string("examples/guide/contract.json")?)?;
    let mut store=SqliteStore::open(":memory:",Some(&contract))?;
    store.apply(&Command::from_value(json!({"type":"startRun","runId":"r"}))?,"10",None)?;
    let mut exporter=FakeCollector{calls:0};
    assert_eq!(store.flush_telemetry(&mut exporter,"10",100)?[0]["status"],"PENDING");
    assert_eq!(store.flush_telemetry(&mut exporter,"1010",100)?[0]["status"],"SENT");
    assert_eq!(store.snapshot()?.as_value()["revision"],"1");
    store.purge_sent_telemetry()?;
    Ok(())
}

```

The local collector stub returns a transient 503 followed by success. The example asserts that delivery retries while the mission revision remains unchanged: exporting telemetry must not repeat a workflow effect. Replace the stub with OtlpHttpExporter using a trusted endpoint, headers from runtime secret configuration and an explicit timeout. The API mapping above lists the native constructors. Never copy credentials into the workflow definition or the source example.

Run flushing on an application-owned bounded schedule. Export with a fresh timestamp, inspect exportState/export_state, and retain FAILED records for operator investigation. Purge acknowledged telemetry according to retention policy only after confirming the downstream requirements.

Collector behavior is checked using local HTTP test servers, including restart after 503 and permanent partial-success handling. The tests do not certify every OTLP collector, vendor backend, deployed alert service or the complete OpenTelemetry API.

References: [OTLP 1.11.0](https://opentelemetry.io/docs/specs/otlp/), [Collector security](https://opentelemetry.io/docs/security/config-best-practices/), reviewed 2026-09-08.
