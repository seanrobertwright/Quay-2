//! Updates of raw surfaces at the `/mcp` seam: what changes and what is refused, what waits, and what the
//! operator's answer and unsent answer are to a surface that changed under them.

use std::time::Duration;

use serde_json::{json, Value};

use super::place::Place;
use super::raw_seam::{
    about_plan, action, create, created, delete, makes, makes_one, messages, plan, rejected, says, surface, told, told_by_rust,
    update,
};
use super::store::{AnswerRefused, SurfaceRecord};
use super::test_seam::{accepted, key, start, until, FakeCli, FakeWebview, OpenCall, Seam};
use super::timing::Timing;
use super::unsent::UnsentRefused;
use crate::slices::pty::models::{ClaudeStatus, RunKind};

/// Has `cli` update the surface `plan`, which the webview accepts.
async fn updated(seam: &Seam, webview: &mut FakeWebview, cli: &FakeCli, asks: bool) -> (OpenCall, SurfaceRecord) {
    updated_by(seam, webview, cli, &[update("plan")], asks).await
}

/// `updated`, by `written`.
async fn updated_by(
    seam: &Seam,
    webview: &mut FakeWebview,
    cli: &FakeCli,
    written: &[Value],
    asks: bool,
) -> (OpenCall, SurfaceRecord) {
    let call = cli.call("quay_surface", messages(written));
    seam.surfaces.verdict(webview.next_check().await.call, makes_one("plan", asks));
    (call, webview.next_shown().await)
}

/// The surface `id` of `term-a` as it is now.
fn now(seam: &Seam, id: &str) -> SurfaceRecord {
    seam.surfaces.surfaces().into_iter().find(|surface| surface.id == id).expect("no such surface")
}

#[tokio::test]
async fn an_update_is_checked_on_the_state_accepted_last_and_drawn_as_a_later_revision() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let (_, first) = created(&seam, &mut webview, &cli, "plan", "tab", false).await;

    let call = cli.call("quay_surface", messages(&[update("plan")]));
    let check = webview.next_check().await;
    assert_eq!((check.tool.as_str(), check.surface_id.as_str()), ("quay_surface", ""), "it creates none");
    assert_eq!(check.arguments, messages(&[update("plan")]), "as its agent wrote it");
    assert_eq!(json!(check.held), json!([{ "place": "tab", "state": first.state }]));
    let changed = says(false, "changed");
    seam.surfaces.verdict(check.call, makes(vec![("plan", changed.clone())]));

    assert_eq!(call.answer().await, json!({ "shown": true }));
    let shown = webview.next_shown().await;
    assert_eq!((&shown.state, shown.revision, shown.order), (&changed.state, 2, first.order));
    assert_eq!((shown.place, shown.title.as_str(), shown.shown_at), (Place::Tab, "Migration plan", first.shown_at));
    assert!(shown.change > first.change && shown.updated_at >= first.updated_at && shown.reopened.is_none());

    let again = cli.call("quay_surface", messages(&[update("plan")]));
    let check = webview.next_check().await;
    assert_eq!(check.held[0].state, changed.state, "what was accepted last");
    seam.surfaces.verdict(check.call, makes_one("plan", false));
    again.answer().await;
    assert_eq!(webview.next_shown().await.revision, 3);
}

