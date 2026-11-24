//! PROTOTYPE (#711), throwaway. One typed surface in the running app: the call is checked by the
//! webview, the accepted state, the revision and the unsent answer are kept here in memory, and
//! the webview asks for the whole list when it loads. None of this is the build.

use std::collections::HashMap;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde_json::{Map, Value, json};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

use super::a2ui_proto::log;
use crate::slices::bridge::routes::AppContext;

/// The spec's limit on a verdict, and on a wait unless `A2UI711_WAIT_S` says otherwise.
const VERDICT_LIMIT: Duration = Duration::from_secs(5);
const WAIT_SECONDS: u64 = 100;

struct Surface {
    order: u64,
    terminal_id: String,
    terminal_name: String,
    id: String,
    tool: String,
    place: String,
    title: Option<String>,
    /// One compact `createSurface`, as the webview accepted it.
    state: Value,
    revision: u64,
    /// The data paths the agent's updates set, with the revision each came in.
    agent_sets: Vec<(u64, String)>,
    /// The unsent answer: data path to value, for what differs from `state`.
    draft: Map<String, Value>,
    settled: Option<Value>,
    asks: bool,
    waiter: Option<oneshot::Sender<String>>,
}

impl Surface {
    fn record(&self) -> Value {
        json!({
            "terminal_id": self.terminal_id,
            "terminal_name": self.terminal_name,
            "id": self.id,
            "tool": self.tool,
            "place": self.place,
            "title": self.title,
            "state": self.state,
            "revision": self.revision,
            "draft": self.draft,
            "settled": self.settled,
            "asks": self.asks,
        })
    }
}

/// Whether one of two JSON Pointers holds the other.
fn overlaps(a: &str, b: &str) -> bool {
    let (a, b) = (a.trim_end_matches('/'), b.trim_end_matches('/'));
    a == b || a.starts_with(&format!("{b}/")) || b.starts_with(&format!("{a}/"))
}

type Key = (String, String);
static NEXT_CALL: AtomicU64 = AtomicU64::new(1);
static NEXT_ORDER: AtomicU64 = AtomicU64::new(1);

fn surfaces() -> &'static Mutex<HashMap<Key, Surface>> {
    static S: OnceLock<Mutex<HashMap<Key, Surface>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Each check without a verdict: who waits for it, and the request itself, so a webview that
/// loads while one is out can be handed it again.
type Checks = HashMap<u64, (oneshot::Sender<Value>, Value)>;
fn verdicts() -> &'static Mutex<Checks> {
    static V: OnceLock<Mutex<Checks>> = OnceLock::new();
    V.get_or_init(|| Mutex::new(HashMap::new()))
}

fn checking() -> &'static tokio::sync::Mutex<()> {
    static C: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    C.get_or_init(|| tokio::sync::Mutex::new(()))
}

/// How long a call waits for its answer. A value that is not whole seconds above zero is refused.
fn wait_limit() -> Result<Duration, String> {
    let seconds = match std::env::var("A2UI711_WAIT_S") {
        Err(std::env::VarError::NotPresent) => WAIT_SECONDS,
        Err(e) => return Err(format!("A2UI711_WAIT_S: {e}")),
        Ok(s) => s
            .parse()
            .ok()
            .filter(|n| *n > 0)
            .ok_or_else(|| format!("A2UI711_WAIT_S must be whole seconds above zero, not {s:?}"))?,
    };
    Ok(Duration::from_secs(seconds))
}

fn text(body: Value, is_error: bool) -> Value {
    let mut out = json!({ "content": [{ "type": "text", "text": body.to_string() }] });
    if is_error {
        out["isError"] = true.into();
    }
    out
}

