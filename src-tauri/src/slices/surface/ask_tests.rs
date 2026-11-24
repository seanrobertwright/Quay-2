//! `quay_ask` at the `/mcp` seam: what the agent is told and what the window is sent.

use std::time::Duration;

use serde_json::{json, Value};

use super::check::Verdict;
use super::store::AnswerRefused;
use super::test_seam::{accepted, start, start_with, CapturedLog, A_WHILE};
use super::timing::Timing;

/// The tools Quay's MCP server had before surfaces, in the order it lists them.
const SEVEN: [&str; 7] = [
    "quay_list_agents",
    "quay_send_message",
    "quay_broadcast",
    "quay_get_agent_status",
    "machina_submit_work_order",
    "machina_get_work_order",
    "machina_submit_deliverable",
];

/// The spec's own question.
fn question() -> Value {
    json!({ "questions": [{
        "question": "Which base should this branch take?",
        "options": [
            { "label": "Rebase onto master", "description": "Two conflicts", "recommended": true },
            { "label": "Merge master in" },
        ],
    }] })
}

fn answer() -> Value {
    json!({ "answers": [{
        "question": "Which base should this branch take?",
        "chosen": ["Rebase onto master"],
        "text": "skip the suite",
    }] })
}

#[tokio::test]
async fn the_surface_tool_is_listed_after_the_seven() {
    let (seam, _webview) = start(Timing::default()).await;

    assert_eq!(seam.cli("term-a").tools().await, [&SEVEN[..], &["quay_ask"]].concat());
}

#[tokio::test]
async fn a_build_that_offers_no_surfaces_neither_lists_nor_accepts_the_tool() {
    let (seam, mut webview) = start_with(false, Timing::default()).await;
    let cli = seam.cli("term-a");

    assert_eq!(cli.tools().await, SEVEN);
    let reply = cli.call("quay_ask", question()).reply().await;
    assert_eq!(reply["error"], json!({ "code": -32602, "message": "Unknown tool: quay_ask" }));
    assert!(webview.no_check().await);
}

#[tokio::test]
async fn an_answer_inside_the_wait_is_the_calls_result() {
    let (seam, mut webview) = start(Timing::default()).await;
    let call = seam.cli("term-a").call("quay_ask", question());

    let check = webview.next_check().await;
    assert_eq!((check.tool.as_str(), check.surface_id.as_str()), ("quay_ask", "ask_1"));
    assert_eq!(
        check.arguments,
        json!({ "questions": [{
            "question": "Which base should this branch take?",
            "options": [
                { "label": "Rebase onto master", "description": "Two conflicts", "recommended": true },
                { "label": "Merge master in", "recommended": false },
            ],
        }] })
    );
    assert!(webview.nothing_shown().await, "drawn before its verdict");
    seam.surfaces.verdict(check.call, accepted(true));

    let shown = webview.next_shown().await;
    assert_eq!((shown.terminal_id.as_str(), shown.id.as_str(), shown.tool.as_str()), ("term-a", "ask_1", "quay_ask"));
    assert_eq!((shown.revision, shown.asks, shown.answer), (1, true, None));
    assert_eq!(shown.state, json!({ "version": "1.0", "createSurface": { "surfaceId": "ask_1" } }));
    assert!(call.is_open(), "the call waits for its answer");
    seam.surfaces.answer("term-a", "ask_1", 1, answer()).unwrap();

    assert_eq!(call.answer().await, answer());
    let settled = webview.next_shown().await;
    assert_eq!((settled.id.as_str(), settled.answer), ("ask_1", Some(answer())));
    assert!(settled.change > shown.change, "the newer record can be told");
}

fn short(verdict_ms: u64, wait_ms: u64) -> Timing {
    Timing { verdict: Duration::from_millis(verdict_ms), wait: Duration::from_millis(wait_ms) }
}

/// The verdict of a webview whose engine refused the expansion.
fn refused() -> Verdict {
    serde_json::from_value(json!({ "errors": [
        { "code": "VALIDATION_FAILED", "path": "/components/2/options", "message": "Required" },
        { "code": "INTEGRITY_ERROR", "message": "No root" },
    ] }))
    .unwrap()
}

const NO_VERDICT: &str =
    "Quay could not show this; your call was not at fault. Nothing was shown. Send the same call once more.";
const NOT_EXPANDED: &str =
    "Quay could not show this; your call was not at fault. Nothing was shown. Say it in the terminal instead.";

#[test]
fn a_verdict_has_5_s_and_the_wait_is_100_s() {
    let timing = Timing::default();
    assert_eq!((timing.verdict, timing.wait), (Duration::from_secs(5), Duration::from_secs(100)));
}

