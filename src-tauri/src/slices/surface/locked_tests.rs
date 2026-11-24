//! Locked surfaces, at the `/mcp` seam: how many a terminal keeps, and what is told of those that leave.
//! What a later message for a dismissed id is told is at the store's own seam and at `check_and_commit`,
//! for `quay_ask` takes no id of its agent's. `quay_board` does, and is tested where it is.

use std::time::Duration;

use serde_json::{json, Value};

use super::check::Verdict;
use super::place::Place;
use super::store::{CommitRefused, Creation, OpenedCall, SurfaceKey, SurfaceRecord, SurfaceStore};
use super::test_seam::{accepted, answer_to, key, question, start, FakeCli, FakeWebview, Seam};
use super::timing::Timing;
use crate::slices::pty::models::{ClaudeStatus, RunKind};
use crate::slices::pty::plugin_watch::LaunchRef;

/// A seam whose `term-a` is idle, so a line for it is typed at once, with the launch it is in.
async fn idle(timing: Timing) -> (Seam, FakeWebview, LaunchRef) {
    let (seam, webview) = start(timing).await;
    let launch = seam.open_terminal("term-a", RunKind::Claude, ClaudeStatus::Idle);
    (seam, webview, launch)
}

async fn read(cli: &FakeCli, id: &str) -> Value {
    cli.call("quay_surface_read", json!({ "surface_id": id })).answer().await
}

/// Has `term-a` ask `count` questions, each answered before the next. Nothing else has been shown.
async fn answered(seam: &Seam, webview: &mut FakeWebview, count: usize) {
    for n in 1..=count {
        seam.asked(webview, "term-a", &format!("Question {n}?")).await;
        settle(seam, webview, &format!("ask_{n}")).await;
    }
}

async fn settle(seam: &Seam, webview: &mut FakeWebview, id: &str) {
    seam.surfaces.answer(&key("term-a", id), 1, answer_to("One?")).unwrap();
    assert!(webview.next_shown().await.answer.is_some());
}

/// The ids of `term-a`'s locked surfaces, in the order they were asked.
fn locked(seam: &Seam) -> Vec<String> {
    let mut ids: Vec<(usize, String)> = seam
        .surfaces
        .surfaces()
        .into_iter()
        .filter(|s| s.terminal_id == "term-a" && (s.answer.is_some() || s.ended_at.is_some()))
        .map(|s| (s.id["ask_".len()..].parse().unwrap(), s.id))
        .collect();
    ids.sort();
    ids.into_iter().map(|(_, id)| id).collect()
}

fn asks(numbers: std::ops::RangeInclusive<usize>) -> Vec<String> {
    numbers.map(|n| format!("ask_{n}")).collect()
}

#[tokio::test]
async fn the_eleventh_to_lock_has_the_first_that_did_leave_at_once() {
    let (seam, mut webview, _) = idle(Timing::default()).await;
    let first = seam.asked(&mut webview, "term-a", "First?").await;
    // Asked after it and answered before it
    for n in 2..=11 {
        seam.asked(&mut webview, "term-a", &format!("Question {n}?")).await;
        settle(&seam, &mut webview, &format!("ask_{n}")).await;
    }
    assert!(webview.none_removed(), "ten are kept");

    settle(&seam, &mut webview, "ask_1").await;
    first.answer().await;

    assert_eq!(webview.next_removed().await, key("term-a", "ask_2"), "it locked first");
    assert!(webview.none_removed());
    let mut kept = asks(3..=11);
    kept.insert(0, "ask_1".to_string());
    assert_eq!(locked(&seam), kept);
}

#[tokio::test]
async fn an_answer_that_is_typed_in_locks_its_question_by_the_same_rule() {
    let (seam, mut webview, _) = idle(Timing { wait: Duration::from_millis(500), ..Timing::default() }).await;
    answered(&seam, &mut webview, 10).await;
    assert_eq!(seam.asked(&mut webview, "term-a", "Question 11?").await.answer().await["state"], "no_answer_yet");
    settle(&seam, &mut webview, "ask_11").await;
    assert!(seam.typed("term-a").contains("(ask_11)"));
    assert_eq!(webview.next_removed().await, key("term-a", "ask_1"));
    assert_eq!(locked(&seam), asks(2..=11));
}

