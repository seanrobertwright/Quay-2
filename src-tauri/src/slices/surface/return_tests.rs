//! How the operator's answer gets back to the agent, at the `/mcp` seam: what ends a call's wait, and
//! what is typed into the terminal once nothing waits.

use std::time::Duration;

use serde_json::{json, Value};

use super::store::{AnswerRefused, SurfaceKey};
use super::test_seam::{accepted, start, FakeWebview, OpenCall, Seam, A_WHILE};
use super::timing::Timing;
use super::typing::NotTyped;
use crate::slices::pty::models::{ClaudeStatus, RunKind};
use crate::slices::pty::osc7501::{AntigravityTurn, Osc7501};

/// A question with a title of its own.
fn question(title: &str) -> Value {
    json!({ "questions": [{ "question": title, "options": [{ "label": "Yes" }, { "label": "No" }] }] })
}

const BASE: &str = "Which base should this branch take?";

fn answer() -> Value {
    json!({ "answers": [{ "question": BASE, "chosen": ["Yes"], "text": "skip the suite" }] })
}

/// `answer`, typed in.
const TYPED: &str = "[Quay surface \"Which base should this branch take?\" (ask_1)]: \
    {\"answers\":[{\"question\":\"Which base should this branch take?\",\"chosen\":[\"Yes\"],\"text\":\"skip the suite\"}]}\r";

fn key(terminal_id: &str, id: &str) -> SurfaceKey {
    SurfaceKey::new(terminal_id, id)
}

/// Limits that leave a test time, with this long a wait.
fn waits(ms: u64) -> Timing {
    Timing { verdict: Duration::from_secs(5), wait: Duration::from_millis(ms) }
}

/// The question `title` as `terminal_id`'s request `id`, once it has been drawn.
async fn asked_as(seam: &Seam, webview: &mut FakeWebview, terminal_id: &str, id: Value, title: &str) -> OpenCall {
    let call = seam.cli(terminal_id).call_as(id, "quay_ask", question(title));
    seam.surfaces.verdict(webview.next_check().await.call, accepted(true));
    webview.next_shown().await;
    call
}

async fn asked(seam: &Seam, webview: &mut FakeWebview, terminal_id: &str) -> OpenCall {
    asked_as(seam, webview, terminal_id, json!(1), BASE).await
}

fn no_answer_yet(id: &str) -> Value {
    json!({
        "surface_id": id,
        "state": "no_answer_yet",
        "next": "End your turn now. The answer will be typed into this terminal. quay_surface_read with this id returns it too.",
    })
}

#[tokio::test]
async fn an_answer_after_the_wait_is_typed_once_the_turn_has_ended() {
    let (seam, mut webview) = start(waits(100)).await;
    let call = asked(&seam, &mut webview, "term-a").await;
    assert_eq!(call.answer().await, no_answer_yet("ask_1"));

    seam.surfaces.answer(&key("term-a", "ask_1"), 1, answer()).unwrap();
    assert_eq!(webview.next_shown().await.answer, Some(answer()), "it is settled");
    assert_eq!(seam.typed("term-a"), "", "held while the turn runs");

    seam.cli("term-a").event("turn.completed", json!({ "answer": "waiting for you" })).await;
    assert_eq!(seam.typed_soon("term-a").await, TYPED);
    assert_eq!(seam.typed("term-b"), "");
}

/// That the operator's answer to `term-a`'s only question is typed in, and not returned.
async fn answer_is_typed(seam: &Seam) {
    seam.surfaces.answer(&key("term-a", "ask_1"), 1, answer()).unwrap();
    seam.cli("term-a").event("turn.completed", json!({})).await;
    assert_eq!(seam.typed_soon("term-a").await, TYPED);
}

/// That `call` still waits after a while, and the operator's answer is its result and no more.
async fn still_waits(seam: &Seam, call: OpenCall) {
    tokio::time::sleep(A_WHILE).await;
    assert!(call.is_open(), "the call waits");
    takes_lines_at_once(seam);
    seam.surfaces.answer(&key("term-a", "ask_1"), 1, answer()).unwrap();
    assert_eq!(call.answer().await, answer());
    assert_eq!(seam.typed("term-a"), "");
}

