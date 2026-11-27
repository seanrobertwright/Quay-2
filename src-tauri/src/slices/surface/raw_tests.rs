//! `quay_surface` at the `/mcp` seam: what the agent is told and what the window is sent.

use std::time::Duration;

use serde_json::{json, Value};

use super::check::Accepted;
use super::place::Place;
use super::raw_seam::{
    about_plan, action, create, created, delete, invalid, makes, makes_one, messages, plan, rejected, surface, told, told_by_rust,
    update,
};
use super::test_seam::{accepted, key, question, start, CapturedLog};
use super::timing::Timing;
use crate::slices::pty::models::{ClaudeStatus, RunKind};

/// A surface that asks for nothing, of so many components whose data model is `data`.
fn surface_with(components: usize, data: Value) -> Accepted {
    let mut surface = surface(false);
    surface.components = u32::try_from(components).unwrap();
    surface.state = json!({ "version": "1.0", "createSurface": { "surfaceId": "plan", "components": [], "dataModel": data } });
    surface
}

/// A surface that asks for nothing and has so many components drawn at once, and with every row.
fn surface_that_draws(at_once: u32, with_rows: u32) -> Accepted {
    let mut surface = surface(false);
    surface.drawn_at_once = at_once;
    surface.drawn_with_rows = with_rows;
    surface
}

const NEXT: &str = "Nothing was changed. Correct the call and send all of it again. quay_surface_guide lists the components, their properties and examples.";

#[tokio::test]
async fn a_surface_that_asks_for_nothing_is_shown_in_its_place_and_its_call_returns_at_once() {
    let (seam, mut webview) = start(Timing::default()).await;
    let places = [("companion", Place::Companion), ("tab", Place::Tab), ("strip", Place::Strip)];
    for (n, (name, place)) in places.into_iter().enumerate() {
        let id = format!("plan{n}");
        let call = seam.cli("term-a").call("quay_surface", plan(&id, name));

        let check = webview.next_check().await;
        assert_eq!((check.tool.as_str(), check.surface_id.as_str()), ("quay_surface", id.as_str()));
        assert_eq!(check.arguments, plan(&id, name), "as its agent wrote it");
        seam.surfaces.verdict(check.call, makes_one(&id, false));

        let shown = webview.next_shown().await;
        assert_eq!((shown.id.as_str(), shown.tool.as_str(), shown.place), (id.as_str(), "quay_surface", place));
        assert_eq!(json!(shown)["title"], "Migration plan");
        assert!(!shown.asks);
        assert_eq!(call.answer().await, json!({ "shown": true }));
    }
}

#[tokio::test]
async fn a_surface_that_asks_waits_and_its_call_returns_the_action() {
    let (seam, mut webview) = start(Timing::default()).await;
    let (call, shown) = created(&seam, &mut webview, &seam.cli("term-a"), "plan", "companion", true).await;
    assert!(shown.asks && call.is_open());

    seam.surfaces.answer(&key("term-a", "plan"), 1, action()).unwrap();

    assert_eq!(call.answer().await, action());
    assert_eq!(webview.next_shown().await.answer, Some(action()));
}

#[tokio::test]
async fn after_the_wait_the_action_is_typed_in_under_the_surfaces_title() {
    let (seam, mut webview) = start(Timing { wait: Duration::from_millis(1), ..Timing::default() }).await;
    seam.open_terminal("term-a", RunKind::Claude, ClaudeStatus::Idle);
    let (call, _) = created(&seam, &mut webview, &seam.cli("term-a"), "plan", "tab", true).await;
    let waited = call.answer().await;
    assert_eq!((&waited["surface_id"], &waited["state"]), (&json!("plan"), &json!("no_answer_yet")));

    let surfaces = seam.surfaces.clone();
    let answered = tokio::task::spawn_blocking(move || surfaces.answer(&key("term-a", "plan"), 1, action()));
    let typed = seam.typed_soon("term-a").await;
    answered.await.unwrap().unwrap();

    assert!(typed.contains("[Quay surface \"Migration plan\" (plan)]: {"), "{typed}");
}

