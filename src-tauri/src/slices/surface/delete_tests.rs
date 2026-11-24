//! Deletes at the `/mcp` seam: what leaves, what is withdrawn, and what takes a deleted surface's place.

use std::time::Duration;

use serde_json::{json, Value};

use super::place::Place;
use super::raw_seam::{about_plan, action, create, created, delete, makes, makes_one, messages, plan, says, surface, told_by_rust, update};
use super::store::{AnswerRefused, SurfaceRecord};
use super::test_seam::{accepted, answer_to, key, question, start, FakeCli, FakeWebview, OpenCall, Seam};
use super::timing::Timing;
use super::unsent::UnsentRefused;

/// Has `cli` send these messages, which the webview accepts as making no surface.
async fn sent(seam: &Seam, webview: &mut FakeWebview, cli: &FakeCli, written: &[Value]) -> OpenCall {
    let call = cli.call("quay_surface", messages(written));
    seam.surfaces.verdict(webview.next_check().await.call, makes(vec![]));
    call
}

/// Has `cli` delete and create the surface `plan` in one call, in `place`.
async fn replaced(seam: &Seam, webview: &mut FakeWebview, cli: &FakeCli, place: &str, asks: bool) -> (OpenCall, SurfaceRecord) {
    let mut arguments = plan("plan", place);
    arguments["title"] = json!("Another plan");
    arguments["messages"] = json!([delete("plan"), create("plan")]);
    let call = cli.call("quay_surface", arguments);
    let check = webview.next_check().await;
    assert_eq!((check.surface_id.as_str(), check.held.len()), ("plan", 0), "it is made of nothing that was there");
    seam.surfaces.verdict(check.call, makes(vec![("plan", says(asks, "new"))]));
    (call, webview.next_shown().await)
}

async fn read(cli: &FakeCli, id: &str) -> Value {
    cli.call("quay_surface_read", json!({ "surface_id": id })).answer().await
}

fn ids(seam: &Seam) -> Vec<String> {
    let mut kept = seam.surfaces.surfaces();
    kept.sort_by_key(|record| record.order);
    kept.into_iter().map(|record| record.id).collect()
}

#[tokio::test]
async fn a_delete_of_a_live_asking_surface_withdraws_it_and_ends_its_wait() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let (raw, shown) = created(&seam, &mut webview, &cli, "plan", "companion", true).await;
    let typed = seam.asked(&mut webview, "term-a", "One?").await;

    for (id, waiting) in [("plan", raw), ("ask_1", typed)] {
        let call = sent(&seam, &mut webview, &cli, &[delete(id)]).await;
        assert_eq!(call.answer().await, json!({ "deleted": true }));
        assert_eq!(waiting.answer().await, json!({ "surface_id": id, "state": "withdrawn" }));
        let withdrawn = webview.next_shown().await;
        assert_eq!(withdrawn.id, id);
        assert!(withdrawn.withdrawn_at.is_some() && withdrawn.answer.is_none() && withdrawn.ended_at.is_none());
        assert_eq!(read(&cli, id).await, json!({ "surface_id": id, "state": "withdrawn" }));
        let refused = seam.surfaces.answer(&key("term-a", id), 1, action());
        assert_eq!(refused, Err(AnswerRefused::Withdrawn), "a withdrawn surface takes no answer");
    }
    assert!(webview.none_removed());
    let kept = seam.surfaces.surfaces();
    let plan = kept.iter().find(|surface| surface.id == "plan").unwrap();
    assert_eq!((&plan.state, plan.revision, plan.order), (&shown.state, 1, shown.order), "it stays as it was");
    assert_eq!(seam.typed("term-a"), "", "its agent is told by its calls only");
}

