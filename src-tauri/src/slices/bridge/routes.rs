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
    CommandsResponse, Envelope, EventsBatchRequest, PermissionRequestPayload,
    PermissionResponsePayload,
};
use super::state::BridgeState;
use crate::slices::machina::MachinaManager;
use crate::slices::orchestrator::A2ARouter;
use crate::slices::pty::manager::PtyManager;
use crate::slices::pty::models::ClaudeStatus;

#[derive(Clone)]
pub struct AppContext {
    pub bridge_state: BridgeState,
    pub pty_manager: PtyManager,
    pub a2a_router: A2ARouter,
    pub machina_manager: MachinaManager,
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

/// Runs the loopback host and origin check, then returns the request's bearer token.
fn loopback_bearer(headers: &HeaderMap) -> Result<&str, (StatusCode, &'static str)> {
    validate_host_and_origin(headers)?;
    extract_bearer_token(headers)
        .ok_or((StatusCode::UNAUTHORIZED, "Missing or invalid Authorization header"))
}

/// Checks a `/v1/events` batch before any of it is applied: the request must be
/// loopback, carry a bearer token, and every event's `tag` must name the terminal
/// that token belongs to. One failing event rejects the whole batch.
pub fn authorize_events(
    bridge_state: &BridgeState,
    headers: &HeaderMap,
    events: &[Envelope],
) -> Result<(), (StatusCode, &'static str)> {
    let token = loopback_bearer(headers)?;

    for envelope in events {
        let tag = envelope.tag.as_deref().unwrap_or("");
        if !bridge_state.verify_token(tag, token) {
            return Err((StatusCode::UNAUTHORIZED, "Invalid Bearer token"));
        }
    }
    Ok(())
}

/// The id of a terminal whose bearer token an `/mcp` call carried. Only
/// `authenticate_mcp_caller` can build one, so code that takes it cannot skip that check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthenticatedTerminal(String);

impl AuthenticatedTerminal {
    pub fn id(&self) -> &str {
        &self.0
    }
}

/// Identifies the terminal behind an `/mcp` call: the request must be loopback and
/// carry the bearer token of one of `terminal_ids`. Returns that terminal.
pub fn authenticate_mcp_caller(
    bridge_state: &BridgeState,
    headers: &HeaderMap,
    terminal_ids: impl IntoIterator<Item = String>,
) -> Result<AuthenticatedTerminal, (StatusCode, &'static str)> {
    let token = loopback_bearer(headers)?;

    terminal_ids
        .into_iter()
        .find(|id| bridge_state.verify_token(id, token))
        .map(AuthenticatedTerminal)
        .ok_or((StatusCode::UNAUTHORIZED, "Invalid Bearer token"))
}

pub async fn handle_events(
    State(ctx): State<Arc<AppContext>>,
    headers: HeaderMap,
    Json(payload): Json<EventsBatchRequest>,
) -> Result<Response, (StatusCode, &'static str)> {
    authorize_events(&ctx.bridge_state, &headers, &payload.events)?;

    for envelope in payload.events {
        let tag = envelope.tag.clone();
        ctx.bridge_state.record_envelope(envelope.clone());

        let mut status = None;
        if let Some(ref terminal_id) = tag {
            status = ctx
                .pty_manager
                .apply_plugin_event(terminal_id, &envelope.event_type);
            match envelope.event_type.as_str() {
                "turn.started" => {
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
                "session.ended" => {
                    ctx.pty_manager.update_current_tool(terminal_id, None);
                }
                _ => {}
            }
        }

        // Broadcast to Tauri frontend. The status follows the event, so it is what the pane ends on.
        let _ = ctx.app_handle.emit("bridge-event", envelope);
        if let Some(status) = status {
            let _ = ctx.app_handle.emit("terminal-status", status);
        }
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
    let terminal_ids = ctx.pty_manager.list().into_iter().map(|t| t.id);
    let caller = match authenticate_mcp_caller(&ctx.bridge_state, &headers, terminal_ids) {
        Ok(id) => id,
        Err(rejection) => return rejection.into_response(),
    };
    let a2a = Arc::new(ctx.a2a_router.clone());
    crate::slices::orchestrator::mcp::handle_mcp_request(State(ctx), State(a2a), caller, Json(req)).await
}

pub async fn handle_mcp_get(headers: HeaderMap) -> Response {
    if let Err(rejection) = validate_host_and_origin(&headers) {
        return rejection.into_response();
    }
    (
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        r#"{"name":"quay-a2a","status":"ready"}"#,
    )
        .into_response()
}

pub async fn handle_machina_agent_card(State(ctx): State<Arc<AppContext>>) -> Response {
    let port = ctx.bridge_state.port();
    let card = ctx.machina_manager.get_a2a_agent_card(port);
    Json(card).into_response()
}

pub fn create_router(ctx: AppContext) -> Router {
    Router::new()
        .route("/v1/events", post(handle_events))
        .route("/v1/commands", get(handle_commands))
        .route("/v1/permission", post(handle_permission))
        .route("/mcp", post(handle_mcp).get(handle_mcp_get))
        .route("/.well-known/agent.json", get(handle_machina_agent_card))
        .route("/a2a/machina-praxis", get(handle_machina_agent_card))
        .with_state(Arc::new(ctx))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event_for(tag: &str) -> Envelope {
        Envelope {
            v: 1,
            boot: "boot-1".to_string(),
            seq: 1,
            ts: 0,
            session_id: "sess-1".to_string(),
            tag: Some(tag.to_string()),
            event_type: "turn.completed".to_string(),
            data: serde_json::json!({ "answer": "done" }),
        }
    }

    fn loopback_headers(token: Option<&str>) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert("host", "127.0.0.1:4000".parse().unwrap());
        if let Some(token) = token {
            headers.insert("authorization", format!("Bearer {}", token).parse().unwrap());
        }
        headers
    }

    #[test]
    fn events_without_a_token_are_unauthorized() {
        let state = BridgeState::new();
        state.token_for("term-a");

        let result = authorize_events(&state, &loopback_headers(None), &[event_for("term-a")]);

        assert_eq!(result.unwrap_err().0, StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn events_with_a_wrong_token_are_unauthorized() {
        let state = BridgeState::new();
        state.token_for("term-a");

        let result = authorize_events(
            &state,
            &loopback_headers(Some("not-the-token")),
            &[event_for("term-a")],
        );

        assert_eq!(result.unwrap_err().0, StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn events_tagged_as_another_terminal_are_unauthorized() {
        let state = BridgeState::new();
        let token_a = state.token_for("term-a");
        state.token_for("term-b");

        let result = authorize_events(
            &state,
            &loopback_headers(Some(&token_a)),
            &[event_for("term-b")],
        );

        assert_eq!(result.unwrap_err().0, StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn a_batch_with_one_foreign_event_is_rejected_whole() {
        let state = BridgeState::new();
        let token_a = state.token_for("term-a");
        state.token_for("term-b");

        let result = authorize_events(
            &state,
            &loopback_headers(Some(&token_a)),
            &[event_for("term-a"), event_for("term-b")],
        );

        assert_eq!(result.unwrap_err().0, StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn events_with_their_terminals_token_are_accepted() {
        let state = BridgeState::new();
        let token_a = state.token_for("term-a");
        state.token_for("term-b");

        let result = authorize_events(
            &state,
            &loopback_headers(Some(&token_a)),
            &[event_for("term-a"), event_for("term-a")],
        );

        assert!(result.is_ok());
    }

    #[test]
    fn mcp_calls_without_a_token_are_unauthorized() {
        let state = BridgeState::new();
        state.token_for("term-a");

        let result = authenticate_mcp_caller(&state, &loopback_headers(None), ["term-a".to_string()]);

        assert_eq!(result.unwrap_err().0, StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn mcp_calls_with_an_unknown_token_are_unauthorized() {
        let state = BridgeState::new();
        state.token_for("term-a");

        let result = authenticate_mcp_caller(
            &state,
            &loopback_headers(Some("not-the-token")),
            ["term-a".to_string()],
        );

        assert_eq!(result.unwrap_err().0, StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn mcp_calls_from_a_browser_origin_are_forbidden() {
        let state = BridgeState::new();
        let token_a = state.token_for("term-a");
        let mut headers = loopback_headers(Some(&token_a));
        headers.insert("origin", "http://evil.example".parse().unwrap());

        let result = authenticate_mcp_caller(&state, &headers, ["term-a".to_string()]);

        assert_eq!(result.unwrap_err().0, StatusCode::FORBIDDEN);
    }

    #[test]
    fn mcp_calls_to_a_non_loopback_host_are_forbidden() {
        let state = BridgeState::new();
        let token_a = state.token_for("term-a");
        let mut headers = loopback_headers(Some(&token_a));
        headers.insert("host", "evil.example:4000".parse().unwrap());

        let result = authenticate_mcp_caller(&state, &headers, ["term-a".to_string()]);

        assert_eq!(result.unwrap_err().0, StatusCode::FORBIDDEN);
    }

    #[test]
    fn mcp_calls_are_attributed_to_the_terminal_whose_token_they_carry() {
        let state = BridgeState::new();
        state.token_for("term-a");
        let token_b = state.token_for("term-b");

        let result = authenticate_mcp_caller(
            &state,
            &loopback_headers(Some(&token_b)),
            ["term-a".to_string(), "term-b".to_string()],
        );

        assert_eq!(result.unwrap().id(), "term-b");
    }
}