#[tokio::test]
async fn each_terminal_keeps_ten_of_its_own_and_an_exit_leaves_ten_the_last_to_lock() {
    let (seam, mut webview, launch) = idle(Timing::default()).await;
    let other = seam.asked(&mut webview, "term-b", "One?").await;
    seam.surfaces.answer(&key("term-b", "ask_1"), 1, answer_to("One?")).unwrap();
    other.answer().await;
    webview.next_shown().await;
    answered(&seam, &mut webview, 9).await;
    for n in 10..=13 {
        seam.asked(&mut webview, "term-a", &format!("Question {n}?")).await;
    }
    assert!(webview.none_removed());

    seam.pty_manager.exit_launch(&launch, Some(0));

    for id in asks(1..=3) {
        assert_eq!(webview.next_removed().await, key("term-a", &id));
    }
    assert!(webview.none_removed());
    assert_eq!(locked(&seam), asks(4..=13));
}

#[tokio::test]
async fn one_that_left_by_the_limit_is_read_as_it_stood_and_makes_no_id_dismissed() {
    let (seam, mut webview, _) = idle(Timing::default()).await;
    answered(&seam, &mut webview, 11).await;
    webview.next_removed().await;
    let cli = seam.cli("term-a");
    assert_eq!(read(&cli, "ask_1").await, json!({ "surface_id": "ask_1", "state": "answered", "result": answer_to("One?") }));
}

#[tokio::test]
async fn dismissing_all_takes_the_locked_ones_that_were_seen_and_tells_the_agent_nothing() {
    let (seam, mut webview, launch) = idle(Timing::default()).await;
    answered(&seam, &mut webview, 2).await;
    seam.asked(&mut webview, "term-a", "Three?").await;
    seam.pty_manager.exit_launch(&launch, Some(0));
    webview.next_shown().await;
    seam.open_terminal("term-a", RunKind::Claude, ClaudeStatus::Idle);
    let live = seam.asked(&mut webview, "term-a", "Four?").await;
    let other = seam.asked(&mut webview, "term-b", "One?").await;
    seam.surfaces.answer(&key("term-b", "ask_1"), 1, answer_to("One?")).unwrap();
    other.answer().await;

    // ask_2 locked after the list was drawn, as far as the operator could see; ask_4 is live
    let seen = ["ask_1", "ask_3", "ask_4", "ask_9"].map(String::from);
    seam.surfaces.dismiss_locked("term-a", &seen);

    for id in ["ask_1", "ask_3"] {
        assert_eq!(webview.next_removed().await, key("term-a", id));
    }
    assert!(webview.none_removed());
    assert_eq!(locked(&seam), ["ask_2"]);
    assert!(live.is_open(), "a question that waits is not dismissed with them");
    assert_eq!(seam.typed("term-a"), "");
    assert_eq!(seam.surfaces.surfaces().iter().filter(|s| s.terminal_id == "term-b").count(), 1);
    let cli = seam.cli("term-a");
    assert_eq!(read(&cli, "ask_3").await["state"], "ended", "it stands as it did");
    seam.surfaces.dismiss_locked("term-c", &seen);
}

#[tokio::test]
async fn what_had_left_is_forgotten_at_the_exit_and_an_ended_one_dismissed_after_it_tells_nobody() {
    let (seam, mut webview, launch) = idle(Timing { wait: Duration::from_millis(1), ..Timing::default() }).await;
    let cli = seam.cli("term-a");
    seam.asked(&mut webview, "term-a", "One?").await.answer().await;
    seam.surfaces.dismiss(&key("term-a", "ask_1")).unwrap();
    assert_eq!(read(&cli, "ask_1").await["state"], "dismissed");
    seam.asked(&mut webview, "term-a", "Two?").await.answer().await;
    let typed = seam.typed("term-a");

    seam.pty_manager.exit_launch(&launch, Some(0));
    seam.surfaces.dismiss(&key("term-a", "ask_2")).unwrap();
    seam.open_terminal("term-a", RunKind::Claude, ClaudeStatus::Idle);

    let failure = cli.call("quay_surface_read", json!({ "surface_id": "ask_1" })).failure().await;
    assert!(failure.contains("No surface"), "{failure}");
    assert_eq!(read(&cli, "ask_2").await["state"], "ended");
    assert_eq!(typed.matches('\r').count(), 1, "only the first dismissal was told");
    assert_eq!(seam.typed("term-a"), "");
}

/// The store with `term` in its first launch.
fn store() -> SurfaceStore {
    let store = SurfaceStore::default();
    store.launched("term", 1);
    store
}

/// A new call of `term` that creates the surface `id`.
fn create(store: &SurfaceStore, id: &str) -> Result<SurfaceRecord, CommitRefused> {
    let call = store.open_call("term", &json!(1)).unwrap().number;
    let arguments = json!({ "of": id });
    let creation = Creation { tool: "quay_ask", arguments: &arguments, title: id, place: Place::Companion, call };
    let Verdict::Accepted(verdict) = accepted(true) else { panic!("not accepted") };
    store.commit(&SurfaceKey::new("term", id), creation, verdict)
}