#[tokio::test]
async fn every_call_that_waits_on_a_withdrawn_surface_ends_once_and_one_that_waits_on_another_too_goes_on() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let (one, _) = created(&seam, &mut webview, &cli, "plan", "companion", true).await;
    let again = cli.call("quay_surface", plan("plan", "companion"));
    let (_other, _) = created(&seam, &mut webview, &cli, "other", "companion", true).await;
    let both = cli.call("quay_surface", messages(&[update("plan"), update("other")]));
    seam.surfaces.verdict(webview.next_check().await.call, makes(vec![("plan", surface(true)), ("other", surface(true))]));
    webview.next_shown().await;
    webview.next_shown().await;

    sent(&seam, &mut webview, &cli, &[delete("plan")]).await.answer().await;
    for call in [one, again] {
        assert_eq!(call.answer().await, json!({ "surface_id": "plan", "state": "withdrawn" }));
    }
    assert!(both.is_open());
    seam.surfaces.answer(&key("term-a", "other"), 2, action()).unwrap();
    assert_eq!(both.answer().await, action());
}

#[tokio::test]
async fn a_call_that_waits_on_two_is_told_once_when_both_are_withdrawn() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let (_one, _) = created(&seam, &mut webview, &cli, "one", "companion", true).await;
    let (_two, _) = created(&seam, &mut webview, &cli, "two", "companion", true).await;
    let both = cli.call("quay_surface", messages(&[update("one"), update("two")]));
    seam.surfaces.verdict(webview.next_check().await.call, makes(vec![("one", surface(true)), ("two", surface(true))]));
    webview.next_shown().await;
    webview.next_shown().await;
    sent(&seam, &mut webview, &cli, &[delete("two"), delete("one"), delete("two")]).await.answer().await;
    let told = both.answer().await;
    assert_eq!((&told["state"], told.as_object().unwrap().len()), (&json!("withdrawn"), 2));
}

#[tokio::test]
async fn a_withdrawn_surface_that_nothing_waits_for_is_told_to_nobody() {
    let (seam, mut webview) = start(Timing { wait: Duration::from_millis(1), ..Timing::default() }).await;
    let cli = seam.cli("term-a");
    let (call, _) = created(&seam, &mut webview, &cli, "plan", "companion", true).await;
    assert_eq!(call.answer().await["state"], "no_answer_yet");
    sent(&seam, &mut webview, &cli, &[delete("plan")]).await.answer().await;
    cli.event("turn.completed", json!({})).await;
    tokio::time::sleep(super::test_seam::A_WHILE).await;
    assert_eq!(seam.typed("term-a"), "");
}

#[tokio::test]
async fn a_delete_of_any_other_surface_removes_it() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    created(&seam, &mut webview, &cli, "shown", "companion", false).await;
    let board = cli.call("quay_board", json!({ "title": "Nightly" }));
    seam.surfaces.verdict(webview.next_check().await.call, accepted(false));
    board.answer().await;
    webview.next_shown().await;
    let (raw, _) = created(&seam, &mut webview, &cli, "plan", "companion", true).await;
    seam.surfaces.answer(&key("term-a", "plan"), 1, action()).unwrap();
    raw.answer().await;
    webview.next_shown().await;
    let ask = seam.asked(&mut webview, "term-a", "One?").await;
    seam.surfaces.answer(&key("term-a", "ask_1"), 1, answer_to("One?")).unwrap();
    ask.answer().await;

    let call = sent(&seam, &mut webview, &cli, &[delete("shown"), delete("board"), delete("plan"), delete("ask_1")]).await;
    assert_eq!(call.answer().await, json!({ "deleted": true }));
    for id in ["shown", "board", "plan", "ask_1"] {
        assert_eq!(webview.next_removed().await, key("term-a", id));
    }
    assert!(ids(&seam).is_empty());
    assert_eq!(read(&cli, "plan").await["result"], action(), "what its agent was answered stays readable");
    assert_eq!(read(&cli, "shown").await["state"], "shown");
    let errors = told_by_rust(&seam, &mut webview, messages(&[update("plan")])).await;
    assert_eq!(errors[0]["message"], "No surface \"plan\" in this terminal. Create it first.", "it is not opened again");
    created(&seam, &mut webview, &cli, "plan", "tab", false).await;
}