/// Has a line for `term-a` typed at once, so one that should not be typed is not merely held.
fn takes_lines_at_once(seam: &Seam) {
    seam.pty_manager.update_status("term-a", ClaudeStatus::Idle);
}

#[tokio::test]
async fn a_wait_ends_when_its_connection_closes() {
    let (seam, mut webview) = start(Timing::default()).await;
    let call = asked(&seam, &mut webview, "term-a").await;

    call.hang_up();
    tokio::time::sleep(A_WHILE).await;
    answer_is_typed(&seam).await;
}

#[tokio::test]
async fn a_wait_ends_when_the_terminals_own_turn_does() {
    let (seam, mut webview) = start(Timing::default()).await;
    let call = asked(&seam, &mut webview, "term-a").await;

    seam.cli("term-a").event("turn.completed", json!({ "answer": "interrupted" })).await;
    assert_eq!(call.answer().await, no_answer_yet("ask_1"));
    answer_is_typed(&seam).await;
}

#[tokio::test]
async fn neither_a_subagents_turn_end_nor_another_terminals_ends_a_wait() {
    let (seam, mut webview) = start(Timing::default()).await;
    let call = asked(&seam, &mut webview, "term-a").await;

    seam.cli("term-a").event("turn.completed", json!({ "answer": "found it", "agentId": "agent-1" })).await;
    seam.cli("term-a").event("turn.started", json!({})).await;
    seam.cli("term-a").event("attention.notification", json!({ "notificationType": "idle_prompt" })).await;
    seam.cli("term-b").event("turn.completed", json!({ "answer": "done" })).await;
    still_waits(&seam, call).await;
}

#[tokio::test]
async fn a_wait_ends_when_antigravity_prints_that_its_turn_ended_and_not_when_it_is_blocked() {
    let (seam, mut webview) = start(Timing::default()).await;
    let launch = seam.open_terminal("term-a", RunKind::Antigravity, ClaudeStatus::Idle);
    let mut turn = AntigravityTurn::default();
    let mut prints = |state: &str| {
        let report = turn.read(&Osc7501::parse(state).unwrap());
        seam.pty_manager.apply_turn_report(&launch, &report);
    };
    prints("state=working");
    let call = asked(&seam, &mut webview, "term-a").await;

    prints("state=blocked:kind=permission");
    prints("state=working");
    tokio::time::sleep(A_WHILE).await;
    assert!(call.is_open(), "a turn that waits on a prompt goes on");
    prints("state=done");
    assert_eq!(call.answer().await, no_answer_yet("ask_1"));
    seam.surfaces.answer(&key("term-a", "ask_1"), 1, answer()).unwrap();
    assert_eq!(seam.typed("term-a"), TYPED);
}

#[tokio::test]
async fn a_wait_ends_at_a_cancel_that_names_its_call() {
    for id in [json!(3), json!("call-3")] {
        let (seam, mut webview) = start(Timing::default()).await;
        let call = asked_as(&seam, &mut webview, "term-a", id.clone(), BASE).await;

        let cancel = json!({ "requestId": id, "reason": "Request timed out" });
        seam.cli("term-a").notify("notifications/cancelled", cancel).await;
        assert_eq!(call.answer().await, no_answer_yet("ask_1"));
        answer_is_typed(&seam).await;
    }
}

#[tokio::test]
async fn a_cancel_that_names_no_waiting_call_of_the_terminal_ends_nothing() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let cancel = |id: Value| cli.notify("notifications/cancelled", json!({ "requestId": id }));
    // OpenCode cancels every call after it has returned
    assert_eq!(cli.call_as(json!(2), "quay_list_agents", json!({})).result().await["isError"], Value::Null);
    cancel(json!(2)).await;
    cancel(json!(2)).await;
    let first = asked_as(&seam, &mut webview, "term-a", json!(3), "First?").await;
    seam.surfaces.answer(&key("term-a", "ask_1"), 1, answer()).unwrap();
    first.answer().await;
    cancel(json!(3)).await;

    // A later launch counts its requests from the start again
    seam.open_terminal("term-a", RunKind::OpenCode, ClaudeStatus::Working);
    let second = asked_as(&seam, &mut webview, "term-a", json!(3), "Second?").await;
    for id in [json!(2), json!("3"), json!(null), json!({ "requestId": 3 })] {
        cancel(id).await;
    }
    cli.notify("notifications/cancelled", json!([])).await;
    cli.notify("notifications/progress", json!({ "requestId": 3 })).await;
    seam.cli("term-b").notify("notifications/cancelled", json!({ "requestId": 3 })).await;
    tokio::time::sleep(A_WHILE).await;
    assert!(second.is_open());
    seam.surfaces.answer(&key("term-a", "ask_2"), 1, answer()).unwrap();
    assert_eq!(second.answer().await, answer());
}

