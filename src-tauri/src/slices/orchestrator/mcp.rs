use std::sync::Arc;
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::Emitter;

use super::models::A2ADispatchRequest;
use super::router::A2ARouter;
use crate::slices::bridge::routes::AppContext;
use crate::slices::pty::models::ClaudeStatus;

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
    headers: HeaderMap,
    Json(req): Json<JsonRpcRequest>,
) -> Response {
    let id = req.id.unwrap_or(Value::Null);

    // Identify calling terminal from Authorization Bearer token
    let caller_token = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "));

    let caller_id = caller_token
        .and_then(|token| {
            ctx.pty_manager.list().into_iter().find(|t| {
                ctx.bridge_state.verify_token(&t.id, token)
            })
        })
        .map(|t| t.id)
        .unwrap_or_else(|| "agent".to_string());

    match req.method.as_str() {
        "initialize" => {
            if caller_id != "agent" {
                ctx.pty_manager.update_status(&caller_id, ClaudeStatus::Idle);
                let _ = ctx.app_handle.emit(
                    "bridge-event",
                    crate::slices::bridge::Envelope {
                        v: 1,
                        boot: "".to_string(),
                        seq: 0,
                        ts: std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as u64,
                        session_id: caller_id.clone(),
                        tag: Some(caller_id.clone()),
                        event_type: "session.started".to_string(),
                        data: serde_json::Value::Null,
                    },
                );
            }

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
                        "description": "List all active agents and terminals hosted in Quay, including their IDs, labels, run kind, and live status (Working, Idle, Waiting, etc.).",
                        "inputSchema": {
                            "type": "object",
                            "properties": {}
                        }
                    },
                    {
                        "name": "quay_send_message",
                        "description": "Send a prompt or task delegation to another agent in Quay. Can optionally wait for the agent to finish their turn and return their reply directly to you.",
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
                                    "description": "If true (default), waits up to 60s for the peer agent to complete their turn and returns their answer."
                                }
                            },
                            "required": ["target_terminal_id", "message"]
                        }
                    },
                    {
                        "name": "quay_broadcast",
                        "description": "Broadcast a notification or status update to all active Claude Code agents running in Quay.",
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
                        .map(|t| {
                            json!({
                                "terminal_id": t.id,
                                "name": t.name,
                                "task_title": t.task_title,
                                "run_kind": t.run_kind,
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
                            from_terminal: caller_id.clone(),
                            to_terminal: target_id.to_string(),
                            prompt: message.to_string(),
                            as_user: Some(false),
                        };

                        if wait {
                            match a2a_router
                                .dispatch_and_wait(request, &ctx.bridge_state, 60)
                                .await
                            {
                                Ok(reply) => {
                                    if let Some(msg) = a2a_router
                                        .get_messages()
                                        .into_iter()
                                        .rev()
                                        .find(|m| m.to_terminal == target_id)
                                    {
                                        let _ = ctx.app_handle.emit("a2a-message-updated", msg);
                                    }
                                    Ok(json!({
                                        "content": [
                                            {
                                                "type": "text",
                                                "text": format!("Reply from {}:\n{}", target_id, reply)
                                            }
                                        ]
                                    }))
                                }
                                Err(e) => Err("Failed waiting for agent reply: ".to_string() + &e),
                            }
                        } else {
                            match a2a_router.dispatch(request, &ctx.bridge_state) {
                                Ok(msg) => {
                                    let _ = ctx.app_handle.emit("a2a-message-updated", msg);
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
                        a2a_router.broadcast_toast(text, &ctx.bridge_state, &ctx.pty_manager);
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
                                        "Agent {}: name='{}', status={:?}, task='{}', tool='{}', auto_approved={}, project='{}'",
                                        info.id,
                                        info.name,
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
