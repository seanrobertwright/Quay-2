//! A terminal that exits, is relaunched or closes, at the `/mcp` seam: what becomes of its surfaces and
//! of the calls that wait on them.

use std::time::Duration;

use serde_json::{json, Value};

use super::store::AnswerRefused;
use super::test_seam::{accepted, answer_to, key, question, start, until, FakeCli, Seam, A_WHILE};
use super::timing::Timing;
use super::typing::NotTyped;
use super::unsent::UnsentRefused;
use crate::slices::pty::models::{ClaudeStatus, RunKind};
use crate::slices::pty::plugin_watch::LaunchRef;

const ENDED: &str = "ended";

const TERMINAL_OVER: &str =
    "Quay could not show this; your call was not at fault. Nothing was shown. Its terminal has exited.";

/// `term-a`, launched again and idle.
fn launched(seam: &Seam) -> LaunchRef {
    seam.open_terminal("term-a", RunKind::Claude, ClaudeStatus::Idle)
}

fn exit(seam: &Seam, launch: &LaunchRef) {
    assert!(seam.pty_manager.exit_launch(launch, Some(0)));
}

fn answer(seam: &Seam, id: &str) -> Result<(), AnswerRefused> {
    seam.surfaces.answer(&key("term-a", id), 1, answer_to("One?"))
}

/// `term-a`'s surface `id`, as the window is given it.
fn record(seam: &Seam, id: &str) -> Value {
    let surfaces = seam.surfaces.surfaces();
    json!(surfaces.iter().find(|s| s.terminal_id == "term-a" && s.id == id).expect("no such surface"))
}

async fn read(cli: &FakeCli, id: &str) -> Value {
    cli.call("quay_surface_read", json!({ "surface_id": id })).answer().await
}

#[tokio::test]
async fn an_exit_ends_every_unsettled_surface_and_each_open_wait_once() {
    let (seam, mut webview) = start(Timing::default()).await;
    let launch = launched(&seam);
    let answered = seam.asked(&mut webview, "term-a", "One?").await;
    answer(&seam, "ask_1").unwrap();
    answered.answer().await;
    webview.next_shown().await;
    let waiting = seam.asked(&mut webview, "term-a", "Two?").await;
    let rejoined = seam.cli("term-a").call_as(json!(2), "quay_ask", question("Two?"));
    seam.shown(&mut webview, "term-a", "Three?").await;
    let others = seam.asked(&mut webview, "term-b", "Two?").await;

    exit(&seam, &launch);

    for call in [waiting, rejoined] {
        assert_eq!(call.answer().await, json!({ "surface_id": "ask_2", "state": ENDED }));
    }
    let shown = [webview.next_shown().await, webview.next_shown().await];
    assert_eq!(shown.each_ref().map(|record| record.id.as_str()), ["ask_2", "ask_3"]);
    assert!(shown.iter().all(|record| json!(record)["ended_at"].is_i64() && record.answer.is_none()));
    assert!(record(&seam, "ask_1")["ended_at"].is_null(), "what was answered stays answered");
    assert_eq!(record(&seam, "ask_1")["answer"], answer_to("One?"));

    assert!(answer(&seam, "ask_2").is_err());
    assert_eq!(seam.typed("term-a"), "");
    assert!(webview.nothing_shown().await && webview.none_removed());
    assert!(others.is_open(), "another terminal's question waits on");
}

#[tokio::test]
async fn a_relaunch_starts_with_nothing_answerable_and_can_read_that_the_question_ended() {
    let (seam, mut webview) = start(Timing::default()).await;
    launched(&seam);
    let call = seam.asked(&mut webview, "term-a", "One?").await;

    // The old process is still there as the new launch begins
    launched(&seam);

    assert_eq!(call.answer().await, json!({ "surface_id": "ask_1", "state": ENDED }));
    assert_eq!(webview.next_shown().await.id, "ask_1");
    assert_eq!(answer(&seam, "ask_1"), Err(AnswerRefused::Ended));
    let cli = seam.cli("term-a");
    assert_eq!(read(&cli, "ask_1").await, json!({ "surface_id": "ask_1", "state": ENDED }));

    let again = cli.call("quay_ask", question("One?"));
    let check = webview.next_check().await;
    assert_eq!(check.surface_id, "ask_2", "the same call again makes a new question, with an id of its own");
    seam.surfaces.verdict(check.call, accepted(true));
    webview.next_shown().await;
    answer(&seam, "ask_2").unwrap();
    assert_eq!(again.answer().await, answer_to("One?"));
}

#[tokio::test]
async fn a_call_that_is_being_checked_when_its_launch_is_over_shows_nothing() {
    for relaunched in [false, true] {
        let (seam, mut webview) = start(Timing::default()).await;
        let launch = launched(&seam);
        let call = seam.cli("term-a").call("quay_ask", question("One?"));
        let check = webview.next_check().await;

        exit(&seam, &launch);
        if relaunched {
            launched(&seam);
        }
        seam.surfaces.verdict(check.call, accepted(true));

        assert_eq!(call.failure().await, TERMINAL_OVER);
        assert!(webview.nothing_shown().await);
        assert!(seam.surfaces.surfaces().is_empty());
    }
}