#[tokio::test]
async fn a_late_verdict_draws_nothing_and_the_agent_is_told_to_send_again() {
    let (log, _guard) = CapturedLog::start();
    let (seam, mut webview) = start(short(50, 5000)).await;
    let call = seam.cli("term-a").call("quay_ask", question());
    let check = webview.next_check().await;

    assert_eq!(call.failure().await, NO_VERDICT);
    assert!(log.text().contains("term-a: no verdict on a quay_ask call"), "{}", log.text());
    assert!(seam.surfaces.unanswered_checks().is_empty(), "a check that is over is not handed over again");

    seam.surfaces.verdict(check.call, accepted(true));
    assert!(webview.nothing_shown().await);
    assert!(seam.surfaces.surfaces().is_empty());
}

#[tokio::test]
async fn a_second_verdict_for_one_check_is_dropped() {
    let (seam, mut webview) = start(Timing::default()).await;
    let _call = seam.cli("term-a").call("quay_ask", question());
    let check = webview.next_check().await;

    seam.surfaces.verdict(check.call, accepted(true));
    seam.surfaces.verdict(check.call, refused());
    seam.surfaces.verdict(check.call, accepted(true));

    assert_eq!(webview.next_shown().await.id, "ask_1");
    assert!(webview.nothing_shown().await);
    assert_eq!(seam.surfaces.surfaces().len(), 1);
}

#[tokio::test]
async fn an_expansion_that_fails_the_engine_is_quays_failure_and_is_logged() {
    let (log, _guard) = CapturedLog::start();
    let (seam, mut webview) = start(Timing::default()).await;
    let call = seam.cli("term-a").call("quay_ask", question());

    seam.surfaces.verdict(webview.next_check().await.call, refused());

    assert_eq!(call.failure().await, NOT_EXPANDED);
    assert!(webview.nothing_shown().await);
    assert!(seam.surfaces.surfaces().is_empty());
    let logged = log.text();
    for part in ["ERROR", "term-a", "VALIDATION_FAILED", "/components/2/options", "Required", "INTEGRITY_ERROR"] {
        assert!(logged.contains(part), "{part} in {logged}");
    }
}

#[tokio::test]
async fn a_check_the_webview_missed_while_it_loaded_is_handed_over_when_it_asks() {
    let (seam, mut webview) = start(Timing::default()).await;
    let call = seam.cli("term-a").call("quay_ask", question());
    let check = webview.next_check().await;

    assert_eq!(seam.surfaces.unanswered_checks(), vec![check.clone()]);
    seam.surfaces.verdict(check.call, accepted(true));

    assert_eq!(webview.next_shown().await.id, "ask_1");
    assert!(seam.surfaces.unanswered_checks().is_empty());
    assert!(call.is_open());
}

#[tokio::test]
async fn a_webview_that_loads_again_is_given_the_surface() {
    let (seam, mut webview) = start(Timing::default()).await;
    let call = seam.cli("term-a").call("quay_ask", question());
    seam.surfaces.verdict(webview.next_check().await.call, accepted(true));
    let shown = webview.next_shown().await;

    assert_eq!(seam.surfaces.surfaces(), vec![shown]);
    seam.surfaces.answer("term-a", "ask_1", 1, answer()).unwrap();

    assert_eq!(call.answer().await, answer(), "the call that was open throughout returns the answer");
    assert_eq!(seam.surfaces.surfaces()[0].answer, Some(answer()));
}

#[tokio::test]
async fn a_wait_ends_at_its_limit_and_the_question_stays_up() {
    let (seam, mut webview) = start(short(5000, 100)).await;
    let call = seam.cli("term-a").call("quay_ask", question());
    seam.surfaces.verdict(webview.next_check().await.call, accepted(true));
    let shown = webview.next_shown().await;

    let no_answer = json!({ "surface_id": "ask_1", "state": "no_answer_yet", "next": "End your turn now." });
    assert_eq!(call.answer().await, no_answer);
    assert_eq!(seam.surfaces.surfaces(), vec![shown]);
    assert_eq!(seam.surfaces.answer("term-a", "ask_1", 1, answer()), Err(AnswerRefused::CallEnded));
    assert_eq!(seam.surfaces.surfaces()[0].answer, None, "an answer that reaches nobody settles nothing");
}

#[tokio::test]
async fn an_answer_to_a_call_whose_connection_closed_is_refused() {
    let (seam, mut webview) = start(Timing::default()).await;
    let call = seam.cli("term-a").call("quay_ask", question());
    seam.surfaces.verdict(webview.next_check().await.call, accepted(true));
    webview.next_shown().await;

    call.hang_up();
    tokio::time::sleep(A_WHILE).await;

    assert_eq!(seam.surfaces.answer("term-a", "ask_1", 1, answer()), Err(AnswerRefused::CallEnded));
    assert_eq!(seam.surfaces.surfaces()[0].answer, None);
}

