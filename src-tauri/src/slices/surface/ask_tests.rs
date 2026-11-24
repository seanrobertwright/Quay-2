//! `quay_ask` at the `/mcp` seam: what the agent is told and what the window is sent.

use std::time::Duration;

use serde_json::{json, Value};

use super::ask::{CONTEXT_LIMIT, DESCRIPTION_LIMIT, LABEL_LIMIT, OPTION_COUNT, QUESTION_COUNT, QUESTION_LIMIT};
use super::check::Verdict;
use super::store::{AnswerRefused, SurfaceKey};
use super::test_seam::{accepted, start, start_with, CapturedLog, OpenCall, Seam};
use super::timing::{Timing, WAIT};
use crate::dates::now_ms;

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
async fn the_surface_tools_are_listed_after_the_seven() {
    let (seam, _webview) = start(Timing::default()).await;

    assert_eq!(seam.cli("term-a").tools().await, [&SEVEN[..], &["quay_ask", "quay_board", "quay_surface", "quay_surface_read"]].concat());
}

#[tokio::test]
async fn the_listed_schema_states_the_limits_the_calls_are_held_to() {
    let (seam, _webview) = start(Timing::default()).await;
    let list = seam.cli("term-a").post("tools/list", json!({})).result().await;
    let tool = list["tools"].as_array().unwrap().iter().find(|tool| tool["name"] == "quay_ask").unwrap();
    let call = &tool["inputSchema"]["properties"];
    let question = &call["questions"]["items"]["properties"];
    let options = &question["options"];
    let option = &options["items"]["properties"];

    let says = |value: &Value, part: String| {
        let description = value["description"].as_str().unwrap();
        assert!(description.contains(&part), "{part:?} in {description:?}");
    };
    says(tool, format!("up to {} seconds", WAIT.as_secs()));
    says(&call["context"], format!("at most {CONTEXT_LIMIT} characters"));
    says(&question["question"], format!("at most {QUESTION_LIMIT} characters"));
    says(&option["label"], format!("At most {LABEL_LIMIT} characters"));
    says(&option["description"], format!("At most {DESCRIPTION_LIMIT} characters"));
    let counts = |list: &Value| (list["minItems"].clone(), list["maxItems"].clone());
    assert_eq!(counts(&call["questions"]), (json!(QUESTION_COUNT.start()), json!(QUESTION_COUNT.end())));
    assert_eq!(counts(options), (json!(OPTION_COUNT.start()), json!(OPTION_COUNT.end())));
    assert_eq!(question["multiple"]["type"], "boolean");
    assert_eq!(tool["inputSchema"]["properties"]["questions"]["items"]["required"], json!(["question"]));
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
    let called = now_ms();
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
            "multiple": false,
        }] })
    );
    assert!(webview.nothing_shown().await, "drawn before its verdict");
    seam.surfaces.verdict(check.call, accepted(true));

    let shown = webview.next_shown().await;
    assert_eq!((shown.terminal_id.as_str(), shown.id.as_str(), shown.tool.as_str()), ("term-a", "ask_1", "quay_ask"));
    assert_eq!((shown.revision, shown.asks, shown.answer, shown.answered_at), (1, true, None, None));
    assert_eq!(shown.state, json!({ "version": "1.0", "createSurface": { "surfaceId": "ask_1" } }));
    assert!(call.is_open(), "the call waits for its answer");
    let before = now_ms();
    assert!(called <= shown.shown_at && shown.shown_at <= before, "{called} {} {before}", shown.shown_at);
    seam.surfaces.answer(&SurfaceKey::new("term-a", "ask_1"), 1, answer()).unwrap();

    assert_eq!(call.answer().await, answer());
    let settled = webview.next_shown().await;
    assert_eq!((settled.id.as_str(), settled.answer), ("ask_1", Some(answer())));
    assert!(settled.change > shown.change, "the newer record can be told");
    let sent = settled.answered_at.expect("when it was sent");
    assert!(before <= sent && sent <= now_ms(), "{before} {sent}");
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
    seam.surfaces.answer(&SurfaceKey::new("term-a", "ask_1"), 1, answer()).unwrap();

    assert_eq!(call.answer().await, answer(), "the call that was open throughout returns the answer");
    assert_eq!(seam.surfaces.surfaces()[0].answer, Some(answer()));
}

#[tokio::test]
async fn a_wait_ends_at_its_limit_and_the_question_stays_up() {
    let (seam, mut webview) = start(short(5000, 100)).await;
    let call = seam.cli("term-a").call("quay_ask", question());
    seam.surfaces.verdict(webview.next_check().await.call, accepted(true));
    let shown = webview.next_shown().await;

    assert_eq!(call.answer().await["state"], "no_answer_yet");
    assert_eq!(seam.surfaces.surfaces(), vec![shown]);
}

