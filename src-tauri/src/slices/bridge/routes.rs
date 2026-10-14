use std::sync::Arc;
use std::time::Duration;
use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use tauri::{AppHandle, Emitter};

use super::models::{
    CommandsResponse, EventsBatchRequest, PermissionRequestPayload, PermissionResponsePayload,
};
use super::state::BridgeState;
use crate::slices::orchestrator::A2ARouter;
use crate::slices::pty::manager::PtyManager;
use crate::slices::pty::models::ClaudeStatus;

#[derive(Clone)]
pub struct AppContext {
    pub bridge_state: BridgeState,
    pub pty_manager: PtyManager,
    pub a2a_router: A2ARouter,
    pub app_handle: AppHandle,
}

#[derive(Debug, Deserialize)]
pub struct CommandsQuery {
    pub session: Option<String>,
    pub tag: Option<String>,
    pub after: Option<String>,
}

fn validate_host_and_origin(headers: &HeaderMap) -> Result<(), (StatusCode, &'static str)> {
    if headers.contains_key("origin") {
        return Err((StatusCode::FORBIDDEN, "Forbidden: Origin header not allowed"));
    }
    if let Some(host) = headers.get("host").and_then(|h| h.to_str().ok()) {
        if !host.starts_with("127.0.0.1") && !host.starts_with("localhost") {
            return Err((StatusCode::FORBIDDEN, "Forbidden: Host must be loopback"));
        }
    }
    Ok(())
}

fn extract_bearer_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|auth| auth.strip_prefix("Bearer "))
}

pub async fn handle_events(
    State(ctx): State<Arc<AppContext>>,
    headers: HeaderMap,
    Json(payload): Json<EventsBatchRequest>,
) -> Result<Response, (StatusCode, &'static str)> {
    validate_host_and_origin(&headers)?;

    for envelope in payload.events {
        let tag = envelope.tag.clone();
        ctx.bridge_state.record_envelope(envelope.clone());

        // Update Claude Status based on event type
        if let Some(ref terminal_id) = tag {
            match envelope.event_type.as_str() {
                "turn.started" => {
                    ctx.pty_manager
                        .update_status(terminal_id, ClaudeStatus::Working);
                    if let Some(prompt) = envelope
                        .data
                        .get("prompt")
                        .or_else(|| envelope.data.get("text"))
                        .or_else(|| envelope.data.get("query"))
                        .or_else(|| envelope.data.get("user_input"))
                        .and_then(|v| v.as_str())
                    {
                        let clean = prompt
                            .lines()
                            .next()
                            .unwrap_or("")
                            .trim();
                        if !clean.is_empty() {
                            let shortened: String = clean.chars().take(32).collect();
                            ctx.pty_manager.update_task_title(terminal_id, &shortened);
                        }
                    }
                }
                "turn.completed" => {
                    ctx.pty_manager
                        .update_status(terminal_id, ClaudeStatus::Idle);
                    ctx.pty_manager.update_current_tool(terminal_id, None);
                    let answer = envelope
                        .data
                        .get("answer")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Turn completed")
                        .to_string();
                    if let Some(msg) = ctx.a2a_router.resolve_pending_reply(terminal_id, answer) {
                        let _ = ctx.app_handle.emit("a2a-message-updated", msg);
                    }
                }
                "tool.started" => {
                    ctx.pty_manager
                        .update_status(terminal_id, ClaudeStatus::Working);
                    let tool = envelope
                        .data
                        .get("tool")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Tool");
                    ctx.pty_manager.update_current_tool(terminal_id, Some(tool.to_string()));
                }
                "tool.finished" => {
                    ctx.pty_manager.increment_auto_approved(terminal_id);
                    ctx.pty_manager.update_current_tool(terminal_id, None);
                }
                "attention.notification" => {
                    ctx.pty_manager
                        .update_status(terminal_id, ClaudeStatus::Waiting);
                }
                "session.started" => {
                    ctx.pty_manager
                        .update_status(terminal_id, ClaudeStatus::Idle);
                }
                "session.ended" => {
                    ctx.pty_manager
                        .update_status(terminal_id, ClaudeStatus::Exited);
                    ctx.pty_manager.update_current_tool(terminal_id, None);
                }
                _ => {}
            }
        }

        // Broadcast to Tauri frontend
        let _ = ctx.app_handle.emit("bridge-event", envelope);
    }

    Ok(StatusCode::OK.into_response())
}

