use std::sync::Arc;
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::Emitter;

use super::models::A2ADispatchRequest;
use super::router::{A2ARouter, WaitOutcome};
use crate::slices::bridge::routes::{AppContext, AuthenticatedTerminal};

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

        "tools/list" => {
            let tools = json!({
                "tools": [
                    {
                        "name": "quay_list_agents",
                        "description": "List the peers on Quay's A2A bus: their terminal IDs, names, run kind, bus level and live status (Working, Idle, Waiting, etc.). A full peer sends messages and replies; a responder replies but can't send; a listener gets messages but can't reply. Shell and Archon terminals are not peers and are not listed.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {}
                        }
                    },
                    {
                        "name": "quay_send_message",
                        "description": "Send a prompt or task delegation to another peer in Quay. Can optionally wait for the peer to finish its turn and return its reply directly to you. A listener can't reply, so a wait on one returns at once and says why.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "target_terminal_id": {
                                    "type": "string",
                                    "description": "The terminal ID of the peer agent to message (e.g. from quay_list_agents)."
                                },
                                "message": {
                                    "type": "string",
                                    "description": "The prompt or task instruction to dispatch to the peer agent."
                                },
                                "wait_for_reply": {
                                    "type": "boolean",
                                    "description": "If true (default), waits up to 60s for the peer to complete its turn and returns its reply. A wait on a listener returns at once."
                                }
                            },
                            "required": ["target_terminal_id", "message"]
                        }
                    },
                    {
                        "name": "quay_broadcast",
                        "description": "Broadcast a notification or status update to every running peer in Quay. Shell and Archon terminals are skipped.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "text": {
                                    "type": "string",
                                    "description": "The notice text to broadcast."
                                }
                            },
                            "required": ["text"]
                        }
                    },
                    {
                        "name": "quay_get_agent_status",
                        "description": "Check the live status and auto-approved action count of a specific peer agent in Quay.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "terminal_id": {
                                    "type": "string",
                                    "description": "The terminal ID of the agent."
                                }
                            },
                            "required": ["terminal_id"]
                        }
                    },
                    {
                        "name": "machina_submit_work_order",
                        "description": "Submit a work order to Machina, Quay's software factory. Machina creates a git worktree and branch for it under .machina/worktrees/ and vaults .machina/holdbacks/. A human launches the author agent and merges the result.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "project_path": { "type": "string", "description": "Any path inside the git repository." },
                                "title": { "type": "string" },
                                "objective": { "type": "string", "description": "What the author agent must do." },
                                "allowed_output_paths": {
                                    "type": "array",
                                    "items": { "type": "string" },
                                    "description": "Repo-relative globs the author may change, e.g. src/slices/auth/**."
                                },
                                "base_branch": { "type": "string", "description": "Defaults to the main checkout's current branch." },
                                "author_agent": { "type": "string", "description": "Agent CLI that will do the work, e.g. claude. Defaults to claude." },
                                "max_corrections": { "type": "integer", "minimum": 0, "maximum": 10 },
                                "budget_usd": { "type": "number", "exclusiveMinimum": 0 },
                                "depends_on": { "type": "array", "items": { "type": "string" } }
                            },
                            "required": ["project_path", "title", "objective", "allowed_output_paths", "budget_usd"]
                        }
                    },
                    {
                        "name": "machina_get_work_order",
                        "description": "Read a Machina work order: objective, allowed and protected paths, attempts, and the latest gate findings. Holdback (Tier 2) details are withheld.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "work_order_id": { "type": "string", "description": "e.g. WO-3" }
                            },
                            "required": ["work_order_id"]
                        }
                    },
                    {
                        "name": "machina_submit_deliverable",
                        "description": "Submit your work on a Machina work order to the gate. The gate commits the worktree, checks changed paths, runs the pre-PR audit and the project's configured build, test and holdback commands. It runs in the background; when you are the work order's author terminal, the verdict is typed into your terminal when it finishes.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "work_order_id": { "type": "string", "description": "e.g. WO-3" }
                            },
                            "required": ["work_order_id"]
                        }
                    }
                ]
            });

            Json(JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                id,
                result: Some(tools),
                error: None,
            })
            .into_response()
        }

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
                    let target_id = arguments
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

                    if target_id.is_empty() || message.is_empty() {
                        Err("Missing target_terminal_id or message argument".to_string())
                    } else {
                        let request = A2ADispatchRequest {
                            from_terminal: caller_id.to_string(),
                            to_terminal: target_id.to_string(),
                            prompt: message.to_string(),
                            as_user: Some(false),
                        };

                        if wait {
                            match a2a_router
                                .dispatch_and_wait(request, Some(&ctx.pty_manager), 60)
                                .await
                            {
                                Ok(outcome) => {
                                    if let Some(msg) = a2a_router
                                        .get_messages()
                                        .into_iter()
                                        .rev()
                                        .find(|m| m.to_terminal == target_id || m.from_terminal == caller_id)
                                    {
                                        let _ = ctx.app_handle.emit("a2a-message-updated", msg.clone());
                                        let _ = ctx.app_handle.emit("a2a-message-dispatched", msg);
                                    }
                                    let text = match outcome {
                                        WaitOutcome::Reply(reply) => {
                                            format!("Reply from {}:\n{}", target_id, reply)
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
                            match a2a_router.dispatch(request, Some(&ctx.pty_manager)) {
                                Ok(msg) => {
                                    let _ = ctx.app_handle.emit("a2a-message-updated", msg.clone());
                                    let _ = ctx.app_handle.emit("a2a-message-dispatched", msg);
                                    Ok(json!({
                                        "content": [
                                            {
                                                "type": "text",
                                                "text": format!("Successfully dispatched task to {}.", target_id)
                                            }
                                        ]
                                    }))
                                }
                                Err(e) => Err("Failed to dispatch task: ".to_string() + &e),
                            }
                        }
                    }
                }

                "quay_broadcast" => {
                    let text = arguments.get("text").and_then(|v| v.as_str()).unwrap_or("");
                    if text.is_empty() {
                        Err("Missing text argument".to_string())
                    } else {
                        let msgs = a2a_router.broadcast_toast(text, &ctx.pty_manager);
                        for msg in &msgs {
                            let _ = ctx.app_handle.emit("a2a-message-updated", msg.clone());
                            let _ = ctx.app_handle.emit("a2a-message-dispatched", msg.clone());
                        }
                        let _ = ctx.app_handle.emit("a2a-toast", text.to_string());
                        Ok(json!({
                            "content": [
                                {
                                    "type": "text",
                                    "text": format!("Broadcasted notice to all active agents: {}", text)
                                }
                            ]
                        }))
                    }
                }

                "quay_get_agent_status" => {
                    let target_id = arguments
                        .get("terminal_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");

                    if let Some(info) = ctx.pty_manager.get_info(target_id) {
                        Ok(json!({
                            "content": [
                                {
                                    "type": "text",
                                    "text": format!(
                                        "Agent {}: name='{}', level={}, status={:?}, task='{}', tool='{}', auto_approved={}, project='{}'",
                                        info.id,
                                        info.name,
                                        info.bus_level().map_or("not a peer", |level| level.as_str()),
                                        info.claude_status,
                                        info.task_title.as_deref().unwrap_or("none"),
                                        info.current_tool.as_deref().unwrap_or("none"),
                                        info.auto_approved_count,
                                        info.project_path
                                    )
                                }
                            ]
                        }))
                    } else {
                        Err(format!("Agent '{}' not found", target_id))
                    }
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
