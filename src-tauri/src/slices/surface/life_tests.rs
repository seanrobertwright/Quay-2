//! A surface's life at the `/mcp` seam: a test for each row of the event table in the A2UI spec (#706),
//! in the table's order and named by its row. The details of a row are in the tests of what it is about.

use serde_json::json;

use super::raw_seam::{action, create, created, delete, makes_one, messages, plan, read, sent, told, update};
use super::store::{AnswerRefused, SurfaceRecord};
use super::test_seam::{accepted, answer_to, key, question, start, FakeCli, FakeWebview, OpenCall, Seam};
use super::timing::Timing;
use crate::slices::pty::models::{ClaudeStatus, RunKind};

/// A seam whose `term-a` has created the asking raw surface `plan`, and the call that did.
async fn with_plan() -> (Seam, FakeWebview, FakeCli, OpenCall, SurfaceRecord) {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let (call, shown) = created(&seam, &mut webview, &cli, "plan", "companion", true).await;
    (seam, webview, cli, call, shown)
}

/// The operator's answer to `revision` of the surface `plan`.
fn answer(seam: &Seam, revision: u64) -> Result<(), AnswerRefused> {
    seam.surfaces.answer(&key("term-a", "plan"), revision, action())
}

#[tokio::test]
async fn the_first_answer_settles_the_surface_and_a_second_is_refused() {
    let (seam, _webview, cli, call, _) = with_plan().await;
    answer(&seam, 1).unwrap();
    assert_eq!(call.answer().await, action());
    assert_eq!(answer(&seam, 1), Err(AnswerRefused::AlreadyAnswered));
    assert_eq!(read(&cli, "plan").await["state"], "answered");
}

#[tokio::test]
async fn an_answer_to_an_older_revision_is_refused_the_surface_redraws_and_the_operator_clicks_again() {
    let (seam, mut webview, cli, _call, _) = with_plan().await;
    let second = sent(&seam, &mut webview, &cli, &[update("plan")], &["plan"]).await;
    let shown = webview.next_shown().await;
    assert_eq!(answer(&seam, 1), Err(AnswerRefused::OlderRevision));
    assert_eq!(webview.next_shown().await, shown);
    answer(&seam, shown.revision).unwrap();
    assert_eq!(second.answer().await, action());
}

#[tokio::test]
async fn the_same_creating_call_again_rejoins_its_unanswered_surface_and_a_repeat_of_a_settled_one_makes_a_new_one() {
    let (seam, mut webview, cli, first, shown) = with_plan().await;
    let second = cli.call("quay_surface", plan("plan", "companion"));
    assert!(webview.no_check().await);
    answer(&seam, 1).unwrap();
    for call in [first, second] {
        assert_eq!(call.answer().await, action());
    }
    webview.next_shown().await;
    let (third, again) = created(&seam, &mut webview, &cli, "plan", "companion", true).await;
    assert!(third.is_open() && again.order > shown.order && again.reopened.is_none());
}

#[tokio::test]
async fn a_create_or_a_board_with_an_id_in_use_by_other_content_is_rejected() {
    let (seam, mut webview, cli, _call, shown) = with_plan().await;
    let mut other = plan("plan", "tab");
    other["title"] = json!("Other");
    for (tool, arguments) in [("quay_surface", other), ("quay_board", json!({ "title": "Nightly", "id": "plan" }))] {
        let call = cli.call(tool, arguments);
        let verdict = if tool == "quay_board" { accepted(false) } else { makes_one("plan", true) };
        seam.surfaces.verdict(webview.next_check().await.call, verdict);
        let (errors, _) = told(call).await;
        assert_eq!((&errors[0]["code"], &errors[0]["surfaceId"]), (&json!("INTEGRITY_ERROR"), &json!("plan")));
    }
    assert_eq!(seam.surfaces.surfaces(), vec![shown]);
}

#[tokio::test]
async fn an_update_to_an_unknown_id_is_rejected() {
    let (seam, mut webview, cli, _call, _) = with_plan().await;
    let call = sent(&seam, &mut webview, &cli, &[update("other")], &[]).await;
    let message = "No surface \"other\" in this terminal. Create it first.";
    assert_eq!(
        told(call).await.0,
        json!([{ "code": "INTEGRITY_ERROR", "surfaceId": "other", "path": "/messages/0/updateDataModel", "message": message }])
    );
}

