use std::sync::{Arc, OnceLock};
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::commands::emit_broadcast;
use super::models::{A2ADispatchRequest, A2AMessageStatus, Broadcast, BroadcastSender};
use super::router::{A2ARouter, WaitOutcome};
use super::target::resolve_target;
use crate::slices::bridge::routes::{AppContext, AuthenticatedTerminal};
use crate::slices::pty::models::TerminalInfo;

#[derive(Debug, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Option<Value>,
}

#[derive(Debug, Serialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

pub async fn handle_mcp_request(
    State(ctx): State<Arc<AppContext>>,
    State(a2a_router): State<Arc<A2ARouter>>,
    caller: AuthenticatedTerminal,
    Json(req): Json<JsonRpcRequest>,
) -> Response {
    let caller_id = caller.id();
    let id = req.id.unwrap_or(Value::Null);

    match req.method.as_str() {
        "initialize" => {
            let requested_version = req
                .params
                .as_ref()
                .and_then(|p| p.get("protocolVersion"))
                .and_then(|v| v.as_str())
                .unwrap_or("2024-11-05");

            let res = JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                id,
                result: Some(json!({
                    "protocolVersion": requested_version,
                    "capabilities": {
                        "tools": {}
                    },
                    "serverInfo": {
                        "name": "quay-a2a",
                        "version": "1.0.0"
                    }
                })),
                error: None,
            };
            Json(res).into_response()
        }

        "notifications/initialized" => {
            (
                StatusCode::OK,
                [(axum::http::header::CONTENT_TYPE, "application/json")],
                "{}",
            )
                .into_response()
        }

        "ping" => {
            let res = JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                id,
                result: Some(json!({})),
                error: None,
            };
            Json(res).into_response()
        }

        "resources/list" => {
            let res = JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                id,
                result: Some(json!({ "resources": [] })),
                error: None,
            };
            Json(res).into_response()
        }

        "prompts/list" => {
            let res = JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                id,
                result: Some(json!({ "prompts": [] })),
                error: None,
            };
            Json(res).into_response()
        }

        "tools/list" => Json(JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id,
            result: Some(json!({ "tools": tool_list() })),
            error: None,
        })
        .into_response(),

        "tools/call" => {
            let params = req.params.unwrap_or(Value::Null);
            let tool_name = params
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let arguments = params.get("arguments").cloned().unwrap_or(json!({}));

            let result = match tool_name {
                "quay_list_agents" => {
                    let terminals = ctx.pty_manager.list();
                    let agents_list: Vec<Value> = terminals
                        .into_iter()
                        .filter_map(|t| t.bus_level().map(|level| (t, level)))
                        .map(|(t, level)| {
                            json!({
                                "terminal_id": t.id,
                                "name": t.name,
                                "task_title": t.task_title,
                                "run_kind": t.run_kind,
                                "level": level.as_str(),
                                "status": t.claude_status,
                                "current_tool": t.current_tool,
                                "auto_approved_count": t.auto_approved_count,
                                "project_path": t.project_path
                            })
                        })
                        .collect();

                    let text = serde_json::to_string_pretty(&agents_list).unwrap_or_default();
                    Ok(json!({
                        "content": [
                            {
                                "type": "text",
                                "text": format!("Active Quay Agents:\n{}", text)
                            }
                        ]
                    }))
                }

                "quay_send_message" => {
                    let target_arg = arguments
                        .get("target_terminal_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let message = arguments
                        .get("message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let wait = arguments
                        .get("wait_for_reply")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(true);

                    if target_arg.trim().is_empty() || message.is_empty() {
                        Err("Missing target_terminal_id or message argument".to_string())
                    } else {
                        match resolve_target(target_arg, Some(caller_id), &ctx.pty_manager) {
                            Err(e) => Err(e),
                            Ok(target) => {
                                let request = A2ADispatchRequest {
                                    from_terminal: caller_id.to_string(),
                                    to_terminal: target.id.clone(),
                                    prompt: message.to_string(),
                                    as_user: Some(false),
                                };

                                if wait {
                                    match a2a_router
                                        .dispatch_and_wait(request, Some(&ctx.pty_manager), 60)
                                        .await
                                    {
                                        Ok(outcome) => {
                                            let text = match outcome {
                                                WaitOutcome::Reply(reply) => {
                                                    format!("Reply from {}:\n{}", target.name, reply)
                                                }
                                                WaitOutcome::NoReply(why) => why,
                                            };
                                            Ok(json!({
                                                "content": [
                                                    {
                                                        "type": "text",
                                                        "text": text
                                                    }
                                                ]
                                            }))
                                        }
                                        Err(e) => Err("Failed waiting for agent reply: ".to_string() + &e),
                                    }
                                } else {
                                    match a2a_router.dispatch_async(request, Some(&ctx.pty_manager)).await {
                                        Ok(_) => {
                                            Ok(json!({
                                                "content": [
                                                    {
                                                        "type": "text",
                                                        "text": format!("Successfully dispatched task to {}.", target.name)
                                                    }
                                                ]
                                            }))
                                        }
                                        Err(e) => Err("Failed to dispatch task: ".to_string() + &e),
                                    }
                                }
                            }
                        }
                    }
                }

                "quay_broadcast" => {
                    let text = arguments.get("text").and_then(|v| v.as_str()).unwrap_or("");
                    if text.is_empty() {
                        Err("Missing text argument".to_string())
                    } else {
                        let sender = BroadcastSender::Peer(caller_id.to_string());
                        a2a_router
                            .broadcast_toast_async(text, &sender, &ctx.pty_manager)
                            .await
                            .map(|sent| {
                                emit_broadcast(&ctx.app_handle, text, &sent);
                                json!({
                                    "content": [
                                        {
                                            "type": "text",
                                            "text": broadcast_reply(&sent)
                                        }
                                    ]
                                })
                            })
                    }
                }

                "quay_get_agent_status" => {
                    let target_arg = arguments
                        .get("terminal_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");

                    resolve_target(target_arg, Some(caller_id), &ctx.pty_manager).map(|info| {
                        json!({
                            "content": [
                                {
                                    "type": "text",
                                    "text": agent_status_text(&info)
                                }
                            ]
                        })
                    })
                }

                "machina_submit_work_order" => {
                    let mgr = ctx.machina_manager.clone();
                    let parsed = machina_submit_request(&arguments);
                    // Agent submissions always wait on hold for a human to admit them.
                    let submitted_by = format!("terminal {}", caller_id);
                    match parsed {
                        Err(e) => Err(e),
                        Ok(req) => match tokio::task::spawn_blocking(move || mgr.submit_work_order(req, Some(submitted_by))).await {
                            Ok(Ok(wo)) => Ok(json!({
                                "content": [{
                                    "type": "text",
                                    "text": format!(
                                        "Submitted {} ({:?}). It waits for a human to admit it in Machina; branch {} and worktree {} are created after that.",
                                        wo.id, wo.status, wo.branch_name, wo.worktree_path
                                    )
                                }]
                            })),
                            Ok(Err(e)) => Err(e),
                            Err(e) => Err(format!("Machina task failed: {}", e)),
                        },
                    }
                }

                "machina_get_work_order" => {
                    let wo_id = arguments.get("work_order_id").and_then(|v| v.as_str()).unwrap_or("");
                    match crate::slices::machina::supervisor::parse_wo_id(wo_id)
                        .and_then(|id| ctx.machina_manager.agent_view(&id))
                    {
                        Ok(view) => Ok(json!({
                            "content": [{ "type": "text", "text": serde_json::to_string_pretty(&view).unwrap_or_default() }]
                        })),
                        Err(e) => Err(e),
                    }
                }

                "machina_submit_deliverable" => {
                    let wo_id = arguments.get("work_order_id").and_then(|v| v.as_str()).unwrap_or("");
                    match crate::slices::machina::supervisor::parse_wo_id(wo_id) {
                        Err(e) => Err(e),
                        Ok(id) => {
                            let mgr = ctx.machina_manager.clone();
                            let requested_by = Some(caller_id.to_string());
                            let gate_id = id.clone();
                            match tokio::task::spawn_blocking(move || mgr.start_gate(&gate_id, requested_by)).await {
                                Ok(Ok(crate::slices::machina::supervisor::GateStart::Started(attempt))) => Ok(json!({
                                    "content": [{
                                        "type": "text",
                                        "text": format!(
                                            "Gate attempt {} for {} started. It runs in the background; stop editing files until the verdict arrives.",
                                            attempt, id
                                        )
                                    }]
                                })),
                                Ok(Ok(crate::slices::machina::supervisor::GateStart::Held(why))) => Ok(json!({
                                    "content": [{
                                        "type": "text",
                                        "text": format!("{} is on hold: {}. Stop and wait for a human.", id, why)
                                    }]
                                })),
                                Ok(Err(e)) => Err(e),
                                Err(e) => Err(format!("Machina task failed: {}", e)),
                            }
                        }
                    }
                }

                _ => Err(format!("Unknown tool: {}", tool_name)),
            };

            match result {
                Ok(val) => Json(JsonRpcResponse {
                    jsonrpc: "2.0".to_string(),
                    id,
                    result: Some(val),
                    error: None,
                })
                .into_response(),
                Err(err_msg) => Json(JsonRpcResponse {
                    jsonrpc: "2.0".to_string(),
                    id,
                    result: None,
                    error: Some(JsonRpcError {
                        code: -32602,
                        message: err_msg,
                        data: None,
                    }),
                })
                .into_response(),
            }
        }

        _ => Json(JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id,
            result: None,
            error: Some(JsonRpcError {
                code: -32601,
                message: format!("Method '{}' not found", req.method),
                data: None,
            }),
        })
        .into_response(),
    }
}

