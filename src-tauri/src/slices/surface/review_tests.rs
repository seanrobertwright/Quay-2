//! `quay_review` at the `/mcp` seam: what the agent is told and what the window is sent.

use std::time::Duration;

use serde_json::{json, Value};

use super::review::{BODY_LIMIT, DETAIL_LIMIT, ITEM_COUNT, ITEM_TITLE_LIMIT, TITLE_LIMIT};
use super::store::{AnswerRefused, SurfaceKey};
use super::test_seam::{accepted, answer_to, key, start, until, FakeWebview, OpenCall, Seam};
use super::timing::{Timing, WAIT};
use crate::slices::pty::models::{ClaudeStatus, RunKind};

/// The spec's own review.
fn review() -> Value {
    json!({
        "title": "Plan: pair each answer with its turn",
        "body": "## Why\n\nAn answer can outlive its turn.",
        "items": [
            { "title": "Give every turn an id", "detail": "In the bridge", "file": "src/turns.ts:12" },
            { "title": "Drop answers whose turn has gone" },
        ],
    })
}

/// What the operator decided of it.
fn verdict() -> Value {
    json!({
        "title": "Plan: pair each answer with its turn",
        "verdict": "approved",
        "dropped": ["Drop answers whose turn has gone"],
        "comment": "Log it instead.",
    })
}

#[tokio::test]
async fn a_review_is_drawn_on_a_tab_and_its_verdict_is_the_calls_result() {
    let (seam, mut webview) = start(Timing::default()).await;
    let call = seam.cli("term-a").call("quay_review", review());

    let check = webview.next_check().await;
    assert_eq!((check.tool.as_str(), check.surface_id.as_str()), ("quay_review", "review_1"));
    assert_eq!(check.arguments, review());
    seam.surfaces.verdict(check.call, accepted(true));

    let shown = webview.next_shown().await;
    assert_eq!((shown.id.as_str(), shown.tool.as_str(), shown.asks), ("review_1", "quay_review", true));
    assert_eq!(serde_json::to_value(&shown).unwrap()["place"], "tab");
    assert!(call.is_open(), "the call waits for its verdict");
    seam.surfaces.answer(&SurfaceKey::new("term-a", "review_1"), 1, verdict()).unwrap();

    assert_eq!(call.answer().await, verdict());
    assert_eq!(webview.next_shown().await.answer, Some(verdict()));
}

/// `term-a`'s review with this title, once it has been drawn.
async fn reviewed(seam: &Seam, webview: &mut FakeWebview, title: &str) -> OpenCall {
    let call = seam.cli("term-a").call("quay_review", json!({ "title": title, "body": "One step." }));
    seam.surfaces.verdict(webview.next_check().await.call, accepted(true));
    webview.next_shown().await;
    call
}

/// `term-a`'s review of this title, which is rejected once the webview has accepted it.
async fn rejected(seam: &Seam, webview: &mut FakeWebview, title: &str) -> Value {
    let call = seam.cli("term-a").call("quay_review", json!({ "title": title, "body": "One step." }));
    seam.surfaces.verdict(webview.next_check().await.call, accepted(true));
    serde_json::from_str(&call.failure().await).unwrap()
}

/// What is wrong with the call `arguments`: each error's path and message.
async fn errors(arguments: Value) -> Vec<(String, String)> {
    let (seam, mut webview) = start(Timing::default()).await;
    let failure = seam.cli("term-a").call("quay_review", arguments).failure().await;
    assert!(webview.no_check().await, "checked all the same");
    let body: Value = serde_json::from_str(&failure).unwrap();
    assert_eq!(body["next"], "Nothing was shown. Correct the call and send it again.");
    let error = |error: &Value| {
        assert_eq!(error["code"], "VALIDATION_FAILED");
        (error["path"].as_str().unwrap().to_string(), error["message"].as_str().unwrap().to_string())
    };
    body["errors"].as_array().unwrap().iter().map(error).collect()
}

fn one(path: &str, message: &str) -> Vec<(String, String)> {
    vec![(path.to_string(), message.to_string())]
}

#[tokio::test]
async fn the_listed_schema_states_the_limits_the_calls_are_held_to() {
    let (seam, _webview) = start(Timing::default()).await;
    let list = seam.cli("term-a").post("tools/list", json!({})).result().await;
    let tool = list["tools"].as_array().unwrap().iter().find(|tool| tool["name"] == "quay_review").unwrap();
    let call = &tool["inputSchema"]["properties"];
    let item = &call["items"]["items"]["properties"];

    let says = |value: &Value, part: String| {
        let description = value["description"].as_str().unwrap();
        assert!(description.contains(&part), "{part:?} in {description:?}");
    };
    says(tool, format!("up to {} seconds", WAIT.as_secs()));
    says(&call["title"], format!("at most {TITLE_LIMIT} characters"));
    says(&call["body"], format!("at most {BODY_LIMIT} characters"));
    says(&item["title"], format!("At most {ITEM_TITLE_LIMIT} characters"));
    says(&item["detail"], format!("at most {DETAIL_LIMIT} characters"));
    assert_eq!(call["items"]["maxItems"], json!(ITEM_COUNT.end()));
    assert_eq!(tool["inputSchema"]["required"], json!(["title", "body"]));
    assert_eq!(call["items"]["items"]["required"], json!(["title"]));
}

