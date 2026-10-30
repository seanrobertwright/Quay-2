//! Topos payloads reach the frontend in camelCase (#369). This test serializes a fixture of every
//! Topos payload and checks its keys, so a struct or variant missing `rename_all = "camelCase"`
//! fails here. Add each new Topos payload to `fixtures`.

use serde_json::{json, Value};

use super::error::GitError;
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
