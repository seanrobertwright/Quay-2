//! What an agent is told when a surface tool's call fails.

use serde::Serialize;
use serde_json::{json, Value};

/// What is wrong with a call: a JSON Pointer into the call as the agent wrote it, and why.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Rejection {
    pub code: &'static str,
    pub path: String,
    pub message: String,
}

impl Rejection {
    pub fn invalid(path: impl Into<String>, message: impl Into<String>) -> Self {
        Self { code: "VALIDATION_FAILED", path: path.into(), message: message.into() }
    }

    /// The result of a typed tool's call that this rejects.
    pub fn typed_result(&self) -> Value {
        let body = json!({ "errors": [self], "next": "Nothing was shown. Correct the call and send it again." });
        error_result(body.to_string())
    }
}

/// Why Quay itself could not show a call it accepted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QuayFailed {
    /// The webview gave no verdict in time.
    NoVerdict,
    /// Quay's own expansion of a typed call failed the engine's check.
    Expansion,
}

impl QuayFailed {
    pub fn result(self) -> Value {
        let next = match self {
            Self::NoVerdict => "Send the same call once more.",
            Self::Expansion => "Say it in the terminal instead.",
        };
        error_result(format!("Quay could not show this; your call was not at fault. Nothing was shown. {next}"))
    }
}

fn error_result(text: String) -> Value {
    json!({ "content": [{ "type": "text", "text": text }], "isError": true })
}