#[tokio::test]
async fn a_call_from_a_terminal_that_has_exited_is_refused_unchecked() {
    let (seam, mut webview) = start(Timing::default()).await;
    let launch = launched(&seam);
    exit(&seam, &launch);

    let call = seam.cli("term-a").call("quay_ask", question("One?"));
    assert_eq!(call.failure().await, TERMINAL_OVER);
    assert!(webview.no_check().await);
}

#[tokio::test]
async fn an_exit_forgets_the_rejections_in_a_row() {
    let (seam, _webview) = start(Timing::default()).await;
    let launch = launched(&seam);
    let cli = seam.cli("term-a");
    let reject = || async { cli.call("quay_ask", json!({})).failure().await };
    for _ in 0..3 {
        reject().await;
    }
    assert!(reject().await.contains("Stop guessing."));

    exit(&seam, &launch);
    reject().await;
    launched(&seam);
    for _ in 0..2 {
        assert!(reject().await.contains("Nothing was shown."));
    }
    assert!(reject().await.contains("Stop guessing."), "counted from the start again");
}

#[tokio::test]
async fn an_exit_that_is_heard_after_the_relaunch_ends_nothing_of_the_later_launch() {
    let (seam, mut webview) = start(Timing::default()).await;
    let old = launched(&seam);
    let new = launched(&seam);
    let call = seam.asked(&mut webview, "term-a", "One?").await;

    seam.surfaces.launch_over("term-a", old.launch);
    seam.surfaces.launched("term-a", old.launch);
    assert!(webview.nothing_shown().await && call.is_open());
    seam.surfaces.launch_over("term-a", new.launch);
    assert_eq!(call.answer().await["state"], ENDED);
}

#[tokio::test]
async fn a_close_leaves_nothing_of_the_terminal_and_takes_its_surfaces_off_the_screen() {
    let (seam, mut webview) = start(Timing::default()).await;
    launched(&seam);
    let answered = seam.asked(&mut webview, "term-a", "One?").await;
    answer(&seam, "ask_1").unwrap();
    answered.answer().await;
    webview.next_shown().await;
    let waiting = seam.asked(&mut webview, "term-a", "Two?").await;
    let _dismissed = seam.asked(&mut webview, "term-a", "Three?").await;
    seam.surfaces.dismiss(&key("term-a", "ask_3")).unwrap();
    webview.next_removed().await;
    let others = seam.asked(&mut webview, "term-b", "Two?").await;
    let cli = seam.cli("term-a");
    for _ in 0..3 {
        cli.call("quay_ask", json!({})).failure().await;
    }
    let order = record(&seam, "ask_2")["order"].clone();
    let unsent = json!({ "page": 1, "save": 1, "order": order, "revision": 1, "values": { "/answers/0/text": "half" } });
    let save = || seam.surfaces.save_unsent(&key("term-a", "ask_2"), serde_json::from_value(unsent.clone()).unwrap());
    save().unwrap();
    let checked = cli.call_as(json!(9), "quay_ask", question("Four?"));
    let check = webview.next_check().await;

    seam.pty_manager.kill("term-a").unwrap();

    assert_eq!(waiting.answer().await, json!({ "surface_id": "ask_2", "state": ENDED }));
    for id in ["ask_1", "ask_2"] {
        assert_eq!(webview.next_removed().await, key("term-a", id));
    }
    seam.surfaces.verdict(check.call, accepted(true));
    assert_eq!(checked.failure().await, TERMINAL_OVER);
    assert!(webview.nothing_shown().await && webview.none_removed());

    // Nothing is left: no surface, nothing unsent, no id that can be read, and no row of rejections
    assert_eq!(seam.surfaces.surfaces().len(), 1, "term-b's");
    assert_eq!(json!(seam.surfaces.open_page())["unsent"], json!([]));
    assert_eq!(save(), Err(UnsentRefused::NoSuchSurface));
    assert_eq!(answer(&seam, "ask_2"), Err(AnswerRefused::NoSuchSurface));
    // Its token is refused now, so a call that was let in before is played past the server
    let late = async |tool: &str, arguments: Value| {
        let result = seam.surfaces.call("term-a", &json!(1), tool, &arguments).await.unwrap();
        assert_eq!(result["isError"], true);
        result["content"][0]["text"].as_str().unwrap().to_string()
    };
    for id in ["ask_1", "ask_2", "ask_3"] {
        let failure = late("quay_surface_read", json!({ "surface_id": id })).await;
        assert!(failure.contains("No surface"), "{failure}");
    }
    assert_eq!(late("quay_ask", question("Five?")).await, TERMINAL_OVER);
    for _ in 0..3 {
        assert!(late("quay_ask", json!({})).await.contains("Nothing was shown."), "nothing is counted");
    }
    assert!(others.is_open());
}