/// The tools `tools/list` answers with. `pnpm docs:build` checks the A2A page's tool
/// reference against this file (see `scripts/mcp-tools`), so the two can't drift apart.
const TOOL_LIST: &str = include_str!("mcp_tools.json");

/// `TOOL_LIST`, parsed once.
fn tool_list() -> &'static Value {
    static TOOLS: OnceLock<Value> = OnceLock::new();
    TOOLS.get_or_init(|| serde_json::from_str(TOOL_LIST).expect("mcp_tools.json is valid JSON"))
}

/// What `quay_broadcast` answers with: the peers its notice reached, those holding it until
/// their turn ends, and those Quay couldn't type it into.
fn broadcast_reply(sent: &Broadcast) -> String {
    if sent.notices.is_empty() {
        return "No other running peer is in your project, so nobody got the notice.".to_string();
    }
    let names = |keep: &dyn Fn(A2AMessageStatus) -> bool| -> Vec<&str> {
        sent.notices
            .iter()
            .filter(|m| keep(m.status))
            .map(|m| m.to_name.as_deref().unwrap_or(&m.to_terminal))
            .collect()
    };
    let reached = names(&|s| s != A2AMessageStatus::Failed);
    let queued = names(&|s| s == A2AMessageStatus::Queued);
    let failed = names(&|s| s == A2AMessageStatus::Failed);

    let mut reply = if reached.is_empty() {
        "Your notice reached no peer.".to_string()
    } else {
        format!(
            "Sent your notice to {} peer{} in your project: {}.",
            reached.len(),
            if reached.len() == 1 { "" } else { "s" },
            reached.join(", ")
        )
    };
    if !queued.is_empty() {
        reply.push_str(&format!(" Queued until their current turn ends: {}.", queued.join(", ")));
    }
    if !failed.is_empty() {
        reply.push_str(&format!(" Couldn't deliver it to: {}.", failed.join(", ")));
    }
    reply
}

