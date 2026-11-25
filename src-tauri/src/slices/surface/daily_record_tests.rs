//! The surface record at the `/mcp` seam: what its files hold once an agent and the operator have acted.

use std::path::PathBuf;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

use serde_json::{json, Value};

use super::daily_record::Function;
use super::raw_seam::{action, create, created, delete, makes, plan, rejected, says, sent, update};
use super::test_seam::{accepted, answer_to, key, start, CapturedLog, FakeWebview, OpenCall, Seam};
use super::timing::Timing;
use crate::dates::parse_timestamp_ms;
use crate::slices::pty::models::{ClaudeStatus, RunKind};
use crate::test_support::TempDir;

const NOON: &str = "2026-11-24T12:00:00.000Z";

/// A seam that keeps a record, whose time stands still until a test moves it.
struct Recorded {
    seam: Seam,
    webview: FakeWebview,
    dir: TempDir,
    now: Arc<AtomicI64>,
}

impl Recorded {
    async fn start() -> Self {
        Self::start_in(TempDir::new("surface-record")).await
    }

    async fn start_in(dir: TempDir) -> Self {
        let (seam, webview) = start(Timing::default()).await;
        let now = Arc::new(AtomicI64::new(parse_timestamp_ms(NOON).unwrap()));
        let clock = now.clone();
        seam.surfaces.keep_record(dir.join("surfaces"), Arc::new(move || clock.load(Ordering::SeqCst)));
        Self { seam, webview, dir, now }
    }

    fn folder(&self) -> PathBuf {
        self.dir.join("surfaces")
    }

    /// The names of the files in the folder, in order.
    fn files(&self) -> Vec<String> {
        self.seam.surfaces.finish_record();
        let mut names: Vec<_> = std::fs::read_dir(self.folder())
            .map(|files| files.map(|file| file.unwrap().file_name().into_string().unwrap()).collect())
            .unwrap_or_default();
        names.sort();
        names
    }

    /// All the files hold, as text.
    fn text(&self) -> String {
        self.files().iter().map(|name| std::fs::read_to_string(self.folder().join(name)).unwrap()).collect()
    }

    /// What happened to each surface, in order, as `event id`.
    fn events(&self) -> Vec<String> {
        let text = |value: &Value| value.as_str().unwrap_or("none").to_string();
        self.lines().iter().map(|line| format!("{} {}", text(&line["event"]), text(&line["surface_id"]))).collect()
    }

    /// Has `term-a` create the surface `id`.
    async fn create(&mut self, id: &str, asks: bool) -> OpenCall {
        created(&self.seam, &mut self.webview, &self.seam.cli("term-a"), id, "companion", asks).await.0
    }

    /// Has `term-a` send `written`, which the webview accepts as making the surfaces `made`, each of which
    /// asks.
    async fn send(&mut self, written: &[Value], made: &[&str]) -> OpenCall {
        sent(&self.seam, &mut self.webview, &self.seam.cli("term-a"), written, made).await
    }

    /// The operator's answer to `term-a`'s question `id`, once its agent has it and it is drawn as settled.
    async fn answer(&mut self, call: OpenCall, id: &str, title: &str) {
        self.seam.surfaces.answer(&key("term-a", id), 1, answer_to(title)).unwrap();
        call.answer().await;
        self.webview.next_shown().await;
    }

    fn at(&self, time: &str) {
        self.now.store(parse_timestamp_ms(time).unwrap(), Ordering::SeqCst);
    }

    /// Has `term-a` send a board of this title.
    async fn board(&mut self, title: &str) {
        let call = self.seam.cli("term-a").call("quay_board", json!({ "title": title }));
        self.seam.surfaces.verdict(self.webview.next_check().await.call, accepted(false));
        call.answer().await;
        self.webview.next_shown().await;
    }

    /// Every line, in order.
    fn lines(&self) -> Vec<Value> {
        self.text().lines().map(|line| serde_json::from_str(line).unwrap()).collect()
    }
}