#[tokio::test]
async fn a_surface_takes_one_answer_to_the_revision_on_screen() {
    let (seam, mut webview) = start(Timing::default()).await;
    let call = seam.cli("term-a").call("quay_ask", question());
    seam.surfaces.verdict(webview.next_check().await.call, accepted(true));
    webview.next_shown().await;

    let answer_to = |revision| seam.surfaces.answer(&SurfaceKey::new("term-a", "ask_1"), revision, answer());
    assert_eq!(answer_to(2), Err(AnswerRefused::OlderRevision));
    assert_eq!(answer_to(1), Ok(()));
    assert_eq!(answer_to(1), Err(AnswerRefused::AlreadyAnswered));
    assert_eq!(call.answer().await, answer());
    assert_eq!(seam.surfaces.answer(&SurfaceKey::new("term-a", "ask_9"), 1, answer()), Err(AnswerRefused::NoSuchSurface));
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

    assert_eq!(seam.surfaces.answer(&SurfaceKey::new("term-b", "ask_1"), 1, answer()), Err(AnswerRefused::NoSuchSurface));
    let call_b = seam.cli("term-b").call("quay_ask", question());
    let check_b = webview.next_check().await;
    assert_eq!(check_b.surface_id, "ask_1", "each terminal counts its own");
    seam.surfaces.verdict(check_b.call, accepted(true));
    assert_eq!(webview.next_shown().await.terminal_id, "term-b");

    let answer_b = json!({ "answers": [{ "question": "B", "chosen": [], "text": "b" }] });
    seam.surfaces.answer(&SurfaceKey::new("term-b", "ask_1"), 1, answer_b.clone()).unwrap();
    assert_eq!(call_b.answer().await, answer_b);
    assert!(call_a.is_open(), "an answer to one terminal's question is not the other's");
    seam.surfaces.answer(&SurfaceKey::new("term-a", "ask_1"), 1, answer()).unwrap();
    assert_eq!(call_a.answer().await, answer());
}

