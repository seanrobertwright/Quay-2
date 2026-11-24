//! `quay_surface_read` at the `/mcp` seam, and what dismissing a surface tells its agent.

use std::time::Duration;

use serde_json::{json, Value};

use super::store::{AnswerRefused, SurfaceKey};
use super::test_seam::{accepted, start, FakeCli, FakeWebview, OpenCall, Seam, A_WHILE};
use super::timing::Timing;
use crate::slices::pty::models::{ClaudeStatus, RunKind};

fn question(title: &str) -> Value {
    json!({ "questions": [{ "question": title, "options": [{ "label": "Yes" }, { "label": "No" }] }] })
}

fn answer() -> Value {
    json!({ "answers": [{ "question": "One?", "chosen": ["Yes"] }] })
}

fn key(terminal_id: &str, id: &str) -> SurfaceKey {
    SurfaceKey::new(terminal_id, id)
}

async fn asked(seam: &Seam, webview: &mut FakeWebview, terminal_id: &str, title: &str) -> OpenCall {
    shown(seam, webview, terminal_id, title, true).await
}

async fn shown(seam: &Seam, webview: &mut FakeWebview, terminal_id: &str, title: &str, asks: bool) -> OpenCall {
    let call = seam.cli(terminal_id).call("quay_ask", question(title));
    seam.surfaces.verdict(webview.next_check().await.call, accepted(asks));
    webview.next_shown().await;
    call
}

fn short_wait() -> Timing {
    Timing { wait: Duration::from_millis(100), ..Timing::default() }
}

async fn read(cli: &FakeCli, id: &str) -> Value {
    cli.call("quay_surface_read", json!({ "surface_id": id })).answer().await
}

#[tokio::test]
async fn a_surface_is_read_by_its_id_in_each_state() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let first = asked(&seam, &mut webview, "term-a", "One?").await;
    assert_eq!(read(&cli, "ask_1").await, json!({ "surface_id": "ask_1", "state": "no_answer_yet" }));
    assert!(first.is_open(), "reading ends no wait");

    seam.surfaces.answer(&key("term-a", "ask_1"), 1, answer()).unwrap();
    assert_eq!(first.answer().await, answer());
    webview.next_shown().await;
    for _ in 0..2 {
        let state = json!({ "surface_id": "ask_1", "state": "answered", "result": answer() });
        assert_eq!(read(&cli, "ask_1").await, state, "as often as it is asked");
    }

    shown(&seam, &mut webview, "term-a", "Two?", false).await;
    assert_eq!(read(&cli, "ask_2").await, json!({ "surface_id": "ask_2", "state": "shown" }));
    seam.surfaces.dismiss(&key("term-a", "ask_2")).unwrap();
    assert_eq!(read(&cli, "ask_2").await, json!({ "surface_id": "ask_2", "state": "dismissed" }));

    let third = asked(&seam, &mut webview, "term-a", "Three?").await;
    seam.surfaces.dismiss(&key("term-a", "ask_3")).unwrap();
    third.answer().await;
    assert_eq!(read(&cli, "ask_3").await, json!({ "surface_id": "ask_3", "state": "dismissed" }));
}

#[tokio::test]
async fn an_answer_is_read_after_its_surface_has_left_the_screen() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let answered = json!({ "surface_id": "ask_1", "state": "answered", "result": answer() });
    let mut calls = vec![asked(&seam, &mut webview, "term-a", "One?").await];
    seam.surfaces.answer(&key("term-a", "ask_1"), 1, answer()).unwrap();
    webview.next_shown().await;
    for n in 2..=15 {
        calls.push(asked(&seam, &mut webview, "term-a", &format!("Question {n}?")).await);
    }
    assert_eq!(webview.next_removed().await, key("term-a", "ask_1"), "it made room");
    assert_eq!(read(&cli, "ask_1").await, answered);

    seam.surfaces.answer(&key("term-a", "ask_2"), 1, answer()).unwrap();
    seam.surfaces.dismiss(&key("term-a", "ask_2")).unwrap();
    assert_eq!(read(&cli, "ask_2").await["result"], answer(), "the operator dismissed an answered question");
}

#[tokio::test]
async fn an_id_the_terminal_never_had_is_rejected() {
    let (seam, mut webview) = start(Timing::default()).await;
    let _call = asked(&seam, &mut webview, "term-a", "One?").await;
    let never = |id: &str| {
        json!({
            "errors": [{
                "code": "INTEGRITY_ERROR",
                "path": "/surface_id",
                "message": format!("No surface \"{id}\" in this terminal."),
            }],
            "next": "Nothing was changed. Correct the call and send it again.",
        })
    };
    for (terminal_id, id) in [("term-a", "ask_2"), ("term-a", "x\u{1b}\n"), ("term-b", "ask_1")] {
        let failure = seam.cli(terminal_id).call("quay_surface_read", json!({ "surface_id": id })).failure().await;
        assert_eq!(serde_json::from_str::<Value>(&failure).unwrap(), never(id), "{terminal_id}");
    }
}