#[tokio::test]
async fn a_surface_that_is_shown_is_a_line_in_the_days_file() {
    let mut on = Recorded::start().await;
    let _call = on.seam.asked(&mut on.webview, "term-a", "Which base?").await;

    assert_eq!(
        on.lines(),
        [json!({
            "time": NOON, "event": "shown", "terminal_id": "term-a", "terminal": "term-a", "cli": "claude",
            "tool": "quay_ask", "surface_id": "ask_1", "title": "Which base?", "place": "companion",
        })]
    );
    assert_eq!(on.files(), ["surfaces.2026-11-24.jsonl"]);
}

#[tokio::test]
async fn what_an_agent_changes_and_deletes_is_updated_deleted_or_withdrawn() {
    let mut on = Recorded::start().await;
    on.create("plan", false).await.answer().await;
    on.send(&[update("plan")], &["plan"]).await.hang_up();
    on.webview.next_shown().await;
    on.send(&[delete("plan")], &[]).await.answer().await;
    assert_eq!(on.events(), ["shown plan", "updated plan", "withdrawn plan"]);

    on.create("notes", false).await.answer().await;
    on.send(&[delete("notes")], &[]).await.answer().await;
    on.send(&[delete("never")], &[]).await.answer().await;
    assert_eq!(on.events()[3..], ["shown notes", "deleted notes"]);
}

#[tokio::test]
async fn a_surface_replaced_in_place_leaves_before_the_new_one_is_shown() {
    let mut on = Recorded::start().await;
    on.create("plan", false).await.answer().await;
    let asks = on.send(&[delete("plan"), create("plan")], &["plan"]).await;
    on.webview.next_shown().await;
    let again = on.send(&[delete("plan"), create("plan"), update("plan")], &["plan"]).await;
    asks.answer().await;
    on.webview.next_shown().await;
    assert_eq!(on.events(), ["shown plan", "deleted plan", "shown plan", "withdrawn plan", "shown plan"]);
    again.hang_up();
}

#[tokio::test]
async fn a_board_that_is_sent_again_is_updated_and_one_of_an_earlier_launch_makes_way() {
    let mut on = Recorded::start().await;
    let launch = on.seam.open_terminal("term-a", RunKind::Claude, ClaudeStatus::Working);
    on.board("Build").await;
    on.board("Build again").await;
    assert!(on.seam.pty_manager.exit_launch(&launch, Some(0)));
    on.webview.next_shown().await;
    on.seam.open_terminal("term-a", RunKind::Claude, ClaudeStatus::Working);
    on.board("Another").await;

    assert_eq!(
        on.events(),
        ["shown board", "updated board", "ended board", "deleted board", "shown board"]
    );
    let titles: Vec<_> = on.lines().iter().map(|line| line["title"].clone()).collect();
    assert_eq!(titles, ["Build", "Build again", "Build again", "Build again", "Another"]);
    assert!(on.lines().iter().all(|line| line["tool"] == "quay_board" && line["place"] == "strip"));
}

#[tokio::test]
async fn what_the_operator_dismisses_is_dismissed_alone_or_with_the_other_locked_ones() {
    let mut on = Recorded::start().await;
    let one = on.seam.asked(&mut on.webview, "term-a", "One?").await;
    on.seam.surfaces.dismiss(&key("term-a", "ask_1")).unwrap();
    one.answer().await;
    let two = on.seam.asked(&mut on.webview, "term-a", "Two?").await;
    on.answer(two, "ask_2", "Two?").await;
    on.seam.surfaces.dismiss_locked("term-a", &["ask_2".to_string(), "ask_9".to_string()]);
    on.seam.surfaces.dismiss(&key("term-a", "ask_9")).unwrap();
    assert_eq!(on.events(), ["shown ask_1", "dismissed ask_1", "shown ask_2", "answered ask_2", "dismissed ask_2"]);
}

#[tokio::test]
async fn an_exit_ends_what_is_not_settled_and_so_does_closing_the_terminal() {
    let mut on = Recorded::start().await;
    let launch = on.seam.open_terminal("term-a", RunKind::Codex, ClaudeStatus::Working);
    let one = on.seam.asked(&mut on.webview, "term-a", "One?").await;
    on.answer(one, "ask_1", "One?").await;
    on.seam.asked(&mut on.webview, "term-a", "Two?").await.hang_up();
    let before = on.events().len();
    assert!(on.seam.pty_manager.exit_launch(&launch, Some(0)));
    assert_eq!(on.events()[before..], ["ended ask_2"]);
    on.webview.next_shown().await;

    on.seam.open_terminal("term-a", RunKind::Codex, ClaudeStatus::Working);
    on.seam.asked(&mut on.webview, "term-a", "Three?").await.hang_up();
    let before = on.events().len();
    on.seam.pty_manager.kill("term-a").unwrap();
    assert_eq!(on.events()[before..], ["ended ask_3"]);
    let last = on.lines().pop().unwrap();
    assert_eq!((&last["terminal"], &last["cli"]), (&json!("term-a"), &json!("codex")), "it is still named");
}