#[tokio::test]
async fn calls_of_one_terminal_are_checked_one_at_a_time_and_hold_up_no_other() {
    let (seam, mut webview) = start(Timing::default()).await;
    let first = seam.cli("term-a").call("quay_ask", question());
    let first_check = webview.next_check().await;
    let second = seam.cli("term-a").call("quay_ask", with_options(json!([{ "label": "Yes" }, { "label": "No" }])));
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

/// The rejection a call got, as its agent reads it.
async fn rejection(call: OpenCall) -> Value {
    serde_json::from_str(&call.failure().await).unwrap()
}

/// Each error's path and message in a rejection.
fn errors(rejection: &Value) -> Vec<(&str, &str)> {
    let errors = rejection["errors"].as_array().unwrap().iter();
    errors.map(|error| (error["path"].as_str().unwrap(), error["message"].as_str().unwrap())).collect()
}

#[tokio::test]
async fn a_call_quay_ask_does_not_take_is_rejected_and_shown_to_nobody() {
    let (seam, mut webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let option = |label: &str| json!({ "label": label });
    let question = |i: usize| json!({ "question": format!("Question {i}?") });
    let cases = [
        (json!("Which?"), "", "A call is an object."),
        (json!({}), "/questions", "quay_ask needs a list of questions."),
        (json!({ "questions": "Which?" }), "/questions", "quay_ask needs a list of questions."),
        (json!({ "questions": [] }), "/questions", "A call takes one to four questions; this one has 0."),
        (
            json!({ "questions": ([1, 2, 3, 4, 5, 6].map(question)) }),
            "/questions",
            "A call takes one to four questions; this one has 6. For more, send a surface with quay_surface and place tab.",
        ),
        (
            json!({ "questions": [question(1)], "a/b~c": true }),
            "/a~1b~0c",
            "quay_ask has no field \"a/b~c\" here.",
        ),
        (json!({ "questions": [question(1)], "context": ["why"] }), "/context", "The context is text."),
        (
            json!({ "questions": [question(1)], "context": "é".repeat(601) }),
            "/context",
            "The context is at most 600 characters; this one is 601. For longer content send a surface with quay_surface and place tab.",
        ),
        (json!({ "questions": [question(1), "B"] }), "/questions/1", "A question is an object."),
        (json!({ "questions": [{}] }), "/questions/0/question", "A question needs some text."),
        (json!({ "questions": [{ "question": " \n" }] }), "/questions/0/question", "A question needs some text."),
        (
            json!({ "questions": [question(1), { "question": "é".repeat(201) }] }),
            "/questions/1/question",
            "A question is at most 200 characters; this one is 201. For longer content send a surface with quay_surface and place tab.",
        ),
        (
            json!({ "questions": [{ "question": "A", "multiple": "yes" }] }),
            "/questions/0/multiple",
            "multiple is true or false.",
        ),
        (with_options(json!("Yes")), "/questions/0/options", "A question's options are a list."),
        (with_options(json!([])), "/questions/0/options", "A question has two to six options; this one has 0."),
        (with_options(json!([option("Yes")])), "/questions/0/options", "A question has two to six options; this one has 1."),
        (
            with_options(json!((["a", "b", "c", "d", "e", "f", "g"].map(option)))),
            "/questions/0/options",
            "A question has two to six options; this one has 7. For more, send a surface with quay_surface and place tab.",
        ),
        (with_options(json!([option("Yes"), "No"])), "/questions/0/options/1", "An option is an object."),
        (with_options(json!([option("Yes"), {}])), "/questions/0/options/1/label", "An option label needs some text."),
        (
            with_options(json!([option("Yes"), option(&"é".repeat(74))])),
            "/questions/0/options/1/label",
            "An option label is at most 60 characters; this one is 74. For longer content send a surface with quay_surface and place tab.",
        ),
        (
            with_options(json!([option("Yes"), { "label": "No", "description": 3 }])),
            "/questions/0/options/1/description",
            "An option description is text.",
        ),
        (
            with_options(json!([option("Yes"), { "label": "No", "description": "é".repeat(121) }])),
            "/questions/0/options/1/description",
            "An option description is at most 120 characters; this one is 121. For longer content send a surface with quay_surface and place tab.",
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
        let rejection = rejection(cli.call("quay_ask", arguments)).await;
        assert_eq!(
            rejection["errors"],
            json!([{ "code": "VALIDATION_FAILED", "path": path, "message": message }])
        );
    }
    assert!(webview.no_check().await && webview.nothing_shown().await);
    assert!(seam.surfaces.surfaces().is_empty());
}

#[tokio::test]
async fn a_call_at_every_limit_is_checked_as_it_was_written() {
    let (seam, mut webview) = start(Timing::default()).await;
    // Each of these is two UTF-16 units and four bytes, and one character
    let of = |length: usize| "👍".repeat(length);
    let options: Vec<Value> = ["a", "b", "c", "d", "e", "f"]
        .map(|c| json!({ "label": format!("{c}{}", of(59)), "description": of(120), "recommended": c == "b" }))
        .into();
    let question = json!({ "question": of(200), "options": options, "multiple": true });
    let call = json!({ "context": of(600), "questions": [question, question, question, question] });
    let _call = seam.cli("term-a").call("quay_ask", call.clone());

    assert_eq!(webview.next_check().await.arguments, call);
}

#[tokio::test]
async fn a_question_needs_neither_options_nor_anything_else() {
    let (seam, mut webview) = start(Timing::default()).await;
    let _call = seam.cli("term-a").call("quay_ask", json!({ "questions": [{ "question": "Why?" }] }));

    assert_eq!(
        webview.next_check().await.arguments,
        json!({ "questions": [{ "question": "Why?", "options": [], "multiple": false }] })
    );
}

#[tokio::test]
async fn a_rejection_lists_everything_wrong_with_the_call() {
    let (seam, _webview) = start(Timing::default()).await;
    let call = seam.cli("term-a").call(
        "quay_ask",
        json!({ "question": "Which?", "questions": [
            { "question": " ", "options": [{ "label": "Yes", "colour": "red" }, { "label": "Yes", "recommended": 1 }] },
            { "question": "B", "options": [{ "label": "é".repeat(61), "description": 3 }, 4] },
        ] }),
    );

    assert_eq!(
        errors(&rejection(call).await),
        [
            ("/question", "quay_ask has no field \"question\" here."),
            ("/questions/0/question", "A question needs some text."),
            ("/questions/0/options/0/colour", "quay_ask has no field \"colour\" here."),
            ("/questions/0/options/1/recommended", "recommended is true or false."),
            (
                "/questions/0/options/1/label",
                "Two options in one question cannot share a label. \"Yes\" is also option 1.",
            ),
            (
                "/questions/1/options/0/label",
                "An option label is at most 60 characters; this one is 61. For longer content send a surface with quay_surface and place tab.",
            ),
            ("/questions/1/options/0/description", "An option description is text."),
            ("/questions/1/options/1", "An option is an object."),
        ]
    );
}

#[tokio::test]
async fn a_rejection_lists_10_errors_and_counts_the_rest() {
    let (seam, _webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let blank = |count: usize| json!({ "questions": [{ "question": "A", "options": vec![json!({ "label": "" }); count] }] });

    let listed = |rejection: &Value| (errors(rejection).len(), rejection.get("more").cloned());
    assert_eq!(listed(&rejection(cli.call("quay_ask", blank(5))).await), (5, None));
    // One for the count, then one for each option
    assert_eq!(listed(&rejection(cli.call("quay_ask", blank(9))).await), (10, None));
    let long = rejection(cli.call("quay_ask", blank(13))).await;
    assert_eq!(listed(&long), (10, Some(json!(4))));
    let errors = errors(&long);
    assert_eq!((errors[0].0, errors[9].0), ("/questions/0/options", "/questions/0/options/8/label"));
}

const SEND_AGAIN: &str = "Nothing was shown. Correct the call and send it again.";
const STOP_GUESSING: &str = "Stop guessing. Call quay_surface_guide first, or use quay_ask, quay_review or quay_board, or say it in the terminal.";

/// What a call with nothing in it is told to do next.
async fn next_of_a_bad_call(seam: &Seam, terminal_id: &str) -> Value {
    rejection(seam.cli(terminal_id).call("quay_ask", json!({}))).await["next"].clone()
}

#[tokio::test]
async fn the_advice_changes_from_the_third_rejection_in_a_row_and_nothing_is_blocked() {
    let (seam, mut webview) = start(Timing::default()).await;
    for next in [SEND_AGAIN, SEND_AGAIN, STOP_GUESSING, STOP_GUESSING] {
        assert_eq!(next_of_a_bad_call(&seam, "term-a").await, next);
    }
    assert_eq!(next_of_a_bad_call(&seam, "term-b").await, SEND_AGAIN, "each terminal's are counted apart");

    let open = seam.asked(&mut webview, "term-a", "Another?").await;
    assert_eq!(next_of_a_bad_call(&seam, "term-a").await, SEND_AGAIN, "an accepted call starts the count again");
    assert!(open.is_open(), "before it has its answer");
    assert_eq!(next_of_a_bad_call(&seam, "term-b").await, SEND_AGAIN, "and only its own terminal's");
    assert_eq!(next_of_a_bad_call(&seam, "term-b").await, STOP_GUESSING);
}

#[tokio::test]
async fn a_call_that_rejoins_its_question_starts_the_count_again() {
    let (seam, mut webview) = start(Timing::default()).await;
    let first = seam.cli("term-a").call("quay_ask", question());
    seam.surfaces.verdict(webview.next_check().await.call, accepted(true));
    webview.next_shown().await;
    for next in [SEND_AGAIN, SEND_AGAIN] {
        assert_eq!(next_of_a_bad_call(&seam, "term-a").await, next);
    }

    let second = seam.cli("term-a").call("quay_ask", question());
    assert!(webview.no_check().await, "no second question is made");
    assert_eq!(next_of_a_bad_call(&seam, "term-a").await, SEND_AGAIN);
    assert!(first.is_open() && second.is_open());
}

#[tokio::test]
async fn a_failure_of_quays_own_neither_counts_as_a_rejection_nor_ends_a_run_of_them() {
    let (seam, mut webview) = start(short(50, 5000)).await;
    assert_eq!(next_of_a_bad_call(&seam, "term-a").await, SEND_AGAIN);
    assert_eq!(seam.cli("term-a").call("quay_ask", question()).failure().await, NO_VERDICT);
    webview.next_check().await;

    assert_eq!(next_of_a_bad_call(&seam, "term-a").await, SEND_AGAIN);
    assert_eq!(seam.cli("term-a").call("quay_ask", question()).failure().await, NO_VERDICT);
    assert_eq!(next_of_a_bad_call(&seam, "term-a").await, STOP_GUESSING);
}

#[tokio::test]
async fn what_is_no_surface_tools_call_is_answered_as_it_was_before_them() {
    let (seam, _webview) = start(Timing::default()).await;
    let cli = seam.cli("term-a");
    let refused = |code: i64, message: &str| json!({ "code": code, "message": message });
    let missing = "Missing target_terminal_id or message argument";
    for (tool, arguments, message) in [
        ("quay_dance", json!({}), "Unknown tool: quay_dance"),
        ("quay_review", json!({}), "Unknown tool: quay_review"),
        ("quay_send_message", json!({}), missing),
        ("quay_broadcast", json!({}), "Missing text argument"),
    ] {
        assert_eq!(cli.call(tool, arguments).reply().await["error"], refused(-32602, message));
    }
    for tool in ["quay_get_agent_status", "machina_submit_work_order", "machina_get_work_order", "machina_submit_deliverable"] {
        let reply = cli.call(tool, json!({})).reply().await;
        assert_eq!((&reply["error"]["code"], &reply["result"]), (&json!(-32602), &Value::Null), "{tool}");
    }
    let nothing_named = cli.post("tools/call", json!({})).reply().await;
    assert_eq!(nothing_named["error"], refused(-32602, "Unknown tool: "));
    let no_method = cli.post("tools/dance", json!({})).reply().await;
    assert_eq!(no_method["error"], refused(-32601, "Method 'tools/dance' not found"));
}