#[tokio::test]
async fn a_delete_twice_does_nothing_more_and_a_withdrawn_one_is_removed_by_the_second() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    created(&seam, &mut webview, &cli, "shown", "companion", false).await;
    let (_open, _) = created(&seam, &mut webview, &cli, "plan", "companion", true).await;
    for _ in 0..2 {
        let call = sent(&seam, &mut webview, &cli, &[delete("shown"), delete("shown"), delete("never")]).await;
        assert_eq!(call.answer().await, json!({ "deleted": true }));
    }
    assert_eq!(webview.next_removed().await, key("term-a", "shown"));
    assert!(webview.none_removed());

    let call = sent(&seam, &mut webview, &cli, &[delete("plan"), delete("plan")]).await;
    assert_eq!(call.answer().await, json!({ "deleted": true }));
    assert!(webview.next_shown().await.withdrawn_at.is_some(), "twice in one call is once");
    sent(&seam, &mut webview, &cli, &[delete("plan")]).await.answer().await;
    assert_eq!(webview.next_removed().await, key("term-a", "plan"));
    assert_eq!(read(&cli, "plan").await["state"], "withdrawn");
    created(&seam, &mut webview, &cli, "plan", "tab", false).await;
}

#[tokio::test]
async fn a_withdrawn_surface_keeps_its_id_and_what_was_typed_in_it() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let (_open, shown) = created(&seam, &mut webview, &cli, "plan", "companion", true).await;
    let typed = |save: u64, text: &str| {
        let save = json!({ "page": 1, "save": save, "order": shown.order, "revision": 1, "values": { "/note": text } });
        seam.surfaces.save_unsent(&key("term-a", "plan"), serde_json::from_value(save).unwrap())
    };
    typed(1, "half a").unwrap();
    sent(&seam, &mut webview, &cli, &[delete("plan")]).await.answer().await;
    let withdrawn = webview.next_shown().await;
    typed(2, "half a thought").unwrap();

    let errors = told_by_rust(&seam, &mut webview, plan("plan", "companion")).await;
    let in_use = "Surface \"plan\" already exists. Update it, or delete it and create it again.";
    assert_eq!(errors, json!([about_plan("INTEGRITY_ERROR", "/messages/0/createSurface", in_use)]));
    let errors = told_by_rust(&seam, &mut webview, messages(&[update("plan")])).await;
    let over = "Surface \"plan\" was deleted before the operator answered. Delete it and create it again.";
    assert_eq!(errors, json!([about_plan("VALIDATION_FAILED", "/messages/0/updateDataModel", over)]));

    assert_eq!(seam.surfaces.surfaces(), vec![withdrawn]);
    assert_eq!(json!(seam.surfaces.open_page())["unsent"][0]["values"], json!({ "/note": "half a thought" }));
}

#[tokio::test]
async fn a_withdrawn_surface_counts_as_locked_and_the_oldest_past_ten_leaves() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    for n in 0..11 {
        let id = format!("plan{n}");
        let (_, _) = created(&seam, &mut webview, &cli, &id, "companion", true).await;
        sent(&seam, &mut webview, &cli, &[delete(&id)]).await.answer().await;
        webview.next_shown().await;
    }
    assert_eq!(webview.next_removed().await, key("term-a", "plan0"));
    assert!(webview.none_removed());
    assert_eq!(seam.surfaces.surfaces().len(), 10);
    assert_eq!(read(&cli, "plan0").await["state"], "withdrawn");
}

#[tokio::test]
async fn a_withdrawn_surface_is_dismissed_without_a_word_and_does_not_end_with_its_terminal() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    for id in ["plan", "other"] {
        let (_, _) = created(&seam, &mut webview, &cli, id, "companion", true).await;
        sent(&seam, &mut webview, &cli, &[delete(id)]).await.answer().await;
        webview.next_shown().await;
    }
    seam.surfaces.dismiss(&key("term-a", "plan")).unwrap();
    assert_eq!(read(&cli, "plan").await["state"], "withdrawn");
    let call = cli.call("quay_surface", plan("plan", "companion"));
    assert_eq!(call.answer().await, json!({ "dismissed": true }));
    let launch = seam.open_terminal("term-a", crate::slices::pty::models::RunKind::Claude, crate::slices::pty::models::ClaudeStatus::Working);
    assert!(launch.launch > 0 && webview.nothing_shown().await);
    let kept = seam.surfaces.surfaces();
    assert!(kept.len() == 1 && kept[0].withdrawn_at.is_some() && kept[0].ended_at.is_none());
}