#[tokio::test]
async fn a_surface_takes_one_answer_to_the_revision_on_screen() {
    let (seam, mut webview) = start(Timing::default()).await;
    let call = seam.cli("term-a").call("quay_ask", question());
    seam.surfaces.verdict(webview.next_check().await.call, accepted(true));
    webview.next_shown().await;

    let answer_to = |revision| seam.surfaces.answer("term-a", "ask_1", revision, answer());
    assert_eq!(answer_to(2), Err(AnswerRefused::OlderRevision));
    assert_eq!(answer_to(1), Ok(()));
    assert_eq!(answer_to(1), Err(AnswerRefused::AlreadyAnswered));
    assert_eq!(call.answer().await, answer());
    assert_eq!(seam.surfaces.answer("term-a", "ask_9", 1, answer()), Err(AnswerRefused::NoSuchSurface));
}

#[tokio::test]
async fn a_surface_that_asks_for_nothing_returns_at_once() {
    let (seam, mut webview) = start(Timing::default()).await;
    let call = seam.cli("term-a").call("quay_ask", question());
    seam.surfaces.verdict(webview.next_check().await.call, accepted(false));

    assert_eq!(call.answer().await, json!({ "shown": true }));
    assert!(!webview.next_shown().await.asks);
}

#[tokio::test]
async fn another_terminals_token_reaches_nothing_of_this_terminals() {
    let (seam, mut webview) = start(Timing::default()).await;
    let call_a = seam.cli("term-a").call("quay_ask", question());
    seam.surfaces.verdict(webview.next_check().await.call, accepted(true));
    webview.next_shown().await;

    assert_eq!(seam.surfaces.answer("term-b", "ask_1", 1, answer()), Err(AnswerRefused::NoSuchSurface));
    let call_b = seam.cli("term-b").call("quay_ask", question());
    let check_b = webview.next_check().await;
    assert_eq!(check_b.surface_id, "ask_1", "each terminal counts its own");
    seam.surfaces.verdict(check_b.call, accepted(true));
    assert_eq!(webview.next_shown().await.terminal_id, "term-b");

    let answer_b = json!({ "answers": [{ "question": "B", "chosen": [], "text": "b" }] });
    seam.surfaces.answer("term-b", "ask_1", 1, answer_b.clone()).unwrap();
    assert_eq!(call_b.answer().await, answer_b);
    assert!(call_a.is_open(), "an answer to one terminal's question is not the other's");
    seam.surfaces.answer("term-a", "ask_1", 1, answer()).unwrap();
    assert_eq!(call_a.answer().await, answer());
}

#[tokio::test]
async fn calls_of_one_terminal_are_checked_one_at_a_time_and_hold_up_no_other() {
    let (seam, mut webview) = start(Timing::default()).await;
    let first = seam.cli("term-a").call("quay_ask", question());
    let first_check = webview.next_check().await;
    let second = seam.cli("term-a").call("quay_ask", question());
    assert!(webview.no_check().await, "the second waits for the first one's check");

    let other = seam.cli("term-b").call("quay_ask", question());
    let other_check = webview.next_check().await;
    seam.surfaces.verdict(other_check.call, accepted(true));
    assert_eq!(webview.next_shown().await.terminal_id, "term-b");
    assert!(webview.no_check().await, "the second still waits");

    seam.surfaces.verdict(first_check.call, accepted(true));
    assert_eq!(webview.next_shown().await.id, "ask_1");
    let second_check = webview.next_check().await;
    assert_eq!(second_check.surface_id, "ask_2");
    seam.surfaces.verdict(second_check.call, accepted(true));
    assert_eq!(webview.next_shown().await.id, "ask_2");
    assert!(first.is_open() && second.is_open() && other.is_open(), "each waits for its own answer, holding up none");
}

#[tokio::test]
async fn a_call_dropped_while_it_is_checked_holds_up_no_later_one() {
    let (seam, mut webview) = start(Timing::default()).await;
    let first = seam.cli("term-a").call("quay_ask", question());
    let first_check = webview.next_check().await;
    let _second = seam.cli("term-a").call("quay_ask", question());
    assert!(webview.no_check().await, "the second waits for the first one's check");

    first.hang_up();

    let second_check = webview.next_check().await;
    assert_eq!(seam.surfaces.unanswered_checks(), vec![second_check.clone()]);
    seam.surfaces.verdict(first_check.call, accepted(true));
    assert!(webview.nothing_shown().await, "a verdict for a call that is gone draws nothing");
    seam.surfaces.verdict(second_check.call, accepted(true));
    assert_eq!(webview.next_shown().await.id, second_check.surface_id);
}