#[tokio::test]
async fn a_locked_surface_that_leaves_by_the_limit_counts_as_deleted() {
    let mut on = Recorded::start().await;
    for n in 1..=11 {
        let call = on.seam.asked(&mut on.webview, "term-a", "Go on?").await;
        on.answer(call, &format!("ask_{n}"), "Go on?").await;
    }
    assert_eq!(on.events()[20..], ["shown ask_11", "answered ask_11", "deleted ask_1"]);
}

/// The operator's answer to a question of `term-a`, as the record has it.
async fn answered(arguments: Value, answer: Value) -> Value {
    let mut on = Recorded::start().await;
    let call = on.seam.cli("term-a").call("quay_ask", arguments);
    on.seam.surfaces.verdict(on.webview.next_check().await.call, accepted(true));
    on.webview.next_shown().await;
    on.seam.surfaces.answer(&key("term-a", "ask_1"), 1, answer).unwrap();
    call.answer().await;
    let line = on.lines().pop().unwrap();
    assert!(!on.text().contains("planted"), "{line}");
    line
}

#[tokio::test]
async fn an_answered_question_has_the_chosen_labels_and_nothing_typed() {
    let options = json!([{ "label": "Yes", "description": "planted" }, { "label": "No" }]);
    let questions = json!([
        { "question": "One?", "options": options.clone(), "multiple": true },
        { "question": "Two?" },
        { "question": "Three?", "options": options },
    ]);
    let answer = json!({ "answers": [
        { "question": "One?", "chosen": ["No", "Yes"], "text": "planted" },
        { "question": "Two?", "chosen": ["planted"], "text": "planted" },
        { "question": "Three?", "chosen": ["planted", "Yes"], "text": "planted" },
    ] });
    let line = answered(json!({ "context": "planted", "questions": questions }), answer).await;
    assert_eq!((&line["event"], &line["title"]), (&json!("answered"), &json!("One?")));
    assert_eq!(line["chosen"], json!([["No", "Yes"], [], ["Yes"]]));
    assert!(line.get("verdict").is_none() && line.get("action").is_none(), "{line}");
}

#[tokio::test]
async fn an_answer_that_is_not_as_quay_makes_them_has_nothing_of_it_in_the_record() {
    let question = json!({ "questions": [{ "question": "One?" }] });
    for answer in [json!("planted"), json!({ "answers": "planted" }), json!({ "answers": [{ "chosen": "planted" }, { "chosen": ["planted"] }] })] {
        assert_eq!(answered(question.clone(), answer).await["event"], "answered");
    }
}

#[tokio::test]
async fn a_review_that_was_typed_in_has_its_verdict_and_no_comment() {
    let mut on = Recorded::start().await;
    let review = |title: &str| json!({ "title": title, "body": "planted", "items": [{ "title": "planted" }] });
    let decide = |verdict: &str| json!({ "title": "Plan", "verdict": verdict, "dropped": ["planted"], "comment": "planted" });
    for (n, verdict) in [(1, "changes_requested"), (2, "planted")] {
        let call = on.seam.cli("term-a").call("quay_review", review(&format!("Plan {n}")));
        on.seam.surfaces.verdict(on.webview.next_check().await.call, accepted(true));
        on.webview.next_shown().await;
        on.seam.surfaces.turn_ended("term-a");
        call.answer().await;
        on.seam.surfaces.answer(&key("term-a", &format!("review_{n}")), 1, decide(verdict)).unwrap();
        on.webview.next_shown().await;
    }
    let lines = on.lines();
    assert_eq!(on.events(), ["shown review_1", "answered review_1", "shown review_2", "answered review_2"]);
    assert_eq!((&lines[1]["verdict"], &lines[1]["place"]), (&json!("changes_requested"), &json!("tab")));
    assert!(lines[3].get("verdict").is_none(), "{}", lines[3]);
    assert!(!on.text().contains("planted"), "{}", on.text());
}