#[tokio::test]
async fn a_creating_call_needs_a_place_and_a_title_within_the_limit() {
    let (seam, mut webview) = start(Timing::default()).await;
    let place = "A call that creates a surface needs a place: companion, tab or strip.";
    let title = "A call that creates a surface needs a title.";
    let long = "é".repeat(96);
    let cases = [
        ("place", None, invalid("/place", place)),
        ("place", Some(json!("modal")), invalid("/place", place)),
        ("place", Some(json!(1)), invalid("/place", place)),
        ("title", None, invalid("/title", title)),
        ("title", Some(json!(" ")), invalid("/title", title)),
        ("title", Some(json!(5)), invalid("/title", title)),
        ("title", Some(json!(long)), invalid("/title", "A title is at most 80 characters; this one is 96.")),
        ("theme", Some(json!({})), invalid("/theme", "quay_surface has no field \"theme\" here.")),
    ];
    for (field, value, error) in cases {
        let mut call = plan("plan", "companion");
        match value {
            Some(value) => call[field] = value,
            None => drop(call.as_object_mut().unwrap().remove(field)),
        }
        assert_eq!(told_by_rust(&seam, &mut webview, call).await, json!([error]), "{field}");
    }
    let mut call = plan("plan", "companion");
    call["title"] = json!("é".repeat(80));
    let call = seam.cli("term-a").call("quay_surface", call);
    seam.surfaces.verdict(webview.next_check().await.call, makes_one("plan", false));
    assert_eq!(call.answer().await, json!({ "shown": true }));
}

#[tokio::test]
async fn messages_that_are_no_list_or_an_empty_one_are_rejected_at_once() {
    let (seam, mut webview) = start(Timing::default()).await;
    for value in [json!({}), json!({ "messages": "x" }), json!({ "messages": { "version": "1.0" } }), json!({ "messages": [] }), json!([])] {
        let call = seam.cli("term-a").call("quay_surface", value.clone());
        let (errors, _) = told(call).await;
        let path = if value.is_array() { "" } else { "/messages" };
        assert_eq!(errors[0]["path"], path, "{value}");
    }
    assert!(webview.no_check().await);
}

#[tokio::test]
async fn a_call_creates_at_most_one_surface_and_each_further_one_is_told() {
    let (seam, mut webview) = start(Timing::default()).await;
    let mut call = plan("plan", "companion");
    call["messages"] = json!([create("plan"), update("plan"), create("other"), create("plan")]);

    let again = "A call creates at most one surface. Send this one in a call of its own.";
    let other = json!({ "code": "VALIDATION_FAILED", "surfaceId": "other", "path": "/messages/2/createSurface", "message": again });
    let errors = told_by_rust(&seam, &mut webview, call).await;
    assert_eq!(errors, json!([other, about_plan("VALIDATION_FAILED", "/messages/3/createSurface", again)]));
}

#[tokio::test]
async fn an_update_of_a_surface_the_terminal_does_not_have_is_told_so() {
    let (seam, mut webview) = start(Timing::default()).await;
    let (_, _) = created(&seam, &mut webview, &seam.cli("term-b"), "plan", "companion", false).await;
    let unknown = "No surface \"plan\" in this terminal. Create it first.";

    let errors = told_by_rust(&seam, &mut webview, messages(&[update("plan")])).await;
    assert_eq!(errors, json!([about_plan("INTEGRITY_ERROR", "/messages/0/updateDataModel", unknown)]), "another terminal's is none of its own");

    let mut before = plan("plan", "companion");
    before["messages"] = json!([update("plan"), create("plan")]);
    let errors = told_by_rust(&seam, &mut webview, before).await;
    assert_eq!(errors, json!([about_plan("INTEGRITY_ERROR", "/messages/0/updateDataModel", unknown)]), "its create comes after");

    let mut later = plan("other", "companion");
    later["messages"] = json!([create("other"), update("plan")]);
    let errors = told_by_rust(&seam, &mut webview, later).await;
    assert_eq!(errors, json!([about_plan("INTEGRITY_ERROR", "/messages/1/updateDataModel", unknown)]));
}

