//! How many surfaces a terminal may have, at the `/mcp` seam.

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

#[tokio::test]
async fn an_answer_makes_room_and_the_oldest_of_ten_answered_leaves_for_the_next() {
    let (seam, mut webview) = start(Timing::default()).await;
    let _waiting = four_asked(&seam, &mut webview).await;
    let settle = |id: String| seam.surfaces.answer(&SurfaceKey::new("term-a", id), 1, answer()).unwrap();
    // Ten answered, with the first three still waiting
    settle("ask_4".to_string());
    webview.next_shown().await;
    for n in 5..=13 {
        asked(&seam, &mut webview, "term-a").await;
        settle(format!("ask_{n}"));
        webview.next_shown().await;
    }
    assert!(webview.none_removed());
    assert_eq!(ids(&seam, "term-a").len(), 13);

    let _next = asked(&seam, &mut webview, "term-a").await;

    assert_eq!(webview.next_removed().await, SurfaceKey::new("term-a", "ask_4"));
    let kept = ids(&seam, "term-a");
    assert_eq!((kept.len(), &kept[..4]), (13, &["ask_1", "ask_2", "ask_3", "ask_5"].map(String::from)[..]));
}