#[tokio::test]
async fn a_rejected_update_leaves_every_surface_as_it_was() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    created(&seam, &mut webview, &cli, "plan", "tab", false).await;
    let (open, _) = created(&seam, &mut webview, &cli, "other", "companion", true).await;
    let before = [now(&seam, "plan"), now(&seam, "other")];
    let found = about_plan("INTEGRITY_ERROR", "/messages/0/updateDataModel", "x");
    let written = [update("plan"), delete("other"), create("third")];
    let mut call = messages(&written);
    (call["place"], call["title"]) = (json!("companion"), json!("Third"));

    let open_call = cli.call("quay_surface", call.clone());
    seam.surfaces.verdict(webview.next_check().await.call, rejected(json!([found])));
    assert_eq!(told(open_call).await.0, json!([found]));

    // What only the store can tell, after the webview found nothing
    let mut large = surface(false);
    large.components = 501;
    let open_call = cli.call("quay_surface", call);
    let verdict = makes(vec![("plan", surface(false)), ("third", large)]);
    seam.surfaces.verdict(webview.next_check().await.call, verdict);
    let words = "A surface has at most 500 components; this one would have 501.";
    assert_eq!(told(open_call).await.0, json!([{ "code": "VALIDATION_FAILED", "surfaceId": "third", "path": "/messages/2/createSurface", "message": words }]));

    assert!(webview.nothing_shown().await && webview.none_removed());
    assert_eq!([now(&seam, "plan"), now(&seam, "other")], before);
    assert_eq!(seam.surfaces.surfaces().len(), 2);
    assert!(open.is_open());
}

#[tokio::test]
async fn a_size_limit_that_an_update_would_pass_is_told_at_its_last_message() {
    let (seam, mut webview) = start(Timing::default()).await;
    created(&seam, &mut webview, &seam.cli("term-a"), "plan", "tab", false).await;
    let mut large = surface(false);
    large.components = 640;
    let call = seam.cli("term-a").call("quay_surface", messages(&[update("plan"), update("plan")]));
    seam.surfaces.verdict(webview.next_check().await.call, makes(vec![("plan", large)]));
    let words = "A surface has at most 500 components; this one would have 640.";
    assert_eq!(told(call).await.0, json!([about_plan("VALIDATION_FAILED", "/messages/1/updateDataModel", words)]));
}

#[tokio::test]
async fn an_update_may_repeat_place_and_title_or_leave_them_out_and_different_ones_are_told_once() {
    let (seam, mut webview) = start(Timing::default()).await;
    created(&seam, &mut webview, &seam.cli("term-a"), "plan", "tab", false).await;
    let place = "Surface \"plan\" is in tab, and a surface's place is fixed. To move it, delete it and create it again.";
    let title = "Surface \"plan\" is titled \"Migration plan\", and a surface's title is fixed. To change it, delete the surface and create it again.";
    let both = messages(&[update("plan"), update("plan")]);

    let mut other = both.clone();
    (other["place"], other["title"]) = (json!("companion"), json!("Another"));
    let errors = told_by_rust(&seam, &mut webview, other).await;
    assert_eq!(errors, json!([about_plan("VALIDATION_FAILED", "/place", place), about_plan("VALIDATION_FAILED", "/title", title)]));

    let mut same = both.clone();
    (same["place"], same["title"]) = (json!("tab"), json!("Migration plan"));
    for call in [both, same] {
        let call = seam.cli("term-a").call("quay_surface", call);
        seam.surfaces.verdict(webview.next_check().await.call, makes_one("plan", false));
        assert_eq!(call.answer().await, json!({ "shown": true }));
    }
}

#[tokio::test]
async fn an_update_of_a_typed_surface_is_told_to_use_its_tool_again() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let _ask = seam.asked(&mut webview, "term-a", "One?").await;
    let board = cli.call("quay_board", json!({ "title": "Nightly" }));
    seam.surfaces.verdict(webview.next_check().await.call, accepted(false));
    board.answer().await;
    let components = json!({ "version": "1.0", "updateComponents": { "surfaceId": "board", "components": [] } });

    let errors = told_by_rust(&seam, &mut webview, messages(&[update("ask_1"), components])).await;
    let said: Vec<_> = errors.as_array().unwrap().iter().map(|error| (&error["path"], &error["message"])).collect();
    assert_eq!(
        said,
        [
            (&json!("/messages/0/updateDataModel"), &json!("Surface \"ask_1\" was made by quay_ask. Call quay_ask again.")),
            (&json!("/messages/1/updateComponents"), &json!("Surface \"board\" was made by quay_board. Call quay_board again.")),
        ]
    );
}

