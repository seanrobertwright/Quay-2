use num_bigint::BigUint;
use serde::de::{self, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, fmt, sync::OnceLock};
#[derive(Debug, Clone, thiserror::Error)]
#[error("{code}")]
pub struct AiwsError {
    pub code: String,
}
pub type Result<T> = std::result::Result<T, AiwsError>;
pub fn error(code: &str) -> AiwsError {
    AiwsError { code: code.into() }
}
pub(crate) fn check(b: bool, c: &str) -> Result<()> {
    if b {
        Ok(())
    } else {
        Err(error(c))
    }
}
pub(crate) fn st(v: &Value) -> &str {
    v.as_str().unwrap_or("")
}
pub(crate) fn q(v: &Value) -> BigUint {
    st(v).parse().expect("validated decimal")
}
pub(crate) fn a(v: &Value) -> &Vec<Value> {
    v.as_array().expect("validated array")
}
pub(crate) fn vs(v: &Value) -> impl Iterator<Item = &Value> {
    v.as_object().expect("validated map").values()
}
pub(crate) fn has(v: &Value, k: &str) -> bool {
    v.as_object().is_some_and(|o| o.contains_key(k))
}
pub(crate) fn get<'a>(v: &'a Value, k: &str) -> Result<&'a Value> {
    v.get(k).ok_or_else(|| error("NOT_FOUND"))
}
pub(crate) fn unique(v: &Value, k: &str) -> Result<()> {
    check(!has(v, k), "DUPLICATE_ID")
}
pub(crate) fn contains(v: &Value, x: &Value) -> bool {
    a(v).contains(x)
}
fn subset(x: &Value, y: &Value) -> bool {
    a(x).iter().all(|v| contains(y, v))
}
pub(crate) fn term(v: &Value) -> bool {
    ["COMPLETED", "FAILED", "CANCELED", "REJECTED"].contains(&st(v))
}
fn valid_decimal(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 100
        && s.bytes().all(|b| b.is_ascii_digit())
        && (s == "0" || !s.starts_with('0'))
}
macro_rules! record {
    ($t:ident,$name:literal) => {
        #[derive(Debug, Clone, PartialEq)]
        pub struct $t(pub(crate) Value);
        impl $t {
            pub fn from_value(v: Value) -> Result<Self> {
                validate($name, &v)?;
                Ok(Self(v))
            }
            pub fn parse(text: &str) -> Result<Self> {
                Self::from_value(parse_strict(text)?)
            }
            pub fn as_value(&self) -> &Value {
                &self.0
            }
        }
    };
}
record!(Contract, "Contract");
record!(Command, "Command");
record!(Grant, "Grant");
record!(Action, "Action");
record!(Approval, "Approval");
record!(TriggerDefinition, "Trigger");
record!(TriggerEvent, "TriggerEvent");
record!(WorkflowGraph, "Graph");
#[derive(Debug, Clone, PartialEq)]
pub struct Snapshot(pub(crate) Value);
impl Snapshot {
    pub fn as_value(&self) -> &Value {
        &self.0
    }
}
static VALIDATORS: OnceLock<HashMap<&'static str, jsonschema::Validator>> = OnceLock::new();
pub fn validate(name: &str, v: &Value) -> Result<()> {
    let validators = VALIDATORS.get_or_init(|| {
        let base: Value = serde_json::from_str(include_str!("schema.json")).unwrap();
        [
            "Contract",
            "Command",
            "Grant",
            "Action",
            "Approval",
            "Trigger",
            "TriggerEvent",
            "Node",
            "Graph",
        ]
        .into_iter()
        .map(|n| {
            let mut s = base.clone();
            s["$ref"] = json!(format!("#/$defs/{n}"));
            (n, jsonschema::validator_for(&s).expect("bundled schema"))
        })
        .collect()
    });
    check(
        validators
            .get(name)
            .ok_or_else(|| error("INVALID_RECORD"))?
            .is_valid(v),
        "INVALID_RECORD",
    )?;
    canonical(v)?;
    Ok(())
}
struct Strict(Value);
impl<'de> Deserialize<'de> for Strict {
    fn deserialize<D: Deserializer<'de>>(d: D) -> std::result::Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = Strict;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                write!(f, "JSON")
            }
            fn visit_bool<E: de::Error>(self, v: bool) -> std::result::Result<Strict, E> {
                Ok(Strict(json!(v)))
            }
            fn visit_unit<E: de::Error>(self) -> std::result::Result<Strict, E> {
                Ok(Strict(Value::Null))
            }
            fn visit_i64<E: de::Error>(self, v: i64) -> std::result::Result<Strict, E> {
                Ok(Strict(json!(v)))
            }
            fn visit_u64<E: de::Error>(self, v: u64) -> std::result::Result<Strict, E> {
                Ok(Strict(json!(v)))
            }
            fn visit_f64<E: de::Error>(self, v: f64) -> std::result::Result<Strict, E> {
                Ok(Strict(json!(v)))
            }
            fn visit_str<E: de::Error>(self, v: &str) -> std::result::Result<Strict, E> {
                Ok(Strict(json!(v)))
            }
            fn visit_string<E: de::Error>(self, v: String) -> std::result::Result<Strict, E> {
                Ok(Strict(json!(v)))
            }
            fn visit_seq<A: SeqAccess<'de>>(
                self,
                mut a: A,
            ) -> std::result::Result<Strict, A::Error> {
                let mut out = vec![];
                while let Some(Strict(x)) = a.next_element()? {
                    out.push(x)
                }
                Ok(Strict(json!(out)))
            }
            fn visit_map<A: MapAccess<'de>>(
                self,
                mut a: A,
            ) -> std::result::Result<Strict, A::Error> {
                let mut out = serde_json::Map::new();
                while let Some(k) = a.next_key::<String>()? {
                    if out.contains_key(&k) {
                        return Err(de::Error::custom("DUPLICATE_KEY"));
                    }
                    let Strict(v) = a.next_value()?;
                    out.insert(k, v);
                }
                Ok(Strict(Value::Object(out)))
            }
        }
        d.deserialize_any(V)
    }
}
pub fn parse_strict(text: &str) -> Result<Value> {
    check(text.len() <= 1_048_576, "INPUT_LIMIT")?;
    let mut d = serde_json::Deserializer::from_str(text);
    let Strict(v) = Strict::deserialize(&mut d).map_err(|e| {
        let message = e.to_string();
        // serde_json refuses a lone surrogate escape while parsing; the TypeScript and Python SDKs
        // parse it and then refuse it as INVALID_UNICODE, so Rust reports the same code.
        error(if message.contains("DUPLICATE_KEY") {
            "DUPLICATE_KEY"
        } else if message.contains("surrogate")
            || message.contains("unexpected end of hex escape")
            || message.contains("invalid unicode code point")
        {
            "INVALID_UNICODE"
        } else {
            "INVALID_JSON"
        })
    })?;
    d.end().map_err(|_| error("INVALID_JSON"))?;
    canonical(&v)?;
    Ok(v)
}
pub fn canonical(v: &Value) -> Result<String> {
    fn enc(v: &Value, depth: usize) -> Result<String> {
        check(depth <= 64, "INPUT_LIMIT")?;
        match v {
            Value::Null | Value::Bool(_) | Value::String(_) => Ok(v.to_string()),
            Value::Number(n) => {
                let x = n.as_f64().ok_or_else(|| error("UNSAFE_NUMBER"))?;
                check(
                    x.is_finite() && x.fract() == 0.0 && x.abs() <= 9_007_199_254_740_991.0,
                    "UNSAFE_NUMBER",
                )?;
                Ok(format!("{}", x as i64))
            }
            Value::Array(v) => Ok(format!(
                "[{}]",
                v.iter()
                    .map(|v| enc(v, depth + 1))
                    .collect::<Result<Vec<_>>>()?
                    .join(",")
            )),
            Value::Object(v) => {
                let mut keys: Vec<_> = v.keys().collect();
                keys.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
                Ok(format!(
                    "{{{}}}",
                    keys.into_iter()
                        .map(|k| Ok(format!("{}:{}", json!(k), enc(&v[k], depth + 1)?)))
                        .collect::<Result<Vec<_>>>()?
                        .join(",")
                ))
            }
        }
    }
    enc(v, 0)
}
pub fn digest(v: &Value) -> Result<String> {
    Ok(format!(
        "sha256:{:x}",
        Sha256::digest(canonical(v)?.as_bytes())
    ))
}
pub fn data_validator(schema: &Value) -> Result<jsonschema::Validator> {
    canonical(schema)?;
    fn inspect(v: &Value) -> Result<()> {
        match v {
            Value::Object(o) => {
                for (k, x) in o {
                    if k == "$ref" {
                        check(
                            x.as_str().is_some_and(|r| r.starts_with("#/")),
                            "SCHEMA_UNSUPPORTED",
                        )?;
                    }
                    check(
                        !["$async", "format", "$dynamicRef"].contains(&k.as_str()),
                        "SCHEMA_UNSUPPORTED",
                    )?;
                    inspect(x)?;
                }
            }
            Value::Array(a) => {
                for x in a {
                    inspect(x)?;
                }
            }
            _ => {}
        }
        Ok(())
    }
    inspect(schema)?;
    jsonschema::validator_for(schema).map_err(|_| error("SCHEMA_INVALID"))
}
pub fn validate_data(schema: &Value, data: &Value) -> Result<()> {
    canonical(data)?;
    check(data_validator(schema)?.is_valid(data), "DATA_SCHEMA")
}
pub fn fingerprint(action: &Action) -> Result<String> {
    digest(&json!({"profile":"finite-v1","action":action.0}))
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Containment {
    Contained,
    NotContained,
    Indeterminate,
}
impl Containment {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Contained => "CONTAINED",
            Self::NotContained => "NOT_CONTAINED",
            Self::Indeterminate => "INDETERMINATE",
        }
    }
}
pub fn compare_grants(parent: &Grant, child: &Grant) -> Containment {
    let (p, c) = (&parent.0, &child.0);
    if p["profile"] != "finite-v1" || c["profile"] != "finite-v1" {
        return Containment::Indeterminate;
    }
    if p["canDelegate"] == true
        && c["parentId"] == p["id"]
        && q(&c["depth"]) < q(&p["depth"])
        && subset(&c["actions"], &p["actions"])
        && subset(&c["resources"], &p["resources"])
        && q(&c["notBefore"]) >= q(&p["notBefore"])
        && q(&c["expiresAt"]) <= q(&p["expiresAt"])
        && q(&c["notBefore"]) < q(&c["expiresAt"])
        && q(&c["limit"]) <= q(&p["limit"])
    {
        Containment::Contained
    } else {
        Containment::NotContained
    }
}
pub fn create_mission(contract: &Contract) -> Result<Snapshot> {
    check(
        !a(&contract.0["criteria"]).is_empty()
            && q(&contract.0["maxAttempts"]) > BigUint::from(0u8),
        "INVALID_CONTRACT",
    )?;
    Ok(Snapshot(
        json!({"contract":contract.0,"revision":"0","missionState":"OPEN","spent":"0","reserved":"0","runs":{},"grants":{},"approvals":{},"operations":{},"attempts":{},"waits":{},"assessments":{},"triggers":{},"receipts":{},"graphs":{},"events":[]}),
    ))
}
pub(crate) fn new_run(id: &str) -> Value {
    let seg = format!("{id}:segment:0");
    json!({"id":id,"state":"READY","segmentId":seg,"segments":[seg],"epoch":"0","planId":"initial","planIds":["initial"]})
}
fn allowed(f: &Value, t: &Value) -> bool {
    let next: &[&str] = match st(f) {
        "READY" => &[
            "RUNNING",
            "WAITING",
            "COMPLETED",
            "PAUSED",
            "CANCELED",
            "FAILED",
        ],
        "RUNNING" => &[
            "READY",
            "WAITING",
            "PAUSED",
            "CANCELING",
            "COMPLETED",
            "FAILED",
        ],
        "WAITING" => &["READY", "PAUSED", "CANCELING", "FAILED"],
        "PAUSED" => &["READY", "CANCELING", "FAILED"],
        "CANCELING" => &["CANCELED", "FAILED"],
        _ => &[],
    };
    next.contains(&st(t))
}
fn chain(s: &Value, id: &str) -> Result<Vec<String>> {
    let mut ids = vec![];
    let mut current = Some(id.to_owned());
    while let Some(id) = current {
        check(!ids.contains(&id), "GRANT_CYCLE")?;
        let g = get(&s["grants"], &id)?;
        current = g["parentId"].as_str().map(str::to_owned);
        ids.push(id)
    }
    Ok(ids)
}
fn gate(s: &Value, op: &Value, p: &Value, now: &BigUint) -> Result<()> {
    let r = get(&s["runs"], st(&op["runId"]))?;
    check(
        s["missionState"] == "OPEN" && ["READY", "RUNNING"].contains(&st(&r["state"])),
        "EXECUTION_BLOCKED",
    )?;
    check(now < &q(&s["contract"]["deadline"]), "DEADLINE")?;
    check(
        p["mandatoryChecksOk"] == true && p["policy"] == "ALLOW",
        if p["mandatoryChecksOk"] == true {
            "POLICY_DENIED"
        } else {
            "POLICY_CHECK_ERROR"
        },
    )?;
    let checked = q(&p["authorizationCheckedAt"]);
    check(
        checked <= *now && now - &checked <= q(&s["contract"]["maxAuthorizationAgeMs"]),
        "AUTHORITY_STALE",
    )?;
    let ids = chain(s, st(&op["grantId"]))?;
    check(
        s["grants"][&ids[0]]["subject"] == op["subject"],
        "SUBJECT_MISMATCH",
    )?;
    for id in ids {
        let g = &s["grants"][&id];
        check(
            g["revoked"] == false
                && *now >= q(&g["notBefore"])
                && *now < q(&g["expiresAt"])
                && contains(&g["actions"], &op["action"]["capability"])
                && contains(&g["resources"], &op["action"]["resource"]),
            "AUTHORITY_DENIED",
        )?;
    }
    if s["contract"]["requiresApproval"] == true || op["approvalId"].is_string() {
        let a = get(&s["approvals"], st(&op["approvalId"]))?;
        check(
            a["withdrawn"] == false
                && a["runId"] == op["runId"]
                && a["fingerprint"] == op["fingerprint"]
                && *now < q(&a["expiresAt"]),
            "APPROVAL_INVALID",
        )?;
    }
    Ok(())
}
fn attempt(s: &mut Value, op_id: &str, c: &Value) -> Result<()> {
    let id = st(&c["attemptId"]);
    unique(&s["attempts"], id)?;
    let amount = q(&c["amount"]);
    let op = s["operations"][op_id].clone();
    check(
        q(&s["spent"]) + q(&s["reserved"]) + &amount <= q(&s["contract"]["budget"]),
        "BUDGET_EXHAUSTED",
    )?;
    let ids = chain(s, st(&op["grantId"]))?;
    for id in &ids {
        let g = &s["grants"][id];
        check(
            q(&g["spent"]) + q(&g["reserved"]) + &amount <= q(&g["limit"]),
            "GRANT_BUDGET_EXHAUSTED",
        )?;
    }
    s["reserved"] = json!((q(&s["reserved"]) + &amount).to_string());
    for id in ids {
        s["grants"][&id]["reserved"] =
            json!((q(&s["grants"][&id]["reserved"]) + &amount).to_string());
    }
    s["attempts"][id] = json!({"id":id,"operationId":op_id,"status":"PREPARED","effect":"NOT_DISPATCHED","amount":c["amount"],"actualCost":null,"epoch":s["runs"][st(&op["runId"])]["epoch"]});
    s["operations"][op_id]["attemptIds"]
        .as_array_mut()
        .unwrap()
        .push(json!(id));
    Ok(())
}
pub fn reduce(input: &Snapshot, command: &Command, now_ms: &str) -> Result<Snapshot> {
    check(valid_decimal(now_ms), "INVALID_TIME")?;
    let now: BigUint = now_ms.parse().unwrap();
    let c = &command.0;
    let mut s = input.0.clone();
    let rid = st(&c["runId"]);
    let aid = st(&c["attemptId"]);
    let oid = st(&c["operationId"]);
    if c["type"] == "transition" && c["to"] == "COMPLETED" && s["runs"][rid]["nodes"].is_object() {
        check(
            vs(&s["runs"][rid]["nodes"])
                .all(|n| ["COMPLETED", "SKIPPED"].contains(&st(&n["status"]))),
            "UNSETTLED_NODES",
        )?;
    }
    if c["type"] == "dispatch" {
        crate::workflow::bind_dispatch(&mut s, c)?;
    }
    match st(&c["type"]) {
        "startRun" => {
            unique(&s["runs"], rid)?;
            check(
                s["missionState"] == "OPEN" && now < q(&s["contract"]["deadline"]),
                "EXECUTION_BLOCKED",
            )?;
            s["runs"][rid] = new_run(rid);
        }
        "continueRun" => {
            let r = get(&s["runs"], rid)?;
            check(
                !term(&r["state"]) && s["missionState"] != "CLOSED",
                "EXECUTION_BLOCKED",
            )?;
            check(!contains(&r["segments"], &c["segmentId"]), "DUPLICATE_ID")?;
            s["runs"][rid]["segments"]
                .as_array_mut()
                .unwrap()
                .push(c["segmentId"].clone());
            s["runs"][rid]["segmentId"] = c["segmentId"].clone();
            s["runs"][rid]["epoch"] =
                json!((q(&s["runs"][rid]["epoch"]) + BigUint::from(1u8)).to_string());
        }
        "activatePlan" => {
            let r = get(&s["runs"], rid)?;
            check(
                !term(&r["state"]) && s["missionState"] == "OPEN",
                "EXECUTION_BLOCKED",
            )?;
            check(r["planId"] == c["expectedPlan"], "REVISION_CONFLICT")?;
            check(!contains(&r["planIds"], &c["planId"]), "DUPLICATE_ID")?;
            s["runs"][rid]["planId"] = c["planId"].clone();
            s["runs"][rid]["planIds"]
                .as_array_mut()
                .unwrap()
                .push(c["planId"].clone());
        }
        "missionState" => {
            check(s["missionState"] != "CLOSED", "EXECUTION_BLOCKED")?;
            if c["state"] == "CLOSED" {
                check(
                    vs(&s["runs"]).all(|r| term(&r["state"]))
                        && s["reserved"] == "0"
                        && !vs(&s["operations"]).any(|o| o["effect"] == "UNKNOWN"),
                    "UNSETTLED_WORK",
                )?;
            }
            s["missionState"] = c["state"].clone();
        }
        "grant" => {
            let mut g = c["grant"].clone();
            let id = st(&g["id"]).to_owned();
            unique(&s["grants"], &id)?;
            check(
                g["profile"] == "finite-v1" && q(&g["notBefore"]) < q(&g["expiresAt"]),
                "AUTHORITY_INDETERMINATE",
            )?;
            check(
                subset(&g["actions"], &s["contract"]["actions"])
                    && subset(&g["resources"], &s["contract"]["resources"])
                    && q(&g["limit"]) <= q(&s["contract"]["budget"])
                    && q(&g["expiresAt"]) <= q(&s["contract"]["deadline"]),
                "AUTHORITY_DENIED",
            )?;
            if let Some(pid) = g["parentId"].as_str() {
                let mut p = get(&s["grants"], pid)?.clone();
                for k in ["revoked", "spent", "reserved"] {
                    p.as_object_mut().unwrap().remove(k);
                }
                check(
                    compare_grants(&Grant::from_value(p)?, &Grant::from_value(g.clone())?)
                        == Containment::Contained,
                    "AUTHORITY_DENIED",
                )?;
                check(
                    chain(&s, pid)?
                        .iter()
                        .all(|id| s["grants"][id]["revoked"] == false),
                    "AUTHORITY_DENIED",
                )?;
            }
            g["revoked"] = json!(false);
            g["spent"] = json!("0");
            g["reserved"] = json!("0");
            s["grants"][id] = g;
        }
        "revokeGrant" => {
            let id = st(&c["grantId"]);
            get(&s["grants"], id)?;
            s["grants"][id]["revoked"] = json!(true);
        }
        "approve" => {
            let mut ap = c["approval"].clone();
            let id = st(&ap["id"]).to_owned();
            unique(&s["approvals"], &id)?;
            get(&s["runs"], st(&ap["runId"]))?;
            ap["withdrawn"] = json!(false);
            ap["operations"] = json!([]);
            s["approvals"][id] = ap;
        }
        "withdrawApproval" => {
            let id = st(&c["approvalId"]);
            get(&s["approvals"], id)?;
            s["approvals"][id]["withdrawn"] = json!(true);
        }
        "admit" => {
            unique(&s["operations"], oid)?;
            let op = json!({"id":oid,"runId":rid,"grantId":c["grantId"],"subject":c["subject"],"approvalId":c["approvalId"],"action":c["action"],"fingerprint":fingerprint(&Action::from_value(c["action"].clone())?)?,"effect":"NOT_DISPATCHED","attemptIds":[]});
            gate(&s, &op, c, &now)?;
            if let Some(apid) = op["approvalId"].as_str() {
                let ap = get(&s["approvals"], apid)?;
                check(
                    BigUint::from(a(&ap["operations"]).len()) < q(&ap["uses"]),
                    "APPROVAL_CONSUMED",
                )?;
                s["approvals"][apid]["operations"]
                    .as_array_mut()
                    .unwrap()
                    .push(json!(oid));
            }
            s["operations"][oid] = op;
            attempt(&mut s, oid, c)?;
        }
        "retry" => {
            let op = get(&s["operations"], oid)?;
            check(op["effect"] == "CONFIRMED_NOT_APPLIED", "UNSAFE_RETRY")?;
            check(
                BigUint::from(a(&op["attemptIds"]).len()) < q(&s["contract"]["maxAttempts"]),
                "RETRY_LIMIT",
            )?;
            check(
                a(&op["attemptIds"]).iter().all(|id| {
                    ["SUCCEEDED", "FAILED"].contains(&st(&s["attempts"][st(id)]["status"]))
                }),
                "UNSETTLED_WORK",
            )?;
            gate(&s, op, c, &now)?;
            attempt(&mut s, oid, c)?;
            s["operations"][oid]["effect"] = json!("NOT_DISPATCHED");
        }
        "dispatch" => {
            let at = get(&s["attempts"], aid)?;
            let oid = st(&at["operationId"]).to_owned();
            let op = &s["operations"][&oid];
            let rid = st(&op["runId"]).to_owned();
            check(at["status"] == "PREPARED", "ATTEMPT_STATE")?;
            check(at["epoch"] == s["runs"][&rid]["epoch"], "STALE_OWNER")?;
            gate(&s, op, c, &now)?;
            s["attempts"][aid]["status"] = json!("DISPATCHED");
            s["attempts"][aid]["effect"] = json!("UNKNOWN");
            s["operations"][oid]["effect"] = json!("UNKNOWN");
            s["runs"][rid]["state"] = json!("RUNNING");
        }
        "settle" => {
            let at = get(&s["attempts"], aid)?.clone();
            let oid = st(&at["operationId"]).to_owned();
            if ["SUCCEEDED", "FAILED"].contains(&st(&at["status"])) {
                check(
                    at["effect"] == c["effect"] && at["actualCost"] == c["actualCost"],
                    "RESULT_CONFLICT",
                )?;
            } else {
                check(
                    ["DISPATCHED", "UNKNOWN"].contains(&st(&at["status"]))
                        || (at["status"] == "PREPARED" && c["effect"] == "CONFIRMED_NOT_APPLIED"),
                    "ATTEMPT_STATE",
                )?;
                if c["effect"] == "UNKNOWN" {
                    s["attempts"][aid]["status"] = json!("UNKNOWN");
                    s["attempts"][aid]["effect"] = json!("UNKNOWN");
                    s["operations"][&oid]["effect"] = json!("UNKNOWN");
                } else {
                    let (amount, cost) = (q(&at["amount"]), q(&c["actualCost"]));
                    check(cost <= amount, "EXPOSURE_EXCEEDED")?;
                    let ids = chain(&s, st(&s["operations"][&oid]["grantId"]))?;
                    s["reserved"] = json!((q(&s["reserved"]) - &amount).to_string());
                    s["spent"] = json!((q(&s["spent"]) + &cost).to_string());
                    for id in ids {
                        s["grants"][&id]["reserved"] =
                            json!((q(&s["grants"][&id]["reserved"]) - &amount).to_string());
                        s["grants"][&id]["spent"] =
                            json!((q(&s["grants"][&id]["spent"]) + &cost).to_string());
                    }
                    s["attempts"][aid]["actualCost"] = c["actualCost"].clone();
                    s["attempts"][aid]["effect"] = c["effect"].clone();
                    s["attempts"][aid]["status"] = json!(if c["effect"] == "CONFIRMED_APPLIED" {
                        "SUCCEEDED"
                    } else {
                        "FAILED"
                    });
                    s["operations"][&oid]["effect"] = c["effect"].clone();
                }
            }
        }
        "wait" => {
            let r = get(&s["runs"], rid)?;
            check(!term(&r["state"]), "EXECUTION_BLOCKED")?;
            let id = st(&c["waitId"]);
            unique(&s["waits"], id)?;
            check(
                now < q(&c["deadline"]) && q(&c["deadline"]) <= q(&s["contract"]["deadline"]),
                "DEADLINE",
            )?;
            s["waits"][id] = c.clone();
            s["waits"][id]["status"] = json!("PENDING");
        }
        "resume" => {
            let id = st(&c["waitId"]);
            let w = get(&s["waits"], id)?;
            check(
                w["status"] == "SATISFIED" || !term(&get(&s["runs"], st(&w["runId"]))?["state"]),
                "EXECUTION_BLOCKED",
            )?;
            check(w["correlation"] == c["correlation"], "CORRELATION_MISMATCH")?;
            check(
                w["status"] == "SATISFIED" || (w["status"] == "PENDING" && now < q(&w["deadline"])),
                "WAIT_EXPIRED",
            )?;
            s["waits"][id]["status"] = json!("SATISFIED");
        }
        "join" => {
            let r = get(&s["runs"], rid)?;
            check(r["state"] == "WAITING", "EXECUTION_BLOCKED")?;
            let ids = a(&c["waitIds"]);
            check(!ids.is_empty(), "INVALID_JOIN")?;
            let waits = ids
                .iter()
                .map(|id| get(&s["waits"], st(id)))
                .collect::<Result<Vec<_>>>()?;
            check(waits.iter().all(|w| w["runId"] == rid), "INVALID_JOIN")?;
            check(
                if c["mode"] == "ALL" {
                    waits.iter().all(|w| w["status"] == "SATISFIED")
                } else {
                    waits.iter().any(|w| w["status"] == "SATISFIED")
                },
                "JOIN_PENDING",
            )?;
            if c["mode"] == "ANY" {
                for id in ids {
                    if s["waits"][st(id)]["status"] == "PENDING" {
                        s["waits"][st(id)]["status"] = json!("CANCELED");
                    }
                }
            }
            s["runs"][rid]["state"] = json!("READY");
        }
        "transition" => {
            let r = get(&s["runs"], rid)?;
            check(allowed(&r["state"], &c["to"]), "INVALID_TRANSITION")?;
            let pending = vs(&s["attempts"]).any(|at| {
                s["operations"][st(&at["operationId"])]["runId"] == rid
                    && ["PREPARED", "DISPATCHED", "UNKNOWN"].contains(&st(&at["status"]))
            });
            let waits = vs(&s["waits"]).any(|w| w["runId"] == rid && w["status"] == "PENDING");
            if c["to"] == "COMPLETED" {
                check(!pending && !waits, "UNSETTLED_WORK")?;
            }
            if c["to"] == "WAITING" {
                check(!pending && waits, "INVALID_WAIT")?;
            }
            s["runs"][rid]["state"] = c["to"].clone();
        }
        "verify" => {
            get(&s["runs"], rid)?;
            let criteria = a(&s["contract"]["criteria"]);
            check(
                c["results"].as_object().unwrap().len() == criteria.len()
                    && criteria.iter().all(|k| has(&c["results"], st(k))),
                "CRITERIA_MISMATCH",
            )?;
            check(
                !a(&s["events"]).iter().any(|e| {
                    e["command"]["type"] == "verify"
                        && e["command"]["runId"] == rid
                        && e["command"]["revision"] == c["revision"]
                }),
                "DUPLICATE_ID",
            )?;
            let verdict = if vs(&c["results"]).any(|v| v == "FAIL") {
                "FAILED"
            } else if vs(&c["results"]).any(|v| v == "INCONCLUSIVE") || a(&c["evidence"]).is_empty()
            {
                "INCONCLUSIVE"
            } else {
                "PASSED"
            };
            s["assessments"][rid] = c.clone();
            s["assessments"][rid]["verification"] = json!(verdict);
            s["assessments"][rid]["acceptance"] = json!("NOT_REQUESTED");
        }
        "accept" => {
            let ap = get(&s["assessments"], rid)?;
            check(
                ap["revision"] == c["verificationRevision"],
                "REVISION_CONFLICT",
            )?;
            check(
                c["decision"] != "ACCEPTED" || ap["verification"] == "PASSED",
                "VERIFICATION_NOT_PASSED",
            )?;
            s["assessments"][rid]["acceptance"] = c["decision"].clone();
            s["assessments"][rid]["acceptanceRecord"] = c.clone();
        }
        "invalidate" => {
            get(&s["assessments"], rid)?;
            s["assessments"][rid]["verification"] = json!("INVALIDATED");
            if s["assessments"][rid]["acceptance"] == "ACCEPTED" {
                s["assessments"][rid]["acceptance"] = json!("INVALIDATED");
            }
            s["assessments"][rid]["invalidationReason"] = c["reason"].clone();
        }
        _ => check(
            crate::workflow::apply_extension(&mut s, c, now_ms)?,
            "UNSUPPORTED_COMMAND",
        )?,
    }
    s["revision"] = json!((q(&s["revision"]) + BigUint::from(1u8)).to_string());
    let observation = crate::observability::event_envelope(&s, c, now_ms)?;
    let ev = json!({"sequence":s["revision"],"at":now_ms,"command":c,"observation":observation});
    s["events"].as_array_mut().unwrap().push(ev);
    Ok(Snapshot(s))
}
pub fn assess_success(s: &Snapshot, run_id: &str) -> Result<Value> {
    let s = &s.0;
    let r = get(&s["runs"], run_id)?;
    let ap = &s["assessments"][run_id];
    let mut reasons = vec![];
    if r["state"] != "COMPLETED" {
        reasons.push("EXECUTION_NOT_COMPLETED")
    }
    if ap["verification"] != "PASSED" {
        reasons.push("VERIFICATION_NOT_PASSED")
    }
    if ap["acceptance"] != "ACCEPTED" {
        reasons.push("ACCEPTANCE_REQUIRED")
    }
    if vs(&s["operations"]).any(|o| o["runId"] == run_id && o["effect"] == "UNKNOWN") {
        reasons.push("EFFECT_UNKNOWN")
    }
    Ok(json!({"verifiedSuccessful":reasons.is_empty(),"reasons":reasons}))
}
pub fn audit_playback(c: &Contract, events: &Value) -> Result<Snapshot> {
    let mut s = create_mission(c)?;
    for e in events.as_array().ok_or_else(|| error("INVALID_RECORD"))? {
        check(
            e["sequence"].as_str().is_some_and(valid_decimal),
            "EVENT_SEQUENCE",
        )?;
        check(
            q(&e["sequence"]) == q(&s.0["revision"]) + BigUint::from(1u8),
            "EVENT_SEQUENCE",
        )?;
        s = reduce(
            &s,
            &Command::from_value(e["command"].clone())?,
            st(&e["at"]),
        )?;
        check(
            s.0["events"].as_array().unwrap().last() == Some(e),
            "EVENT_MISMATCH",
        )?;
    }
    Ok(s)
}