fn short_wait() -> Timing {
    Timing { wait: Duration::from_millis(1), ..Timing::default() }
}

/// Has `term-a`'s launch be over, by an exit or by the next one's beginning, and the next one idle.
fn over_and_launched(seam: &Seam, launch: &LaunchRef, exits: bool) -> LaunchRef {
    if exits {
        exit(seam, launch);
    }
    launched(seam)
}

#[tokio::test]
async fn what_is_held_for_a_turns_end_reaches_no_later_launch() {
    for exits in [true, false] {
        let (seam, mut webview) = start(short_wait()).await;
        let launch = seam.open_terminal("term-a", RunKind::Claude, ClaudeStatus::Working);
        for title in ["One?", "Two?"] {
            seam.asked(&mut webview, "term-a", title).await.answer().await;
        }
        answer(&seam, "ask_1").unwrap();
        seam.surfaces.dismiss(&key("term-a", "ask_2")).unwrap();

        over_and_launched(&seam, &launch, exits);

        // A turn's end lets in what is held
        seam.cli("term-a").event("turn.completed", json!({})).await;
        tokio::time::sleep(3 * A_WHILE).await;
        assert_eq!(seam.typed("term-a"), "", "after an exit: {exits}");
        assert_eq!(seam.not_delivered(), 2);
    }
}

#[tokio::test]
async fn an_answer_is_not_typed_into_the_launch_after_the_one_that_dropped_it_unread() {
    let (seam, mut webview) = start(Timing::default()).await;
    launched(&seam);
    let (request, arguments) = (json!(1), question("One?"));
    let mut call = Box::pin(seam.surfaces.call("term-a", &request, "quay_ask", &arguments));
    tokio::select! {
        _ = &mut call => panic!("it returned unchecked"),
        check = webview.next_check() => seam.surfaces.verdict(check.call, accepted(true)),
    }
    tokio::select! {
        _ = &mut call => panic!("it returned unanswered"),
        _ = webview.next_shown() => {}
    }
    answer(&seam, "ask_1").unwrap();

    launched(&seam);
    drop(call);
    tokio::time::sleep(3 * A_WHILE).await;
    assert_eq!(seam.typed("term-a"), "");
    assert_eq!(record(&seam, "ask_1")["answer"], answer_to("One?"), "it was answered before");
}

#[tokio::test]
async fn an_answer_that_is_being_typed_as_its_launch_ends_ends_with_it() {
    for exits in [true, false] {
        let (seam, mut webview) = start(short_wait()).await;
        let launch = launched(&seam);
        seam.asked(&mut webview, "term-a", "One?").await.answer().await;

        let sent = half_typed(&seam).await;
        over_and_launched(&seam, &launch, exits);

        assert_eq!(webview.next_shown().await.id, "ask_1");
        assert!(record(&seam, "ask_1")["ended_at"].is_i64());
        assert_eq!(sent.join().unwrap(), Err(AnswerRefused::NotTyped(NotTyped::TerminalOver)));
        assert_eq!(seam.typed("term-a"), "", "no Enter goes to the launch after");
        assert_eq!(answer(&seam, "ask_1"), Err(AnswerRefused::Ended));
        assert!(record(&seam, "ask_1")["ended_at"].is_i64() && record(&seam, "ask_1")["answer"].is_null());
    }
}

/// The answer to `term-a`'s `ask_1`, once its text has been typed in. Its Enter comes a moment later.
async fn half_typed(seam: &Seam) -> std::thread::JoinHandle<Result<(), AnswerRefused>> {
    let surfaces = seam.surfaces.clone();
    let sent = std::thread::spawn(move || surfaces.answer(&key("term-a", "ask_1"), 1, answer_to("One?")));
    until(|| !seam.typed("term-a").is_empty(), "nothing was typed").await;
    sent
}

#[tokio::test]
async fn an_answer_that_is_being_typed_as_its_launch_ends_leaves_the_status_after_it_alone() {
    for relaunched in [false, true] {
        let (seam, mut webview) = start(short_wait()).await;
        let launch = launched(&seam);
        seam.asked(&mut webview, "term-a", "One?").await.answer().await;

        let sent = half_typed(&seam).await;
        exit(&seam, &launch);
        let after = match relaunched {
            true => {
                seam.open_terminal("term-a", RunKind::Claude, ClaudeStatus::Starting);
                ClaudeStatus::Starting
            }
            false => {
                seam.pty_manager.close_test_input("term-a");
                ClaudeStatus::Exited
            }
        };

        assert_eq!(sent.join().unwrap(), Err(AnswerRefused::NotTyped(NotTyped::TerminalOver)));
        assert_eq!(seam.pty_manager.get_info("term-a").unwrap().claude_status, after);
    }
}