pub async fn handle_commands(
    State(ctx): State<Arc<AppContext>>,
    headers: HeaderMap,
    Query(query): Query<CommandsQuery>,
) -> Result<Response, (StatusCode, &'static str)> {
    validate_host_and_origin(&headers)?;

    let tag = query
        .tag
        .as_deref()
        .ok_or((StatusCode::BAD_REQUEST, "Missing 'tag' parameter"))?;

    let token = extract_bearer_token(&headers)
        .ok_or((StatusCode::UNAUTHORIZED, "Missing or invalid Authorization header"))?;

    if !ctx.bridge_state.verify_token(tag, token) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid Bearer token"));
    }

    // Check if commands are already in queue
    let existing = ctx.bridge_state.drain_commands(tag);
    if !existing.is_empty() {
        return Ok(Json(CommandsResponse { commands: existing }).into_response());
    }

    // Long-poll: wait up to 25 seconds for a command
    let notifier = ctx.bridge_state.get_notifier(tag);
    match tokio::time::timeout(Duration::from_secs(25), notifier.notified()).await {
        Ok(_) => {
            let commands = ctx.bridge_state.drain_commands(tag);
            if commands.is_empty() {
                Ok(StatusCode::NO_CONTENT.into_response())
            } else {
                Ok(Json(CommandsResponse { commands }).into_response())
            }
        }
        Err(_) => {
            // Timeout reached: return 204 No Content
            Ok(StatusCode::NO_CONTENT.into_response())
        }
    }
}

pub async fn handle_permission(
    State(ctx): State<Arc<AppContext>>,
    headers: HeaderMap,
    Json(payload): Json<PermissionRequestPayload>,
) -> Result<Response, (StatusCode, &'static str)> {
    validate_host_and_origin(&headers)?;

    let tag = payload.tag.as_deref().unwrap_or("");
    if let Some(token) = extract_bearer_token(&headers) {
        if !ctx.bridge_state.verify_token(tag, token) {
            return Err((StatusCode::UNAUTHORIZED, "Invalid Bearer token"));
        }
    }

    // Check terminal permission mode
    let term_info = ctx.pty_manager.get_info(tag);
    let is_normal = term_info
        .as_ref()
        .map(|t| t.live_mode == crate::slices::pty::models::PermissionMode::Normal)
        .unwrap_or(false);

    // If Normal mode and not already allowed for session, wait for human approval
    if is_normal && !ctx.bridge_state.is_tool_allowed_for_session(tag, &payload.tool) {
        ctx.pty_manager.update_status(tag, ClaudeStatus::Waiting);
        ctx.pty_manager
            .update_current_tool(tag, Some(payload.tool.clone()));

        let (tx, rx) = tokio::sync::oneshot::channel();
        ctx.bridge_state.register_pending_permission(
            payload.request_id.clone(),
            payload.clone(),
            tx,
        );

        // Broadcast to frontend modal
        let _ = ctx.app_handle.emit("permission-requested", payload.clone());

        // Wait up to 10 minutes (600 seconds) for user decision
        let result = match tokio::time::timeout(Duration::from_secs(600), rx).await {
            Ok(Ok(resp)) => resp,
            Ok(Err(_)) => PermissionResponsePayload {
                decision: "deny".to_string(),
                reason: Some("Permission request channel cancelled".to_string()),
            },
            Err(_) => {
                ctx.bridge_state
                    .remove_pending_permission(&payload.request_id);
                PermissionResponsePayload {
                    decision: "deny".to_string(),
                    reason: Some("Timed out waiting for human approval".to_string()),
                }
            }
        };

        if result.decision == "allow" {
            ctx.pty_manager.update_status(tag, ClaudeStatus::Working);
            ctx.pty_manager.increment_auto_approved(tag);
        } else {
            ctx.pty_manager.update_status(tag, ClaudeStatus::Idle);
        }

        let _ = ctx.app_handle.emit(
            "permission-resolved",
            serde_json::json!({
                "requestId": payload.request_id,
                "decision": result.decision,
                "tool": payload.tool,
                "tag": tag,
            }),
        );

        return Ok(Json(result).into_response());
    }

    // Auto-approve for Skip mode or if tool was previously allowed for session
    ctx.pty_manager.increment_auto_approved(tag);
    let _ = ctx.app_handle.emit("permission-requested", payload.clone());
    let _ = ctx.app_handle.emit(
        "permission-resolved",
        serde_json::json!({
            "requestId": payload.request_id,
            "decision": "allow",
            "tool": payload.tool,
            "tag": tag,
        }),
    );

    let response = PermissionResponsePayload {
        decision: "allow".to_string(),
        reason: None,
    };

    Ok(Json(response).into_response())
}

pub async fn handle_mcp(
    State(ctx): State<Arc<AppContext>>,
    headers: HeaderMap,
    Json(req): Json<crate::slices::orchestrator::mcp::JsonRpcRequest>,
) -> Response {
    let a2a = Arc::new(ctx.a2a_router.clone());
    crate::slices::orchestrator::mcp::handle_mcp_request(State(ctx), State(a2a), headers, Json(req)).await
}

pub async fn handle_mcp_get() -> Response {
    (
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        r#"{"name":"quay-a2a","status":"ready"}"#,
    )
        .into_response()
}

pub fn create_router(ctx: AppContext) -> Router {
    Router::new()
        .route("/v1/events", post(handle_events))
        .route("/v1/commands", get(handle_commands))
        .route("/v1/permission", post(handle_permission))
        .route("/mcp", post(handle_mcp).get(handle_mcp_get))
        .with_state(Arc::new(ctx))
}
