//! Correlated records, allowlisted OTLP/HTTP JSON, metrics and alert evaluation.
use crate::core::{a, check, q, st, vs};
use crate::*;
use num_bigint::BigUint;
use serde_json::{json, Value};
fn hash(v: &Value) -> Result<String> {
    Ok(digest(v)?[7..].to_owned())
}
fn quant(v: &Value) -> Result<BigUint> {
    let t = st(v);
    check(
        !t.is_empty()
            && t.len() <= 100
            && t.bytes().all(|b| b.is_ascii_digit())
            && (t == "0" || !t.starts_with('0')),
        "OBSERVABILITY_CONFIG",
    )?;
    Ok(q(v))
}
pub fn event_envelope(s: &Value, c: &Value, at: &str) -> Result<Value> {
    let default = json!({"actor":"local:unattributed","policyRevision":"unattested","decisionClass":"DETERMINISTIC"});
    let ctx = c.get("context").unwrap_or(&default);
    check(
        ctx["traceId"] != "0".repeat(32) && ctx["parentSpanId"] != "0".repeat(16),
        "TRACE_CONTEXT",
    )?;
    let attempt = &s["attempts"][st(&c["attemptId"])];
    let oid = c.get("operationId").unwrap_or(&attempt["operationId"]);
    let op = &s["operations"][st(oid)];
    let wait = &s["waits"][st(&c["waitId"])];
    let rid = [
        &c["runId"],
        &op["runId"],
        &wait["runId"],
        &c["approval"]["runId"],
    ]
    .into_iter()
    .find(|v| v.is_string())
    .cloned()
    .unwrap_or(Value::Null);
    let nid = c.get("nodeId").unwrap_or(&op["nodeId"]);
    let tid = c.get("triggerId").unwrap_or(&c["trigger"]["id"]);
    let refs = json!({"missionId":s["contract"]["missionId"],"contractId":s["contract"]["id"],"runId":rid,"nodeId":nid,"operationId":oid,"attemptId":c["attemptId"],"triggerId":tid,"waitId":c["waitId"]});
    let trace = ctx["traceId"]
        .as_str()
        .map(str::to_owned)
        .unwrap_or(hash(&json!(["mission", s["contract"]["missionId"]]))?[..32].to_owned());
    let id = format!(
        "event:{}",
        hash(&json!([s["contract"]["id"], s["revision"]]))?
    );
    let parent = a(&s["events"])
        .iter()
        .rev()
        .find(|e| {
            e["observation"]["traceId"] == trace
                && (rid.is_null() || e["observation"]["refs"]["runId"] == rid)
        })
        .map(|e| e["observation"].clone())
        .unwrap_or(Value::Null);
    Ok(
        json!({"id":id,"type":c["type"],"recordedAt":at,"actor":ctx["actor"],"attributed":c.get("context").is_some(),"decisionClass":ctx["decisionClass"],"definitionRevision":s["contract"]["id"],"policyRevision":ctx["policyRevision"],"correlationId":ctx.get("correlationId").unwrap_or(if rid.is_null(){&s["contract"]["missionId"]}else{&rid}),"causationId":ctx.get("causationId").unwrap_or(&parent["id"]),"traceId":trace,"spanId":&hash(&json!(["event",id]))?[..16],"parentSpanId":ctx.get("parentSpanId").unwrap_or(&parent["spanId"]),"refs":refs}),
    )
}
pub fn trace_payload(event: &Value) -> Result<Value> {
    let o = &event["observation"];
    check(o.is_object(), "OBSERVATION_REQUIRED")?;
    let nanos = quant(&event["at"])? * BigUint::from(1000000u32);
    check(nanos <= BigUint::from(u64::MAX), "TIMESTAMP_RANGE")?;
    let mut attrs = vec![];
    for (key, value) in [
        ("aiws.event.type", o["type"].clone()),
        ("aiws.event.id", o["id"].clone()),
        ("aiws.sequence", event["sequence"].clone()),
        ("aiws.decision.class", o["decisionClass"].clone()),
        ("aiws.policy.hash", json!(hash(&o["policyRevision"])?)),
    ] {
        attrs.push(json!({"key":key,"value":{"stringValue":value}}));
    }
    for key in [
        "missionId",
        "contractId",
        "runId",
        "nodeId",
        "operationId",
        "attemptId",
        "triggerId",
        "waitId",
    ] {
        let value = &o["refs"][key];
        if !value.is_null() {
            attrs.push(
                json!({"key":format!("aiws.{key}.hash"),"value":{"stringValue":hash(value)?}}),
            );
        }
    }
    let mut span = json!({"traceId":o["traceId"],"spanId":o["spanId"],"name":format!("aiws.{}",st(&o["type"])),"kind":1,"startTimeUnixNano":nanos.to_string(),"endTimeUnixNano":nanos.to_string(),"attributes":attrs,"status":{"code":0}});
    if !o["parentSpanId"].is_null() {
        span["parentSpanId"] = o["parentSpanId"].clone();
    }
    Ok(
        json!({"resourceSpans":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"aiws-sdk"}}]},"scopeSpans":[{"scope":{"name":"aiws.observability","version":"1"},"spans":[span]}]}]}),
    )
}
pub fn default_thresholds() -> Value {
    json!({"stalledAfterMs":"300000","unknownAfterMs":"60000","approvalAfterMs":"3600000","budgetPercent":"90","exportBacklog":"1000"})
}
fn difference(end: &Value, start: &Value) -> Result<BigUint> {
    let e = quant(end)?;
    let s = quant(start)?;
    check(e >= s, "CLOCK_REGRESSION")?;
    Ok(e - s)
}
pub fn operational_summary(
    s: &Snapshot,
    now_ms: &str,
    thresholds: Option<&Value>,
    export_state: Option<&Value>,
) -> Result<Value> {
    let s = &s.0;
    let defaults = default_thresholds();
    let t = thresholds.unwrap_or(&defaults);
    let export_default = json!({"pending":"0","failed":"0"});
    let export = export_state.unwrap_or(&export_default);
    let now = json!(now_ms);
    quant(&now)?;
    for key in [
        "stalledAfterMs",
        "unknownAfterMs",
        "approvalAfterMs",
        "budgetPercent",
        "exportBacklog",
    ] {
        quant(&t[key])?;
    }
    check(
        q(&t["budgetPercent"]) > BigUint::from(0u8)
            && q(&t["budgetPercent"]) <= BigUint::from(100u8),
        "OBSERVABILITY_CONFIG",
    )?;
    let mut previous = BigUint::from(0u8);
    for event in a(&s["events"]) {
        let at = quant(&event["at"])?;
        check(at >= previous && at <= quant(&now)?, "CLOCK_REGRESSION")?;
        previous = at;
    }
    let events = a(&s["events"]);
    let mut alerts = vec![];
    let (mut run_ms, mut attempt_ms, mut approval_ms) = (vec![], vec![], vec![]);
    for r in vs(&s["runs"]) {
        let related: Vec<_> = events
            .iter()
            .filter(|e| e["observation"]["refs"]["runId"] == r["id"])
            .collect();
        if related.is_empty() {
            continue;
        }
        if let Some(end) = related.iter().find(|e| {
            e["command"]["type"] == "transition" && crate::core::term(&e["command"]["to"])
        }) {
            run_ms.push(difference(&end["at"], &related[0]["at"])?.to_string());
        }
        if !crate::core::term(&r["state"])
            && difference(&now, &related.last().unwrap()["at"])? >= q(&t["stalledAfterMs"])
        {
            alerts.push(json!({"code":"WORKFLOW_STALLED","severity":"WARNING","objectId":r["id"]}));
        }
    }
    for at in vs(&s["attempts"]) {
        let start = events
            .iter()
            .find(|e| e["command"]["type"] == "dispatch" && e["command"]["attemptId"] == at["id"]);
        let end = events.iter().find(|e| {
            e["command"]["type"] == "settle"
                && e["command"]["attemptId"] == at["id"]
                && e["command"]["effect"] != "UNKNOWN"
        });
        if let (Some(start), Some(end)) = (start, end) {
            attempt_ms.push(difference(&end["at"], &start["at"])?.to_string());
        }
        if let Some(start) = start {
            if ["DISPATCHED", "UNKNOWN"].contains(&st(&at["status"]))
                && difference(&now, &start["at"])? >= q(&t["unknownAfterMs"])
            {
                alerts.push(
                    json!({"code":"EFFECT_UNRESOLVED","severity":"CRITICAL","objectId":at["id"]}),
                );
            }
        }
    }
    for w in vs(&s["waits"]) {
        if w["kind"] != "AUTHORIZATION" {
            continue;
        }
        let Some(start) = events
            .iter()
            .find(|e| e["command"]["type"] == "wait" && e["command"]["waitId"] == w["waitId"])
        else {
            continue;
        };
        let end = events.iter().find(|e| {
            let c = &e["command"];
            (c["type"] == "resume" && c["waitId"] == w["waitId"])
                || (c["type"] == "fireTrigger"
                    && s["triggers"][st(&c["triggerId"])]["definition"]["waitId"] == w["waitId"]
                    && c["event"]["correlation"] == w["correlation"])
        });
        if w["status"] == "SATISFIED" {
            if let Some(end) = end {
                approval_ms.push(difference(&end["at"], &start["at"])?.to_string());
            }
        }
        if w["status"] == "PENDING" && difference(&now, &start["at"])? >= q(&t["approvalAfterMs"]) {
            alerts.push(
                json!({"code":"APPROVAL_OVERDUE","severity":"WARNING","objectId":w["waitId"]}),
            );
        }
    }
    let exposure = q(&s["spent"]) + q(&s["reserved"]);
    let budget = q(&s["contract"]["budget"]);
    if exposure >= budget {
        alerts.push(json!({"code":"BUDGET_EXHAUSTED","severity":"CRITICAL","objectId":s["contract"]["missionId"]}));
    } else if exposure * BigUint::from(100u8) >= budget * q(&t["budgetPercent"]) {
        alerts.push(json!({"code":"BUDGET_NEAR_LIMIT","severity":"WARNING","objectId":s["contract"]["missionId"]}));
    }
    if quant(&export["pending"])? >= q(&t["exportBacklog"])
        || quant(&export["failed"])? > BigUint::from(0u8)
    {
        alerts.push(json!({"code":"EXPORT_UNHEALTHY","severity":"WARNING","objectId":s["contract"]["missionId"]}));
    }
    run_ms.sort();
    attempt_ms.sort();
    approval_ms.sort();
    alerts.sort_by_key(|a| canonical(a).unwrap());
    Ok(
        json!({"metrics":{"commands_total":events.len().to_string(),"attempts_total":vs(&s["attempts"]).count().to_string(),"retries_total":events.iter().filter(|e|e["command"]["type"]=="retry").count().to_string(),"failed_runs_total":vs(&s["runs"]).filter(|r|r["state"]=="FAILED").count().to_string(),"spent_units":s["spent"],"reserved_units":s["reserved"],"unknown_effects":vs(&s["operations"]).filter(|o|o["effect"]=="UNKNOWN").count().to_string(),"pending_waits":vs(&s["waits"]).filter(|w|w["status"]=="PENDING").count().to_string(),"export_pending":export["pending"],"export_failed":export["failed"]},"durations":{"run_ms":run_ms,"attempt_ms":attempt_ms,"approval_wait_ms":approval_ms},"alerts":alerts}),
    )
}
pub fn metric_payload(summary: &Value, now_ms: &str) -> Result<Value> {
    let nanos = quant(&json!(now_ms))? * BigUint::from(1000000u32);
    check(nanos <= BigUint::from(u64::MAX), "TIMESTAMP_RANGE")?;
    let mut metrics = vec![];
    for (name, value) in summary["metrics"]
        .as_object()
        .ok_or_else(|| error("INVALID_RECORD"))?
    {
        check(
            quant(value)? <= BigUint::from(i64::MAX as u64),
            "METRIC_RANGE",
        )?;
        metrics.push(json!({"name":format!("aiws.{name}"),"unit":"1","gauge":{"dataPoints":[{"timeUnixNano":nanos.to_string(),"asInt":value}]}}));
    }
    for (name, values) in summary["durations"]
        .as_object()
        .ok_or_else(|| error("INVALID_RECORD"))?
    {
        let xs = a(values);
        if !xs.is_empty() {
            let mut exact = BigUint::from(0u8);
            for value in xs {
                exact += quant(value)?;
            }
            check(exact <= BigUint::from(9007199254740991u64), "METRIC_RANGE")?;
            let sum: f64 = exact
                .to_string()
                .parse()
                .map_err(|_| error("METRIC_RANGE"))?;
            metrics.push(json!({"name":format!("aiws.{name}"),"unit":"ms","histogram":{"aggregationTemporality":2,"dataPoints":[{"timeUnixNano":nanos.to_string(),"count":xs.len().to_string(),"sum":sum,"explicitBounds":[],"bucketCounts":[xs.len().to_string()]}]}}));
        }
    }
    metrics.sort_by(|a, b| st(&a["name"]).cmp(st(&b["name"])));
    Ok(
        json!({"resourceMetrics":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"aiws-sdk"}}]},"scopeMetrics":[{"scope":{"name":"aiws.observability","version":"1"},"metrics":metrics}]}]}),
    )
}
pub fn classify_response(status: u16, body: &str, retry_after: Option<&str>) -> Value {
    if [0, 429, 502, 503, 504].contains(&status) {
        let retry = retry_after
            .filter(|x| !x.is_empty() && x.bytes().all(|b| b.is_ascii_digit()))
            .and_then(|x| x.parse::<BigUint>().ok())
            .map(|x| (x * BigUint::from(1000u32)).to_string())
            .unwrap_or("0".into());
        return json!({"status":"RETRY","code":"TRANSIENT_EXPORT","retryAfterMs":retry});
    }
    if status != 200 {
        return json!({"status":"FAILED","code":"EXPORT_REJECTED","retryAfterMs":"0"});
    }
    let parsed = serde_json::from_str::<Value>(if body.is_empty() { "{}" } else { body });
    match parsed {
        Ok(data) if data.is_object() => {
            let p = &data["partialSuccess"];
            if data.get("partialSuccess").is_some() && !p.is_object() {
                return json!({"status":"FAILED","code":"INVALID_EXPORT_RESPONSE","retryAfterMs":"0"});
            }
            let n = p.get("rejectedSpans").or(p.get("rejectedDataPoints"));
            let number = n
                .map(|x| {
                    if x.is_string() {
                        st(x).parse::<u64>().ok()
                    } else {
                        x.as_u64()
                    }
                })
                .unwrap_or(Some(0));
            match number {
                Some(n) if n > 0 => {
                    json!({"status":"FAILED","code":"PARTIAL_SUCCESS","retryAfterMs":"0"})
                }
                Some(_) => json!({"status":"SENT","code":"OK","retryAfterMs":"0"}),
                None => {
                    json!({"status":"FAILED","code":"INVALID_EXPORT_RESPONSE","retryAfterMs":"0"})
                }
            }
        }
        _ => json!({"status":"FAILED","code":"INVALID_EXPORT_RESPONSE","retryAfterMs":"0"}),
    }
}
pub trait TelemetryExporter {
    fn send(&mut self, signal: &str, payload: &Value) -> Value;
}
pub struct OtlpHttpExporter {
    endpoint: String,
    headers: std::collections::BTreeMap<String, String>,
    client: reqwest::blocking::Client,
}
impl OtlpHttpExporter {
    pub fn new(
        endpoint: &str,
        headers: std::collections::BTreeMap<String, String>,
        timeout_ms: u64,
    ) -> Result<Self> {
        let url = reqwest::Url::parse(endpoint).map_err(|_| error("EXPORT_CONFIG"))?;
        check(
            ["http", "https"].contains(&url.scheme())
                && url.username().is_empty()
                && url.password().is_none()
                && timeout_ms > 0,
            "EXPORT_CONFIG",
        )?;
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_millis(timeout_ms))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| error("EXPORT_CONFIG"))?;
        Ok(Self {
            endpoint: endpoint.trim_end_matches('/').into(),
            headers,
            client,
        })
    }
}
impl TelemetryExporter for OtlpHttpExporter {
    fn send(&mut self, signal: &str, payload: &Value) -> Value {
        if !["traces", "metrics"].contains(&signal) {
            return json!({"status":"FAILED","code":"EXPORT_CONFIG","retryAfterMs":"0"});
        }
        let mut req = self.client.post(format!("{}/v1/{signal}", self.endpoint));
        for (k, v) in &self.headers {
            req = req.header(k, v);
        }
        let response = req
            .header("content-type", "application/json")
            .body(payload.to_string())
            .send();
        match response {
            Ok(r) => {
                let status = r.status().as_u16();
                let retry = r
                    .headers()
                    .get("retry-after")
                    .and_then(|v| v.to_str().ok())
                    .map(str::to_owned);
                match r.text() {
                    Ok(body) => classify_response(status, &body, retry.as_deref()),
                    Err(_) => classify_response(0, "", None),
                }
            }
            Err(_) => classify_response(0, "", None),
        }
    }
}