/// Settles the surface `id` of `term`, which no call waits on, by an answer that was typed in.
fn answer_typed(store: &SurfaceStore, id: &str) {
    let key = SurfaceKey::new("term", id);
    assert!(store.answer(&key, 1, json!({})).is_ok());
    assert!(store.typed(&key).is_some());
}

#[test]
fn a_later_message_for_a_dismissed_id_finds_it_dismissed_until_the_terminal_exits() {
    let store = store();
    for id in ["plan", "ask_1"] {
        assert!(create(&store, id).is_ok());
        assert!(store.dismiss(&SurfaceKey::new("term", id)).is_ok());
    }
    store.rejected("term", "quay_ask");
    store.rejected("term", "quay_ask");
    assert_eq!(create(&store, "plan").err(), Some(CommitRefused::Dismissed));
    assert_eq!(store.rejected("term", "quay_ask"), 1, "it was accepted, which ends the row");
    assert!(store.list().is_empty());
    assert_eq!(store.name_ask("term").unwrap().id, "ask_2", "no ask is given a dismissed id");
    store.launched("other", 1);
    assert!(store.standing(&SurfaceKey::new("other", "plan")).is_none());

    // Also once more have left than can be read
    for n in 0..120 {
        let id = format!("board_{n}");
        assert!(create(&store, &id).is_ok());
        assert!(store.dismiss(&SurfaceKey::new("term", id)).is_ok());
    }
    assert_eq!(create(&store, "plan").err(), Some(CommitRefused::Dismissed));

    store.launch_over("term", 1);
    store.launched("term", 2);
    assert!(create(&store, "plan").is_ok(), "the later launch's own");
}

#[tokio::test]
async fn a_later_message_for_a_dismissed_id_is_told_so_and_is_not_checked() {
    let (seam, mut webview, _) = idle(Timing::default()).await;
    seam.asked(&mut webview, "term-a", "One?").await;
    seam.surfaces.dismiss(&key("term-a", "ask_1")).unwrap();
    let store = seam.surfaces.store();
    store.rejected("term-a", "quay_ask");
    store.rejected("term-a", "quay_ask");

    // `_rx` keeps its wait open
    let OpenedCall { number: call, rx: _rx, .. } = store.open_call("term-a", &json!(2)).unwrap();
    let arguments = question("Again?");
    let creation = Creation { tool: "quay_ask", arguments: &arguments, title: "Again?", place: Place::Companion, call };
    let refused = key("term-a", "ask_1");
    let reply = seam.surfaces.check_and_commit(&refused, creation, arguments.clone());
    // The webview gives no verdict: a message that it would reject is told the same
    let reply = tokio::time::timeout(Duration::from_secs(1), reply).await.expect("it waited for a verdict");

    let told = json!({ "content": [{ "type": "text", "text": r#"{"dismissed":true}"# }] });
    assert_eq!(reply, Err(told));
    assert!(webview.no_check().await);
    assert_eq!(store.rejected("term-a", "quay_ask"), 1, "it was accepted, which ends the row");
}

#[test]
fn what_is_dismissed_of_an_earlier_launch_is_no_dismissed_id_of_the_later_one() {
    let store = store();
    for id in ["plan", "notes"] {
        assert!(create(&store, id).is_ok());
    }
    store.launch_over("term", 1);
    store.launched("term", 2);
    assert!(store.dismiss(&SurfaceKey::new("term", "plan")).is_ok());
    assert_eq!(store.dismiss_locked("term", &["notes".to_string()]).len(), 1);

    for id in ["plan", "notes"] {
        assert!(create(&store, id).is_ok());
    }
}

#[test]
fn a_locked_one_that_is_dismissed_with_the_others_is_a_dismissed_id() {
    let store = store();
    assert!(create(&store, "plan").is_ok());
    answer_typed(&store, "plan");
    store.dismiss_locked("term", &["plan".to_string()]);
    assert_eq!(create(&store, "plan").err(), Some(CommitRefused::Dismissed));
}

#[test]
fn one_that_left_by_the_limit_counts_as_deleted() {
    let store = store();
    for n in 0..=10 {
        let id = format!("plan_{n}");
        assert!(create(&store, &id).is_ok());
        answer_typed(&store, &id);
    }
    assert_eq!(store.list().len(), 10);
    assert!(create(&store, "plan_0").is_ok(), "its id can be created again");
    assert_eq!(create(&store, "plan_1").err(), Some(CommitRefused::IdInUse));
}