/// The line `quay_get_agent_status` answers with, its status in the lowercase form
/// `quay_list_agents` uses.
fn agent_status_text(info: &TerminalInfo) -> String {
    format!(
        "Agent {}: name='{}', level={}, status={}, task='{}', tool='{}', auto_approved={}, project='{}'",
        info.id,
        info.name,
        info.bus_level().map_or("not a peer", |level| level.as_str()),
        info.claude_status.as_str(),
        info.task_title.as_deref().unwrap_or("none"),
        info.current_tool.as_deref().unwrap_or("none"),
        info.auto_approved_count,
        info.project_path
    )
}

/// Parses `machina_submit_work_order` arguments, rejecting wrong types instead of
/// silently substituting defaults.
fn machina_submit_request(
    args: &Value,
) -> Result<crate::slices::machina::models::SubmitWorkOrderRequest, String> {
    let text = |key: &str| -> Result<String, String> {
        args.get(key)
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .ok_or_else(|| format!("{} must be a string", key))
    };
    let strings = |key: &str| -> Result<Vec<String>, String> {
        match args.get(key) {
            None | Some(Value::Null) => Ok(Vec::new()),
            Some(Value::Array(items)) => items
                .iter()
                .map(|x| x.as_str().map(str::to_string).ok_or_else(|| format!("{} must contain only strings", key)))
                .collect(),
            Some(_) => Err(format!("{} must be an array of strings", key)),
        }
    };
    let max_corrections = match args.get("max_corrections") {
        None | Some(Value::Null) => 3,
        Some(v) => v
            .as_u64()
            .and_then(|n| u32::try_from(n).ok())
            .ok_or("max_corrections must be a whole number")?,
    };
    let budget_usd = args
        .get("budget_usd")
        .and_then(|v| v.as_f64())
        .ok_or("budget_usd must be a number")?;
    let author_agent = match args.get("author_agent") {
        None | Some(Value::Null) => "claude".to_string(),
        Some(_) => text("author_agent")?,
    };
    let base_branch = match args.get("base_branch") {
        None | Some(Value::Null) => None,
        Some(_) => Some(text("base_branch")?),
    };
    Ok(crate::slices::machina::models::SubmitWorkOrderRequest {
        project_path: text("project_path")?,
        title: text("title")?,
        objective: text("objective")?,
        allowed_output_paths: strings("allowed_output_paths")?,
        base_branch,
        author_agent,
        max_corrections,
        budget_usd,
        depends_on: strings("depends_on")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::slices::orchestrator::models::A2AMessage;

    #[test]
    fn the_tool_list_names_each_tool_once_with_an_object_schema() {
        let tools = tool_list().as_array().expect("mcp_tools.json is an array");
        let names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().expect("a tool name")).collect();
        assert_eq!(
            names,
            [
                "quay_list_agents",
                "quay_send_message",
                "quay_broadcast",
                "quay_get_agent_status",
                "machina_submit_work_order",
                "machina_get_work_order",
                "machina_submit_deliverable",
            ]
        );
        for tool in tools {
            assert_eq!(tool["inputSchema"]["type"], "object", "{}", tool["name"]);
            assert!(tool["inputSchema"]["properties"].is_object(), "{}", tool["name"]);
            assert!(tool["description"].is_string(), "{}", tool["name"]);
        }
    }

    #[test]
    fn both_target_parameters_describe_one_matching_rule() {
        let schema = |name: &str| {
            tool_list()
                .as_array()
                .unwrap()
                .iter()
                .find(|t| t["name"] == name)
                .map(|t| t["inputSchema"]["properties"].clone())
                .unwrap()
        };
        let send = &schema("quay_send_message")["target_terminal_id"]["description"];
        let status = &schema("quay_get_agent_status")["terminal_id"]["description"];
        assert!(send.as_str().is_some_and(|d| d.contains("exact terminal ID")), "{send}");
        assert_eq!(send, status);
    }

    #[test]
    fn test_jsonrpc_request_deserialize() {
        let raw = r#"{
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "quay_broadcast",
                "arguments": { "text": "hello agents" }
            }
        }"#;

        let req: JsonRpcRequest = serde_json::from_str(raw).unwrap();
        assert_eq!(req.method, "tools/call");
        assert_eq!(req.id, Some(json!(1)));

        let params = req.params.unwrap();
        assert_eq!(params["name"], "quay_broadcast");
        assert_eq!(params["arguments"]["text"], "hello agents");
    }

    #[test]
    fn agent_status_prints_the_status_as_quay_list_agents_does() {
        use crate::slices::pty::models::{test_terminal, ClaudeStatus, RunKind};

        let mut info = test_terminal("term-status", RunKind::Claude, ClaudeStatus::Working);
        info.name = "answerer".to_string();
        info.task_title = Some("Read package.json".to_string());
        let text = agent_status_text(&info);

        let listed = serde_json::to_value(&info.claude_status).unwrap();
        assert_eq!(listed, json!("working"));
        assert!(text.contains("status=working,"), "{text}");
        assert!(text.contains("name='answerer'"), "{text}");
        assert!(text.contains("task='Read package.json'"), "{text}");
    }

    fn notice(to_name: &str, status: A2AMessageStatus) -> A2AMessage {
        A2AMessage {
            id: format!("broadcast-{to_name}"),
            from_terminal: "term-captain".to_string(),
            to_terminal: format!("term-{to_name}"),
            from_name: Some("release-captain".to_string()),
            to_name: Some(to_name.to_string()),
            content: "FREEZE".to_string(),
            as_user: false,
            broadcast: true,
            waited: false,
            timestamp: 0,
            delivered_at: None,
            completed_at: None,
            status,
            response: None,
            note: None,
        }
    }

    fn sent(notices: Vec<A2AMessage>) -> Broadcast {
        Broadcast { from_name: "release-captain".to_string(), notices }
    }

    #[test]
    fn a_broadcast_reply_names_the_peers_it_reached_and_those_queued() {
        let text = broadcast_reply(&sent(vec![
            notice("feature-dev", A2AMessageStatus::Dispatched),
            notice("docs-writer", A2AMessageStatus::Queued),
        ]));
        assert_eq!(
            text,
            "Sent your notice to 2 peers in your project: feature-dev, docs-writer. \
             Queued until their current turn ends: docs-writer."
        );
    }

    #[test]
    fn a_broadcast_reply_says_which_peers_it_couldnt_reach() {
        let text = broadcast_reply(&sent(vec![
            notice("feature-dev", A2AMessageStatus::Dispatched),
            notice("docs-writer", A2AMessageStatus::Failed),
        ]));
        assert_eq!(
            text,
            "Sent your notice to 1 peer in your project: feature-dev. Couldn't deliver it to: docs-writer."
        );
    }

    #[test]
    fn a_broadcast_reply_says_when_no_peer_got_it() {
        assert_eq!(
            broadcast_reply(&sent(Vec::new())),
            "No other running peer is in your project, so nobody got the notice."
        );
    }

    #[test]
    fn test_jsonrpc_response_serialize() {
        let res = JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id: json!(42),
            result: Some(json!({ "status": "ok" })),
            error: None,
        };

        let raw = serde_json::to_string(&res).unwrap();
        assert!(raw.contains(r#""jsonrpc":"2.0""#));
        assert!(raw.contains(r#""id":42"#));
        assert!(!raw.contains("error"));
    }
}
