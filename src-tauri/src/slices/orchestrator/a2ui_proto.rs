//! PROTOTYPE (#693), throwaway. The roughest surface round trip: an agent hands A2UI 1.0
//! messages to `quay_surface_proto`, the call waits for the operator's click, and an answer
//! that comes after the wait is typed into the terminal. None of this is the build.
//! #708 adds the spec's 100 s wait, an `isError` rejection and an `instructions` text.

use std::collections::HashMap;
use std::io::Write;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::oneshot;

use super::models::A2ADispatchRequest;
use super::router::A2ARouter;
use crate::slices::bridge::routes::AppContext;
use crate::slices::pty::manager::PtyManager;

struct Surface {
    terminal_id: String,
    started: Instant,
    /// Present while the hand-over call is still open and waiting.
    waiter: Option<oneshot::Sender<String>>,
}

static NEXT: AtomicU64 = AtomicU64::new(1);

fn surfaces() -> &'static Mutex<HashMap<String, Surface>> {
    static SURFACES: OnceLock<Mutex<HashMap<String, Surface>>> = OnceLock::new();
    SURFACES.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Sends a UTC-stamped line to the prototype's log, the file `QUAY_A2UI_PROTO_LOG` names.
/// Without the variable nothing is written, because a line can hold a whole turn's answer.
/// The file is written on a thread of its own, so this never blocks.
pub fn log(line: &str) {
    static LINES: OnceLock<Option<mpsc::Sender<String>>> = OnceLock::new();
    let Some(lines) = LINES.get_or_init(start_log) else { return };
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let day = now.as_secs() % 86_400;
    let stamp = format!(
        "{:02}:{:02}:{:02}.{:03}",
        day / 3600,
        day % 3600 / 60,
        day % 60,
        now.subsec_millis()
    );
    // It fails only when the writer has ended, which says so itself
    let _ = lines.send(format!("{stamp} {line}"));
}

/// Starts the log's writer, or returns `None` when no log is asked for. The writer ends at the
/// first line it cannot write, and says so on stderr.
fn start_log() -> Option<mpsc::Sender<String>> {
    let path = std::env::var_os("QUAY_A2UI_PROTO_LOG")?;
    let (lines, queue) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        let written = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .and_then(|mut file| queue.iter().try_for_each(|line| writeln!(file, "{line}")));
        if let Err(e) = written {
            eprintln!("QUAY_A2UI_PROTO_LOG {path:?} is not being written: {e}");
        }
    });
    Some(lines)
}

/// The `instructions` text of Quay's handshake reply: the file `QUAY_A2UI_PROTO_INSTRUCTIONS`
/// names, read at each handshake. `None` without the variable; an error when the file cannot
/// be read or is blank.
pub fn instructions() -> Result<Option<String>, String> {
    let Some(path) = std::env::var_os("QUAY_A2UI_PROTO_INSTRUCTIONS") else { return Ok(None) };
    match std::fs::read_to_string(&path) {
        Ok(text) if text.trim().is_empty() => Err(format!("QUAY_A2UI_PROTO_INSTRUCTIONS {path:?} is blank")),
        Ok(text) => Ok(Some(text)),
        Err(e) => Err(format!("QUAY_A2UI_PROTO_INSTRUCTIONS {path:?}: {e}")),
    }
}

/// The `quay_reject_proto` tool: always the spec's rejection object, as an `isError` result.
/// The text has JSON quotes, line breaks, a non-ASCII character and a nonce, so a CLI that
/// rewrites it can be told from one that does not.
pub fn rejection(caller_id: &str) -> Value {
    let text = serde_json::to_string_pretty(&json!({
        "errors": [{
            "code": "VALIDATION_FAILED",
            "surfaceId": "plan",
            "path": "/messages/1/updateComponents/components/2/variant",
            "message": "A title is at most 80 characters; this one is 96 \u{2014} nonce zebra-4471."
        }],
        "next": "Nothing was changed. Correct the call and send all of it again. quay_surface_guide lists the components, their properties and examples."
    }))
    .unwrap_or_default();
    log(&format!("REJECTING a call from {caller_id} with isError, text {text:?}"));
    json!({ "content": [{ "type": "text", "text": text }], "isError": true })
}

/// Logs when the hand-over future is dropped before it finished, which is how axum shows a
/// client that closed its connection while the call waited.
struct CallGuard {
    id: String,
    started: Instant,
    finished: bool,
    app: AppHandle,
}

