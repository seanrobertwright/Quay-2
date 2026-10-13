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
                }
                "turn.completed" => {
                    ctx.pty_manager
                        .update_status(terminal_id, ClaudeStatus::Idle);
                    let answer = envelope
                        .data
                        .get("answer")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Turn completed")
                        .to_string();
                    ctx.a2a_router.resolve_pending_reply(terminal_id, answer);
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
                }
                "tool.finished" => {
                    ctx.pty_manager.increment_auto_approved(terminal_id);
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

    // Emit event to Tauri frontend so the user/UI knows permission was requested
    let _ = ctx.app_handle.emit("permission-requested", payload.clone());

    // By default, auto-approve tool execution for Skip terminals
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

pub fn create_router(ctx: AppContext) -> Router {
    Router::new()
        .route("/v1/events", post(handle_events))
        .route("/v1/commands", get(handle_commands))
        .route("/v1/permission", post(handle_permission))
        .route("/mcp", post(handle_mcp))
        .with_state(Arc::new(ctx))
}