#[tokio::test]
async fn an_update_that_follows_a_create_is_not_told_that_there_is_no_surface() {
    let (seam, mut webview) = start(Timing::default()).await;
    let mut call = plan("plan", "modal");
    call["messages"] = json!([create("plan"), update("plan")]);
    let errors = told_by_rust(&seam, &mut webview, call).await;
    assert_eq!(errors.as_array().unwrap().len(), 1, "{errors}");
}

#[tokio::test]
async fn an_id_in_use_by_other_content_is_rejected_and_the_surface_stays_as_it_was() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let (_, first) = created(&seam, &mut webview, &cli, "plan", "companion", false).await;
    let _asked = seam.asked(&mut webview, "term-a", "One?").await;
    let in_use = |id: &str| format!("Surface \"{id}\" already exists. Update it, or delete it and create it again.");

    let mut other = plan("plan", "companion");
    other["messages"] = json!([update_text("plan")]);
    let errors = told_by_rust(&seam, &mut webview, other).await;
    assert_eq!(errors, json!([about_plan("INTEGRITY_ERROR", "/messages/0/createSurface", &in_use("plan"))]));
    let errors = told_by_rust(&seam, &mut webview, plan("ask_1", "companion")).await;
    assert_eq!(errors[0]["message"], json!(in_use("ask_1")), "typed and raw surfaces share one set of ids");

    assert!(webview.nothing_shown().await);
    assert_eq!(seam.surfaces.surfaces().into_iter().find(|surface| surface.id == "plan"), Some(first));
    let (_, others) = created(&seam, &mut webview, &seam.cli("term-b"), "plan", "companion", false).await;
    assert_eq!(others.terminal_id, "term-b", "another terminal's ids are its own");
}

/// `create`, with another content.
fn update_text(id: &str) -> Value {
    let mut message = create(id);
    message["createSurface"]["components"][0]["text"] = json!("y");
    message
}

#[tokio::test]
async fn past_four_live_surfaces_in_a_place_a_create_is_rejected_at_its_message() {
    for (place, name) in [("companion", "companion"), ("tab", "tab"), ("strip", "strip")] {
        let (seam, mut webview) = start(Timing::default()).await;
        let cli = seam.cli("term-a");
        for n in 0..4 {
            created(&seam, &mut webview, &cli, &format!("plan{n}"), place, false).await;
        }
        let fifth = cli.call("quay_surface", plan("plan", place));
        seam.surfaces.verdict(webview.next_check().await.call, makes_one("plan", false));
        let message = format!("This terminal has four live surfaces in {name}, the most allowed. Wait for an answer, delete one, or put several questions in one quay_ask.");
        assert_eq!(told(fifth).await.0, json!([about_plan("VALIDATION_FAILED", "/messages/0/createSurface", &message)]));
        assert_eq!(seam.surfaces.surfaces().len(), 4);
    }
}

#[tokio::test]
async fn a_surface_past_a_size_limit_is_not_committed_whatever_the_webview_says() {
    let (seam, mut webview) = start(Timing::default()).await;
    // {"a":"…"} is eight bytes more than what it holds
    let data = |bytes: usize| json!({ "a": "x".repeat(bytes - 8) });
    let images = || {
        let mut surface = surface(false);
        surface.images = 13;
        surface
    };
    let cases = [
        (surface_with(640, json!({})), "A surface has at most 500 components; this one would have 640."),
        (surface_with(2, data(256 * 1024 + 1)), "A surface has at most 256 kB of data; this one would have 257 kB."),
        (images(), "A surface has at most 12 images; this one would have 13."),
    ];
    for (surface, message) in cases {
        let call = seam.cli("term-a").call("quay_surface", plan("plan", "companion"));
        seam.surfaces.verdict(webview.next_check().await.call, makes(vec![("plan", surface)]));
        assert_eq!(told(call).await.0, json!([about_plan("VALIDATION_FAILED", "/messages/0/createSurface", message)]));
    }
    assert!(seam.surfaces.surfaces().is_empty());

    for (n, surface) in [surface_with(500, json!({})), surface_with(2, data(256 * 1024))].into_iter().enumerate() {
        let id = format!("plan{n}");
        let call = seam.cli("term-a").call("quay_surface", plan(&id, "companion"));
        seam.surfaces.verdict(webview.next_check().await.call, makes(vec![(id.as_str(), surface)]));
        assert_eq!(call.answer().await, json!({ "shown": true }));
    }
}