#[tokio::test]
async fn an_answered_raw_surface_has_its_actions_name_alone() {
    let mut on = Recorded::start().await;
    let call = on.create("plan", true).await;
    let mut sent = action();
    sent["action"]["context"] = json!({ "note": "planted" });
    on.seam.surfaces.answer(&key("term-a", "plan"), 1, sent).unwrap();
    call.answer().await;
    let line = on.lines().pop().unwrap();
    assert_eq!((&line["event"], &line["action"]), (&json!("answered"), &json!("go")));
    assert!(!on.text().contains("planted"), "{line}");
}

#[tokio::test]
async fn a_rejected_call_has_each_errors_code_and_path_and_how_many_were_in_a_row() {
    let mut on = Recorded::start().await;
    let cli = on.seam.cli("term-a");
    cli.call("quay_ask", json!({ "context": "planted", "questions": [{ "question": "planted ".repeat(40) }, {}] })).failure().await;
    let call = cli.call("quay_ask", json!({}));
    call.failure().await;
    let lines = on.lines();
    assert_eq!(
        lines[0],
        json!({
            "time": NOON, "event": "rejected", "terminal_id": "term-a", "terminal": "term-a", "cli": "claude",
            "tool": "quay_ask", "surface_id": null, "title": null, "place": null, "run": 1,
            "errors": [
                { "code": "VALIDATION_FAILED", "path": "/questions/0/question" },
                { "code": "VALIDATION_FAILED", "path": "/questions/1/question" },
            ],
        })
    );
    assert_eq!((&lines[1]["run"], &lines[1]["errors"][0]["path"]), (&json!(2), &json!("/questions")));

    let call = cli.call("quay_surface", json!({ "place": "tab", "title": "planted", "messages": [create("plan")] }));
    let error = |n: usize| json!({ "code": "ENGINE\u{1b}CODE", "surfaceId": "plan", "path": format!("/messages/{n}"), "message": "planted" });
    let errors: Vec<_> = (0..12).map(error).collect();
    on.seam.surfaces.verdict(on.webview.next_check().await.call, rejected(json!(errors)));
    call.failure().await;
    let line = on.lines().pop().unwrap();
    assert_eq!((&line["tool"], &line["surface_id"], &line["run"]), (&json!("quay_surface"), &json!("plan"), &json!(1)));
    assert_eq!(line["errors"][9], json!({ "code": "ENGINE CODE", "path": "/messages/9" }));
    assert_eq!((line["errors"].as_array().unwrap().len(), &line["more"]), (10, &json!(2)));

    cli.call("quay_surface_read", json!({ "surface_id": "never" })).failure().await;
    let line = on.lines().pop().unwrap();
    assert_eq!((&line["event"], &line["tool"], &line["errors"][0]["path"]), (&json!("rejected"), &json!("quay_surface_read"), &json!("/surface_id")));
    assert!(!on.text().contains("planted"), "{}", on.text());
}

#[tokio::test]
async fn a_call_that_failed_by_quays_own_fault_is_no_rejection() {
    let mut on = Recorded::start().await;
    let call = on.seam.cli("term-a").call("quay_surface", json!({ "place": "tab", "title": "Plan", "messages": [create("plan")] }));
    on.seam.surfaces.verdict(on.webview.next_check().await.call, makes(vec![]));
    call.failure().await;
    assert_eq!(on.lines(), [] as [Value; 0]);
}

#[tokio::test]
async fn what_an_agent_named_is_bounded_and_has_no_control_characters() {
    let mut on = Recorded::start().await;
    on.seam.pty_manager.rename("term-a", "fix\u{202e}75").unwrap();
    let id = format!("a\n\u{1b}[31m{}", "b".repeat(500));
    on.create(&id, false).await.answer().await;
    let call = on.seam.cli("term-a").call("quay_surface", json!({ "messages": [], (id.clone()): 1 }));
    call.failure().await;

    let lines = on.lines();
    assert_eq!(lines[0]["terminal"], "fix 75");
    let shown = lines[0]["surface_id"].as_str().unwrap();
    assert_eq!((&shown[..7], shown.chars().count()), ("a  [31m", 201), "cut, which the last character says");
    assert!(lines[1]["errors"].as_array().unwrap().iter().all(|error| error["path"].as_str().unwrap().chars().count() <= 201));
    let text = on.text();
    assert!(text.lines().count() == 2 && !text.contains("\\u") && !text.contains("\\n"), "{text}");
}