#[tokio::test]
async fn an_answer_to_an_older_revision_is_refused_and_the_surface_drawn_again() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let (first, _) = created(&seam, &mut webview, &cli, "plan", "companion", true).await;
    let (second, shown) = updated(&seam, &mut webview, &cli, true).await;

    let refused = seam.surfaces.answer(&key("term-a", "plan"), 1, action());
    assert_eq!(refused, Err(AnswerRefused::OlderRevision));
    assert_eq!(webview.next_shown().await, shown);
    assert!(first.is_open() && second.is_open());

    seam.surfaces.answer(&key("term-a", "plan"), 2, action()).unwrap();
    for call in [first, second] {
        assert_eq!(call.answer().await, action());
    }
}

#[tokio::test]
async fn a_call_waits_on_every_asking_surface_it_creates_or_updates_and_returns_the_first_answer() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let (_one, _) = created(&seam, &mut webview, &cli, "one", "companion", true).await;
    let (_two, _) = created(&seam, &mut webview, &cli, "two", "tab", false).await;
    let mut call = plan("plan", "companion");
    call["messages"] = json!([update("one"), create("plan"), update("two")]);

    let call = cli.call("quay_surface", call);
    let check = webview.next_check().await;
    assert_eq!(check.held.len(), 2);
    let verdict = makes(vec![("plan", surface(true)), ("two", surface(false)), ("one", surface(true))]);
    seam.surfaces.verdict(check.call, verdict);
    for _ in 0..3 {
        webview.next_shown().await;
    }
    assert!(call.is_open());
    seam.surfaces.answer(&key("term-a", "one"), 2, action()).unwrap();

    assert_eq!(call.answer().await, action());
    // The other still asks, and nothing waits for it now
    assert!(now(&seam, "plan").answer.is_none());
    let surfaces = seam.surfaces.clone();
    let answered = tokio::task::spawn_blocking(move || surfaces.answer(&key("term-a", "plan"), 1, action()));
    answered.await.unwrap().unwrap();
    assert_eq!(now(&seam, "plan").answer, Some(action()));
}

#[tokio::test]
async fn a_call_that_waited_on_several_is_told_of_one_that_still_asks() {
    let (seam, mut webview) = start(Timing { wait: Duration::from_millis(200), ..Timing::default() }).await;
    let cli = seam.cli("term-a");
    let (_one, _) = created(&seam, &mut webview, &cli, "one", "companion", true).await;
    let (_two, _) = created(&seam, &mut webview, &cli, "two", "companion", true).await;
    let call = cli.call("quay_surface", messages(&[update("one"), update("two")]));
    seam.surfaces.verdict(webview.next_check().await.call, makes(vec![("one", surface(true)), ("two", surface(true))]));
    webview.next_shown().await;
    webview.next_shown().await;
    let withdraws = cli.call("quay_surface", messages(&[delete("one")]));
    seam.surfaces.verdict(webview.next_check().await.call, makes(vec![]));
    withdraws.answer().await;

    let waited = call.answer().await;
    assert_eq!((&waited["surface_id"], &waited["state"]), (&json!("two"), &json!("no_answer_yet")));
}

#[tokio::test]
async fn a_wait_ends_when_an_update_leaves_nothing_to_answer_and_one_that_asks_begins_to_wait() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let (first, _) = created(&seam, &mut webview, &cli, "plan", "companion", true).await;

    let (second, shown) = updated(&seam, &mut webview, &cli, false).await;
    assert!(!shown.asks);
    assert_eq!(second.answer().await, json!({ "shown": true }));
    assert_eq!(first.answer().await, json!({ "surface_id": "plan", "state": "shown" }));
    assert_eq!(seam.surfaces.answer(&key("term-a", "plan"), 2, action()), Err(AnswerRefused::NoSuchSurface));

    let (third, shown) = updated(&seam, &mut webview, &cli, true).await;
    assert!(shown.asks && third.is_open());
    seam.surfaces.answer(&key("term-a", "plan"), 3, action()).unwrap();
    assert_eq!(third.answer().await, action());
}