#[tokio::test]
async fn a_surface_is_held_to_what_it_may_have_drawn_and_so_is_an_update_which_leaves_it_as_it_was() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let cases = [
        (2001, 2001, "A surface has at most 2000 components drawn at once; this one would have 2001."),
        (102, 10_001, "A surface has at most 10000 components with every row drawn; this one would have 10001."),
        (2001, 10_001, "A surface has at most 2000 components drawn at once; this one would have 2001."),
    ];
    for (at_once, with_rows, message) in cases {
        let call = cli.call("quay_surface", plan("plan", "companion"));
        seam.surfaces.verdict(webview.next_check().await.call, makes(vec![("plan", surface_that_draws(at_once, with_rows))]));
        assert_eq!(told(call).await.0, json!([about_plan("VALIDATION_FAILED", "/messages/0/createSurface", message)]));
    }
    assert!(webview.nothing_shown().await);
    assert!(seam.surfaces.surfaces().is_empty());

    let call = cli.call("quay_surface", plan("plan", "companion"));
    seam.surfaces.verdict(webview.next_check().await.call, makes(vec![("plan", surface_that_draws(2000, 10_000))]));
    assert_eq!(call.answer().await, json!({ "shown": true }));
    let shown = webview.next_shown().await;

    for (at_once, with_rows, message) in cases {
        let call = cli.call("quay_surface", messages(&[update("plan")]));
        seam.surfaces.verdict(webview.next_check().await.call, makes(vec![("plan", surface_that_draws(at_once, with_rows))]));
        assert_eq!(told(call).await.0, json!([about_plan("VALIDATION_FAILED", "/messages/0/updateDataModel", message)]));
    }
    assert!(webview.nothing_shown().await);
    let [held] = &seam.surfaces.surfaces()[..] else { panic!("one surface") };
    assert_eq!((held.revision, &held.state), (shown.revision, &shown.state));
}

#[tokio::test]
async fn what_the_webview_finds_is_the_agents_after_what_rust_finds() {
    let (seam, mut webview) = start(Timing::default()).await;
    let (log, _guard) = CapturedLog::start();
    let found = about_plan("RECURSION_LIMIT_EXCEEDED", "/messages/0/createSurface/components/0", "A cycle");

    let call = seam.cli("term-a").call("quay_surface", plan("plan", "companion"));
    seam.surfaces.verdict(webview.next_check().await.call, rejected(json!([found])));
    assert_eq!(told(call).await, (json!([found]), NEXT.to_string()));

    let mut both = plan("plan", "companion");
    both.as_object_mut().unwrap().remove("title");
    let call = seam.cli("term-a").call("quay_surface", both);
    seam.surfaces.verdict(webview.next_check().await.call, rejected(json!([found])));
    assert_eq!(told(call).await.0, json!([invalid("/title", "A call that creates a surface needs a title."), found]));

    assert!(webview.nothing_shown().await, "a rejected call shows nothing");
    assert!(seam.surfaces.surfaces().is_empty());
    assert_eq!(log.text(), "", "the fault is the agent's");
}

#[tokio::test]
async fn ten_errors_are_listed_with_a_count_of_the_rest() {
    let (seam, mut webview) = start(Timing::default()).await;
    let errors: Vec<Value> = (0..10).map(|n| about_plan("VALIDATION_FAILED", &format!("/messages/{n}"), "x")).collect();
    let mut call = plan("plan", "companion");
    call.as_object_mut().unwrap().remove("title");
    let call = seam.cli("term-a").call("quay_surface", call);
    let verdict = serde_json::from_value(json!({ "errors": errors, "more": 4 })).unwrap();
    seam.surfaces.verdict(webview.next_check().await.call, verdict);

    let body: Value = serde_json::from_str(&call.failure().await).unwrap();
    assert_eq!((body["errors"].as_array().unwrap().len(), &body["more"]), (10, &json!(5)));
}

