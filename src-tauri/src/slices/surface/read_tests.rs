//! `quay_surface_read` at the `/mcp` seam, and what dismissing a surface tells its agent.

use std::time::Duration;

use serde_json::{json, Value};

use super::store::AnswerRefused;
use super::test_seam::{answer_to, key, question, start, FakeCli, A_WHILE};
use super::timing::Timing;
use crate::slices::pty::models::{ClaudeStatus, RunKind};

fn answer() -> Value {
    answer_to("One?")
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
    let first = seam.asked(&mut webview, "term-a", "One?").await;
    assert_eq!(read(&cli, "ask_1").await, json!({ "surface_id": "ask_1", "state": "no_answer_yet" }));
    assert!(first.is_open(), "reading ends no wait");

    seam.surfaces.answer(&key("term-a", "ask_1"), 1, answer()).unwrap();
    assert_eq!(first.answer().await, answer());
    webview.next_shown().await;
    for _ in 0..2 {
        let state = json!({ "surface_id": "ask_1", "state": "answered", "result": answer() });
        assert_eq!(read(&cli, "ask_1").await, state, "as often as it is asked");
    }

    seam.shown(&mut webview, "term-a", "Two?").await;
    assert_eq!(read(&cli, "ask_2").await, json!({ "surface_id": "ask_2", "state": "shown" }));
    seam.surfaces.dismiss(&key("term-a", "ask_2")).unwrap();
    assert_eq!(read(&cli, "ask_2").await, json!({ "surface_id": "ask_2", "state": "dismissed" }));

    let third = seam.asked(&mut webview, "term-a", "Three?").await;
    seam.surfaces.dismiss(&key("term-a", "ask_3")).unwrap();
    third.answer().await;
    assert_eq!(read(&cli, "ask_3").await, json!({ "surface_id": "ask_3", "state": "dismissed" }));
}

#[tokio::test]
async fn the_tool_names_each_state_it_returns() {
    let (seam, _webview) = start(Timing::default()).await;
    let list = seam.cli("term-a").post("tools/list", json!({})).result().await;
    let tools = list["tools"].as_array().unwrap();
    let tool = tools.iter().find(|tool| tool["name"] == "quay_surface_read").unwrap();
    let description = tool["description"].as_str().unwrap();
    for state in ["shown", "no_answer_yet", "answered", "dismissed", "withdrawn", "ended"] {
        assert!(description.contains(state), "{state}");
    }
}

#[tokio::test]
async fn an_answer_is_read_after_its_surface_has_left_the_screen() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let answered = json!({ "surface_id": "ask_1", "state": "answered", "result": answer() });
    for n in 1..=11 {
        seam.asked(&mut webview, "term-a", &format!("Question {n}?")).await;
        seam.surfaces.answer(&key("term-a", &format!("ask_{n}")), 1, answer()).unwrap();
        webview.next_shown().await;
    }
    assert_eq!(webview.next_removed().await, key("term-a", "ask_1"), "ten answered stay");
    assert_eq!(read(&cli, "ask_1").await, answered);

    seam.surfaces.dismiss(&key("term-a", "ask_2")).unwrap();
    assert_eq!(read(&cli, "ask_2").await["result"], answer(), "the operator dismissed an answered question");
}

#[tokio::test]
async fn an_id_the_terminal_never_had_is_rejected() {
    let (seam, mut webview) = start(Timing::default()).await;
    let _call = seam.asked(&mut webview, "term-a", "One?").await;
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
        (json!(["ask_1"]), "", "A call is an object."),
        (json!({ "surface_id": "ask_1", "a/b~": 1 }), "/a~1b~0", "quay_surface_read has no field \"a/b~\" here."),
    ] {
        let failure = seam.cli("term-a").call("quay_surface_read", arguments).failure().await;
        let body: Value = serde_json::from_str(&failure).unwrap();
        assert_eq!(body["errors"], json!([{ "code": "VALIDATION_FAILED", "path": path, "message": message }]));
    }
}

#[tokio::test]
async fn reads_have_a_row_of_rejections_of_their_own_which_an_accepted_one_ends() {
    let (seam, mut webview) = start(Timing::default()).await;
    let _call = seam.asked(&mut webview, "term-a", "One?").await;
    let cli = seam.cli("term-a");
    let mut advice = Vec::new();
    for id in ["none", "none", "none", "ask_1", "none"] {
        if id == "ask_1" {
            read(&cli, id).await;
            continue;
        }
        cli.call("quay_ask", json!({})).failure().await;
        let failure = cli.call("quay_surface_read", json!({ "surface_id": id })).failure().await;
        let next = serde_json::from_str::<Value>(&failure).unwrap()["next"].clone();
        advice.push(next.as_str().unwrap().split('.').next().unwrap().to_string());
    }
    assert_eq!(advice, ["Nothing was changed", "Nothing was changed", "Stop guessing", "Nothing was changed"]);
}

#[tokio::test]
async fn dismissing_a_question_is_its_open_calls_result() {
    let (seam, mut webview) = start(Timing::default()).await;
    seam.open_terminal("term-a", RunKind::Claude, ClaudeStatus::Idle);
    let call = seam.asked(&mut webview, "term-a", "One?").await;
    let other = seam.asked(&mut webview, "term-b", "One?").await;

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
    seam.asked(&mut webview, "term-a", "One?").await.answer().await;

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
    seam.shown(&mut webview, "term-a", "One?").await;
    let answered = seam.asked(&mut webview, "term-a", "Two?").await;
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
    seam.asked(&mut webview, "term-a", "One?").await.answer().await;
    seam.pty_manager.update_status("term-a", ClaudeStatus::Exited);

    seam.surfaces.dismiss(&key("term-a", "ask_1")).unwrap();
    assert_eq!(webview.next_removed().await, key("term-a", "ask_1"));
    assert_eq!(seam.typed("term-a"), "");
}

#[tokio::test]
async fn only_the_last_100_surfaces_to_leave_a_terminal_can_still_be_read() {
    let (seam, mut webview) = start(Timing::default()).await;
    let _other = seam.shown(&mut webview, "term-b", "One?").await;
    seam.surfaces.dismiss(&key("term-b", "ask_1")).unwrap();
    for n in 1..=101 {
        seam.shown(&mut webview, "term-a", &format!("Question {n}?")).await;
        seam.surfaces.dismiss(&key("term-a", &format!("ask_{n}"))).unwrap();
    }

    let cli = seam.cli("term-a");
    let failure = cli.call("quay_surface_read", json!({ "surface_id": "ask_1" })).failure().await;
    assert!(failure.contains("No surface \\\"ask_1\\\" in this terminal."), "{failure}");
    for id in ["ask_2", "ask_101"] {
        assert_eq!(read(&cli, id).await["state"], "dismissed");
    }
    assert_eq!(read(&seam.cli("term-b"), "ask_1").await["state"], "dismissed", "each terminal's are its own");
}