#[tokio::test]
async fn a_wait_ends_when_the_operator_types_a_lone_escape_in_codex() {
    let (seam, mut webview) = start(Timing::default()).await;
    seam.open_terminal("term-a", RunKind::Codex, ClaudeStatus::Idle);
    let call = asked(&seam, &mut webview, "term-a").await;

    for other in ["e", "\u{1b}[A", "\u{1b}\u{1b}", "\r", ""] {
        seam.surfaces.operator_typed("term-a", other);
    }
    seam.surfaces.operator_typed("term-b", "\u{1b}");
    tokio::time::sleep(A_WHILE).await;
    assert!(call.is_open(), "no other key ends it");
    seam.surfaces.operator_typed("term-a", "\u{1b}");
    assert_eq!(call.answer().await, no_answer_yet("ask_1"));
    seam.surfaces.answer(&key("term-a", "ask_1"), 1, answer()).unwrap();
    assert!(seam.typed("term-a").starts_with(TYPED.trim_end()));
}

#[tokio::test]
async fn an_escape_outside_codex_ends_no_wait() {
    let (seam, mut webview) = start(Timing::default()).await;
    let call = asked(&seam, &mut webview, "term-a").await;

    seam.surfaces.operator_typed("term-a", "\u{1b}");
    still_waits(&seam, call).await;
}

#[tokio::test]
async fn what_ends_a_wait_also_ends_one_whose_call_is_still_being_checked() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let cancelled = cli.call_as(json!(7), "quay_ask", question("First?"));
    let check = webview.next_check().await;
    cli.notify("notifications/cancelled", json!({ "requestId": 7 })).await;
    seam.surfaces.verdict(check.call, accepted(true));
    assert_eq!(cancelled.answer().await, no_answer_yet("ask_1"));
    assert_eq!(webview.next_shown().await.id, "ask_1", "the question is up all the same");

    let interrupted = cli.call_as(json!(8), "quay_ask", question("Second?"));
    let check = webview.next_check().await;
    cli.event("turn.completed", json!({})).await;
    seam.surfaces.verdict(check.call, accepted(true));
    assert_eq!(interrupted.answer().await, no_answer_yet("ask_2"));
}

#[tokio::test]
async fn an_answer_handed_to_a_call_that_is_dropped_before_it_returns_is_typed() {
    let (seam, mut webview) = start(Timing::default()).await;
    seam.open_terminal("term-a", RunKind::Claude, ClaudeStatus::Idle);
    let arguments = question(BASE);
    let request = json!(1);
    let mut call = Box::pin(seam.surfaces.call("term-a", &request, "quay_ask", &arguments));
    tokio::select! {
        _ = &mut call => panic!("it returned unchecked"),
        check = webview.next_check() => seam.surfaces.verdict(check.call, accepted(true)),
    }
    tokio::select! {
        _ = &mut call => panic!("it returned unanswered"),
        _ = webview.next_shown() => {}
    }

    seam.surfaces.answer(&key("term-a", "ask_1"), 1, answer()).unwrap();
    assert_eq!(seam.typed("term-a"), "", "an open call has it");
    drop(call);
    assert_eq!(seam.typed_soon("term-a").await, TYPED);
}

