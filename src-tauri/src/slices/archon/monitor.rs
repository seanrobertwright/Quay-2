//! Live run monitor: talks to the Archon web server (default :3090) the same way the
//! Archon web UI does, and condenses a run's events into node states, a log, the run's
//! conversation and any pending approval.

use std::collections::HashMap;

use serde_json::Value;

use super::models::{
    ArchonChatMessage, ArchonLogEntry, ArchonNodeState, ArchonPendingApproval, ArchonRun,
    ArchonRunDetail,
};
use crate::dates;

/// The run log keeps the most recent entries only; a long run has thousands of events.
pub const MAX_LOG_ENTRIES: usize = 600;
const MAX_MESSAGES: usize = 200;
const MAX_DETAIL_CHARS: usize = 400;
const MAX_RESPONSE_TEXT: usize = 4000;

/// Calls the Archon HTTP API on `127.0.0.1:{port}` through curl. Requests time out,
/// never follow redirects (curl's default) and never open a console window. Returns the
/// parsed JSON body, or the server's `error` message for 4xx/5xx responses.
pub fn archon_request(
    port: u16,
    method: &str,
    path: &str,
    body: Option<&Value>,
) -> Result<Value, String> {
    let url = format!("http://127.0.0.1:{}{}", port, path);
    let program = if cfg!(windows) { "curl.exe" } else { "curl" };
    let mut cmd = crate::spawn::hidden_command(program);
    cmd.args([
        "-s",
        "-S",
        "--proto",
        "=http",
        "--connect-timeout",
        "2",
        "--max-time",
        "10",
        "-X",
        method,
        "-w",
        "\n%{http_code}",
    ]);
    if let Some(b) = body {
        cmd.args([
            "-H",
            "Content-Type: application/json",
            "--data-binary",
            &b.to_string(),
        ]);
    }
    cmd.arg(&url);

    let out = cmd
        .output()
        .map_err(|e| format!("Could not run curl for {}: {}", path, e))?;
    if !out.status.success() {
        return Err(format!(
            "Archon request {} {} failed: {}",
            method,
            path,
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let (body_text, code) = text
        .rsplit_once('\n')
        .ok_or_else(|| format!("Archon request {} returned no status", path))?;
    let status: u16 = code.trim().parse().unwrap_or(0);
    let json: Value = if body_text.trim().is_empty() {
        Value::Null
    } else {
        serde_json::from_str(body_text).unwrap_or_else(|_| Value::String(body_text.to_string()))
    };
    if !(200..300).contains(&status) {
        let msg = json
            .get("error")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| format!("HTTP {}", status));
        return Err(format!("Archon {} {}: {}", method, path, msg));
    }
    Ok(json)
}

/// Archon run ids and conversation ids are short ASCII tokens; anything else is rejected
/// before it is put in a URL path.
pub fn validate_id(kind: &str, id: &str) -> Result<(), String> {
    let ok = (1..=128).contains(&id.len())
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_');
    if ok {
        Ok(())
    } else {
        Err(format!("Invalid Archon {} id: {:?}", kind, id))
    }
}

fn str_at<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str).filter(|s| !s.is_empty())
}

fn ts(v: &Value, key: &str) -> Option<i64> {
    str_at(v, key).and_then(dates::parse_timestamp_ms)
}

fn clip(s: &str, max: usize) -> String {
    let trimmed = s.trim();
    if trimmed.chars().count() <= max {
        trimmed.to_string()
    } else {
        let cut: String = trimmed.chars().take(max).collect();
        format!("{}…", cut)
    }
}