#[tokio::test]
async fn the_creating_call_again_rejoins_its_surface_after_an_update_and_changes_nothing() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let (_one, _) = created(&seam, &mut webview, &cli, "one", "companion", true).await;
    let mut both = plan("plan", "companion");
    both["messages"] = json!([delete("plan"), create("plan"), update("one")]);
    let first = cli.call("quay_surface", both.clone());
    seam.surfaces.verdict(webview.next_check().await.call, makes(vec![("plan", surface(true)), ("one", surface(true))]));
    webview.next_shown().await;
    webview.next_shown().await;
    updated(&seam, &mut webview, &cli, true).await;

    let again = cli.call("quay_surface", both);
    assert!(webview.no_check().await && again.is_open());
    assert_eq!((now(&seam, "plan").revision, now(&seam, "one").revision), (2, 2));
    seam.surfaces.answer(&key("term-a", "one"), 2, action()).unwrap();
    for call in [first, again] {
        assert_eq!(call.answer().await, action(), "it waits on the one it updated as well");
    }
}

/// Answers the surface `plan` at `revision` through its open call.
async fn answered(seam: &Seam, webview: &mut FakeWebview, call: OpenCall, revision: u64) -> SurfaceRecord {
    seam.surfaces.answer(&key("term-a", "plan"), revision, action()).unwrap();
    call.answer().await;
    webview.next_shown().await
}

#[tokio::test]
async fn an_update_opens_an_answered_surface_again_at_the_end_of_the_queue_and_waits() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let (first, shown) = created(&seam, &mut webview, &cli, "plan", "companion", true).await;
    let settled = answered(&seam, &mut webview, first, 1).await;
    let (_other, other) = created(&seam, &mut webview, &cli, "other", "companion", true).await;

    let (second, again) = updated(&seam, &mut webview, &cli, true).await;
    assert!(again.answer.is_none() && again.answered_at.is_none() && again.asks);
    let reopened = again.reopened.clone().expect("it was opened again");
    assert_eq!((reopened.answer, Some(reopened.answered_at)), (action(), settled.answered_at));
    assert!(reopened.at >= reopened.answered_at);
    assert!(again.order > other.order, "at the end of the queue");
    assert_eq!((again.began, again.revision, again.shown_at), (shown.began, 2, shown.shown_at));
    assert!(second.is_open(), "the call waits again");
    assert_eq!(seam.surfaces.answer(&key("term-a", "plan"), 1, action()), Err(AnswerRefused::OlderRevision));

    let read = cli.call("quay_surface_read", json!({ "surface_id": "plan" }));
    assert_eq!(read.answer().await, json!({ "surface_id": "plan", "state": "no_answer_yet" }));
    webview.next_shown().await;
    let settled = answered(&seam, &mut webview, second, 2).await;
    assert_eq!(settled.answer, Some(action()));
}

#[tokio::test]
async fn an_update_that_asks_for_nothing_opens_an_answered_surface_again_without_a_wait() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let (first, _) = created(&seam, &mut webview, &cli, "plan", "companion", true).await;
    answered(&seam, &mut webview, first, 1).await;
    let (second, again) = updated(&seam, &mut webview, &cli, false).await;
    assert!(!again.asks && again.answer.is_none() && again.reopened.is_some());
    assert_eq!(second.answer().await, json!({ "shown": true }));
}