#[tokio::test]
async fn an_answer_that_only_some_of_its_calls_drop_is_not_typed_and_one_that_all_drop_is_typed_once() {
    for all_drop in [false, true] {
        let (seam, mut webview) = start(Timing::default()).await;
        seam.open_terminal("term-a", RunKind::Claude, ClaudeStatus::Idle);
        let arguments = question(BASE);
        let (one, two) = (json!(1), json!(2));
        let mut first = Box::pin(seam.surfaces.call("term-a", &one, "quay_ask", &arguments));
        tokio::select! {
            _ = &mut first => panic!("it returned unchecked"),
            check = webview.next_check() => seam.surfaces.verdict(check.call, accepted(true)),
        }
        let mut second = Box::pin(seam.surfaces.call("term-a", &two, "quay_ask", &arguments));
        let both = async { tokio::join!(&mut first, &mut second) };
        assert!(tokio::time::timeout(A_WHILE, both).await.is_err(), "both wait");

        seam.surfaces.answer(&key("term-a", "ask_1"), 1, answer()).unwrap();
        drop(first);
        if all_drop {
            drop(second);
            assert_eq!(seam.typed_soon("term-a").await, TYPED);
        } else {
            let result = second.await.unwrap();
            assert_eq!(result["content"][0]["text"], json!(answer().to_string()));
        }
        // Longer than it takes to type a line
        tokio::time::sleep(3 * A_WHILE).await;
        assert_eq!(seam.typed("term-a").matches('\r').count(), usize::from(all_drop));
    }
}

#[tokio::test]
async fn the_same_call_again_rejoins_its_unanswered_question_and_both_get_the_answer() {
    let (seam, mut webview) = start(Timing::default()).await;
    takes_lines_at_once(&seam);
    let first = asked(&seam, &mut webview, "term-a").await;
    // Equal as parsed JSON: the keys' order and the spacing are the CLI's own
    let again: Value = serde_json::from_str(
        r#"{ "questions": [ { "options": [{"label":"Yes"}, {"label":"No"}],
            "question": "Which base should this branch take?" } ] }"#,
    )
    .unwrap();
    let second = seam.cli("term-a").call_as(json!(2), "quay_ask", again);
    assert!(webview.no_check().await && webview.nothing_shown().await, "no second question is made");
    let other = asked(&seam, &mut webview, "term-b").await;
    assert!(first.is_open() && second.is_open());

    seam.surfaces.answer(&key("term-a", "ask_1"), 1, answer()).unwrap();
    assert_eq!(first.answer().await, answer());
    assert_eq!(second.answer().await, answer());
    assert!(other.is_open(), "another terminal's equal question is its own");
    assert_eq!(seam.typed("term-a"), "", "a call returned it");
}

#[tokio::test]
async fn the_same_call_twice_at_once_makes_one_question() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let calls = [1, 2].map(|id| cli.call_as(json!(id), "quay_ask", question(BASE)));
    seam.surfaces.verdict(webview.next_check().await.call, accepted(true));
    webview.next_shown().await;
    assert!(webview.no_check().await);

    seam.surfaces.answer(&key("term-a", "ask_1"), 1, answer()).unwrap();
    for call in calls {
        assert_eq!(call.answer().await, answer());
    }
}

#[tokio::test]
async fn a_question_asked_again_after_its_wait_returns_the_answer_through_the_new_call() {
    let (seam, mut webview) = start(waits(1000)).await;
    takes_lines_at_once(&seam);
    assert_eq!(asked(&seam, &mut webview, "term-a").await.answer().await, no_answer_yet("ask_1"));

    let again = seam.cli("term-a").call("quay_ask", question(BASE));
    assert_eq!(again.answer().await, no_answer_yet("ask_1"), "it rejoined, and waited in its turn");
    let third = seam.cli("term-a").call("quay_ask", question(BASE));
    tokio::time::sleep(A_WHILE).await;
    seam.surfaces.answer(&key("term-a", "ask_1"), 1, answer()).unwrap();
    assert_eq!(third.answer().await, answer());
    assert_eq!(seam.typed("term-a"), "");
}