#[tokio::test]
async fn a_delete_of_an_unknown_or_deleted_id_is_accepted_and_does_nothing() {
    let (seam, mut webview, cli, _call, shown) = with_plan().await;
    created(&seam, &mut webview, &cli, "other", "companion", false).await;
    for id in ["unknown", "other", "other"] {
        let call = sent(&seam, &mut webview, &cli, &[delete(id)], &[]).await;
        assert_eq!(call.answer().await, json!({ "deleted": true }));
    }
    assert_eq!(seam.surfaces.surfaces(), vec![shown]);
}

#[tokio::test]
async fn any_message_for_a_dismissed_id_is_dismissed_until_the_terminal_exits() {
    let (seam, mut webview, cli, call, _) = with_plan().await;
    seam.surfaces.dismiss(&key("term-a", "plan")).unwrap();
    assert_eq!(call.answer().await, json!({ "dismissed": true }));
    for arguments in [plan("plan", "companion"), messages(&[update("plan")]), messages(&[delete("plan")]), messages(&[delete("plan"), create("plan")])] {
        assert_eq!(cli.call("quay_surface", arguments).answer().await, json!({ "dismissed": true }));
    }
    let board = cli.call("quay_board", json!({ "title": "Nightly", "id": "plan" }));
    assert_eq!(board.answer().await, json!({ "dismissed": true }));

    seam.open_terminal("term-a", RunKind::Claude, ClaudeStatus::Working);
    created(&seam, &mut webview, &cli, "plan", "companion", true).await;
}

#[tokio::test]
async fn an_update_to_an_answered_raw_surface_opens_it_again_at_the_end_of_the_queue_and_the_call_waits() {
    let (seam, mut webview, cli, call, _) = with_plan().await;
    answer(&seam, 1).unwrap();
    call.answer().await;
    webview.next_shown().await;
    let _other = seam.asked(&mut webview, "term-a", "One?").await;
    let order = seam.surfaces.surfaces().iter().map(|surface| surface.order).max().unwrap();

    let again = sent(&seam, &mut webview, &cli, &[update("plan")], &["plan"]).await;
    let shown = webview.next_shown().await;
    assert!(shown.asks && shown.answer.is_none() && shown.order > order);
    assert_eq!(shown.reopened.map(|reopened| reopened.answer), Some(action()));
    assert!(again.is_open());
    answer(&seam, 2).unwrap();
    assert_eq!(again.answer().await, action());
}

#[tokio::test]
async fn an_update_to_a_typed_surface_is_rejected() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let ask = seam.asked(&mut webview, "term-a", "One?").await;
    let components = json!({ "version": "1.0", "updateComponents": { "surfaceId": "ask_1", "components": [] } });
    for message in [components, update("ask_1")] {
        let call = sent(&seam, &mut webview, &cli, &[message], &[]).await;
        assert_eq!(told(call).await.0[0]["message"], "Surface \"ask_1\" was made by quay_ask. Call quay_ask again.");
    }
    seam.surfaces.answer(&key("term-a", "ask_1"), 1, answer_to("One?")).unwrap();
    assert_eq!(ask.answer().await, answer_to("One?"));
}

#[tokio::test]
async fn a_delete_of_a_surface_that_is_settled_or_asks_for_nothing_removes_it() {
    let (seam, mut webview, cli, call, _) = with_plan().await;
    answer(&seam, 1).unwrap();
    call.answer().await;
    created(&seam, &mut webview, &cli, "other", "companion", false).await;
    for id in ["plan", "other"] {
        let call = sent(&seam, &mut webview, &cli, &[delete(id)], &[]).await;
        assert_eq!(call.answer().await, json!({ "deleted": true }));
        assert_eq!(webview.next_removed().await, key("term-a", id));
    }
    assert!(seam.surfaces.surfaces().is_empty());
}

#[tokio::test]
async fn a_delete_of_a_live_asking_surface_locks_it_as_withdrawn() {
    let (seam, mut webview, cli, call, _) = with_plan().await;
    let deletes = sent(&seam, &mut webview, &cli, &[delete("plan")], &[]).await;
    assert_eq!(deletes.answer().await, json!({ "deleted": true }));
    assert_eq!(call.answer().await, json!({ "surface_id": "plan", "state": "withdrawn" }));
    assert!(webview.next_shown().await.withdrawn_at.is_some() && webview.none_removed());
    assert_eq!(answer(&seam, 1), Err(AnswerRefused::Withdrawn));
    assert_eq!(read(&cli, "plan").await["state"], "withdrawn");
}

