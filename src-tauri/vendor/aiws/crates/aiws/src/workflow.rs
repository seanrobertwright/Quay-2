use crate::core::*;
use num_bigint::BigUint;
use serde_json::{json, Value};
use std::collections::HashSet;
fn positive(v: &Value) -> bool {
    v.as_str().is_some_and(|s| {
        !s.is_empty() && !s.starts_with('0') && s.bytes().all(|b| b.is_ascii_digit())
    })
}
pub fn validate_graph(input: &Value) -> Result<WorkflowGraph> {
    let g = WorkflowGraph::from_value(input.clone())?;
    let nodes = a(&g.0["nodes"]);
    let ids: HashSet<_> = nodes.iter().map(|n| st(&n["id"])).collect();
    check(ids.len() == nodes.len(), "DUPLICATE_NODE")?;
    check(nodes.iter().any(|n| n["kind"] == "END"), "MISSING_END")?;
    for n in nodes {
        check(
            a(&n["dependsOn"])
                .iter()
                .all(|id| ids.contains(st(id)) && id != &n["id"]),
            "INVALID_DEPENDENCY",
        )?;
        for key in ["inputSchema", "outputSchema"] {
            if n[key].is_object() {
                data_validator(&n[key])?;
            }
        }
        let c = &n["config"];
        let keys: &[&str] = match st(&n["kind"]) {
            "TASK" => &["executionKind"],
            "DECISION" => &["field", "equals", "then", "else"],
            "JOIN" => &["mode"],
            "LOOP" => &["maxIterations"],
            _ => &[],
        };
        check(
            c.as_object()
                .unwrap()
                .keys()
                .all(|k| keys.contains(&k.as_str()))
                && keys.iter().all(|k| has(c, k)),
            "NODE_CONFIG",
        )?;
        match st(&n["kind"]) {
            "TASK" => check(
                ["AGENT", "FUNCTION", "TOOL", "HUMAN"].contains(&st(&c["executionKind"])),
                "NODE_CONFIG",
            )?,
            "JOIN" => check(
                ["ALL", "ANY"].contains(&st(&c["mode"])) && !a(&n["dependsOn"]).is_empty(),
                "NODE_CONFIG",
            )?,
            "LOOP" => check(positive(&c["maxIterations"]), "NODE_CONFIG")?,
            "DECISION" => check(
                c["field"].is_string()
                    && ids.contains(st(&c["then"]))
                    && ids.contains(st(&c["else"]))
                    && c["then"] != c["else"]
                    && nodes
                        .iter()
                        .filter(|x| x["id"] == c["then"] || x["id"] == c["else"])
                        .all(|x| contains(&x["dependsOn"], &n["id"])),
                "NODE_CONFIG",
            )?,
            _ => {}
        }
    }
    fn visit(
        id: &str,
        nodes: &Vec<Value>,
        active: &mut HashSet<String>,
        done: &mut HashSet<String>,
    ) -> Result<()> {
        check(!active.contains(id), "GRAPH_CYCLE")?;
        if done.contains(id) {
            return Ok(());
        }
        active.insert(id.into());
        for dep in a(&nodes.iter().find(|n| n["id"] == id).unwrap()["dependsOn"]) {
            visit(st(dep), nodes, active, done)?;
        }
        active.remove(id);
        done.insert(id.into());
        Ok(())
    }
    let (mut active, mut done) = (HashSet::new(), HashSet::new());
    for id in &ids {
        visit(id, nodes, &mut active, &mut done)?;
    }
    let mut reachable = HashSet::new();
    let mut queue: Vec<String> = nodes
        .iter()
        .filter(|n| n["kind"] == "END")
        .map(|n| st(&n["id"]).to_owned())
        .collect();
    while let Some(id) = queue.pop() {
        if !reachable.insert(id.clone()) {
            continue;
        }
        queue.extend(
            a(&nodes.iter().find(|n| n["id"] == id).unwrap()["dependsOn"])
                .iter()
                .map(|v| st(v).to_owned()),
        );
    }
    check(reachable.len() == ids.len(), "NO_END_PATH")?;
    Ok(g)
}
pub fn ready_nodes(s: &Snapshot, run_id: &str) -> Result<Vec<String>> {
    let s = &s.0;
    let r = get(&s["runs"], run_id)?;
    if s["missionState"] != "OPEN"
        || !["READY", "RUNNING"].contains(&st(&r["state"]))
        || !r["graphId"].is_string()
    {
        return Ok(vec![]);
    }
    let g = get(&s["graphs"], st(&r["graphId"]))?;
    Ok(a(&g["nodes"])
        .iter()
        .filter(|n| {
            if r["nodes"][st(&n["id"])]["status"] != "PENDING" {
                return false;
            }
            let deps = a(&n["dependsOn"]);
            if n["kind"] == "JOIN" && n["config"]["mode"] == "ANY" {
                deps.iter()
                    .any(|id| r["nodes"][st(id)]["status"] == "COMPLETED")
            } else {
                deps.iter()
                    .all(|id| r["nodes"][st(id)]["status"] == "COMPLETED")
            }
        })
        .map(|n| st(&n["id"]).to_owned())
        .collect())
}
fn skip(s: &mut Value, rid: &str) {
    let nodes = s["graphs"][st(&s["runs"][rid]["graphId"])]["nodes"].clone();
    let mut change = true;
    while change {
        change = false;
        for n in a(&nodes) {
            let id = st(&n["id"]);
            if s["runs"][rid]["nodes"][id]["status"] != "PENDING" {
                continue;
            }
            let deps = a(&n["dependsOn"]);
            let unreachable = if n["kind"] == "JOIN" && n["config"]["mode"] == "ANY" {
                deps.iter()
                    .all(|d| s["runs"][rid]["nodes"][st(d)]["status"] == "SKIPPED")
            } else {
                deps.iter()
                    .any(|d| s["runs"][rid]["nodes"][st(d)]["status"] == "SKIPPED")
            };
            if !deps.is_empty() && unreachable {
                s["runs"][rid]["nodes"][id]["status"] = json!("SKIPPED");
                change = true;
            }
        }
    }
}
fn operation<'a>(s: &'a Value, rid: &str, nid: &str, result: &Value) -> Result<&'a Value> {
    let o = get(&s["operations"], st(&result["operationId"]))?;
    check(
        o["runId"] == rid && o["nodeId"] == nid && o["effect"] == "CONFIRMED_APPLIED",
        "NODE_EFFECT",
    )?;
    Ok(o)
}
pub(crate) fn bind_dispatch(s: &mut Value, c: &Value) -> Result<()> {
    let at = get(&s["attempts"], st(&c["attemptId"]))?;
    let oid = st(&at["operationId"]).to_owned();
    let op = get(&s["operations"], &oid)?;
    let rid = st(&op["runId"]).to_owned();
    let run = get(&s["runs"], &rid)?;
    if !run["graphId"].is_string() {
        return check(!c["nodeId"].is_string(), "NODE_NOT_READY");
    }
    let nid = st(&c["nodeId"]);
    check(
        ready_nodes(&Snapshot(s.clone()), &rid)?.contains(&nid.to_owned()),
        "NODE_NOT_READY",
    )?;
    let node = &run["nodes"][nid];
    let def = a(&s["graphs"][st(&run["graphId"])]["nodes"])
        .iter()
        .find(|n| n["id"] == nid)
        .unwrap();
    check(
        ["TASK", "LOOP", "COMPENSATION"].contains(&st(&def["kind"])),
        "NODE_KIND",
    )?;
    check(
        !op["nodeId"].is_string() || op["nodeId"] == nid,
        "NODE_BINDING",
    )?;
    check(
        !node["activeOperation"].is_string() || node["activeOperation"] == oid,
        "NODE_BUSY",
    )?;
    if def["kind"] == "LOOP" {
        check(
            q(&node["iterations"]) < q(&def["config"]["maxIterations"]),
            "LOOP_LIMIT",
        )?;
    }
    if def["inputSchema"].is_object() {
        validate_data(&def["inputSchema"], &op["action"]["payload"])?;
    }
    s["operations"][&oid]["nodeId"] = json!(nid);
    s["runs"][rid]["nodes"][nid]["activeOperation"] = json!(oid);
    Ok(())
}
pub(crate) fn apply_extension(s: &mut Value, c: &Value, now_ms: &str) -> Result<bool> {
    let now: BigUint = now_ms.parse().unwrap();
    let rid = st(&c["runId"]);
    match st(&c["type"]) {
        "tickTrigger" => {
            let id = st(&c["triggerId"]);
            let rec = get(&s["triggers"], id)?.clone();
            let t = &rec["definition"];
            let sch = &t["schedule"];
            check(
                t["kind"] == "SCHEDULED" && sch.is_object(),
                "SCHEDULE_CONFIG",
            )?;
            check(
                s["missionState"] == "OPEN"
                    && t["enabled"] == true
                    && now >= q(&t["notBefore"])
                    && now < q(&t["expiresAt"]),
                "TRIGGER_INACTIVE",
            )?;
            let due = due_slots(
                st(&sch["startMs"]),
                st(&sch["intervalMs"]),
                st(&rec["nextSlot"]),
                now_ms,
                st(&sch["catchUp"]),
                st(&sch["maxCatchUp"]).parse().unwrap(),
            )?;
            for slot in a(&due["slots"]) {
                let occurred = (q(&sch["startMs"]) + q(&sch["intervalMs"]) * q(slot)).to_string();
                let hash = digest(&json!([t["id"], t["revision"], slot]))?;
                let run = format!("schedule:{}", hash.strip_prefix("sha256:").unwrap());
                apply_extension(
                    s,
                    &json!({"type":"fireTrigger","triggerId":id,"runId":run,"event":{"id":format!("slot:{}",st(slot)),"source":t["source"],"type":t["eventType"],"occurredAt":occurred,"data":{"slot":slot},"depth":"0"}}),
                    now_ms,
                )?;
            }
            s["triggers"][id]["nextSlot"] = due["nextSlot"].clone();
        }
        "registerTrigger" => {
            check(
                contains(&s["contract"]["features"], &json!("triggers")),
                "UNSUPPORTED_FEATURE",
            )?;
            let t = &c["trigger"];
            let id = st(&t["id"]);
            unique(&s["triggers"], id)?;
            check(
                t["contractId"] == s["contract"]["id"]
                    && q(&t["notBefore"]) < q(&t["expiresAt"])
                    && q(&t["expiresAt"]) <= q(&s["contract"]["deadline"]),
                "TRIGGER_CONTRACT",
            )?;
            check(
                positive(&t["maxConcurrent"])
                    && positive(&t["rateLimit"])
                    && positive(&t["rateWindowMs"]),
                "TRIGGER_LIMIT",
            )?;
            check(
                (t["action"] == "RESUME_WAIT") == t["waitId"].is_string(),
                "TRIGGER_TARGET",
            )?;
            check(
                t["kind"] != "CONDITION"
                    || (t["filter"].is_object() && t["conditionMode"].is_string()),
                "TRIGGER_CONDITION",
            )?;
            check(
                (t["kind"] == "SCHEDULED") == t["schedule"].is_object(),
                "SCHEDULE_CONFIG",
            )?;
            if t["schedule"].is_object() {
                check(
                    positive(&t["schedule"]["intervalMs"])
                        && positive(&t["schedule"]["maxCatchUp"])
                        && q(&t["schedule"]["maxCatchUp"]) <= BigUint::from(1000u32),
                    "SCHEDULE_CONFIG",
                )?;
            }
            s["triggers"][id] =
                json!({"definition":t,"window":null,"count":"0","condition":false,"runIds":[]});
            if t["schedule"].is_object() {
                s["triggers"][id]["nextSlot"] = json!("0");
            }
        }
        "fireTrigger" => {
            check(
                contains(&s["contract"]["features"], &json!("triggers")),
                "UNSUPPORTED_FEATURE",
            )?;
            let id = st(&c["triggerId"]);
            let rec = get(&s["triggers"], id)?.clone();
            let t = &rec["definition"];
            let e = &c["event"];
            let key = canonical(&json!([t["id"], t["revision"], e["source"], e["id"]]))?;
            let material = canonical(e)?;
            if has(&s["receipts"], &key) {
                check(
                    s["receipts"][&key]["material"] == material,
                    "EVENT_ID_CONFLICT",
                )?;
            } else {
                check(
                    s["missionState"] == "OPEN"
                        && t["enabled"] == true
                        && now >= q(&t["notBefore"])
                        && now < q(&t["expiresAt"])
                        && now < q(&s["contract"]["deadline"]),
                    "TRIGGER_INACTIVE",
                )?;
                check(
                    e["source"] == t["source"] && e["type"] == t["eventType"],
                    "EVENT_SOURCE",
                )?;
                let time = q(&e["occurredAt"]);
                check(
                    time <= now && &now - &time <= q(&t["maxAgeMs"]),
                    "EVENT_EXPIRED",
                )?;
                check(q(&e["depth"]) <= q(&t["maxDepth"]), "TRIGGER_DEPTH")?;
                let matches = if t["filter"].is_object() {
                    let f = &t["filter"];
                    has(&e["data"], st(&f["field"]))
                        && canonical(&e["data"][st(&f["field"])])? == canonical(&f["equals"])?
                } else {
                    true
                };
                let fire = matches
                    && !(t["kind"] == "CONDITION"
                        && t["conditionMode"] == "EDGE"
                        && rec["condition"] == true);
                if t["kind"] == "CONDITION" {
                    s["triggers"][id]["condition"] = json!(matches);
                }
                if !fire {
                    s["receipts"][&key] =
                        json!({"material":material,"status":"FILTERED","at":now_ms});
                } else {
                    let window = (&now / q(&t["rateWindowMs"])).to_string();
                    if rec["window"] != window {
                        s["triggers"][id]["window"] = json!(window);
                        s["triggers"][id]["count"] = json!("0");
                    }
                    check(
                        q(&s["triggers"][id]["count"]) < q(&t["rateLimit"]),
                        "TRIGGER_RATE",
                    )?;
                    if t["action"] == "START_RUN" {
                        let count = a(&rec["runIds"])
                            .iter()
                            .filter(|id| !term(&s["runs"][st(id)]["state"]))
                            .count();
                        check(
                            BigUint::from(count) < q(&t["maxConcurrent"]),
                            "TRIGGER_CONCURRENCY",
                        )?;
                        unique(&s["runs"], rid)?;
                        s["runs"][rid] = new_run(rid);
                        s["triggers"][id]["runIds"]
                            .as_array_mut()
                            .unwrap()
                            .push(json!(rid));
                    } else {
                        let wid = st(&t["waitId"]);
                        let w = get(&s["waits"], wid)?;
                        check(
                            w["runId"] == rid && !term(&get(&s["runs"], rid)?["state"]),
                            "TRIGGER_TARGET",
                        )?;
                        check(
                            w["status"] == "PENDING"
                                && w["correlation"] == e["correlation"]
                                && now < q(&w["deadline"]),
                            "WAIT_CORRELATION",
                        )?;
                        s["waits"][wid]["status"] = json!("SATISFIED");
                    }
                    s["triggers"][id]["count"] =
                        json!((q(&s["triggers"][id]["count"]) + BigUint::from(1u8)).to_string());
                    s["receipts"][&key] =
                        json!({"material":material,"status":"ADMITTED","runId":rid,"at":now_ms});
                }
            }
        }
        "registerGraph" => {
            check(
                contains(&s["contract"]["features"], &json!("graphs")),
                "UNSUPPORTED_FEATURE",
            )?;
            let id = st(&c["graph"]["id"]);
            unique(&s["graphs"], id)?;
            s["graphs"][id] = validate_graph(&c["graph"])?.0;
        }
        "attachGraph" => {
            check(
                contains(&s["contract"]["features"], &json!("graphs")),
                "UNSUPPORTED_FEATURE",
            )?;
            let r = get(&s["runs"], rid)?;
            let g = get(&s["graphs"], st(&c["graphId"]))?.clone();
            check(
                r["state"] == "READY"
                    && !r["graphId"].is_string()
                    && !vs(&s["operations"]).any(|o| o["runId"] == rid),
                "GRAPH_ALREADY_ACTIVE",
            )?;
            s["runs"][rid]["graphId"] = g["id"].clone();
            let mut nodes = serde_json::Map::new();
            for n in a(&g["nodes"]) {
                nodes.insert(
                    st(&n["id"]).into(),
                    json!({"status":"PENDING","iterations":"0"}),
                );
            }
            s["runs"][rid]["nodes"] = Value::Object(nodes);
        }
        "completeNode" => {
            let r = get(&s["runs"], rid)?;
            let g = get(&s["graphs"], st(&r["graphId"]))?;
            let nid = st(&c["nodeId"]);
            let n = a(&g["nodes"])
                .iter()
                .find(|n| n["id"] == nid)
                .ok_or_else(|| error("NODE_NOT_READY"))?
                .clone();
            check(
                ready_nodes(&Snapshot(s.clone()), rid)?
                    .iter()
                    .any(|id| id == nid),
                "NODE_NOT_READY",
            )?;
            let result = &c["result"];
            if n["outputSchema"].is_object() {
                validate_data(&n["outputSchema"], result)?;
            }
            match st(&n["kind"]) {
                "TASK" => {
                    operation(s, rid, nid, result)?;
                }
                "FORK" => {}
                "JOIN" => {
                    if n["config"]["mode"] == "ANY" {
                        for id in a(&n["dependsOn"]) {
                            check(
                                !s["runs"][rid]["nodes"][st(id)]["activeOperation"].is_string(),
                                "UNSETTLED_NODES",
                            )?;
                            if s["runs"][rid]["nodes"][st(id)]["status"] == "PENDING" {
                                s["runs"][rid]["nodes"][st(id)]["status"] = json!("SKIPPED");
                            }
                        }
                    }
                }
                "DECISION" => {
                    let conf = &n["config"];
                    check(
                        result["data"].is_object() && has(&result["data"], st(&conf["field"])),
                        "DECISION_INPUT",
                    )?;
                    let selected = if canonical(&result["data"][st(&conf["field"])])?
                        == canonical(&conf["equals"])?
                    {
                        &conf["then"]
                    } else {
                        &conf["else"]
                    };
                    s["runs"][rid]["nodes"][nid]["selected"] = selected.clone();
                    let other = if selected == &conf["then"] {
                        &conf["else"]
                    } else {
                        &conf["then"]
                    };
                    s["runs"][rid]["nodes"][st(other)]["status"] = json!("SKIPPED");
                }
                "LOOP" => {
                    operation(s, rid, nid, result)?;
                    let node = &s["runs"][rid]["nodes"][nid];
                    check(
                        result["done"].is_boolean()
                            && !node["operations"]
                                .as_array()
                                .is_some_and(|ops| ops.contains(&result["operationId"])),
                        "LOOP_RESULT",
                    )?;
                    check(
                        q(&node["iterations"]) < q(&n["config"]["maxIterations"]),
                        "LOOP_LIMIT",
                    )?;
                    let count = q(&node["iterations"]) + BigUint::from(1u8);
                    s["runs"][rid]["nodes"][nid]["iterations"] = json!(count.to_string());
                    if !s["runs"][rid]["nodes"][nid]["operations"].is_array() {
                        s["runs"][rid]["nodes"][nid]["operations"] = json!([]);
                    }
                    s["runs"][rid]["nodes"][nid]["operations"]
                        .as_array_mut()
                        .unwrap()
                        .push(result["operationId"].clone());
                    s["runs"][rid]["nodes"][nid]
                        .as_object_mut()
                        .unwrap()
                        .remove("activeOperation");
                    if result["done"] == false {
                        if count >= q(&n["config"]["maxIterations"]) {
                            s["runs"][rid]["nodes"][nid]["status"] = json!("FAILED");
                            s["runs"][rid]["state"] = json!("FAILED");
                        }
                        s["runs"][rid]["nodes"][nid]["result"] = result.clone();
                        return Ok(true);
                    }
                }
                "WAIT" => {
                    let w = get(&s["waits"], st(&result["waitId"]))?;
                    check(w["runId"] == rid && w["status"] == "SATISFIED", "NODE_WAIT")?;
                }
                "APPROVAL" => {
                    let ap = get(&s["approvals"], st(&result["approvalId"]))?;
                    check(
                        ap["runId"] == rid && ap["withdrawn"] == false && now < q(&ap["expiresAt"]),
                        "APPROVAL_INVALID",
                    )?;
                }
                "SUBWORKFLOW" => {
                    check(
                        result["childRunId"] != rid
                            && assess_success(&Snapshot(s.clone()), st(&result["childRunId"]))?
                                ["verifiedSuccessful"]
                                == true,
                        "CHILD_NOT_ACCEPTED",
                    )?;
                }
                "VERIFICATION" => check(
                    s["assessments"][rid]["verification"] == "PASSED"
                        && s["assessments"][rid]["revision"] == result["revision"],
                    "VERIFICATION_NOT_PASSED",
                )?,
                "ACCEPTANCE" => check(
                    s["assessments"][rid]["acceptance"] == "ACCEPTED"
                        && s["assessments"][rid]["revision"] == result["revision"],
                    "ACCEPTANCE_REQUIRED",
                )?,
                "RECONCILIATION" => {
                    let o = get(&s["operations"], st(&result["operationId"]))?;
                    check(
                        o["runId"] == rid
                            && ["CONFIRMED_APPLIED", "CONFIRMED_NOT_APPLIED"]
                                .contains(&st(&o["effect"])),
                        "EFFECT_UNKNOWN",
                    )?;
                }
                "COMPENSATION" => {
                    let o = operation(s, rid, nid, result)?;
                    let original = get(&s["operations"], st(&result["originalOperationId"]))?;
                    check(
                        o["id"] != original["id"] && original["effect"] == "CONFIRMED_APPLIED",
                        "COMPENSATION_LINK",
                    )?;
                    s["runs"][rid]["nodes"][nid]["originalOperationId"] = original["id"].clone();
                }
                "END" => check(result["disposition"] == "COMPLETED", "END_DISPOSITION")?,
                _ => return Err(error("UNSUPPORTED_NODE")),
            }
            s["runs"][rid]["nodes"][nid]
                .as_object_mut()
                .unwrap()
                .remove("activeOperation");
            s["runs"][rid]["nodes"][nid]["status"] = json!("COMPLETED");
            s["runs"][rid]["nodes"][nid]["result"] = result.clone();
            skip(s, rid);
        }
        _ => return Ok(false),
    }
    Ok(true)
}
pub fn due_slots(
    start: &str,
    interval: &str,
    next_slot: &str,
    now: &str,
    policy: &str,
    limit: usize,
) -> Result<Value> {
    check(
        positive(&json!(interval)) && limit > 0 && ["SKIP", "LATEST", "ALL"].contains(&policy),
        "SCHEDULE_CONFIG",
    )?;
    let begin: BigUint = start.parse().map_err(|_| error("SCHEDULE_CONFIG"))?;
    let step: BigUint = interval.parse().map_err(|_| error("SCHEDULE_CONFIG"))?;
    let cursor: BigUint = next_slot.parse().map_err(|_| error("SCHEDULE_CONFIG"))?;
    let time: BigUint = now.parse().map_err(|_| error("SCHEDULE_CONFIG"))?;
    if time < begin {
        return Ok(json!({"slots":[],"nextSlot":next_slot}));
    }
    let last = (&time - &begin) / &step;
    if cursor > last {
        return Ok(json!({"slots":[],"nextSlot":next_slot}));
    }
    let one = BigUint::from(1u8);
    if policy == "SKIP" {
        let slots: Vec<String> = if time == begin + &last * &step {
            vec![last.to_string()]
        } else {
            vec![]
        };
        return Ok(json!({"slots":slots,"nextSlot":(last+&one).to_string()}));
    }
    if policy == "LATEST" {
        return Ok(json!({"slots":[last.to_string()],"nextSlot":(last+&one).to_string()}));
    }
    let end = std::cmp::min(&cursor + BigUint::from(limit) - &one, last);
    let mut i = cursor;
    let mut slots = vec![];
    while i <= end {
        slots.push(i.to_string());
        i += &one;
    }
    Ok(json!({"slots":slots,"nextSlot":i.to_string()}))
}