/// Parses one run object from `/api/dashboard/runs` or `/api/workflows/runs/{id}`.
pub fn parse_run(item: &Value) -> ArchonRun {
    let strings = |key: &str| str_at(item, key).map(str::to_string);
    let active_nodes = item
        .get("active_nodes")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|v| {
                    v.as_str()
                        .map(str::to_string)
                        .or_else(|| str_at(v, "id").map(str::to_string))
                })
                .collect::<Vec<_>>()
        });
    let counts = &item["metadata"]["node_counts"];
    ArchonRun {
        id: str_at(item, "id").unwrap_or_default().to_string(),
        workflow_name: str_at(item, "workflow_name")
            .unwrap_or_default()
            .to_string(),
        user_message: strings("user_message"),
        status: str_at(item, "status").unwrap_or("unknown").to_string(),
        outcome: strings("outcome"),
        working_path: strings("working_path"),
        started_at: strings("started_at"),
        completed_at: strings("completed_at"),
        total_cost_usd: item["total_cost_usd"]
            .as_f64()
            .or_else(|| item["metadata"]["total_cost_usd"].as_f64()),
        codebase_name: strings("codebase_name"),
        current_step_name: strings("current_step_name"),
        active_nodes,
        nodes_completed: counts["completed"].as_u64().map(|n| n as u32),
        nodes_total: counts["total"].as_u64().map(|n| n as u32),
        started_ms: ts(item, "started_at"),
        completed_ms: ts(item, "completed_at"),
        conversation_platform_id: strings("conversation_platform_id")
            .or_else(|| strings("worker_platform_id")),
    }
}

/// One-line summary of a tool call's input, preferring what a human wrote.
fn tool_summary(input: &Value) -> Option<String> {
    for key in [
        "description",
        "command",
        "file_path",
        "path",
        "pattern",
        "url",
        "query",
        "prompt",
        "skill",
    ] {
        if let Some(s) = str_at(input, key) {
            return Some(clip(s.lines().next().unwrap_or(s), MAX_DETAIL_CHARS));
        }
    }
    match input {
        Value::Null => None,
        other => Some(clip(&other.to_string(), MAX_DETAIL_CHARS)),
    }
}

fn is_active(status: &str) -> bool {
    matches!(status, "running" | "pending" | "paused")
}