#[tokio::test]
async fn a_read_without_one_id_is_rejected() {
    let (seam, _webview) = start(Timing::default()).await;
    let needs = "quay_surface_read needs a surface_id.";
    for (arguments, path, message) in [
        (json!({}), "/surface_id", needs),
        (json!({ "surface_id": 1 }), "/surface_id", needs),
        (json!({ "surface_id": "" }), "/surface_id", needs),
        (json!(["ask_1"]), "/surface_id", needs),
        (json!({ "surface_id": "ask_1", "a/b~": 1 }), "/a~1b~0", "quay_surface_read has no field \"a/b~\"."),
    ] {
        let failure = seam.cli("term-a").call("quay_surface_read", arguments).failure().await;
        let body: Value = serde_json::from_str(&failure).unwrap();
        assert_eq!(body["errors"], json!([{ "code": "VALIDATION_FAILED", "path": path, "message": message }]));
    }
}

#[tokio::test]
async fn dismissing_a_question_is_its_open_calls_result() {
    let (seam, mut webview) = start(Timing::default()).await;
    seam.open_terminal("term-a", RunKind::Claude, ClaudeStatus::Idle);
    let call = asked(&seam, &mut webview, "term-a", "One?").await;
    let other = asked(&seam, &mut webview, "term-b", "One?").await;

    seam.surfaces.dismiss(&key("term-a", "ask_1")).unwrap();
    assert_eq!(call.answer().await, json!({ "dismissed": true }));
    assert_eq!(webview.next_removed().await, key("term-a", "ask_1"));
    assert_eq!(seam.typed("term-a"), "");
    assert!(other.is_open());
    assert_eq!(
        seam.surfaces.answer(&key("term-a", "ask_1"), 1, answer()),
        Err(AnswerRefused::NoSuchSurface),
        "it has had its one answer"
    );
    let again = seam.cli("term-a").call("quay_ask", question("One?"));
    assert_eq!(webview.next_check().await.surface_id, "ask_2", "asking again makes a new one");
    again.hang_up();
}

#[tokio::test]
async fn a_dismissal_after_the_wait_is_typed_held_until_the_turn_ends() {
    let (seam, mut webview) = start(short_wait()).await;
    asked(&seam, &mut webview, "term-a", "One?").await.answer().await;

    seam.surfaces.dismiss(&key("term-a", "ask_1")).unwrap();
    seam.surfaces.dismiss(&key("term-a", "ask_1")).unwrap();
    assert_eq!(webview.next_removed().await, key("term-a", "ask_1"));
    assert_eq!(seam.typed("term-a"), "");
    seam.cli("term-a").event("turn.completed", json!({})).await;
    assert_eq!(seam.typed_soon("term-a").await, "[Quay surface \"One?\" (ask_1)]: {\"dismissed\":true}\r");
    seam.cli("term-a").event("turn.completed", json!({})).await;
    tokio::time::sleep(A_WHILE).await;
    assert_eq!(seam.typed("term-a").matches('\r').count(), 1, "told once");
}

#[tokio::test]
async fn dismissing_what_asks_for_nothing_tells_the_agent_nothing() {
    let (seam, mut webview) = start(Timing::default()).await;
    seam.open_terminal("term-a", RunKind::Claude, ClaudeStatus::Idle);
    shown(&seam, &mut webview, "term-a", "One?", false).await;
    let answered = asked(&seam, &mut webview, "term-a", "Two?").await;
    seam.surfaces.answer(&key("term-a", "ask_2"), 1, answer()).unwrap();
    answered.answer().await;

    for id in ["ask_1", "ask_2"] {
        seam.surfaces.dismiss(&key("term-a", id)).unwrap();
        assert_eq!(webview.next_removed().await, key("term-a", id));
    }
    assert!(seam.surfaces.surfaces().is_empty());
    assert_eq!(seam.typed("term-a"), "");
}

#[tokio::test]
async fn a_question_of_a_terminal_that_is_over_can_still_be_dismissed() {
    let (seam, mut webview) = start(short_wait()).await;
    asked(&seam, &mut webview, "term-a", "One?").await.answer().await;
    seam.pty_manager.update_status("term-a", ClaudeStatus::Exited);

    seam.surfaces.dismiss(&key("term-a", "ask_1")).unwrap();
    assert_eq!(webview.next_removed().await, key("term-a", "ask_1"));
    assert_eq!(seam.typed("term-a"), "");
}
