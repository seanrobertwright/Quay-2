//! How many surfaces a terminal may have, at the `/mcp` seam.

use std::ops::RangeInclusive;

use serde_json::{json, Value};

use super::ask_tests::{answer, asked, question};
use super::store::SurfaceKey;
use super::test_seam::{accepted, start, FakeWebview, OpenCall, Seam, A_WHILE};
use super::timing::Timing;

async fn four_asked(seam: &Seam, webview: &mut FakeWebview) -> Vec<OpenCall> {
    let mut calls = Vec::new();
    for _ in 0..4 {
        calls.push(asked(seam, webview, "term-a").await);
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

    let fifth = seam.cli("term-a").call("quay_ask", question());
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

    let other = asked(&seam, &mut webview, "term-b").await;
    assert!(other.is_open());
}

#[tokio::test]
async fn calls_sent_at_once_cannot_pass_the_four() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let calls: Vec<OpenCall> = (0..8).map(|_| cli.call("quay_ask", question())).collect();
    for _ in 0..8 {
        seam.surfaces.verdict(webview.next_check().await.call, accepted(true));
    }
    tokio::time::sleep(A_WHILE).await;

    assert_eq!(calls.iter().filter(|call| call.is_open()).count(), 4);
    assert_eq!(ids(&seam, "term-a").len(), 4);
    assert!(webview.none_removed());
}

#[tokio::test]
async fn a_question_whose_call_is_over_still_counts_and_makes_no_room() {
    let (seam, mut webview) = start(Timing::default()).await;
    for call in four_asked(&seam, &mut webview).await {
        call.hang_up();
    }
    tokio::time::sleep(A_WHILE).await;

    let fifth = seam.cli("term-a").call("quay_ask", question());
    seam.surfaces.verdict(webview.next_check().await.call, accepted(true));

    assert!(fifth.failure().await.contains("four live surfaces in companion"));
    assert!(webview.none_removed());
    assert_eq!(ids(&seam, "term-a"), ["ask_1", "ask_2", "ask_3", "ask_4"]);
}

#[tokio::test]
async fn a_surface_that_asks_for_nothing_counts_too() {
    let (seam, mut webview) = start(Timing::default()).await;
    for _ in 0..4 {
        let call = seam.cli("term-a").call("quay_ask", question());
        seam.surfaces.verdict(webview.next_check().await.call, accepted(false));
        assert_eq!(call.answer().await, json!({ "shown": true }));
    }
    let fifth = seam.cli("term-a").call("quay_ask", question());
    seam.surfaces.verdict(webview.next_check().await.call, accepted(true));
    assert!(fifth.failure().await.contains("four live surfaces in companion"));
}

/// Has `term-a` ask these of its asks, by number, each answered before the next.
async fn asked_and_answered(seam: &Seam, webview: &mut FakeWebview, asks: RangeInclusive<usize>) {
    for n in asks {
        asked(seam, webview, "term-a").await;
        settle(seam, webview, n).await;
    }
}

/// Answers `term-a`'s `n`th ask.
async fn settle(seam: &Seam, webview: &mut FakeWebview, n: usize) {
    seam.surfaces.answer(&SurfaceKey::new("term-a", format!("ask_{n}")), 1, answer()).unwrap();
    webview.next_shown().await;
}

#[tokio::test]
async fn an_answer_makes_room_and_ten_answered_all_stay() {
    let (seam, mut webview) = start(Timing::default()).await;
    let _waiting = four_asked(&seam, &mut webview).await;
    // Ten answered, with the first three still waiting
    settle(&seam, &mut webview, 4).await;
    asked_and_answered(&seam, &mut webview, 5..=13).await;

    let _next = asked(&seam, &mut webview, "term-a").await;

    assert!(webview.none_removed());
    assert_eq!(ids(&seam, "term-a").len(), 14);
}

#[tokio::test]
async fn the_answered_past_ten_leave_oldest_first_for_the_next() {
    let (seam, mut webview) = start(Timing::default()).await;
    asked_and_answered(&seam, &mut webview, 1..=9).await;
    let _waiting = four_asked(&seam, &mut webview).await;
    for n in 10..=13 {
        settle(&seam, &mut webview, n).await;
    }

    let _next = asked(&seam, &mut webview, "term-a").await;

    for id in ["ask_1", "ask_2", "ask_3"] {
        assert_eq!(webview.next_removed().await, SurfaceKey::new("term-a", id));
    }
    assert!(webview.none_removed());
    assert_eq!(
        ids(&seam, "term-a"),
        ["ask_4", "ask_5", "ask_6", "ask_7", "ask_8", "ask_9", "ask_10", "ask_11", "ask_12", "ask_13", "ask_14"]
    );
}
