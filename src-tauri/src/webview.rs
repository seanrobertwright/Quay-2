//! Events to Quay's webview, for the code that a test runs without an app.

use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

type Deliver = dyn Fn(&str, Value) + Send + Sync;

/// Where events to Quay's webview go: to the app, or, in a test, wherever the test sends them,
/// since a test has no app.
#[derive(Clone)]
pub struct WebviewEvents(Arc<Deliver>);

impl WebviewEvents {
    /// Events that reach every webview of `app`.
    pub fn to_app(app: AppHandle) -> Self {
        Self::to(move |event, payload| {
            if let Err(e) = app.emit(event, payload) {
                log_undelivered(event, &e);
            }
        })
    }

    /// Events handed to `deliver`, by name and payload.
    pub fn to(deliver: impl Fn(&str, Value) + Send + Sync + 'static) -> Self {
        Self(Arc::new(deliver))
    }

    /// Sends `event`. No caller can act on a failure to, so it is logged here.
    pub fn emit(&self, event: &str, payload: impl Serialize) {
        match serde_json::to_value(payload) {
            Ok(payload) => (self.0)(event, payload),
            Err(e) => log_undelivered(event, &e),
        }
    }
}

fn log_undelivered(event: &str, error: &dyn std::fmt::Display) {
    tracing::warn!("The {event} event didn't reach the webview: {error}");
}