#[tokio::test]
async fn a_delete_and_a_create_of_one_id_replace_a_surface_in_place_with_no_stub() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let (first, shown) = created(&seam, &mut webview, &cli, "plan", "companion", true).await;
    let (_other, _) = created(&seam, &mut webview, &cli, "other", "companion", true).await;

    let (second, new) = replaced(&seam, &mut webview, &cli, "tab", true).await;
    assert_eq!((new.place, new.title.as_str(), &new.state), (Place::Tab, "Another plan", &says(true, "new").state));
    assert_eq!((new.order, new.began, new.revision), (shown.order, shown.began, 2), "in its place");
    assert_eq!(json!(new)["carried"], json!({ "from": 2, "set": {} }), "nothing the operator put in the old one is kept");
    assert_eq!(first.answer().await, json!({ "surface_id": "plan", "state": "withdrawn" }));
    assert!(second.is_open() && webview.none_removed() && webview.nothing_shown().await);
    assert_eq!(ids(&seam), ["plan", "other"]);

    assert_eq!(seam.surfaces.answer(&key("term-a", "plan"), 1, action()), Err(AnswerRefused::OlderRevision));
    let late = json!({ "page": 1, "save": 1, "order": shown.order, "revision": 1, "values": { "/note": "x" } });
    let late = seam.surfaces.save_unsent(&key("term-a", "plan"), serde_json::from_value(late).unwrap());
    assert_eq!(late, Err(UnsentRefused::OtherRevision));
    seam.surfaces.answer(&key("term-a", "plan"), 2, action()).unwrap();
    assert_eq!(second.answer().await, action());
}

#[tokio::test]
async fn a_locked_surface_and_a_typed_one_are_replaced_too_and_a_locked_ones_place_in_the_queue_is_the_end() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let (call, _) = created(&seam, &mut webview, &cli, "plan", "companion", true).await;
    sent(&seam, &mut webview, &cli, &[delete("plan")]).await.answer().await;
    call.answer().await;
    webview.next_shown().await;
    let ask = seam.asked(&mut webview, "term-a", "One?").await;
    let before = seam.surfaces.surfaces().iter().map(|surface| surface.order).max().unwrap();

    let (_open, new) = replaced(&seam, &mut webview, &cli, "companion", true).await;
    assert!(new.order > before && new.withdrawn_at.is_none());
    let mut arguments = plan("ask_1", "companion");
    arguments["messages"] = json!([delete("ask_1"), create("ask_1")]);
    let call = cli.call("quay_surface", arguments);
    seam.surfaces.verdict(webview.next_check().await.call, makes_one("ask_1", false));
    assert_eq!(call.answer().await, json!({ "shown": true }));
    assert_eq!(ask.answer().await, json!({ "surface_id": "ask_1", "state": "withdrawn" }));
    assert_eq!(webview.next_shown().await.tool, "quay_surface");
    assert_eq!(ids(&seam), ["ask_1", "plan"]);
}

#[tokio::test]
async fn a_delete_makes_room_for_a_create_in_the_same_call() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    for n in 0..4 {
        created(&seam, &mut webview, &cli, &format!("plan{n}"), "companion", n == 0).await;
    }
    for (gone, new) in [("plan0", "a"), ("plan1", "b")] {
        let mut arguments = plan(new, "companion");
        arguments["messages"] = json!([create(new), delete(gone)]);
        let call = cli.call("quay_surface", arguments);
        seam.surfaces.verdict(webview.next_check().await.call, makes_one(new, false));
        assert_eq!(call.answer().await, json!({ "shown": true }), "{gone}");
    }
    let mut arguments = plan("c", "companion");
    arguments["messages"] = json!([create("c"), delete("gone")]);
    let call = cli.call("quay_surface", arguments);
    seam.surfaces.verdict(webview.next_check().await.call, makes_one("c", false));
    call.failure().await;
}

