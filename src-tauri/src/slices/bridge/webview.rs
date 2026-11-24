use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

type Deliver = dyn Fn(&str, Value) -> Result<(), String> + Send + Sync;

/// Where the bridge's events to Quay's webview go: to the app, or, in a test, wherever the test
/// sends them, since a test has no app.
#[derive(Clone)]
pub struct WebviewEvents(Arc<Deliver>);

impl WebviewEvents {
    /// Events that reach every webview of `app`.
    pub fn to_app(app: AppHandle) -> Self {
        Self::to(move |event, payload| app.emit(event, payload).map_err(|e| e.to_string()))
    }

    /// Events handed to `deliver`, by name and payload.
    pub fn to(deliver: impl Fn(&str, Value) -> Result<(), String> + Send + Sync + 'static) -> Self {
        Self(Arc::new(deliver))
    }

    pub fn emit(&self, event: &str, payload: impl Serialize) -> Result<(), String> {
        let payload = serde_json::to_value(payload).map_err(|e| e.to_string())?;
        (self.0)(event, payload)
    }
}