/// `quay_ask` and `quay_surface`: check in the webview, commit, show, and wait when it asks.
pub async fn call(
    ctx: &AppContext,
    caller_id: &str,
    tool: &str,
    arguments: &Value,
) -> Result<Value, String> {
    let wait = wait_limit()?;
    let name = ctx.pty_manager.get_info(caller_id).map(|t| t.name).unwrap_or_default();
    let typed = tool == "quay_ask";
    let key;
    let rx = {
        let _one_at_a_time = checking().lock().await;
        let typed_id = typed.then(|| {
            let all = surfaces().lock();
            (1..)
                .map(|n| format!("ask_{n}"))
                .find(|id| !all.contains_key(&(caller_id.to_string(), id.clone())))
                .unwrap_or_default()
        });
        let states: Map<String, Value> = surfaces()
            .lock()
            .iter()
            .filter(|((terminal, _), _)| terminal == caller_id)
            .map(|((_, id), s)| (id.clone(), s.state.clone()))
            .collect();

        let call = NEXT_CALL.fetch_add(1, Ordering::Relaxed);
        let (tx, verdict_rx) = oneshot::channel();
        let request = json!({
            "call": call, "tool": tool, "id": typed_id, "arguments": arguments, "states": states,
        });
        verdicts().lock().insert(call, (tx, request.clone()));
        let started = Instant::now();
        log(&format!("call {call} CHECK {tool} from {caller_id} bytes={}", arguments.to_string().len()));
        let _ = ctx.app_handle.emit("a2ui711-check", request);
        let verdict = tokio::time::timeout(VERDICT_LIMIT, verdict_rx).await;
        let ms = started.elapsed().as_secs_f64() * 1000.0;
        let verdict = match verdict {
            Ok(Ok(v)) => v,
            _ => {
                verdicts().lock().remove(&call);
                log(&format!("call {call} NO VERDICT after {ms:.1}ms"));
                return Ok(text(
                    json!(
                        "Quay could not show this; your call was not at fault. Nothing was shown. Send the same call once more."
                    ),
                    true,
                ));
            }
        };
        log(&format!(
            "call {call} VERDICT {ms:.1}ms (webview {}ms) components={} errors={} bytes={}",
            verdict["webview_ms"],
            verdict["components"],
            verdict["errors"],
            verdict.to_string().len()
        ));
        if verdict["errors"].is_array() {
            return Ok(text(json!({ "errors": verdict["errors"] }), true));
        }
        let id = verdict["id"].as_str().unwrap_or_default().to_string();
        key = (caller_id.to_string(), id.clone());
        let asks = verdict["asks"].as_bool().unwrap_or(false);
        let sets: Vec<String> = verdict["sets"]
            .as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
            .unwrap_or_default();
        let (tx, rx) = oneshot::channel();
        let record = {
            let mut all = surfaces().lock();
            let surface = all.entry(key.clone()).or_insert_with(|| Surface {
                order: NEXT_ORDER.fetch_add(1, Ordering::Relaxed),
                terminal_id: caller_id.to_string(),
                terminal_name: name.clone(),
                id: id.clone(),
                tool: tool.to_string(),
                place: arguments["place"].as_str().unwrap_or("companion").to_string(),
                title: arguments["title"].as_str().map(str::to_string),
                state: Value::Null,
                revision: 0,
                agent_sets: Vec::new(),
                draft: Map::new(),
                settled: None,
                asks,
                waiter: None,
            });
            surface.revision += 1;
            surface.state = verdict["state"].clone();
            surface.asks = asks;
            surface.settled = None;
            // An update keeps what the operator typed, except the paths it sets
            for path in &sets {
                surface.draft.retain(|typed, _| !overlaps(typed, path));
                surface.agent_sets.push((surface.revision, path.clone()));
            }
            surface.waiter = asks.then_some(tx);
            let mut record = surface.record();
            if !typed {
                record["messages"] = arguments["messages"].clone();
            }
            record
        };
        log(&format!("call {call} COMMIT {id} revision={} sets={sets:?}", record["revision"]));
        let _ = ctx.app_handle.emit("a2ui711-show", record);
        if !asks {
            return Ok(text(json!({ "shown": true }), false));
        }
        rx
    };

    match tokio::time::timeout(wait, rx).await {
        Ok(Ok(result)) => {
            log(&format!("{} RETURNED {result}", key.1));
            Ok(json!({ "content": [{ "type": "text", "text": result }] }))
        }
        _ => {
            log(&format!("{} NO ANSWER YET", key.1));
            Ok(text(json!({ "surface_id": key.1, "state": "no_answer_yet" }), false))
        }
    }
}