/// What the record holds of the functions fired in `term-a`'s surface, whose agent wrote `written`.
async fn fired(written: &str, fires: &[(Function, Option<&str>)]) -> Vec<Value> {
    let mut on = Recorded::start().await;
    let call = on.seam.cli("term-a").call("quay_surface", plan("plan", "companion"));
    on.seam.surfaces.verdict(on.webview.next_check().await.call, makes(vec![("plan", says(false, written))]));
    call.answer().await;
    for (function, target) in fires {
        on.seam.surfaces.function_fired(&key("term-a", "plan"), *function, *target);
    }
    assert!(!on.text().contains("planted"), "{}", on.text());
    on.lines().split_off(1)
}

#[tokio::test]
async fn a_function_that_fired_has_its_target_but_for_the_text_it_copied() {
    let written = "See [it](https://Example.com/a?b=c#d), [notes](my%20notes.md), C:\\work\\plan.md and fix-75. planted";
    let lines = fired(
        written,
        &[
            (Function::OpenUrl, Some("https://Example.com/a?b=c#d")),
            (Function::ShowFile, Some("C:\\work\\plan.md")),
            (Function::ShowFile, Some("my notes.md")),
            (Function::FocusTerminal, Some("fix-75")),
            (Function::CopyText, Some("planted")),
        ],
    )
    .await;
    assert_eq!(
        lines[0],
        json!({
            "time": NOON, "event": "function fired", "terminal_id": "term-a", "terminal": "term-a", "cli": "claude",
            "tool": "quay_surface", "surface_id": "plan", "title": "Migration plan", "place": "companion",
            "function": "openUrl", "target": "https://Example.com/a?b=c#d",
        })
    );
    let held: Vec<_> = lines.iter().map(|line| (line["function"].clone(), line["target"].clone(), line.get("target_cut").is_some())).collect();
    assert_eq!(held[1], (json!("showFile"), json!("C:\\work\\plan.md"), false));
    assert_eq!(held[2], (json!("showFile"), json!("my notes.md"), false));
    assert_eq!(held[3], (json!("focusTerminal"), json!("fix-75"), false));
    assert_eq!(held[4], (json!("copyText"), Value::Null, false));
}

#[tokio::test]
async fn a_target_that_holds_what_the_operator_typed_is_cut_where_that_begins() {
    let lines = fired(
        "https://example.com/search?q=${/q}",
        &[(Function::OpenUrl, Some("https://example.com/search?q=planted")), (Function::ShowFile, Some("planted"))],
    )
    .await;
    assert_eq!((&lines[0]["target"], &lines[0]["target_cut"]), (&json!("https://example.com/search?q="), &json!(true)));
    assert_eq!(lines[1]["target_cut"], true);
    assert!("planted".starts_with(lines[1]["target"].as_str().unwrap_or_default()));
}

#[tokio::test]
async fn a_target_is_bounded_and_has_no_control_characters() {
    let long = format!("https://example.com/{}", "a".repeat(3000));
    let written = format!("a\u{202e}b.md {long}");
    let lines = fired(&written, &[(Function::OpenUrl, Some(&long)), (Function::ShowFile, Some("a\u{202e}b.md"))]).await;
    assert_eq!(lines[0]["target"].as_str().unwrap().chars().count(), 2049, "cut, which the last character says");
    assert_eq!(lines[1]["target"], "a b.md");
}

#[tokio::test]
async fn a_function_of_a_surface_that_terminal_has_not_is_not_recorded() {
    let mut on = Recorded::start().await;
    on.create("plan", false).await.answer().await;
    on.seam.surfaces.function_fired(&key("term-b", "plan"), Function::OpenUrl, Some("x"));
    on.seam.surfaces.function_fired(&key("term-a", "never"), Function::OpenUrl, Some("x"));
    assert_eq!(on.events(), ["shown plan"]);
}