#[tokio::test]
async fn only_the_calls_still_open_get_the_answer_and_one_is_enough() {
    let (seam, mut webview) = start(Timing::default()).await;
    seam.open_terminal("term-a", RunKind::Claude, ClaudeStatus::Idle);
    let first = asked(&seam, &mut webview, "term-a").await;
    let second = seam.cli("term-a").call_as(json!(2), "quay_ask", question(BASE));
    tokio::time::sleep(A_WHILE).await;

    first.hang_up();
    tokio::time::sleep(A_WHILE).await;
    seam.surfaces.answer(&key("term-a", "ask_1"), 1, answer()).unwrap();
    assert_eq!(second.answer().await, answer());
    tokio::time::sleep(A_WHILE).await;
    assert_eq!(seam.typed("term-a"), "");
}

#[tokio::test]
async fn a_repeat_of_an_answered_question_and_a_different_one_make_new_ones() {
    let (seam, mut webview) = start(Timing::default()).await;
    let first = asked(&seam, &mut webview, "term-a").await;
    seam.surfaces.answer(&key("term-a", "ask_1"), 1, answer()).unwrap();
    first.answer().await;
    webview.next_shown().await;

    let _repeat = seam.cli("term-a").call("quay_ask", question(BASE));
    let check = webview.next_check().await;
    assert_eq!(check.surface_id, "ask_2");
    seam.surfaces.verdict(check.call, accepted(true));
    let _other = seam.cli("term-a").call("quay_ask", question("Another?"));
    assert_eq!(webview.next_check().await.surface_id, "ask_3");
}

#[tokio::test]
async fn of_two_answers_at_once_exactly_one_settles_the_question() {
    let answer_at_once = |seam: &Seam| {
        let answers = std::thread::scope(|scope| {
            let threads: Vec<_> = (0..8)
                .map(|n| {
                    let surfaces = seam.surfaces.clone();
                    scope.spawn(move || surfaces.answer(&key("term-a", "ask_1"), 1, json!({ "answers": [n] })))
                })
                .collect();
            threads.into_iter().map(|thread| thread.join().unwrap()).collect::<Vec<_>>()
        });
        assert_eq!(answers.iter().filter(|answer| answer.is_ok()).count(), 1, "{answers:?}");
        let refused = answers.iter().filter(|answer| **answer == Err(AnswerRefused::AlreadyAnswered)).count();
        assert_eq!(refused, 7, "{answers:?}");
        let winner = answers.iter().position(Result::is_ok).unwrap();
        json!({ "answers": [winner] })
    };

    let (seam, mut webview) = start(Timing::default()).await;
    takes_lines_at_once(&seam);
    let call = asked(&seam, &mut webview, "term-a").await;
    let settled = answer_at_once(&seam);
    assert_eq!(call.answer().await, settled);
    assert_eq!(seam.surfaces.surfaces()[0].answer, Some(settled));
    assert_eq!(seam.typed("term-a"), "");

    let (seam, mut webview) = start(waits(100)).await;
    seam.open_terminal("term-a", RunKind::Claude, ClaudeStatus::Idle);
    asked(&seam, &mut webview, "term-a").await.answer().await;
    let settled = answer_at_once(&seam);
    assert_eq!(seam.surfaces.surfaces()[0].answer, Some(settled.clone()));
    assert_eq!(seam.typed("term-a"), format!("[Quay surface \"{BASE}\" (ask_1)]: {settled}\r"), "typed once");
}

#[tokio::test]
async fn an_answer_to_an_older_revision_is_refused_and_the_question_is_drawn_again() {
    let (seam, mut webview) = start(Timing::default()).await;
    let call = asked(&seam, &mut webview, "term-a").await;
    let current = seam.surfaces.surfaces().remove(0);

    let older = current.revision - 1;
    assert_eq!(seam.surfaces.answer(&key("term-a", "ask_1"), older, answer()), Err(AnswerRefused::OlderRevision));
    assert_eq!(webview.next_shown().await, current);
    assert!(call.is_open());
    seam.surfaces.answer(&key("term-a", "ask_1"), current.revision, answer()).unwrap();
    assert_eq!(call.answer().await, answer());
}

#[tokio::test]
async fn an_answer_is_typed_at_once_where_quay_sees_no_turn_end() {
    let (seam, mut webview) = start(waits(100)).await;
    seam.open_terminal("term-g", RunKind::Grok, ClaudeStatus::Working);
    let call = asked(&seam, &mut webview, "term-g").await;
    assert_eq!(call.answer().await, no_answer_yet("ask_1"));

    seam.surfaces.answer(&key("term-g", "ask_1"), 1, answer()).unwrap();
    assert_eq!(seam.typed("term-g"), TYPED);
}