#[tokio::test]
async fn a_surface_is_opened_again_only_where_its_place_has_room() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let (first, _) = created(&seam, &mut webview, &cli, "plan", "companion", true).await;
    let settled = answered(&seam, &mut webview, first, 1).await;
    for n in 0..4 {
        created(&seam, &mut webview, &cli, &format!("other{n}"), "companion", false).await;
    }
    let call = cli.call("quay_surface", messages(&[update("plan")]));
    seam.surfaces.verdict(webview.next_check().await.call, makes_one("plan", true));
    let words = "This terminal has four live surfaces in companion, the most allowed. Wait for an answer, delete one, or put several questions in one quay_ask.";
    assert_eq!(told(call).await.0, json!([about_plan("VALIDATION_FAILED", "/messages/0/updateDataModel", words)]));
    assert_eq!(now(&seam, "plan"), settled);

    let call = cli.call("quay_surface", messages(&[update("plan"), delete("other0"), update("other1")]));
    seam.surfaces.verdict(webview.next_check().await.call, makes(vec![("plan", surface(true)), ("other1", surface(false))]));
    webview.next_shown().await;
    assert!(call.is_open(), "what the same call deletes makes room, and a live one that it updates takes none");
}

#[tokio::test]
async fn an_update_after_a_relaunch_opens_an_answered_surface_again_and_not_one_that_ended() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let (first, _) = created(&seam, &mut webview, &cli, "plan", "companion", true).await;
    answered(&seam, &mut webview, first, 1).await;
    created(&seam, &mut webview, &cli, "other", "companion", true).await;
    seam.open_terminal("term-a", RunKind::Claude, ClaudeStatus::Working);
    let ended = webview.next_shown().await;
    assert!(ended.id == "other" && ended.ended_at.is_some());

    let errors = told_by_rust(&seam, &mut webview, messages(&[update("other")])).await;
    assert_eq!(errors[0]["message"], "Surface \"other\" ended when this terminal exited. Delete it and create it again.");
    assert_eq!(now(&seam, "other"), ended);

    let (second, again) = updated(&seam, &mut webview, &cli, true).await;
    assert!(second.is_open() && again.reopened.is_some());
    // It is of this launch now, so its dismissal is remembered
    seam.surfaces.dismiss(&key("term-a", "plan")).unwrap();
    assert_eq!(second.answer().await, json!({ "dismissed": true }));
    let call = cli.call("quay_surface", messages(&[update("plan")]));
    assert_eq!(call.answer().await, json!({ "dismissed": true }));
    let (_, shown) = created(&seam, &mut webview, &cli, "third", "companion", true).await;
    assert!(shown.reopened.is_none());
    seam.open_terminal("term-a", RunKind::Claude, ClaudeStatus::Working);
    let ended = webview.next_shown().await;
    assert!(ended.id == "third" && ended.ended_at.is_some());
}

#[tokio::test]
async fn while_an_answer_is_being_typed_in_a_call_changes_nothing_and_is_told_to_come_again() {
    let replaces = || [delete("plan"), create("plan")];
    for (written, verdict) in [(vec![update("plan")], true), (vec![delete("plan")], false), (replaces().to_vec(), true)] {
        let (seam, mut webview) = start(Timing { wait: Duration::from_millis(1), ..Timing::default() }).await;
        seam.open_terminal("term-a", RunKind::Claude, ClaudeStatus::Idle);
        let cli = seam.cli("term-a");
        let (first, _) = created(&seam, &mut webview, &cli, "plan", "companion", true).await;
        first.answer().await;
        let mut arguments = plan("plan", "companion");
        arguments["messages"] = json!(written);
        let call = cli.call("quay_surface", arguments);
        let check = webview.next_check().await;

        let surfaces = seam.surfaces.clone();
        let answering = tokio::task::spawn_blocking(move || surfaces.answer(&key("term-a", "plan"), 1, action()));
        until(|| !seam.typed("term-a").is_empty(), "nothing was typed").await;
        seam.surfaces.verdict(check.call, if verdict { makes_one("plan", true) } else { makes(vec![]) });

        let failed = "Quay could not show this; your call was not at fault. Nothing was shown. Send the same call once more.";
        assert_eq!(call.failure().await, failed);
        answering.await.unwrap().unwrap();
        assert_eq!((now(&seam, "plan").answer, now(&seam, "plan").revision), (Some(action()), 1));
    }
}