#[tokio::test]
async fn an_update_is_recorded_at_most_once_a_minute_for_each_surface() {
    let mut on = Recorded::start().await;
    on.board("One").await;
    for (time, title) in [("12:00:01", "Two"), ("12:00:30", "Three"), ("12:01:00.999", "Four"), ("12:01:01", "Five")] {
        on.at(&format!("2026-11-24T{time}Z"));
        on.board(title).await;
    }
    let times = |on: &Recorded| -> Vec<String> {
        let is_update = |line: &Value| line["event"] == "updated";
        on.lines().into_iter().filter(is_update).map(|line| format!("{} {}", line["title"], line["time"])).collect()
    };
    assert_eq!(times(&on), ["\"Two\" \"2026-11-24T12:00:01.000Z\"", "\"Five\" \"2026-11-24T12:01:01.000Z\""]);

    let board = json!({ "title": "Another's", "id": "board" });
    for _ in 0..2 {
        let call = on.seam.cli("term-b").call("quay_board", board.clone());
        on.seam.surfaces.verdict(on.webview.next_check().await.call, accepted(false));
        call.answer().await;
        on.webview.next_shown().await;
    }
    on.create("plan", false).await.answer().await;
    on.send(&[update("plan")], &["plan"]).await.hang_up();
    on.webview.next_shown().await;
    let last = on.events().split_off(3);
    assert_eq!(last, ["shown board", "updated board", "shown plan", "updated plan"], "each has a minute of its own");
}

#[tokio::test]
async fn each_day_has_a_file_of_its_own_and_thirty_days_are_kept() {
    let dir = TempDir::new("surface-record");
    let folder = dir.join("surfaces");
    std::fs::create_dir_all(&folder).unwrap();
    let others = ["surfaces.2026-13-01.jsonl", "surfaces.old.jsonl", "2020-01-01.jsonl", "notes.txt", "surfaces.2020-01-01.jsonl.bak"];
    let days = ["2020-01-01", "2026-10-25", "2026-10-26", "2026-11-23"].map(|day| format!("surfaces.{day}.jsonl"));
    for name in others.iter().copied().chain(days.iter().map(String::as_str)) {
        std::fs::write(folder.join(name), "{}\n").unwrap();
    }
    let mut on = Recorded::start_in(dir).await;
    let kept = |on: &Recorded| -> Vec<String> {
        on.files().into_iter().filter(|name| !others.contains(&name.as_str())).collect()
    };
    assert_eq!(kept(&on), ["surfaces.2026-10-26.jsonl", "surfaces.2026-11-23.jsonl"], "as it starts");

    on.at("2026-11-24T23:59:59.999Z");
    on.board("One").await;
    on.at("2026-11-25T00:00:00Z");
    on.board("Two").await;
    assert_eq!(kept(&on), ["surfaces.2026-11-23.jsonl", "surfaces.2026-11-24.jsonl", "surfaces.2026-11-25.jsonl"]);
    assert_eq!(on.files().len(), 3 + others.len(), "nothing else is deleted");
    let written = std::fs::read_to_string(on.folder().join("surfaces.2026-11-24.jsonl")).unwrap();
    assert!(written.lines().count() == 1 && written.contains("One"), "{written}");
}

#[tokio::test]
async fn a_line_that_cannot_be_written_goes_to_the_error_log_and_the_call_is_as_ever() {
    let (log, _guard) = CapturedLog::start();
    let dir = TempDir::new("surface-record");
    std::fs::write(dir.join("surfaces"), "no folder").unwrap();
    let mut on = Recorded::start_in(dir).await;
    let call = on.seam.asked(&mut on.webview, "term-a", "One?").await;
    on.seam.surfaces.answer(&key("term-a", "ask_1"), 1, answer_to("One?")).unwrap();
    assert_eq!(call.answer().await, answer_to("One?"));
    on.webview.next_shown().await;
    on.seam.surfaces.finish_record();
    assert_eq!(log.text().matches("A line of the surface record could not be written").count(), 2, "{}", log.text());
    assert!(!log.text().contains("skip the suite"), "{}", log.text());

    std::fs::remove_file(on.dir.join("surfaces")).unwrap();
    on.seam.asked_as(&mut on.webview, "term-b", json!(2), "Two?").await;
    assert_eq!(on.events(), ["shown ask_1"], "the next one that can be is written");
}