#[tokio::test]
async fn from_the_third_rejection_in_a_row_the_advice_changes_and_an_accepted_call_starts_again() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let stop = "Stop guessing. Call quay_surface_guide first, or use quay_ask, quay_review or quay_board, or say it in the terminal.";
    for next in [NEXT, NEXT, stop, stop] {
        let call = cli.call("quay_surface", plan("plan", "companion"));
        seam.surfaces.verdict(webview.next_check().await.call, rejected(json!([about_plan("X", "/messages/0", "x")])));
        assert_eq!(told(call).await.1, next);
    }
    created(&seam, &mut webview, &cli, "plan", "companion", false).await;
    let call = cli.call("quay_surface", json!({ "messages": 1 }));
    assert_eq!(told(call).await.1, NEXT);
}

/// Calls with a mistake, what the webview's check finds wrong with each, and the fix that `next` names for
/// it: none for a mistake that is not made often. `rawRejected.test.ts` holds the check to these errors.
const MISTAKES: &str = include_str!("raw_mistakes.fixture.json");

/// The `next` of a rejected `quay_surface` call that names `fixes`.
fn told_to(fixes: &[&str]) -> String {
    format!("Nothing was changed. {} Correct the call and send all of it again.", fixes.join(" "))
}

#[tokio::test]
async fn a_common_mistake_is_told_its_fix_and_the_errors_as_the_check_gave_them() {
    let mistakes: Vec<Value> = serde_json::from_str(MISTAKES).unwrap();
    for mistake in mistakes {
        let (seam, mut webview) = start(Timing::default()).await;
        let call = seam.cli("term-a").call("quay_surface", mistake["arguments"].clone());
        seam.surfaces.verdict(webview.next_check().await.call, rejected(mistake["errors"].clone()));
        let (errors, next) = told(call).await;
        assert_eq!(errors, mistake["errors"], "{}", mistake["mistake"]);
        let expected = match mistake["fix"].as_str() {
            Some(fix) => told_to(&[fix]),
            None => NEXT.to_string(),
        };
        assert_eq!(next, expected, "{}", mistake["mistake"]);
    }
}

#[tokio::test]
async fn each_fix_is_named_once_in_the_order_found_and_from_the_third_rejection_in_a_row_stop_guessing_replaces_them() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let mistakes: Vec<Value> = serde_json::from_str(MISTAKES).unwrap();
    let of = |mistake: &str| mistakes.iter().find(|one| one["mistake"] == mistake).unwrap();
    let (bare, nested, other) = (of("checks is written without the @"), of("A Button's child is written inside it"), of("A cycle"));
    let errors: Vec<Value> = [bare, nested, other, bare].iter().map(|one| one["errors"][0].clone()).collect();
    let stop = "Stop guessing. Call quay_surface_guide first, or use quay_ask, quay_review or quay_board, or say it in the terminal.";
    let fix = |mistake: &Value| mistake["fix"].as_str().unwrap().to_string();
    let both = told_to(&[&fix(bare), &fix(nested)]);
    for next in [both.as_str(), &both, stop] {
        let call = cli.call("quay_surface", plan("plan", "companion"));
        seam.surfaces.verdict(webview.next_check().await.call, rejected(json!(errors)));
        assert_eq!(told(call).await, (json!(errors), next.to_string()));
    }
}

#[tokio::test]
async fn a_call_with_no_verdict_is_quays_failure_unless_rust_rejects_it() {
    let (seam, mut webview) = start(Timing { verdict: Duration::from_millis(20), ..Timing::default() }).await;
    let call = seam.cli("term-a").call("quay_surface", plan("plan", "companion"));
    let check = webview.next_check().await;
    let failed = "Quay could not show this; your call was not at fault. Nothing was shown. Send the same call once more.";
    assert_eq!(call.failure().await, failed);
    seam.surfaces.verdict(check.call, makes_one("plan", false));
    assert!(webview.nothing_shown().await, "a late verdict shows nothing");

    let call = seam.cli("term-a").call("quay_surface", plan("plan", "modal"));
    assert_eq!(told(call).await.0[0]["path"], "/place");
}