/// What the operator put in the surface `plan`: by path, in its revision `revision`, as the page's `save`th save.
fn typed(seam: &Seam, save: u64, revision: u64, values: Value) -> Result<(), UnsentRefused> {
    let order = now(seam, "plan").order;
    let save = json!({ "page": 1, "save": save, "order": order, "revision": revision, "values": values });
    seam.surfaces.save_unsent(&key("term-a", "plan"), serde_json::from_value(save).unwrap())
}

/// What is held unsent in the one surface that has anything: at which revision, and by path.
fn held(seam: &Seam) -> (u64, Value) {
    let page = json!(seam.surfaces.open_page());
    let [unsent] = page["unsent"].as_array().unwrap().as_slice() else { panic!("{page}") };
    (unsent["revision"].as_u64().unwrap(), unsent["values"].clone())
}

fn set(path: Option<&str>) -> Value {
    let mut message = json!({ "version": "1.0", "updateDataModel": { "surfaceId": "plan", "value": {} } });
    if let Some(path) = path {
        message["updateDataModel"]["path"] = json!(path);
    }
    message
}

#[tokio::test]
async fn what_the_operator_typed_is_kept_through_an_update_but_for_the_paths_it_sets() {
    let values = || json!({ "/note": "half", "/rows/0/name": "Ada", "/rows/10/name": "Bob", "/rowsum": "7", "/a~1b/c": "x", "/pick": ["a"] });
    let left = |gone: &[&str]| {
        let mut left = values();
        gone.iter().for_each(|path| drop(left.as_object_mut().unwrap().remove(*path)));
        left
    };
    let components = json!({ "version": "1.0", "updateComponents": { "surfaceId": "plan", "components": [] } });
    let cases = [
        (vec![components], left(&[])),
        (vec![set(Some("/note"))], left(&["/note"])),
        (vec![set(Some("/other"))], left(&[])),
        (vec![set(Some("/rows"))], left(&["/rows/0/name", "/rows/10/name"])),
        (vec![set(Some("/rows/1"))], left(&[])),
        (vec![set(Some("/rows/00/name/"))], left(&["/rows/0/name"])),
        (vec![set(Some("/pick/0/deep"))], left(&["/pick"])),
        (vec![set(Some("/a~1b"))], left(&["/a~1b/c"])),
        (vec![set(Some("/a")), set(Some("//note"))], left(&["/note"])),
        (vec![set(None)], json!({})),
        (vec![set(Some("/"))], json!({})),
        (vec![set(Some(""))], json!({})),
    ];
    for (written, kept) in cases {
        let (seam, mut webview) = start(Timing::default()).await;
        let cli = seam.cli("term-a");
        created(&seam, &mut webview, &cli, "plan", "companion", true).await;
        typed(&seam, 1, 1, values()).unwrap();
        updated_by(&seam, &mut webview, &cli, &written, true).await;
        assert_eq!(held(&seam), (2, kept.clone()), "{written:?}");

        // Read before it, and here only now
        typed(&seam, 2, 1, values()).unwrap();
        assert_eq!(held(&seam), (2, kept), "{written:?}");
        typed(&seam, 3, 2, values()).unwrap();
        assert_eq!(held(&seam), (2, values()), "what is typed after it stays");
    }
}