#[tokio::test]
async fn a_review_at_every_limit_is_shown() {
    let (seam, mut webview) = start(Timing::default()).await;
    // Characters, of which each of these has two bytes
    let item = |n: usize| json!({ "title": format!("{n:0>120}"), "detail": "ü".repeat(300), "file": "src/turns.ts:12" });
    let arguments = json!({
        "title": "ü".repeat(80),
        "body": "ü".repeat(20_000),
        "items": (0..30).map(item).collect::<Vec<_>>(),
    });
    let _call = seam.cli("term-a").call("quay_review", arguments.clone());
    assert_eq!(webview.next_check().await.arguments, arguments);
}

#[tokio::test]
async fn a_review_past_a_limit_is_rejected_at_the_field_naming_place_tab() {
    let more = "For longer content send a surface with quay_surface and place tab.";
    assert_eq!(
        errors(json!({ "title": "x".repeat(96), "body": "One step." })).await,
        one("/title", &format!("A title is at most 80 characters; this one is 96. {more}"))
    );
    assert_eq!(
        errors(json!({ "title": "Plan", "body": "x".repeat(20_001) })).await,
        one("/body", &format!("The body is at most 20000 characters; this one is 20001. {more}"))
    );
    let item = json!({ "title": "x".repeat(121), "detail": "x".repeat(301) });
    assert_eq!(
        errors(json!({ "title": "Plan", "body": "One step.", "items": [{ "title": "One" }, item] })).await,
        [
            one("/items/1/title", &format!("An item title is at most 120 characters; this one is 121. {more}")),
            one("/items/1/detail", &format!("An item detail is at most 300 characters; this one is 301. {more}")),
        ]
        .concat()
    );
}

#[tokio::test]
async fn more_than_thirty_items_and_a_shared_title_are_rejected() {
    let items: Vec<Value> = (0..31).map(|n| json!({ "title": format!("Step {n}") })).collect();
    assert_eq!(
        errors(json!({ "title": "Plan", "body": "Steps.", "items": items })).await,
        one(
            "/items",
            "A call takes up to 30 items; this one has 31. For more, send a surface with quay_surface and place tab."
        )
    );
    let items = json!([{ "title": "Test it" }, { "title": "Ship it" }, { "title": "Test it", "detail": "Again" }]);
    assert_eq!(
        errors(json!({ "title": "Plan", "body": "Steps.", "items": items })).await,
        one("/items/2/title", "Two items cannot share a title. \"Test it\" is also item 1.")
    );
}

#[tokio::test]
async fn a_call_of_the_wrong_shape_is_rejected_with_everything_wrong_with_it() {
    assert_eq!(
        errors(json!({ "body": "  ", "place": "tab", "items": [7, { "detail": 3, "file": 4 }] })).await,
        [
            one("/place", "quay_review has no field \"place\" here."),
            one("/title", "A title needs some text."),
            one("/body", "The body needs some text."),
            one("/items/0", "An item is an object."),
            one("/items/1/title", "An item title needs some text."),
            one("/items/1/detail", "An item detail is text."),
            one("/items/1/file", "An item file is text."),
        ]
        .concat()
    );
    assert_eq!(errors(json!({ "title": "Plan", "body": "Steps.", "items": {} })).await, one("/items", "A review's items are a list."));
}

#[tokio::test]
async fn a_terminal_has_four_live_tabs_and_four_questions_beside_them() {
    let (seam, mut webview) = start(Timing::default()).await;
    for n in 1..=4 {
        reviewed(&seam, &mut webview, &format!("Plan {n}")).await;
        seam.asked(&mut webview, "term-a", &format!("Question {n}?")).await;
    }

    assert_eq!(
        rejected(&seam, &mut webview, "Plan 5").await["errors"],
        json!([{
            "code": "VALIDATION_FAILED",
            "path": "",
            "message": "This terminal has four live surfaces in tab, the most allowed. Wait for an answer, delete one, or put several questions in one quay_ask.",
        }])
    );
    let mut kept = seam.surfaces.surfaces();
    kept.sort_by_key(|record| record.order);
    let kept: Vec<Value> = kept.iter().map(|record| json!([record.id, record.place])).collect();
    let both = |n: usize| [json!([format!("review_{n}"), "tab"]), json!([format!("ask_{n}"), "companion"])];
    assert_eq!(kept, (1..=4).flat_map(both).collect::<Vec<_>>(), "each tool counts its own");

    seam.surfaces.answer(&key("term-a", "review_2"), 1, verdict()).unwrap();
    webview.next_shown().await;
    reviewed(&seam, &mut webview, "Plan 5").await;
}

