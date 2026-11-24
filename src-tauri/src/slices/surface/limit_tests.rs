//! How many surfaces a terminal may have, at the `/mcp` seam.

use std::ops::RangeInclusive;
use std::time::Duration;

use serde_json::{json, Value};

use super::store::SurfaceKey;
use super::test_seam::{accepted, answer_to, question, start, until, FakeWebview, OpenCall, Seam};
use super::timing::Timing;

async fn four_asked(seam: &Seam, webview: &mut FakeWebview) -> Vec<OpenCall> {
    let mut calls = Vec::new();
    for n in 1..=4 {
        calls.push(seam.asked(webview, "term-a", &format!("Waiting {n}?")).await);
    }
    calls
}

/// The ids of `terminal_id`'s surfaces, in the order they were drawn.
fn ids(seam: &Seam, terminal_id: &str) -> Vec<String> {
    let mut kept = seam.surfaces.surfaces();
    kept.retain(|record| record.terminal_id == terminal_id);
    kept.sort_by_key(|record| record.order);
    kept.into_iter().map(|record| record.id).collect()
}

#[tokio::test]
async fn a_fifth_live_surface_in_a_place_is_rejected_and_another_terminal_has_its_own_four() {
    let (seam, mut webview) = start(Timing::default()).await;
    let calls = four_asked(&seam, &mut webview).await;

    let fifth = seam.cli("term-a").call("quay_ask", question("Fifth?"));
    seam.surfaces.verdict(webview.next_check().await.call, accepted(true));

    assert_eq!(
        serde_json::from_str::<Value>(&fifth.failure().await).unwrap(),
        json!({
            "errors": [{
                "code": "VALIDATION_FAILED",
                "path": "",
                "message": "This terminal has four live surfaces in companion, the most allowed. Wait for an answer, delete one, or put several questions in one quay_ask.",
            }],
            "next": "Nothing was shown. Correct the call and send it again.",
        })
    );
    assert!(webview.nothing_shown().await && webview.none_removed());
    assert!(calls.iter().all(OpenCall::is_open));
    assert_eq!(ids(&seam, "term-a"), ["ask_1", "ask_2", "ask_3", "ask_4"]);

    let other = seam.asked(&mut webview, "term-b", "Fifth?").await;
    assert!(other.is_open());
}

#[tokio::test]
async fn calls_sent_at_once_cannot_pass_the_four() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let calls: Vec<OpenCall> = (0..8).map(|n| cli.call("quay_ask", question(&format!("Question {n}?")))).collect();
    for _ in 0..8 {
        seam.surfaces.verdict(webview.next_check().await.call, accepted(true));
    }
    until(|| calls.iter().filter(|call| !call.is_open()).count() == 4, "four calls were not rejected").await;

    assert_eq!(ids(&seam, "term-a").len(), 4);
    assert!(webview.none_removed());
}

#[tokio::test]
async fn a_question_whose_call_is_over_still_counts_and_makes_no_room() {
    let (seam, mut webview) = start(Timing { wait: Duration::from_millis(1), ..Timing::default() }).await;
    for call in four_asked(&seam, &mut webview).await {
        assert_eq!(call.answer().await["state"], "no_answer_yet");
    }

    let fifth = seam.cli("term-a").call("quay_ask", question("Fifth?"));
    seam.surfaces.verdict(webview.next_check().await.call, accepted(true));

    assert!(fifth.failure().await.contains("four live surfaces in companion"));
    assert!(webview.none_removed());
    assert_eq!(ids(&seam, "term-a"), ["ask_1", "ask_2", "ask_3", "ask_4"]);
}

#[tokio::test]
async fn with_four_live_the_same_call_again_rejoins_its_question_and_a_dismissal_makes_room() {
    let (seam, mut webview) = start(Timing::default()).await;
    let mut calls = four_asked(&seam, &mut webview).await;

    let again = seam.cli("term-a").call("quay_ask", question("Waiting 1?"));
    assert!(webview.no_check().await && again.is_open(), "it asks for no fifth");

    seam.surfaces.dismiss(&SurfaceKey::new("term-a", "ask_1")).unwrap();
    for call in [calls.remove(0), again] {
        assert_eq!(call.answer().await, json!({ "dismissed": true }));
    }
    let _next = seam.asked(&mut webview, "term-a", "Next?").await;
    assert_eq!(ids(&seam, "term-a"), ["ask_2", "ask_3", "ask_4", "ask_5"]);
}

#[tokio::test]
async fn a_surface_that_asks_for_nothing_counts_too() {
    let (seam, mut webview) = start(Timing::default()).await;
    for _ in 0..4 {
        let call = seam.shown(&mut webview, "term-a", "One?").await;
        assert_eq!(call.answer().await, json!({ "shown": true }));
    }
    let fifth = seam.cli("term-a").call("quay_ask", question("Fifth?"));
    seam.surfaces.verdict(webview.next_check().await.call, accepted(true));
    assert!(fifth.failure().await.contains("four live surfaces in companion"));
}

/// Has `term-a` ask these of its asks, by number, each answered before the next.
async fn asked_and_answered(seam: &Seam, webview: &mut FakeWebview, asks: RangeInclusive<usize>) {
    for n in asks {
        seam.asked(webview, "term-a", &format!("Question {n}?")).await;
        settle(seam, webview, n).await;
    }
}

/// Answers `term-a`'s `n`th ask.
async fn settle(seam: &Seam, webview: &mut FakeWebview, n: usize) {
    seam.surfaces.answer(&SurfaceKey::new("term-a", format!("ask_{n}")), 1, answer_to("One?")).unwrap();
    webview.next_shown().await;
}

#[tokio::test]
async fn an_answer_makes_room_and_ten_answered_all_stay() {
    let (seam, mut webview) = start(Timing::default()).await;
    let _waiting = four_asked(&seam, &mut webview).await;
    // Ten answered, with the first three still waiting
    settle(&seam, &mut webview, 4).await;
    asked_and_answered(&seam, &mut webview, 5..=13).await;

    let _next = seam.asked(&mut webview, "term-a", "Next?").await;

    assert!(webview.none_removed());
    assert_eq!(ids(&seam, "term-a").len(), 14);
}

#[tokio::test]
async fn the_answered_past_ten_leave_as_they_are_answered_and_what_comes_next_takes_none() {
    let (seam, mut webview) = start(Timing::default()).await;
    asked_and_answered(&seam, &mut webview, 1..=9).await;
    let _waiting = four_asked(&seam, &mut webview).await;
    for n in 10..=13 {
        settle(&seam, &mut webview, n).await;
    }
    for id in ["ask_1", "ask_2", "ask_3"] {
        assert_eq!(webview.next_removed().await, SurfaceKey::new("term-a", id));
    }

    let _next = seam.asked(&mut webview, "term-a", "Next?").await;

    assert!(webview.none_removed());
    assert_eq!(
        ids(&seam, "term-a"),
        ["ask_4", "ask_5", "ask_6", "ask_7", "ask_8", "ask_9", "ask_10", "ask_11", "ask_12", "ask_13", "ask_14"]
    );
}