impl Drop for CallGuard {
    fn drop(&mut self) {
        if self.finished {
            return;
        }
        if let Some(surface) = surfaces().lock().get_mut(&self.id) {
            surface.waiter = None;
        }
        log(&format!(
            "{} CALL DROPPED: the client closed the connection after {:.1}s of waiting",
            self.id,
            self.started.elapsed().as_secs_f32()
        ));
        let _ = self.app.emit("a2ui-proto-update", json!({ "id": self.id, "call": "closed by the CLI" }));
    }
}

/// The `quay_surface_proto` tool: shows the surface and waits `wait_seconds` for an answer.
pub async fn hand_over(ctx: &AppContext, caller_id: &str, arguments: &Value) -> Result<Value, String> {
    let messages = arguments
        .get("messages")
        .filter(|m| m.is_array())
        .cloned()
        .ok_or("messages must be an array of A2UI 1.0 messages")?;
    let wait = arguments.get("wait_seconds").and_then(Value::as_u64).unwrap_or(100);
    let id = format!("s-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let (tx, rx) = oneshot::channel();
    surfaces().lock().insert(
        id.clone(),
        Surface { terminal_id: caller_id.to_string(), started: Instant::now(), waiter: Some(tx) },
    );
    let name = ctx.pty_manager.get_info(caller_id).map(|t| t.name).unwrap_or_default();
    log(&format!(
        "{id} CALL from {caller_id} ({name}) wait={wait}s args_bytes={}",
        arguments.to_string().len()
    ));
    let _ = ctx.app_handle.emit(
        "a2ui-proto-surface",
        json!({
            "id": id,
            "terminal_id": caller_id,
            "terminal_name": name,
            "messages": messages,
            "wait_seconds": wait
        }),
    );

    let mut guard =
        CallGuard { id: id.clone(), started: Instant::now(), finished: false, app: ctx.app_handle.clone() };
    let outcome = tokio::time::timeout(Duration::from_secs(wait), rx).await;
    guard.finished = true;
    let waited = guard.started.elapsed().as_secs_f32();

    let text = match outcome {
        Ok(Ok(action)) => {
            log(&format!("{id} RETURNING the action as the call's result after {waited:.1}s"));
            let action: Value = serde_json::from_str(&action).unwrap_or(Value::String(action));
            json!({ "surface_id": id, "status": "answered", "answer": action }).to_string()
        }
        _ => {
            if let Some(surface) = surfaces().lock().get_mut(&id) {
                surface.waiter = None;
            }
            log(&format!("{id} WAIT RAN OUT after {waited:.1}s, returning 'no answer yet'"));
            let _ = ctx.app_handle.emit("a2ui-proto-update", json!({ "id": id, "call": "wait ran out" }));
            format!(
                "No answer yet. Surface {id} is still on the operator's screen. End your turn now and do \
                 not call this tool again. When the operator answers, Quay types the answer into this \
                 terminal as a message that starts with [Quay surface {id}]."
            )
        }
    };
    Ok(json!({ "content": [{ "type": "text", "text": text }] }))
}

/// The operator's click. Returns the answer through the waiting call when there is one, and
/// otherwise types it into the terminal the way an operator's A2A message is typed.
#[tauri::command]
pub async fn a2ui_proto_answer(
    id: String,
    action: String,
    router: State<'_, A2ARouter>,
    pty_manager: State<'_, PtyManager>,
) -> Result<String, String> {
    let (terminal_id, waiter, age) = {
        let mut all = surfaces().lock();
        let surface = all.get_mut(&id).ok_or("No such surface")?;
        (surface.terminal_id.clone(), surface.waiter.take(), surface.started.elapsed().as_secs_f32())
    };
    log(&format!("{id} OPERATOR ANSWERED {age:.1}s after the call: {action}"));
    if let Some(tx) = waiter {
        if tx.send(action.clone()).is_ok() {
            return Ok("returned as the call's result".to_string());
        }
        log(&format!("{id} the waiting call was already gone"));
    }
    let request = A2ADispatchRequest {
        from_terminal: "user".to_string(),
        to_terminal: terminal_id,
        prompt: format!("[Quay surface {id}] The operator answered your surface: {action}"),
        as_user: Some(true),
    };
    let message = router.dispatch_async(request, Some(&pty_manager)).await?;
    log(&format!("{id} TYPED INTO THE TERMINAL, trail status {:?}", message.status));
    Ok(format!("typed into the terminal ({:?})", message.status))
}