#[tokio::test]
async fn calls_sent_at_once_cannot_pass_the_four_tabs() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let review = |n: usize| json!({ "title": format!("Plan {n}"), "body": "One step." });
    let calls: Vec<OpenCall> = (0..6).map(|n| cli.call("quay_review", review(n))).collect();
    for _ in 0..6 {
        seam.surfaces.verdict(webview.next_check().await.call, accepted(true));
    }
    until(|| calls.iter().filter(|call| !call.is_open()).count() == 2, "two were not rejected").await;
    assert_eq!(seam.surfaces.surfaces().len(), 4);
}

#[tokio::test]
async fn ten_locked_are_kept_whatever_place_they_were_in() {
    let (seam, mut webview) = start(Timing::default()).await;
    for n in 1..=5 {
        reviewed(&seam, &mut webview, &format!("Plan {n}")).await;
        seam.surfaces.answer(&key("term-a", &format!("review_{n}")), 1, verdict()).unwrap();
        webview.next_shown().await;
        seam.asked(&mut webview, "term-a", &format!("Question {n}?")).await;
        seam.surfaces.answer(&key("term-a", &format!("ask_{n}")), 1, answer_to("One?")).unwrap();
        webview.next_shown().await;
    }
    assert!(webview.none_removed(), "ten are kept");

    reviewed(&seam, &mut webview, "Plan 6").await;
    seam.surfaces.answer(&key("term-a", "review_6"), 1, verdict()).unwrap();
    assert_eq!(webview.next_removed().await, key("term-a", "review_1"));
    assert!(webview.none_removed());
}

#[tokio::test]
async fn a_verdict_after_the_wait_is_typed_in_once_under_the_reviews_title() {
    let (seam, mut webview) = start(Timing { wait: Duration::from_millis(1), ..Timing::default() }).await;
    seam.open_terminal("term-a", RunKind::Claude, ClaudeStatus::Idle);
    let call = reviewed(&seam, &mut webview, "Plan: pair each answer with its turn").await;
    assert_eq!(
        call.answer().await,
        json!({
            "surface_id": "review_1",
            "state": "no_answer_yet",
            "next": "End your turn now. The answer will be typed into this terminal. quay_surface_read with this id returns it too.",
        })
    );

    seam.surfaces.answer(&key("term-a", "review_1"), 1, verdict()).unwrap();
    let typed = seam.typed_soon("term-a").await;
    let start = "[Quay surface \"Plan: pair each answer with its turn\" (review_1)]: ";
    let (_, result) = typed.split_once(start).unwrap_or_else(|| panic!("{typed:?}"));
    let result = result.trim_end_matches(|c: char| c.is_control() || "[201~".contains(c));
    assert_eq!(serde_json::from_str::<Value>(result).unwrap(), verdict());
    assert_eq!(seam.surfaces.answer(&key("term-a", "review_1"), 1, verdict()), Err(AnswerRefused::AlreadyAnswered));
    let read = seam.cli("term-a").call("quay_surface_read", json!({ "surface_id": "review_1" })).answer().await;
    assert_eq!(read, json!({ "surface_id": "review_1", "state": "answered", "result": verdict() }));
}

#[tokio::test]
async fn a_verdict_inside_the_wait_is_not_typed_in_and_a_second_is_refused() {
    let (seam, mut webview) = start(Timing::default()).await;
    let call = reviewed(&seam, &mut webview, "Plan").await;
    seam.surfaces.answer(&key("term-a", "review_1"), 1, verdict()).unwrap();
    assert_eq!(seam.surfaces.answer(&key("term-a", "review_1"), 1, verdict()), Err(AnswerRefused::AlreadyAnswered));
    assert_eq!(call.answer().await, verdict());
    assert_eq!(seam.typed("term-a"), "");
}

#[tokio::test]
async fn dismissing_an_undecided_review_tells_its_agent_and_a_decided_one_does_not() {
    let (seam, mut webview) = start(Timing::default()).await;
    let call = reviewed(&seam, &mut webview, "Plan").await;
    seam.surfaces.dismiss(&key("term-a", "review_1")).unwrap();
    assert_eq!(call.answer().await, json!({ "dismissed": true }));
    assert_eq!(webview.next_removed().await, key("term-a", "review_1"));

    let call = reviewed(&seam, &mut webview, "Plan").await;
    seam.surfaces.answer(&key("term-a", "review_2"), 1, verdict()).unwrap();
    assert_eq!(call.answer().await, verdict());
    seam.surfaces.dismiss(&key("term-a", "review_2")).unwrap();
    assert_eq!(webview.next_removed().await, key("term-a", "review_2"));
    assert_eq!(seam.typed("term-a"), "");
}

#[tokio::test]
async fn the_same_review_again_rejoins_its_tab_and_both_calls_get_the_verdict() {
    let (seam, mut webview) = start(Timing::default()).await;
    let first = reviewed(&seam, &mut webview, "Plan").await;
    let again = seam.cli("term-a").call("quay_review", json!({ "body": "One step.", "title": "Plan" }));
    assert!(webview.no_check().await && again.is_open());
    seam.surfaces.answer(&key("term-a", "review_1"), 1, verdict()).unwrap();
    for call in [first, again] {
        assert_eq!(call.answer().await, verdict());
    }
}