/// Condenses `/api/workflows/runs/{id}` (and the conversation's messages, when fetched)
/// into what the monitor renders. Hook events are counted but left out unless
/// `include_hooks` is set.
pub fn build_run_detail(
    detail: &Value,
    messages: Option<&Value>,
    include_hooks: bool,
) -> ArchonRunDetail {
    let run_json = &detail["run"];
    let run = parse_run(run_json);
    let run_active = is_active(&run.status);
    let meta = &run_json["metadata"];

    let mut events: Vec<&Value> = detail["events"]
        .as_array()
        .map(|a| a.iter().collect())
        .unwrap_or_default();
    events.sort_by_key(|e| e["event_order"].as_i64().unwrap_or(0));

    let mut nodes: Vec<ArchonNodeState> = Vec::new();
    let mut node_index: HashMap<String, usize> = HashMap::new();
    let mut logs: Vec<ArchonLogEntry> = Vec::new();
    let mut tool_entries: HashMap<String, usize> = HashMap::new();
    let mut hidden_hooks = 0usize;
    let mut pending: Option<ArchonPendingApproval> = None;

    for e in &events {
        let kind = e["event_type"].as_str().unwrap_or("");
        let data = &e["data"];
        let step = str_at(e, "step_name").map(str::to_string);
        let at = ts(e, "created_at");
        let id = str_at(e, "id").unwrap_or_default().to_string();
        let entry = |kind: &str,
                     label: String,
                     detail: Option<String>,
                     status: Option<&str>,
                     duration: Option<u64>| ArchonLogEntry {
            id: id.clone(),
            ts_ms: at,
            kind: kind.to_string(),
            node_id: step.clone(),
            label,
            detail,
            status: status.map(str::to_string),
            duration_ms: duration,
        };

        match kind {
            "node_started"
            | "node_completed"
            | "node_failed"
            | "node_skipped"
            | "node_skipped_prior_success" => {
                let Some(node_id) = step.clone() else {
                    continue;
                };
                let state = match kind {
                    "node_started" => "running",
                    "node_completed" => "completed",
                    "node_failed" => "failed",
                    _ => "skipped",
                };
                let duration = data["duration_ms"]
                    .as_u64()
                    .or_else(|| data["timing"]["durationMs"].as_u64());
                let started = ts(&data["timing"], "startedAt")
                    .or(ts(&data["invocation"], "startedAt"))
                    .or(at);
                let detail_text = match state {
                    "failed" => str_at(data, "error").map(|s| clip(s, MAX_DETAIL_CHARS)),
                    "skipped" => str_at(data, "reason")
                        .or_else(|| str_at(data, "expr"))
                        .map(|s| clip(s, MAX_DETAIL_CHARS)),
                    _ => None,
                };
                let model = str_at(&data["model_usage"], "resolved").map(str::to_string);
                let cost = data["cost_usd"].as_f64();

                let idx = *node_index.entry(node_id.clone()).or_insert_with(|| {
                    nodes.push(ArchonNodeState {
                        node_id: node_id.clone(),
                        state: "running".into(),
                        started_ms: None,
                        duration_ms: None,
                        cost_usd: None,
                        model: None,
                        detail: None,
                    });
                    nodes.len() - 1
                });
                let n = &mut nodes[idx];
                n.state = state.to_string();
                if state == "running" {
                    n.started_ms = started;
                    n.duration_ms = None;
                    n.detail = None;
                } else {
                    n.started_ms = n.started_ms.or(started);
                    n.duration_ms = duration.or(n.duration_ms);
                    n.detail = detail_text.clone();
                }
                n.cost_usd = cost.or(n.cost_usd);
                n.model = model.or(n.model.take());

                let verb = match state {
                    "running" => "started",
                    "completed" => "completed",
                    "failed" => "failed",
                    _ => "skipped",
                };
                let status = match state {
                    "running" => "running",
                    "completed" => "ok",
                    "failed" => "failed",
                    _ => "skipped",
                };
                logs.push(entry(
                    "node",
                    format!("{} {}", node_id, verb),
                    detail_text,
                    Some(status),
                    duration,
                ));
            }
            "tool_called" => {
                let tool = str_at(data, "tool_name").unwrap_or("tool").to_string();
                let detail_text = str_at(data, "argsSummary")
                    .map(|s| clip(s, MAX_DETAIL_CHARS))
                    .or_else(|| tool_summary(&data["tool_input"]));
                logs.push(entry("tool", tool, detail_text, Some("running"), None));
                if let Some(call_id) = str_at(data, "tool_call_id") {
                    tool_entries.insert(call_id.to_string(), logs.len() - 1);
                }
            }
            "tool_completed" => {
                let ok = str_at(data, "tool_outcome").is_none_or(|o| o == "success");
                let duration = data["duration_ms"].as_u64();
                match str_at(data, "tool_call_id").and_then(|c| tool_entries.get(c).copied()) {
                    Some(i) => {
                        logs[i].status = Some(if ok { "ok" } else { "failed" }.into());
                        logs[i].duration_ms = duration;
                    }
                    None => {
                        let tool = str_at(data, "tool_name").unwrap_or("tool").to_string();
                        logs.push(entry(
                            "tool",
                            tool,
                            None,
                            Some(if ok { "ok" } else { "failed" }),
                            duration,
                        ));
                    }
                }
            }
            "task_activity" => {
                let activity = str_at(data, "activity").unwrap_or("update");
                let text = str_at(data, "description")
                    .or_else(|| str_at(data, "summary"))
                    .map(|s| clip(s, MAX_DETAIL_CHARS));
                let status = match activity {
                    "started" => Some("running"),
                    "completed" => Some("ok"),
                    "failed" => Some("failed"),
                    _ => None,
                };
                logs.push(entry(
                    "task",
                    format!("Task {}", activity),
                    text,
                    status,
                    None,
                ));
            }
            "loop_iteration_started" | "loop_iteration_completed" => {
                let iteration = data["iteration"].as_u64().unwrap_or(0);
                let label = match data["maxIterations"].as_u64() {
                    Some(max) if kind.ends_with("started") => {
                        format!("Iteration {}/{} started", iteration, max)
                    }
                    _ if kind.ends_with("started") => format!("Iteration {} started", iteration),
                    _ => format!("Iteration {} completed", iteration),
                };
                let status = if kind.ends_with("started") {
                    "running"
                } else {
                    "ok"
                };
                logs.push(entry(
                    "loop",
                    label,
                    None,
                    Some(status),
                    data["duration"].as_u64(),
                ));
            }
            "approval_requested" => {
                let prompt = str_at(data, "message")
                    .unwrap_or("Approval requested")
                    .to_string();
                pending = Some(ArchonPendingApproval {
                    prompt: prompt.clone(),
                    node_id: step.clone(),
                    requested_ms: at,
                });
                logs.push(entry(
                    "approval",
                    "Approval requested".into(),
                    Some(clip(&prompt, MAX_DETAIL_CHARS)),
                    Some("running"),
                    None,
                ));
            }
            "approval_received" => {
                pending = None;
                let decision = str_at(data, "decision").unwrap_or("received");
                let note = str_at(data, "comment")
                    .or_else(|| str_at(data, "reason"))
                    .map(|s| clip(s, MAX_DETAIL_CHARS));
                let status = if decision == "approved" {
                    "ok"
                } else {
                    "failed"
                };
                logs.push(entry(
                    "approval",
                    format!("Approval {}", decision),
                    note,
                    Some(status),
                    None,
                ));
            }
            "workflow_started" | "workflow_completed" | "workflow_failed" | "workflow_resumed"
            | "workflow_cancelled" => {
                let label = match kind {
                    "workflow_started" => "Workflow started",
                    "workflow_completed" => "Workflow completed",
                    "workflow_failed" => "Workflow failed",
                    "workflow_resumed" => "Workflow resumed",
                    _ => "Workflow cancelled",
                };
                let detail_text = str_at(data, "error").map(|s| clip(s, MAX_DETAIL_CHARS));
                let status = match kind {
                    "workflow_completed" => Some("ok"),
                    "workflow_failed" | "workflow_cancelled" => Some("failed"),
                    _ => None,
                };
                logs.push(entry(
                    "system",
                    label.into(),
                    detail_text,
                    status,
                    data["duration_ms"].as_u64(),
                ));
            }
            "workflow_parse_warnings" => {
                let warnings: Vec<&str> = data["warnings"]
                    .as_array()
                    .map(|a| a.iter().filter_map(Value::as_str).collect())
                    .unwrap_or_default();
                logs.push(entry(
                    "warning",
                    "Workflow parse warnings".into(),
                    Some(clip(&warnings.join("\n"), MAX_DETAIL_CHARS * 2)),
                    None,
                    None,
                ));
            }
            "error" => {
                let msg = str_at(data, "error")
                    .or_else(|| str_at(data, "message"))
                    .unwrap_or("Error");
                logs.push(entry(
                    "error",
                    "Error".into(),
                    Some(clip(msg, MAX_DETAIL_CHARS)),
                    Some("failed"),
                    None,
                ));
            }
            "hook_activity" => {
                if include_hooks {
                    let name = str_at(data, "hook_name").unwrap_or("hook");
                    let activity = str_at(data, "activity").unwrap_or("");
                    logs.push(entry(
                        "hook",
                        format!("{} {}", name, activity).trim().to_string(),
                        None,
                        None,
                        None,
                    ));
                } else {
                    hidden_hooks += 1;
                }
            }
            other => {
                let text = str_at(data, "text")
                    .or_else(|| str_at(data, "message"))
                    .map(|s| clip(s, MAX_DETAIL_CHARS));
                logs.push(entry("text", other.replace('_', " "), text, None, None));
            }
        }
    }

    // A finished run's terminal record is authoritative for every node's final state.
    if let Some(record) = run_json["terminal_record"]["nodes"].as_array() {
        for n in record {
            let (Some(node_id), Some(state)) = (str_at(n, "node_id"), str_at(n, "state")) else {
                continue;
            };
            match node_index.get(node_id) {
                Some(&i) => nodes[i].state = state.to_string(),
                None => {
                    node_index.insert(node_id.to_string(), nodes.len());
                    nodes.push(ArchonNodeState {
                        node_id: node_id.to_string(),
                        state: state.to_string(),
                        started_ms: None,
                        duration_ms: None,
                        cost_usd: None,
                        model: None,
                        detail: None,
                    });
                }
            }
        }
    }
    // Nodes still marked running on a run that stopped were interrupted.
    if !run_active {
        for n in nodes.iter_mut().filter(|n| n.state == "running") {
            n.state = "cancelled".into();
        }
        pending = None;
    }

    let active_nodes: Vec<String> = nodes
        .iter()
        .filter(|n| n.state == "running")
        .map(|n| n.node_id.clone())
        .collect();

    let logs_truncated = logs.len() > MAX_LOG_ENTRIES;
    if logs_truncated {
        logs.drain(..logs.len() - MAX_LOG_ENTRIES);
    }

    let messages = messages.map(parse_messages).unwrap_or_default();

    let error =
        str_at(&run_json["terminal_record"], "error").map(|s| clip(s, MAX_DETAIL_CHARS * 3));
    let mut run = run;
    if run.active_nodes.as_ref().is_none_or(|a| a.is_empty()) {
        run.active_nodes = Some(active_nodes.clone());
    }

    ArchonRunDetail {
        last_activity_ms: ts(run_json, "last_activity_at"),
        error,
        tokens_in: meta["total_tokens_in"].as_u64(),
        tokens_out: meta["total_tokens_out"].as_u64(),
        cache_read_tokens: meta["total_cache_read_tokens"].as_u64(),
        cache_write_tokens: meta["total_cache_write_tokens"].as_u64(),
        nodes,
        active_nodes,
        logs,
        total_events: events.len(),
        hidden_hook_events: hidden_hooks,
        logs_truncated,
        messages,
        pending_approval: pending,
        fetched_at_ms: dates::now_ms(),
        run,
    }
}

