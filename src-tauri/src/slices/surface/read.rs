//! `quay_surface_read`: where a surface stands, by its id.

use serde_json::{json, Map, Value};

use super::rejection::Rejection;
use super::store::{Standing, SurfaceKey, SurfaceStore};

pub const TOOL: &str = "quay_surface_read";

/// What `terminal_id`'s call asks for, or the result that rejects it.
pub fn read(store: &SurfaceStore, terminal_id: &str, arguments: &Value) -> Result<Value, Value> {
    let id = surface_id(arguments).map_err(rejected)?;
    let standing = store.standing(&SurfaceKey::new(terminal_id, id)).ok_or_else(|| {
        rejected(Rejection {
            code: "INTEGRITY_ERROR",
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
    if let Some(field) = arguments.as_object().and_then(|fields| fields.keys().find(|field| *field != "surface_id")) {
        return Err(Rejection::unknown_field(TOOL, "", field));
    }
    let id = arguments.get("surface_id").and_then(Value::as_str).filter(|id| !id.is_empty());
    id.ok_or_else(|| Rejection::invalid("/surface_id", format!("{TOOL} needs a surface_id.")))
}

fn rejected(rejection: Rejection) -> Value {
    rejection.result("Nothing was changed. Correct the call and send it again.")
}