#[tokio::test]
async fn a_verdict_that_is_not_one_on_the_call_is_quays_failure_and_shows_nothing() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let left_out = makes(vec![]);
    let of_a_typed_call = accepted(false);
    for verdict in [left_out, makes_one("other", false), of_a_typed_call] {
        let call = cli.call("quay_surface", plan("plan", "companion"));
        seam.surfaces.verdict(webview.next_check().await.call, verdict);
        let failed = "Quay could not show this; your call was not at fault. Nothing was shown. Say it in the terminal instead.";
        assert_eq!(call.failure().await, failed);
    }
    assert!(webview.nothing_shown().await && seam.surfaces.surfaces().is_empty());
}

#[tokio::test]
async fn the_same_creating_call_again_rejoins_its_unanswered_surface_and_both_get_the_action() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let (first, _) = created(&seam, &mut webview, &cli, "plan", "companion", true).await;

    let second = cli.call("quay_surface", plan("plan", "companion"));
    assert!(webview.no_check().await && second.is_open());
    seam.surfaces.answer(&key("term-a", "plan"), 1, action()).unwrap();
    for call in [first, second] {
        assert_eq!(call.answer().await, action());
    }
}

#[tokio::test]
async fn the_same_creating_call_again_of_a_surface_that_asks_for_nothing_changes_nothing() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    created(&seam, &mut webview, &cli, "plan", "strip", false).await;
    for _ in 0..2 {
        assert_eq!(told(cli.call("quay_surface", json!({ "messages": 1 }))).await.1, NEXT);
    }

    let again = cli.call("quay_surface", plan("plan", "strip"));
    assert_eq!(again.answer().await, json!({ "shown": true }));
    assert!(webview.no_check().await && webview.nothing_shown().await);
    assert_eq!(seam.surfaces.surfaces().len(), 1);
    assert_eq!(told(cli.call("quay_surface", json!({ "messages": 1 }))).await.1, NEXT, "an accepted call resets the count");
}

#[tokio::test]
async fn a_repeat_of_a_settled_one_makes_a_new_surface_in_its_place() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let (first, shown) = created(&seam, &mut webview, &cli, "plan", "companion", true).await;
    seam.surfaces.answer(&key("term-a", "plan"), 1, action()).unwrap();
    first.answer().await;
    webview.next_shown().await;

    let (second, again) = created(&seam, &mut webview, &cli, "plan", "companion", true).await;

    assert!(again.order > shown.order && again.answer.is_none() && second.is_open());
    assert_eq!(seam.surfaces.surfaces(), vec![again]);
    let mut other = plan("plan", "companion");
    other["messages"] = json!([update_text("plan")]);
    let errors = told_by_rust(&seam, &mut webview, other).await;
    assert_eq!(errors[0]["code"], "INTEGRITY_ERROR", "with other content its id is in use");
}

#[tokio::test]
async fn an_ended_surface_keeps_its_id_and_what_was_typed_in_it() {
    let (seam, mut webview) = start(Timing::default()).await;
    let (_open, first) = created(&seam, &mut webview, &seam.cli("term-a"), "plan", "companion", true).await;
    let page = seam.surfaces.open_page();
    let typed = json!({ "page": page.page, "save": 1, "order": first.order, "revision": first.revision, "values": { "/note": "half a thought" } });
    seam.surfaces.save_unsent(&key("term-a", "plan"), serde_json::from_value(typed).unwrap()).unwrap();
    seam.open_terminal("term-a", RunKind::Claude, ClaudeStatus::Working);
    let ended = webview.next_shown().await;
    assert!(ended.ended_at.is_some());

    let in_use = "Surface \"plan\" already exists. Update it, or delete it and create it again.";
    let mut other = plan("plan", "companion");
    other["messages"] = json!([update_text("plan")]);
    for call in [other, plan("plan", "companion")] {
        let errors = told_by_rust(&seam, &mut webview, call).await;
        assert_eq!(errors, json!([about_plan("INTEGRITY_ERROR", "/messages/0/createSurface", in_use)]));
    }

    assert_eq!(seam.surfaces.surfaces(), vec![ended]);
    let unsent = json!(seam.surfaces.open_page())["unsent"].clone();
    assert_eq!(unsent[0]["values"], json!({ "/note": "half a thought" }));
}