/// Parses `/api/conversations/{id}/messages`, oldest first, keeping the newest
/// `MAX_MESSAGES`.
pub fn parse_messages(json: &Value) -> Vec<ArchonChatMessage> {
    let Some(arr) = json.as_array() else {
        return Vec::new();
    };
    let mut out: Vec<ArchonChatMessage> = arr
        .iter()
        .map(|m| {
            let meta: Value = match &m["metadata"] {
                Value::String(s) => serde_json::from_str(s).unwrap_or(Value::Null),
                other => other.clone(),
            };
            ArchonChatMessage {
                id: str_at(m, "id").unwrap_or_default().to_string(),
                role: str_at(m, "role").unwrap_or("assistant").to_string(),
                content: m["content"].as_str().unwrap_or_default().to_string(),
                ts_ms: ts(m, "created_at"),
                category: str_at(&meta, "category").map(str::to_string),
            }
        })
        .collect();
    out.sort_by_key(|m| m.ts_ms.unwrap_or(0));
    if out.len() > MAX_MESSAGES {
        out.drain(..out.len() - MAX_MESSAGES);
    }
    out
}

/// Request path and JSON body for a run action. `approve`/`reject` answer a pending
/// approval gate; `text` is an optional comment.
pub fn action_request(
    run_id: &str,
    action: &str,
    text: Option<&str>,
) -> Result<(String, Value), String> {
    validate_id("run", run_id)?;
    let text = text.map(str::trim).filter(|t| !t.is_empty());
    if text.is_some_and(|t| t.chars().count() > MAX_RESPONSE_TEXT) {
        return Err(format!(
            "Comment is longer than {} characters",
            MAX_RESPONSE_TEXT
        ));
    }
    let base = format!("/api/workflows/runs/{}", run_id);
    match action {
        "cancel" | "resume" | "abandon" => {
            Ok((format!("{}/{}", base, action), serde_json::json!({})))
        }
        "approve" | "reject" => {
            let mut body = serde_json::json!({ "decision": action });
            if let Some(t) = text {
                body["text"] = Value::String(t.to_string());
            }
            Ok((format!("{}/respond", base), body))
        }
        other => Err(format!("Unknown run action {:?}", other)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ev(order: i64, kind: &str, step: Option<&str>, data: Value) -> Value {
        json!({
            "id": format!("e{}", order),
            "event_order": order,
            "event_type": kind,
            "step_name": step,
            "data": data,
            "created_at": "2026-10-18 03:11:27"
        })
    }

    fn detail(status: &str, events: Vec<Value>, terminal_nodes: Option<Value>) -> Value {
        json!({
            "run": {
                "id": "1f4365983bc189dae090aa3fef18e425",
                "workflow_name": "lril-sdlc:implement",
                "status": status,
                "started_at": "2026-10-18T03:11:21.000Z",
                "conversation_platform_id": "cli-1792293076066-fs5b62",
                "metadata": { "total_tokens_out": 360746, "node_counts": { "completed": 1, "total": 3 } },
                "terminal_record": terminal_nodes.map(|n| json!({ "nodes": n, "error": null })).unwrap_or(Value::Null)
            },
            "events": events
        })
    }

    #[test]
    fn running_run_tracks_node_states_and_merges_tool_results() {
        let d = detail(
            "running",
            vec![
                ev(
                    3,
                    "tool_called",
                    Some("implement.build"),
                    json!({ "tool_name": "Bash", "tool_input": { "command": "npm test", "description": "Run tests" }, "tool_call_id": "t1" }),
                ),
                ev(1, "node_started", Some("fetch"), json!({})),
                ev(
                    2,
                    "node_completed",
                    Some("fetch"),
                    json!({ "duration_ms": 120, "cost_usd": 0.0 }),
                ),
                ev(
                    4,
                    "tool_completed",
                    Some("implement.build"),
                    json!({ "tool_name": "Bash", "duration_ms": 900, "tool_call_id": "t1", "tool_outcome": "success" }),
                ),
                ev(5, "node_started", Some("implement"), json!({})),
                ev(
                    6,
                    "hook_activity",
                    Some("implement.build"),
                    json!({ "hook_name": "SessionStart", "activity": "started" }),
                ),
            ],
            None,
        );
        let r = build_run_detail(&d, None, false);
        assert_eq!(
            r.run.conversation_platform_id.as_deref(),
            Some("cli-1792293076066-fs5b62")
        );
        assert_eq!(
            r.run.started_ms,
            dates::parse_timestamp_ms("2026-10-18T03:11:21Z")
        );
        let fetch = r.nodes.iter().find(|n| n.node_id == "fetch").unwrap();
        assert_eq!(fetch.state, "completed");
        assert_eq!(fetch.duration_ms, Some(120));
        assert_eq!(r.active_nodes, vec!["implement".to_string()]);
        // Events are ordered by event_order, and the tool result folds into its call.
        let tool = r.logs.iter().find(|l| l.kind == "tool").unwrap();
        assert_eq!(tool.detail.as_deref(), Some("Run tests"));
        assert_eq!(tool.status.as_deref(), Some("ok"));
        assert_eq!(tool.duration_ms, Some(900));
        assert_eq!(r.logs.iter().filter(|l| l.kind == "tool").count(), 1);
        assert_eq!(r.hidden_hook_events, 1);
        assert_eq!(r.total_events, 6);
        assert_eq!(r.tokens_out, Some(360746));
    }

    #[test]
    fn stopped_run_uses_terminal_record_and_cancels_stragglers() {
        let d = detail(
            "cancelled",
            vec![
                ev(1, "node_started", Some("fetch"), json!({})),
                ev(2, "node_started", Some("gate"), json!({})),
                ev(
                    3,
                    "approval_requested",
                    Some("gate"),
                    json!({ "message": "Ship it?" }),
                ),
            ],
            Some(
                json!([{ "node_id": "fetch", "state": "completed" }, { "node_id": "outcome", "state": "skipped" }]),
            ),
        );
        let r = build_run_detail(&d, None, false);
        let state = |id: &str| {
            r.nodes
                .iter()
                .find(|n| n.node_id == id)
                .map(|n| n.state.clone())
        };
        assert_eq!(state("fetch").as_deref(), Some("completed"));
        assert_eq!(state("gate").as_deref(), Some("cancelled"));
        assert_eq!(state("outcome").as_deref(), Some("skipped"));
        assert!(r.active_nodes.is_empty());
        assert!(r.pending_approval.is_none());
    }

    #[test]
    fn pending_approval_clears_when_answered() {
        let asked = vec![ev(
            1,
            "approval_requested",
            Some("gate"),
            json!({ "message": "Ship it?" }),
        )];
        let r = build_run_detail(&detail("paused", asked.clone(), None), None, false);
        assert_eq!(
            r.pending_approval.as_ref().map(|p| p.prompt.as_str()),
            Some("Ship it?")
        );

        let mut answered = asked;
        answered.push(ev(
            2,
            "approval_received",
            Some("gate"),
            json!({ "decision": "approved" }),
        ));
        let r = build_run_detail(&detail("running", answered, None), None, false);
        assert!(r.pending_approval.is_none());
    }

    #[test]
    fn failed_node_carries_its_error() {
        let d = detail(
            "failed",
            vec![ev(
                1,
                "node_failed",
                Some("gate"),
                json!({ "error": "Script node 'gate' failed [exit 1]" }),
            )],
            None,
        );
        let r = build_run_detail(&d, None, false);
        assert_eq!(r.nodes[0].state, "failed");
        assert_eq!(
            r.nodes[0].detail.as_deref(),
            Some("Script node 'gate' failed [exit 1]")
        );
    }

    #[test]
    fn log_keeps_the_most_recent_entries() {
        let events: Vec<Value> = (0..(MAX_LOG_ENTRIES as i64 + 50))
            .map(|i| {
                ev(
                    i,
                    "task_activity",
                    Some("build"),
                    json!({ "activity": "started", "description": format!("task {}", i) }),
                )
            })
            .collect();
        let r = build_run_detail(&detail("running", events, None), None, false);
        assert!(r.logs_truncated);
        assert_eq!(r.logs.len(), MAX_LOG_ENTRIES);
        assert_eq!(
            r.logs.last().unwrap().detail.as_deref(),
            Some(format!("task {}", MAX_LOG_ENTRIES + 49).as_str())
        );
    }

    #[test]
    fn messages_parse_metadata_category_and_sort() {
        let msgs = json!([
            { "id": "b", "role": "assistant", "content": "done", "metadata": "{\"category\":\"workflow_result\"}", "created_at": "2026-10-18 04:51:03" },
            { "id": "a", "role": "user", "content": "Implement #169", "metadata": "{}", "created_at": "2026-10-18 03:11:27" }
        ]);
        let m = parse_messages(&msgs);
        assert_eq!(m[0].id, "a");
        assert_eq!(m[1].category.as_deref(), Some("workflow_result"));
    }

    #[test]
    fn actions_are_validated() {
        let (path, body) = action_request("abc123", "approve", Some("  looks good ")).unwrap();
        assert_eq!(path, "/api/workflows/runs/abc123/respond");
        assert_eq!(body, json!({ "decision": "approve", "text": "looks good" }));
        let (path, body) = action_request("abc123", "cancel", None).unwrap();
        assert_eq!(path, "/api/workflows/runs/abc123/cancel");
        assert_eq!(body, json!({}));
        assert!(action_request("abc123", "delete", None).is_err());
        assert!(action_request("../etc", "cancel", None).is_err());
        assert!(action_request("abc", "reject", Some(&"x".repeat(MAX_RESPONSE_TEXT + 1))).is_err());
    }
}