/// A question with these options.
fn with_options(options: Value) -> Value {
    json!({ "questions": [{ "question": "Which?", "options": options }] })
}

#[tokio::test]
async fn a_call_quay_ask_does_not_take_is_rejected_and_shown_to_nobody() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let option = |label: &str| json!({ "label": label });
    let cases = [
        (json!({}), "/questions", "quay_ask needs a list of questions."),
        (json!({ "questions": "Which?" }), "/questions", "quay_ask needs a list of questions."),
        (json!({ "questions": [] }), "/questions", "A call takes one question; this one has 0."),
        (
            json!({ "questions": [{ "question": "A" }, { "question": "B" }] }),
            "/questions",
            "A call takes one question; this one has 2.",
        ),
        (
            json!({ "questions": question()["questions"], "a/b~c": true }),
            "/a~1b~0c",
            "quay_ask has no field \"a/b~c\" here.",
        ),
        (
            json!({ "questions": [{ "question": "A", "options": [], "multiple": true }] }),
            "/questions/0/multiple",
            "quay_ask has no field \"multiple\" here.",
        ),
        (json!({ "questions": ["A"] }), "/questions/0", "A question is an object."),
        (json!({ "questions": [{ "options": [] }] }), "/questions/0/question", "A question needs some text."),
        (
            json!({ "questions": [{ "question": " \n", "options": [] }] }),
            "/questions/0/question",
            "A question needs some text.",
        ),
        (
            json!({ "questions": [{ "question": "é".repeat(201), "options": [] }] }),
            "/questions/0/question",
            "A question is at most 200 characters; this one is 201.",
        ),
        (json!({ "questions": [{ "question": "A" }] }), "/questions/0/options", "A question needs a list of options."),
        (with_options(json!([option("Yes")])), "/questions/0/options", "A question has two to six options; this one has 1."),
        (
            with_options(json!(["a", "b", "c", "d", "e", "f", "g"])),
            "/questions/0/options",
            "A question has two to six options; this one has 7.",
        ),
        (with_options(json!([option("Yes"), "No"])), "/questions/0/options/1", "An option is an object."),
        (with_options(json!([option("Yes"), {}])), "/questions/0/options/1/label", "An option label needs some text."),
        (
            with_options(json!([option("Yes"), option(&"é".repeat(61))])),
            "/questions/0/options/1/label",
            "An option label is at most 60 characters; this one is 61.",
        ),
        (
            with_options(json!([option("Yes"), { "label": "No", "description": 3 }])),
            "/questions/0/options/1/description",
            "An option description is text.",
        ),
        (
            with_options(json!([option("Yes"), { "label": "No", "description": "é".repeat(121) }])),
            "/questions/0/options/1/description",
            "An option description is at most 120 characters; this one is 121.",
        ),
        (
            with_options(json!([option("Yes"), { "label": "No", "recommended": "yes" }])),
            "/questions/0/options/1/recommended",
            "recommended is true or false.",
        ),
        (
            with_options(json!([option("Yes"), option("No"), option("Yes")])),
            "/questions/0/options/2/label",
            "Two options in one question cannot share a label. \"Yes\" is also option 1.",
        ),
        (
            with_options(json!([{ "label": "Yes", "recommended": true }, { "label": "No", "recommended": true }])),
            "/questions/0/options/1/recommended",
            "A question has at most one recommended option.",
        ),
    ];
    for (arguments, path, message) in cases {
        let failure = cli.call("quay_ask", arguments).failure().await;
        assert_eq!(
            serde_json::from_str::<Value>(&failure).unwrap(),
            json!({
                "errors": [{ "code": "VALIDATION_FAILED", "path": path, "message": message }],
                "next": "Nothing was shown. Correct the call and send it again.",
            })
        );
    }
    assert!(webview.no_check().await);
}

#[tokio::test]
async fn a_call_at_every_limit_is_checked() {
    let (seam, mut webview) = start(Timing::default()).await;
    let options: Vec<Value> = ["a", "b", "c", "d", "e", "f"]
        .map(|c| json!({ "label": format!("{c}{}", "é".repeat(59)), "description": "é".repeat(120) }))
        .into();
    let _call = seam
        .cli("term-a")
        .call("quay_ask", json!({ "questions": [{ "question": "é".repeat(200), "options": options }] }));

    assert_eq!(webview.next_check().await.arguments["questions"][0]["options"].as_array().unwrap().len(), 6);
}