#[tauri::command]
pub fn a2ui711_verdict(call: u64, verdict: Value) {
    match verdicts().lock().remove(&call) {
        Some((tx, _)) => drop(tx.send(verdict)),
        None => log(&format!("call {call} LATE VERDICT dropped")),
    }
}

#[tauri::command]
pub fn a2ui711_list() -> Vec<Value> {
    let all = surfaces().lock();
    let mut rows: Vec<&Surface> = all.values().collect();
    rows.sort_by_key(|s| s.order);
    log(&format!("LIST {} surfaces", rows.len()));
    rows.into_iter().map(Surface::record).collect()
}

/// The checks without a verdict. A check is an event, and one sent while no page listens is lost,
/// so a page that has just loaded asks for what it missed.
#[tauri::command]
pub fn a2ui711_checks() -> Vec<Value> {
    let requests: Vec<Value> = verdicts().lock().values().map(|(_, request)| request.clone()).collect();
    if !requests.is_empty() {
        log(&format!("CHECKS {} handed over again", requests.len()));
    }
    requests
}

/// The unsent answer, whole, as of the revision the webview had drawn when it was read.
#[tauri::command]
pub fn a2ui711_draft(
    terminal_id: String,
    id: String,
    revision: u64,
    draft: Map<String, Value>,
    why: String,
) -> Result<(), String> {
    let mut all = surfaces().lock();
    let surface = all.get_mut(&(terminal_id, id.clone())).ok_or("No such surface")?;
    if surface.settled.is_some() {
        return Err("settled".to_string());
    }
    let mut kept = draft;
    for (since, path) in &surface.agent_sets {
        if *since > revision {
            kept.retain(|typed, _| !overlaps(typed, path));
        }
    }
    let bytes = serde_json::to_string(&kept).map(|s| s.len()).unwrap_or(0);
    log(&format!(
        "{id} DRAFT ({why}) revision={revision} of {} entries={} bytes={bytes}",
        surface.revision,
        kept.len()
    ));
    surface.draft = kept;
    Ok(())
}

/// The operator's action. The first one at the current revision settles the surface.
#[tauri::command]
pub fn a2ui711_answer(
    app: AppHandle,
    terminal_id: String,
    id: String,
    revision: u64,
    result: Value,
) -> Result<String, String> {
    let (waiter, record) = {
        let mut all = surfaces().lock();
        let surface = all.get_mut(&(terminal_id, id.clone())).ok_or("No such surface")?;
        if surface.settled.is_some() {
            log(&format!("{id} SECOND ANSWER refused"));
            return Err("already answered".to_string());
        }
        if revision != surface.revision {
            log(&format!("{id} STALE ANSWER refused revision={revision} of {}", surface.revision));
            return Err("stale".to_string());
        }
        surface.settled = Some(result.clone());
        surface.draft.clear();
        (surface.waiter.take(), surface.record())
    };
    log(&format!("{id} ANSWERED {result}"));
    let _ = app.emit("a2ui711-show", record);
    let returned = waiter.is_some_and(|tx| tx.send(result.to_string()).is_ok());
    Ok(if returned { "returned as the call's result" } else { "no call is waiting" }.to_string())
}

/// A line from the webview into the prototype's log, so both sides share one clock.
#[tauri::command]
pub fn a2ui711_log(line: String) {
    log(&format!("WEBVIEW {line}"));
}