#[tokio::test]
async fn what_several_updates_set_is_dropped_from_a_save_that_was_read_before_them() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    created(&seam, &mut webview, &cli, "plan", "companion", true).await;
    for path in ["/a", "/b", "/a"] {
        updated_by(&seam, &mut webview, &cli, &[set(Some(path))], true).await;
    }
    let values = || json!({ "/a": "1", "/b": "2", "/c": "3" });
    for (save, (revision, kept)) in
        [(1, json!({ "/c": "3" })), (2, json!({ "/c": "3" })), (3, json!({ "/b": "2", "/c": "3" })), (4, values())].into_iter().enumerate()
    {
        typed(&seam, save as u64 + 1, revision, values()).unwrap();
        assert_eq!(held(&seam), (4, kept), "read at {revision}");
    }
    assert_eq!(typed(&seam, 9, 5, values()), Err(UnsentRefused::OtherRevision), "there is no such revision yet");
}

#[tokio::test]
async fn the_window_is_told_which_paths_each_revision_set() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let (_, shown) = created(&seam, &mut webview, &cli, "plan", "companion", true).await;
    assert_eq!(json!(shown)["carried"], json!({ "from": 1, "set": {} }));
    updated_by(&seam, &mut webview, &cli, &[set(Some("/a~1b/00"))], true).await;
    let (_, shown) = updated_by(&seam, &mut webview, &cli, &[set(None), set(Some("/c"))], true).await;
    assert_eq!(json!(shown)["carried"], json!({ "from": 1, "set": { "/a~1b/0": 2, "/": 3, "/c": 3 } }));
}

#[tokio::test]
async fn past_the_paths_that_are_kept_only_what_was_read_before_the_oldest_is_lost() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    created(&seam, &mut webview, &cli, "plan", "companion", true).await;
    let many: Vec<Value> = (0..300).map(|n| set(Some(&format!("/many/{n}")))).collect();
    typed(&seam, 1, 1, json!({ "/note": "half" })).unwrap();
    updated_by(&seam, &mut webview, &cli, &many, true).await;
    assert_eq!(held(&seam), (2, json!({ "/note": "half" })), "one update sets as many as it likes");
    updated_by(&seam, &mut webview, &cli, &[set(Some("/a"))], true).await;
    assert_eq!(held(&seam), (3, json!({ "/note": "half" })));

    assert_eq!(typed(&seam, 2, 1, json!({ "/note": "x" })), Err(UnsentRefused::OtherRevision));
    typed(&seam, 3, 2, json!({ "/note": "half a", "/a": "x" })).unwrap();
    assert_eq!(held(&seam), (3, json!({ "/note": "half a" })));
}

#[tokio::test]
async fn a_surface_opened_again_starts_with_nothing_unsent() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let (first, shown) = created(&seam, &mut webview, &cli, "plan", "companion", true).await;
    typed(&seam, 1, 1, json!({ "/note": "half" })).unwrap();
    answered(&seam, &mut webview, first, 1).await;
    updated(&seam, &mut webview, &cli, true).await;
    assert_eq!(json!(seam.surfaces.open_page())["unsent"], json!([]));
    let late = json!({ "page": 1, "save": 2, "order": shown.order, "revision": 1, "values": { "/note": "half" } });
    let late = seam.surfaces.save_unsent(&key("term-a", "plan"), serde_json::from_value(late).unwrap());
    assert_eq!(late, Err(UnsentRefused::NoSuchSurface));
    assert_eq!(typed(&seam, 3, 1, json!({ "/note": "half" })), Err(UnsentRefused::OtherRevision));
}

#[tokio::test]
async fn an_update_of_one_terminal_reaches_no_other_terminals_surface() {
    let (seam, mut webview) = start(Timing::default()).await;
    let (_open, other) = created(&seam, &mut webview, &seam.cli("term-b"), "plan", "companion", true).await;
    created(&seam, &mut webview, &seam.cli("term-a"), "plan", "companion", true).await;
    updated(&seam, &mut webview, &seam.cli("term-a"), true).await;
    let of_b = seam.surfaces.surfaces().into_iter().find(|surface| surface.terminal_id == "term-b");
    assert_eq!(of_b, Some(other));
}