#[tokio::test]
async fn an_update_after_a_delete_in_one_call_is_told_that_there_is_no_surface() {
    let (seam, mut webview) = start(Timing::default()).await;
    let (_, shown) = created(&seam, &mut webview, &seam.cli("term-a"), "plan", "companion", false).await;
    let errors = told_by_rust(&seam, &mut webview, messages(&[delete("plan"), update("plan")])).await;
    let unknown = "No surface \"plan\" in this terminal. Create it first.";
    assert_eq!(errors, json!([about_plan("INTEGRITY_ERROR", "/messages/1/updateDataModel", unknown)]));
    assert_eq!(seam.surfaces.surfaces(), vec![shown]);
}

#[tokio::test]
async fn what_a_call_makes_and_deletes_again_is_never_shown() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    created(&seam, &mut webview, &cli, "other", "companion", false).await;
    let mut arguments = plan("plan", "companion");
    arguments["messages"] = json!([create("plan"), update("plan"), delete("plan"), update("other"), delete("other")]);
    let call = cli.call("quay_surface", arguments);
    let check = webview.next_check().await;
    assert_eq!(check.held.len(), 1, "the update of the other is checked all the same");
    seam.surfaces.verdict(check.call, makes(vec![]));
    assert_eq!(call.answer().await, json!({ "deleted": true }));
    assert_eq!(webview.next_removed().await, key("term-a", "other"));
    assert!(webview.nothing_shown().await && ids(&seam).is_empty());
}

#[tokio::test]
async fn any_message_for_a_dismissed_id_is_told_so_and_the_call_changes_nothing() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    created(&seam, &mut webview, &cli, "plan", "companion", false).await;
    let (_, other) = created(&seam, &mut webview, &cli, "other", "companion", false).await;
    let ask = cli.call("quay_ask", question("One?"));
    seam.surfaces.verdict(webview.next_check().await.call, accepted(true));
    webview.next_shown().await;
    for id in ["plan", "ask_1"] {
        seam.surfaces.dismiss(&key("term-a", id)).unwrap();
    }
    assert_eq!(ask.answer().await, json!({ "dismissed": true }));

    for id in ["plan", "ask_1"] {
        let mut new = plan("new", "companion");
        new["messages"] = json!([create("new"), delete(id)]);
        let calls = [messages(&[update(id)]), messages(&[delete(id)]), messages(&[delete(id), create(id)]), messages(&[delete("other"), update(id)]), new];
        for arguments in calls {
            let call = cli.call("quay_surface", arguments.clone());
            assert_eq!(call.answer().await, json!({ "dismissed": true }), "{arguments}");
        }
    }
    assert!(webview.no_check().await && webview.nothing_shown().await);
    assert_eq!(seam.surfaces.surfaces(), vec![other]);
}

#[tokio::test]
async fn a_surface_dismissed_while_the_call_that_updates_it_is_checked_stays_dismissed() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    created(&seam, &mut webview, &cli, "plan", "companion", true).await;
    for (written, verdict) in [(update("plan"), makes_one("plan", true)), (delete("plan"), makes(vec![]))] {
        let call = cli.call("quay_surface", messages(&[written]));
        // The second is for an id that is dismissed by then, and is not checked
        if let Ok(check) = tokio::time::timeout(super::test_seam::A_WHILE, webview.next_check()).await {
            seam.surfaces.dismiss(&key("term-a", "plan")).unwrap();
            seam.surfaces.verdict(check.call, verdict);
        }
        assert_eq!(call.answer().await, json!({ "dismissed": true }));
    }
    assert!(ids(&seam).is_empty());
}