#[tokio::test]
async fn an_earlier_launchs_settled_surface_makes_way_for_the_same_call_only() {
    let (seam, mut webview) = start(Timing::default()).await;
    let (first, _) = created(&seam, &mut webview, &seam.cli("term-a"), "plan", "companion", true).await;
    seam.surfaces.answer(&key("term-a", "plan"), 1, action()).unwrap();
    first.answer().await;
    let settled = webview.next_shown().await;
    seam.open_terminal("term-a", RunKind::Claude, ClaudeStatus::Working);

    let mut other = plan("plan", "companion");
    other["messages"] = json!([update_text("plan")]);
    let errors = told_by_rust(&seam, &mut webview, other).await;
    assert_eq!(errors[0]["code"], "INTEGRITY_ERROR");
    assert_eq!(seam.surfaces.surfaces(), vec![settled]);

    let (again, shown) = created(&seam, &mut webview, &seam.cli("term-a"), "plan", "companion", true).await;
    assert!(again.is_open());
    assert_eq!(seam.surfaces.surfaces(), vec![shown]);
}

#[tokio::test]
async fn a_create_for_a_dismissed_id_is_told_so() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    created(&seam, &mut webview, &cli, "plan", "companion", false).await;
    seam.surfaces.dismiss(&key("term-a", "plan")).unwrap();

    let call = cli.call("quay_surface", plan("plan", "companion"));
    assert_eq!(call.answer().await, json!({ "dismissed": true }));
    assert!(webview.no_check().await);
}

#[tokio::test]
async fn a_delete_of_an_id_the_terminal_does_not_have_is_accepted_and_does_nothing() {
    let (seam, mut webview) = start(Timing::default()).await;
    let call = seam.cli("term-a").call("quay_surface", messages(&[delete("gone")]));
    seam.surfaces.verdict(webview.next_check().await.call, makes(vec![]));
    assert_eq!(call.answer().await, json!({ "deleted": true }));

    let mut with_create = plan("plan", "companion");
    with_create["messages"] = json!([delete("gone"), create("plan")]);
    let call = seam.cli("term-a").call("quay_surface", with_create);
    seam.surfaces.verdict(webview.next_check().await.call, makes_one("plan", false));
    assert_eq!(call.answer().await, json!({ "shown": true }));
}

#[tokio::test]
async fn a_message_names_its_surface() {
    let (seam, mut webview) = start(Timing::default()).await;
    let needs = "A message names its surface by a surfaceId.";
    for id in [json!(""), json!("  "), json!(5), Value::Null] {
        let mut call = plan("plan", "companion");
        call["messages"][0]["createSurface"]["surfaceId"] = id;
        assert_eq!(told_by_rust(&seam, &mut webview, call).await, json!([invalid("/messages/0/createSurface/surfaceId", needs)]));
    }
    let mut call = plan("plan", "companion");
    call["messages"] = json!([create("plan"), { "version": "1.0", "updateDataModel": { "value": {} } }, { "version": "1.0", "deleteSurface": 5 }]);
    let errors = told_by_rust(&seam, &mut webview, call).await;
    assert_eq!(errors, json!([invalid("/messages/1/updateDataModel/surfaceId", needs), invalid("/messages/2/deleteSurface/surfaceId", needs)]));
}

#[tokio::test]
async fn the_raw_tool_is_listed_and_its_wait_holds_no_lock() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    assert!(cli.tools().await.contains(&"quay_surface".to_string()));
    let (open, _) = created(&seam, &mut webview, &cli, "plan", "companion", true).await;
    let other = cli.call("quay_ask", question("One?"));
    seam.surfaces.verdict(webview.next_check().await.call, accepted(false));
    assert_eq!(other.answer().await, json!({ "shown": true }));
    assert!(open.is_open());
}
