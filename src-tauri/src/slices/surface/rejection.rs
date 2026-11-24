//! What an agent is told when a surface tool's call fails. The shape is every surface tool's.

use std::borrow::Cow;

use serde::Serialize;
use serde_json::{json, Value};

/// The most errors a rejection lists. It gives the number of the rest.
const MOST_LISTED: usize = 10;

/// From this rejection in a row of one terminal's calls of one tool, the advice changes.
const STOP_GUESSING_FROM: u32 = 3;

/// One thing wrong with a call.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CallError {
    /// `VALIDATION_FAILED` or `INTEGRITY_ERROR` for Quay's own, or the engine's code as it gave it.
    pub code: Cow<'static, str>,
    /// Left out when the error is about no surface.
    #[serde(rename = "surfaceId", skip_serializing_if = "Option::is_none")]
    pub surface_id: Option<String>,
    /// A JSON Pointer into the call as the agent wrote it.
    pub path: String,
    pub message: String,
}

/// Everything wrong with a call, of which nothing is shown.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Rejection {
    /// The first `MOST_LISTED`, in the order they were found.
    errors: Vec<CallError>,
    /// How many were found after those.
    more: usize,
}

impl Rejection {
    /// A rejection for one thing: what is at `path` breaks a rule of Quay's own.
    pub fn invalid(path: impl Into<String>, message: impl Into<String>) -> Self {
        let mut rejection = Self::default();
        rejection.add_invalid(path, message);
        rejection
    }

    /// Adds that what is at `path` breaks a rule of Quay's own.
    pub fn add_invalid(&mut self, path: impl Into<String>, message: impl Into<String>) {
        let code = "VALIDATION_FAILED".into();
        self.add(CallError { code, surface_id: None, path: path.into(), message: message.into() });
    }

    pub fn add(&mut self, error: CallError) {
        if self.errors.len() < MOST_LISTED {
            self.errors.push(error);
        } else {
            self.more += 1;
        }
    }

    pub fn is_empty(&self) -> bool {
        self.errors.is_empty()
    }

    /// The result of the call of `tool` that this rejects, the `run`th rejected in a row.
    pub fn result(&self, tool: &str, run: u32) -> Value {
        let mut body = json!({ "errors": self.errors, "next": next(tool, run) });
        if self.more > 0 {
            body["more"] = json!(self.more);
        }
        error_result(body.to_string())
    }
}

/// What an agent whose call of `tool` was rejected is to do, `run` being how many were in a row.
fn next(tool: &str, run: u32) -> &'static str {
    if run >= STOP_GUESSING_FROM {
        return "Stop guessing. Call quay_surface_guide first, or use quay_ask, quay_review or quay_board, or say it in the terminal.";
    }
    match tool {
        "quay_surface" => "Nothing was changed. Correct the call and send all of it again. quay_surface_guide lists the components, their properties and examples.",
        _ => "Nothing was shown. Correct the call and send it again.",
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

#[cfg(test)]
mod tests {
    use super::*;

    fn body(result: &Value) -> Value {
        assert_eq!(result["isError"], true);
        serde_json::from_str(result["content"][0]["text"].as_str().unwrap()).unwrap()
    }

    #[test]
    fn an_error_names_its_surface_and_keeps_the_code_it_came_with() {
        let mut rejection = Rejection::default();
        rejection.add(CallError {
            code: "RECURSION_LIMIT_EXCEEDED".into(),
            surface_id: Some("plan".to_string()),
            path: "/messages/1/updateComponents".to_string(),
            message: "A cycle".to_string(),
        });

        assert_eq!(
            body(&rejection.result("quay_surface", 1)),
            json!({
                "errors": [{
                    "code": "RECURSION_LIMIT_EXCEEDED",
                    "surfaceId": "plan",
                    "path": "/messages/1/updateComponents",
                    "message": "A cycle",
                }],
                "next": "Nothing was changed. Correct the call and send all of it again. quay_surface_guide lists the components, their properties and examples.",
            })
        );
    }

    #[test]
    fn the_raw_tool_and_the_others_are_given_the_same_advice_from_the_third_in_a_row() {
        let rejection = Rejection::invalid("/place", "A call that creates a surface needs a place: companion, tab or strip.");
        for tool in ["quay_surface", "quay_review"] {
            assert!(body(&rejection.result(tool, 2))["next"].as_str().unwrap().starts_with("Nothing was "));
            assert!(body(&rejection.result(tool, 3))["next"].as_str().unwrap().starts_with("Stop guessing."));
        }
    }
}
