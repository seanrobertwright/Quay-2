//! `quay_surface_read`: where a surface stands, by its id.

use serde_json::{json, Map, Value};

use super::arguments::Arguments;
use super::rejection::{CallError, Rejection};
use super::store::{Standing, SurfaceKey, SurfaceStore};

pub const TOOL: &str = "quay_surface_read";

/// The id that a call with these `arguments` asks for, if they have one.
pub fn named(arguments: &Value) -> Option<&str> {
    arguments["surface_id"].as_str().filter(|id| !id.is_empty())
}

/// What `terminal_id`'s call asks for.
pub fn read(store: &SurfaceStore, terminal_id: &str, arguments: &Value) -> Result<Value, Rejection> {
    let id = surface_id(arguments)?;
    let standing = store.standing(&SurfaceKey::new(terminal_id, id)).ok_or_else(|| {
        Rejection::of(CallError {
            code: "INTEGRITY_ERROR".into(),
            surface_id: None,
            path: "/surface_id".to_string(),
            message: format!("No surface \"{id}\" in this terminal."),
        })
    })?;
    let mut body = Map::new();
    body.insert("surface_id".to_string(), json!(id));
    body.insert("state".to_string(), json!(standing.state()));
    if let Standing::Answered(result) = standing {
        body.insert("result".to_string(), result);
    }
    Ok(Value::Object(body))
}

fn surface_id(arguments: &Value) -> Result<&str, Rejection> {
    let mut args = Arguments::new(TOOL, "tab");
    let Some(call) = args.object(arguments, "", "A call", &["surface_id"]) else {
        return args.finish("");
    };
    let id = call.get("surface_id").and_then(Value::as_str).filter(|id| !id.is_empty());
    if id.is_none() {
        args.invalid(call.path("surface_id"), format!("{TOOL} needs a surface_id."));
    }
    args.finish(id.unwrap_or_default())
}
