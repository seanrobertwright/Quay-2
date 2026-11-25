//! The surface record at the `/mcp` seam: what its files hold once an agent and the operator have acted.

use std::path::PathBuf;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

use serde_json::{json, Value};

use super::raw_seam::{action, create, created, delete, sent, update};
use super::test_seam::{accepted, answer_to, key, start, FakeWebview, OpenCall, Seam};
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

    /// Has `term-a` send a board of this title.
    async fn board(&mut self, title: &str) {
        let call = self.seam.cli("term-a").call("quay_board", json!({ "title": title }));
        self.seam.surfaces.verdict(self.webview.next_check().await.call, accepted(false));
        call.answer().await;
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
