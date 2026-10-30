//! Topos payloads reach the frontend in camelCase (#369). This test serializes a fixture of every
//! Topos payload and checks its keys, so a struct or variant missing `rename_all = "camelCase"`
//! fails here. Add each new Topos payload to `fixtures`.

use serde_json::{json, Value};

use super::error::GitError;
use super::op_runner::OpEvent;
use super::version::GitVersionStatus;

fn s<T: serde::Serialize>(payload: &T) -> Value {
    serde_json::to_value(payload).expect("payload serializes")
}

fn fixtures() -> Vec<(&'static str, Value, Value)> {
    vec![
        ("GitVersionStatus::Ok", s(&GitVersionStatus::Ok), json!({ "status": "ok" })),
        ("GitVersionStatus::Missing", s(&GitVersionStatus::Missing), json!({ "status": "missing" })),
        (
            "GitVersionStatus::TooOld",
            s(&GitVersionStatus::TooOld { found: "2.30.1".into() }),
            json!({ "status": "tooOld", "found": "2.30.1" }),
        ),
        (
            "GitVersionStatus::Unknown",
            s(&GitVersionStatus::Unknown { raw: "git version ?".into() }),
            json!({ "status": "unknown", "raw": "git version ?" }),
        ),
        (
            "GitError::Other",
            s(&GitError::Other { stderr: "fatal: not a git repository".into() }),
            json!({ "kind": "other", "stderr": "fatal: not a git repository" }),
        ),
        ("GitError::Cancelled", s(&GitError::Cancelled), json!({ "kind": "cancelled" })),
        (
            "OpEvent::Progress",
            s(&OpEvent::Progress { phase: "Receiving objects".into(), percent: Some(45) }),
            json!({ "event": "progress", "phase": "Receiving objects", "percent": 45 }),
        ),
        (
            "OpEvent::Progress without a percent",
            s(&OpEvent::Progress { phase: "Enumerating objects".into(), percent: None }),
            json!({ "event": "progress", "phase": "Enumerating objects" }),
        ),
        (
            "OpEvent::Output",
            s(&OpEvent::Output { chunk: "From origin
".into() }),
            json!({ "event": "output", "chunk": "From origin
" }),
        ),
        ("OpEvent::Stalled", s(&OpEvent::Stalled), json!({ "event": "stalled" })),
        ("OpEvent::Done", s(&OpEvent::Done), json!({ "event": "done" })),
        (
            "OpEvent::Failed",
            s(&OpEvent::Failed { error: GitError::Cancelled }),
            json!({ "event": "failed", "error": { "kind": "cancelled" } }),
        ),
    ]
}

/// Every object key in `value`, at any depth.
fn keys(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            for (k, v) in map {
                out.push(k.clone());
                keys(v, out);
            }
        }
        Value::Array(items) => items.iter().for_each(|v| keys(v, out)),
        _ => {}
    }
}

fn is_camel_case(key: &str) -> bool {
    key.chars().next().is_some_and(|c| c.is_ascii_lowercase()) && key.chars().all(|c| c.is_ascii_alphanumeric())
}

#[test]
fn every_payload_serializes_to_its_camel_case_fixture() {
    for (name, actual, expected) in fixtures() {
        assert_eq!(actual, expected, "{name} serialized differently from its fixture");
        let mut found = Vec::new();
        keys(&actual, &mut found);
        for key in found {
            assert!(is_camel_case(&key), "{name} has a key that isn't camelCase: {key}");
        }
    }
}