#[tokio::test]
async fn an_answer_that_cannot_be_typed_settles_nothing() {
    let (seam, mut webview) = start(waits(100)).await;
    let call = asked(&seam, &mut webview, "term-a").await;
    call.answer().await;
    let send = || seam.surfaces.answer(&key("term-a", "ask_1"), 1, answer());

    seam.pty_manager.update_status("term-a", ClaudeStatus::Exited);
    assert_eq!(send(), Err(AnswerRefused::NotTyped(NotTyped::TerminalOver)));
    seam.pty_manager.update_status("term-a", ClaudeStatus::Idle);
    seam.pty_manager.close_test_input("term-a");
    assert_eq!(send(), Err(AnswerRefused::NotTyped(NotTyped::Failed)));
    assert_eq!(seam.surfaces.surfaces()[0].answer, None);

    seam.open_terminal("term-a", RunKind::Claude, ClaudeStatus::Idle);
    assert_eq!(send(), Ok(()), "it can be sent again");
    assert_eq!(seam.typed("term-a"), TYPED);
    assert_eq!(send(), Err(AnswerRefused::AlreadyAnswered));
}

#[tokio::test]
async fn nothing_the_agent_or_the_operator_wrote_reaches_the_terminal_as_a_control_code() {
    let (seam, mut webview) = start(waits(100)).await;
    seam.open_terminal("term-a", RunKind::Claude, ClaudeStatus::Idle);
    let title = "Which\r\n\u{1b}[2J one\u{7f}\u{9b}31m\u{85}\u{2028}\u{202e}\u{0}?";
    let call = asked_as(&seam, &mut webview, "term-a", json!(1), title).await;
    call.answer().await;

    let text = "a\r\nb\u{1b}]0;x\u{7}\u{7f}\u{85}\u{9b}\u{2028}\u{202e}\u{e0041} é😀 \"q\" \\";
    let result = json!({ "answers": [{ "question": title, "chosen": [], "text": text }] });
    seam.surfaces.answer(&key("term-a", "ask_1"), 1, result.clone()).unwrap();

    let typed = seam.typed("term-a");
    let line = typed.strip_suffix('\r').expect("Quay's own Enter ends it");
    let bytes = line.as_bytes();
    assert!(bytes.iter().all(|&byte| byte >= 0x20 && byte != 0x7f), "no C0 code or DEL: {line:?}");
    assert!(
        bytes.windows(2).all(|pair| !(pair[0] == 0xc2 && (0x80..=0x9f).contains(&pair[1]))),
        "no C1 code: {line:?}"
    );
    let body = line.strip_prefix("[Quay surface \"Which[2J one31m?\" (ask_1)]: ").unwrap_or_else(|| panic!("{line:?}"));
    assert!(
        body.ends_with(r#""text":"a\r\nb\u001b]0;x\u0007\u007f\u0085\u009b\u2028\u202e\udb40\udc41 é😀 \"q\" \\"}]}"#),
        "{body}"
    );
    assert_eq!(serde_json::from_str::<Value>(body).unwrap(), result, "the agent reads what was written");
}

#[tokio::test]
async fn a_typed_answer_does_not_become_the_terminals_task_title() {
    let (seam, _webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let title = || seam.pty_manager.get_info("term-a").unwrap().task_title;
    cli.event("turn.started", json!({ "prompt": "Fix the login bug" })).await;
    assert_eq!(title().as_deref(), Some("Fix the login bug"));

    let typed = TYPED.trim_end();
    for prompt in [typed.to_string(), format!("<pasted_content id=\"62ae\">\n{typed}\n</pasted_content>")] {
        cli.event("turn.started", json!({ "prompt": prompt })).await;
        assert_eq!(title().as_deref(), Some("Fix the login bug"));
    }

    cli.event("turn.started", json!({ "prompt": "[Quay surface] looks odd" })).await;
    assert_eq!(title().as_deref(), Some("[Quay surface] looks odd"), "what the operator types is a title");
}
