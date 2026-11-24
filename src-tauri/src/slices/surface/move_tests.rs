//! The operator's move of a raw companion surface to a stage tab and back, at the `/mcp` seam: what stays
//! as it was, and that its agent cannot tell.

use std::time::Duration;

use serde_json::{json, Value};

use super::place::Place;
use super::raw_seam::{action, create, created, delete, makes, makes_one, messages, plan, told, told_by_rust, update};
use super::store::MoveRefused;
use super::test_seam::{accepted, key, start};
use super::timing::Timing;
use crate::slices::pty::models::{ClaudeStatus, RunKind};

#[tokio::test]
async fn a_move_keeps_the_surface_and_its_waiting_call_and_is_not_told_to_the_agent() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let (call, shown) = created(&seam, &mut webview, &cli, "plan", "companion", true).await;
    let save = json!({ "page": 1, "save": 1, "order": shown.order, "revision": 1, "values": { "/note": "half" } });
    seam.surfaces.save_unsent(&key("term-a", "plan"), serde_json::from_value(save).unwrap()).unwrap();
    assert!(!shown.as_tab);

    let mut before = shown;
    for as_tab in [true, false, true] {
        let moved = seam.surfaces.move_surface(&key("term-a", "plan"), as_tab).unwrap();
        assert_eq!(webview.next_shown().await, moved);
        assert!(moved.change > before.change);
        let expected = super::store::SurfaceRecord { as_tab, change: moved.change, ..before.clone() };
        assert_eq!(moved, expected, "nothing else of it changes");
        before = moved;
    }
    assert!(call.is_open() && webview.none_removed());
    assert_eq!(json!(seam.surfaces.open_page())["unsent"][0]["values"], json!({ "/note": "half" }));
    let read = cli.call("quay_surface_read", json!({ "surface_id": "plan" }));
    assert_eq!(read.answer().await, json!({ "surface_id": "plan", "state": "no_answer_yet" }));
    assert_eq!(seam.typed("term-a"), "");

    seam.surfaces.answer(&key("term-a", "plan"), 1, action()).unwrap();
    assert_eq!(call.answer().await, action());
    assert!(webview.next_shown().await.as_tab, "it stays where it was moved to");
}

#[tokio::test]
async fn to_its_agent_a_moved_surface_is_in_the_companion_and_takes_up_room_there() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    for n in 0..4 {
        created(&seam, &mut webview, &cli, &format!("plan{n}"), "companion", false).await;
        seam.surfaces.move_surface(&key("term-a", &format!("plan{n}")), true).unwrap();
        webview.next_shown().await;
    }
    let fifth = cli.call("quay_surface", plan("plan", "companion"));
    seam.surfaces.verdict(webview.next_check().await.call, makes_one("plan", false));
    let (errors, _) = told(fifth).await;
    assert!(errors[0]["message"].as_str().unwrap().contains("four live surfaces in companion"), "{errors}");
    for n in 0..4 {
        created(&seam, &mut webview, &cli, &format!("tab{n}"), "tab", false).await;
    }

    let mut other = messages(&[update("plan0")]);
    other["place"] = json!("tab");
    let errors = told_by_rust(&seam, &mut webview, other.clone()).await;
    assert_eq!(errors[0]["message"], "Surface \"plan0\" is in companion, and a surface's place is fixed. To move it, delete it and create it again.");
    other["place"] = json!("companion");
    let call = cli.call("quay_surface", other);
    let check = webview.next_check().await;
    assert_eq!(check.held[0].place, Place::Companion);
    seam.surfaces.verdict(check.call, makes_one("plan0", false));
    assert_eq!(call.answer().await, json!({ "shown": true }));
    let shown = webview.next_shown().await;
    assert!(shown.as_tab && shown.revision == 2, "an update leaves it where the operator has it");
}

#[tokio::test]
async fn a_move_lasts_through_an_answer_and_an_opening_again_and_not_through_a_replacement() {
    let (seam, mut webview) = start(Timing { wait: Duration::from_millis(1), ..Timing::default() }).await;
    seam.open_terminal("term-a", RunKind::Claude, ClaudeStatus::Idle);
    let cli = seam.cli("term-a");
    let (_call, _) = created(&seam, &mut webview, &cli, "plan", "companion", true).await;
    seam.surfaces.move_surface(&key("term-a", "plan"), true).unwrap();
    webview.next_shown().await;
    let surfaces = seam.surfaces.clone();
    tokio::task::spawn_blocking(move || surfaces.answer(&key("term-a", "plan"), 1, action())).await.unwrap().unwrap();
    assert!(webview.next_shown().await.as_tab);
    let refused = seam.surfaces.move_surface(&key("term-a", "plan"), false).unwrap_err();
    assert_eq!(refused, MoveRefused::Locked);

    let _again = cli.call("quay_surface", messages(&[update("plan")]));
    seam.surfaces.verdict(webview.next_check().await.call, makes_one("plan", true));
    let again = webview.next_shown().await;
    assert!(again.as_tab && again.reopened.is_some());
    let mut arguments = plan("plan", "companion");
    arguments["messages"] = json!([delete("plan"), create("plan")]);
    let _new = cli.call("quay_surface", arguments);
    seam.surfaces.verdict(webview.next_check().await.call, makes(vec![("plan", super::raw_seam::surface(true))]));
    assert!(!webview.next_shown().await.as_tab, "it is another surface, where its agent put it");
}

#[tokio::test]
async fn only_a_live_raw_companion_surface_is_moved() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    created(&seam, &mut webview, &cli, "tab", "tab", false).await;
    created(&seam, &mut webview, &cli, "strip", "strip", false).await;
    let _ask = seam.asked(&mut webview, "term-a", "One?").await;
    let review = cli.call("quay_review", json!({ "title": "Plan", "body": "x" }));
    seam.surfaces.verdict(webview.next_check().await.call, accepted(true));
    webview.next_shown().await;
    let (_open, _) = created(&seam, &mut webview, &cli, "gone", "companion", true).await;
    let deletes = cli.call("quay_surface", messages(&[delete("gone")]));
    seam.surfaces.verdict(webview.next_check().await.call, makes(vec![]));
    deletes.answer().await;
    webview.next_shown().await;
    let before: Vec<Value> = seam.surfaces.surfaces().into_iter().map(|record| json!(record)).collect();

    for (id, why) in [
        ("tab", MoveRefused::NotMovable),
        ("strip", MoveRefused::NotMovable),
        ("ask_1", MoveRefused::NotMovable),
        ("review_1", MoveRefused::NotMovable),
        ("gone", MoveRefused::Locked),
        ("never", MoveRefused::NoSuchSurface),
    ] {
        assert_eq!(seam.surfaces.move_surface(&key("term-a", id), true), Err(why), "{id}");
    }
    assert_eq!(seam.surfaces.move_surface(&key("term-b", "gone"), true), Err(MoveRefused::NoSuchSurface));
    assert!(webview.nothing_shown().await && review.is_open());
    let after: Vec<Value> = seam.surfaces.surfaces().into_iter().map(|record| json!(record)).collect();
    assert_eq!(after, before);
}