#[tokio::test]
async fn a_delete_and_a_create_of_one_id_in_one_call_replace_in_place_with_no_stub() {
    let (seam, mut webview, cli, _call, shown) = with_plan().await;
    let again = sent(&seam, &mut webview, &cli, &[delete("plan"), create("plan")], &["plan"]).await;
    let new = webview.next_shown().await;
    assert_eq!((new.order, new.revision, new.withdrawn_at), (shown.order, 2, None));
    assert!(again.is_open() && webview.none_removed());
    assert_eq!(seam.surfaces.surfaces(), vec![new]);
}

#[tokio::test]
async fn the_end_of_the_agents_turn_does_nothing_to_its_surfaces() {
    let (seam, _webview, cli, call, shown) = with_plan().await;
    cli.event("turn.completed", json!({})).await;
    // It ends the wait, and no more
    assert_eq!(call.answer().await["state"], "no_answer_yet");
    assert_eq!(seam.surfaces.surfaces(), vec![shown]);
}

#[tokio::test]
async fn when_the_process_exits_its_surfaces_end_and_stay_and_counts_and_dismissed_ids_are_forgotten() {
    let (seam, mut webview) = start(Timing::default()).await;
    let launch = seam.open_terminal("term-a", RunKind::Claude, ClaudeStatus::Working);
    let cli = seam.cli("term-a");
    let (call, _) = created(&seam, &mut webview, &cli, "plan", "companion", true).await;
    created(&seam, &mut webview, &cli, "gone", "companion", false).await;
    seam.surfaces.dismiss(&key("term-a", "gone")).unwrap();
    for _ in 0..2 {
        told(cli.call("quay_surface", json!({ "messages": 1 }))).await;
    }
    assert!(seam.pty_manager.exit_launch(&launch, Some(0)));
    let ended = webview.next_shown().await;
    assert!(ended.id == "plan" && ended.ended_at.is_some());
    assert_eq!(call.answer().await["state"], "ended");
    assert_eq!(seam.surfaces.surfaces(), vec![ended]);

    seam.open_terminal("term-a", RunKind::Claude, ClaudeStatus::Working);
    let (_, next) = told(cli.call("quay_surface", json!({ "messages": 1 }))).await;
    assert!(next.starts_with("Nothing was changed."), "the row of rejections starts again: {next}");
    created(&seam, &mut webview, &cli, "gone", "companion", false).await;
}

#[tokio::test]
async fn after_a_relaunch_nothing_is_answerable() {
    let (seam, mut webview, cli, _call, _) = with_plan().await;
    seam.open_terminal("term-a", RunKind::Claude, ClaudeStatus::Working);
    webview.next_shown().await;
    assert_eq!(answer(&seam, 1), Err(AnswerRefused::Ended));
    let call = sent(&seam, &mut webview, &cli, &[update("plan")], &[]).await;
    let message = "Surface \"plan\" ended when this terminal exited. Delete it and create it again.";
    assert_eq!(told(call).await.0[0]["message"], message);
    assert_eq!(answer(&seam, 1), Err(AnswerRefused::Ended));
}

#[tokio::test]
async fn when_the_terminal_is_closed_all_its_surfaces_are_removed() {
    let (seam, mut webview, cli, _call, _) = with_plan().await;
    created(&seam, &mut webview, &cli, "other", "tab", false).await;
    sent(&seam, &mut webview, &cli, &[delete("plan")], &[]).await.answer().await;
    seam.surfaces.terminal_closed("term-a");
    let mut removed = [webview.next_removed().await.id, webview.next_removed().await.id];
    removed.sort();
    assert_eq!(removed, ["other", "plan"]);
    assert!(seam.surfaces.surfaces().is_empty());
}

#[tokio::test]
async fn after_quay_restarts_there_are_none() {
    let (before, ..) = with_plan().await;
    assert_eq!(before.surfaces.surfaces().len(), 1);
    let (after, mut webview) = start(Timing::default()).await;
    assert!(after.surfaces.surfaces().is_empty());
    let ask = after.cli("term-a").call("quay_ask", question("One?"));
    after.surfaces.verdict(webview.next_check().await.call, accepted(true));
    assert_eq!(webview.next_shown().await.id, "ask_1");
    assert!(ask.is_open());
}
