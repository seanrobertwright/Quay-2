//! Topos payloads reach the frontend in camelCase (#369). This test serializes a fixture of every
//! Topos payload and checks its keys, so a struct or variant missing `rename_all = "camelCase"`
//! fails here. Add each new Topos payload to `fixtures`.

use serde_json::{json, Value};

use super::error::GitError;
use super::graph::{Author, GitRefs, GraphEvent, RefBadge, RefKind, Refreshed, Track, TrackKind, WorktreeHead};
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
        ("GraphEvent::Started", s(&GraphEvent::Started { session_id: 3 }), json!({ "event": "started", "sessionId": 3 })),
        (
            "GraphEvent::Paused",
            s(&GraphEvent::Paused { session_id: 3, rows_loaded: 50_000 }),
            json!({ "event": "paused", "sessionId": 3, "rowsLoaded": 50_000 }),
        ),
        (
            "GraphEvent::Done",
            s(&GraphEvent::Done { session_id: 3, total: 12 }),
            json!({ "event": "done", "sessionId": 3, "total": 12 }),
        ),
        (
            "GraphEvent::Truncated",
            s(&GraphEvent::Truncated { session_id: 3, cap: 2_000_000 }),
            json!({ "event": "truncated", "sessionId": 3, "cap": 2_000_000 }),
        ),
        (
            "GraphEvent::Failed",
            s(&GraphEvent::Failed { session_id: 3, error: GitError::Other { stderr: "boom".into() } }),
            json!({ "event": "failed", "sessionId": 3, "error": { "kind": "other", "stderr": "boom" } }),
        ),
        (
            "GraphEvent::Splice",
            s(&GraphEvent::Splice {
                session_id: 3,
                replace_rows: 64,
                new_rows: 69,
                row_delta: 5,
                edges_from: 70,
                edges_to: 76,
                tracks_from: 4,
                tracks_to: 5,
                crossing_edges: vec![[68, 74]],
                live_tracks: vec![[0, 0]],
            }),
            json!({
                "event": "splice", "sessionId": 3, "replaceRows": 64, "newRows": 69, "rowDelta": 5,
                "edgesFrom": 70, "edgesTo": 76, "tracksFrom": 4, "tracksTo": 5,
                "crossingEdges": [[68, 74]], "liveTracks": [[0, 0]]
            }),
        ),
        ("GraphEvent::Reset", s(&GraphEvent::Reset { session_id: 3 }), json!({ "event": "reset", "sessionId": 3 })),
        ("Refreshed::Spliced", s(&Refreshed::Spliced { row_delta: -2 }), json!({ "kind": "spliced", "rowDelta": -2 })),
        (
            "Refreshed::Reset",
            s(&Refreshed::Reset { searched_rows: 20_000 }),
            json!({ "kind": "reset", "searchedRows": 20_000 }),
        ),
        (
            "Author",
            s(&Author { name: "Ann".into(), email: "ann@example.invalid".into() }),
            json!({ "name": "Ann", "email": "ann@example.invalid" }),
        ),
        (
            "Track",
            s(&Track { id: 4, key: "feature/x".into(), kind: TrackKind::Derived, left: Some(0), right: None }),
            json!({ "id": 4, "key": "feature/x", "kind": "derived", "left": 0, "right": null }),
        ),
        (
            "GitRefs",
            s(&GitRefs {
                refs: vec![RefBadge { kind: RefKind::Remote, name: "origin/main".into(), oid: "abc".into() }],
                worktrees: vec![WorktreeHead { path: "C:/repo-wt".into(), oid: "abc".into(), branch: None }],
                tag_only_count: 30,
            }),
            json!({
                "refs": [{ "kind": "remote", "name": "origin/main", "oid": "abc" }],
                "worktrees": [{ "path": "C:/repo-wt", "oid": "abc", "branch": null }],
                "tagOnlyCount": 30
            }),
        ),
        ("RefKind::Local", s(&RefKind::Local), json!("local")),
        ("RefKind::Tag", s(&RefKind::Tag), json!("tag")),
        ("TrackKind::Default", s(&TrackKind::Default), json!("default")),
        ("TrackKind::Anonymous", s(&TrackKind::Anonymous), json!("anonymous")),
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
