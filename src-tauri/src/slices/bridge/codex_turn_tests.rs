//! A Codex terminal's turns, from the two ways Quay hears of them: the OSC 7501 sequences in its
//! output, which show its status, and its turn-end helper's `turn.completed`, which carries its
//! answer and can come before or after the output shows the turn over.

use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde_json::{json, Value};
use tokio::task::JoinHandle;

use super::models::Envelope;
use super::routes::{apply_event, AppContext};
use super::BridgeState;
use crate::dates::now_ms;
use crate::slices::machina::MachinaManager;
use crate::slices::orchestrator::router::WaitOutcome;
use crate::slices::orchestrator::{A2ADispatchRequest, A2AMessage, A2AMessageStatus, A2ARouter};
use crate::slices::pty::manager::PtyManager;
use crate::slices::pty::models::{test_terminal, ClaudeStatus, RunKind};
use crate::slices::pty::osc7501::Osc7501Scanner;
use crate::slices::pty::plugin_watch::LaunchRef;
use crate::slices::pty::session::Osc7501Hook;
use crate::slices::surface::SurfaceTools;
use crate::test_support::TempDir;
use crate::webview::WebviewEvents;

const CODEX: &str = "term-codex";

/// A Codex terminal that is Idle, as it is once it has printed, and a Claude one that sends it
/// messages.
struct Codex {
    ctx: AppContext,
    launch: LaunchRef,
    scanner: Osc7501Scanner,
    hook: Osc7501Hook,
    /// Every event sent to the window, by name and payload.
    sent: Arc<Mutex<Vec<(String, Value)>>>,
    /// Every prompt of its thread so far, which its turn-end helper reports with each turn.
    prompts: Vec<String>,
    _machina_dir: TempDir,
}

impl Codex {
    fn open() -> Self {
        let machina_dir = TempDir::new("codex-turns");
        let sent = Arc::new(Mutex::new(Vec::new()));
        let log = sent.clone();
        let ctx = AppContext {
            bridge_state: BridgeState::new(),
            pty_manager: PtyManager::new(),
            a2a_router: A2ARouter::new(),
            machina_manager: MachinaManager::with_paths(machina_dir.join("state.json"), machina_dir.join("vault")),
            surfaces: SurfaceTools::new(),
            webview: WebviewEvents::to(move |event, payload| log.lock().push((event.to_string(), payload))),
        };
        ctx.a2a_router.follow_turns(&ctx.pty_manager);
        let (router, terminals) = (ctx.a2a_router.clone(), ctx.pty_manager.clone());
        ctx.pty_manager.set_status_watcher(move |id| {
            let (router, terminals, id) = (router.clone(), terminals.clone(), id.to_string());
            std::thread::spawn(move || router.deliver_held(&id, &terminals));
        });
        ctx.pty_manager.insert_test_terminal(test_terminal("term-asker", RunKind::Claude, ClaudeStatus::Idle));
        let (launch, hook) = begin_launch(&ctx);
        Self {
            ctx,
            launch,
            scanner: Osc7501Scanner::default(),
            hook,
            sent,
            prompts: Vec::new(),
            _machina_dir: machina_dir,
        }
    }

    /// One that has printed that it is ready.
    fn ready() -> Self {
        let mut codex = Self::open();
        codex.prints("idle");
        codex
    }

    /// Prints `text`, as its PTY reader reads it.
    fn outputs(&mut self, text: &str) {
        for seq in self.scanner.feed(text) {
            (self.hook)(seq);
        }
    }

    /// Prints the sequence for `state`, with Codex's other fields.
    fn prints(&mut self, state: &str) {
        let kind = if state == "blocked" { ":kind=permission" } else { "" };
        self.outputs(&format!("\x1b]7501;state={state}:app=codex{kind}\x1b\\"));
    }

    /// Starts a turn on `prompt`, and returns when it began.
    fn turn_starts(&mut self, prompt: &str) -> i64 {
        self.prompts.push(prompt.to_string());
        self.prints("working");
        a_moment();
        let began = now_ms();
        a_moment();
        began
    }

    /// Its turn-end helper reports the turn that began at `began`, with every prompt so far.
    fn helper_reports(&self, began: i64, answer: &str) {
        self.helper_posts(json!({ "answer": answer, "inputMessages": self.prompts, "turnId": turn_id(began) }));
    }

    fn helper_posts(&self, data: Value) {
        apply_event(
            &self.ctx,
            Envelope {
                v: 1,
                boot: "codex-notify-1".to_string(),
                seq: 1,
                ts: 0,
                session_id: "thread-1".to_string(),
                tag: Some(CODEX.to_string()),
                event_type: "turn.completed".to_string(),
                data,
            },
        );
    }

    fn status(&self) -> ClaudeStatus {
        self.ctx.pty_manager.get_info(CODEX).unwrap().claude_status
    }

    /// Every status and every `turn.completed` the window has been sent, in order.
    fn told(&self) -> Vec<String> {
        let sent = self.sent.lock();
        sent.iter()
            .filter_map(|(event, payload)| match event.as_str() {
                "terminal-status" => payload["claude_status"].as_str().map(str::to_string),
                "bridge-event" => payload["type"].as_str().map(str::to_string),
                _ => None,
            })
            .collect()
    }

    /// Sends it a peer's message.
    fn message(&self, text: &str) -> A2AMessage {
        self.ctx.a2a_router.dispatch(peer_message(text), Some(&self.ctx.pty_manager)).unwrap()
    }

    /// Sends it a peer's message and waits for the answer, once the message is typed in.
    async fn asked(&self, text: &str) -> JoinHandle<Result<WaitOutcome, String>> {
        let (router, terminals, request) =
            (self.ctx.a2a_router.clone(), self.ctx.pty_manager.clone(), peer_message(text));
        let waiting = tokio::spawn(async move { router.dispatch_and_wait(request, Some(&terminals), 60).await });
        self.until_entered(&[text]).await;
        waiting
    }

    /// Every message typed in with its Enter so far, without what Quay puts before it.
    fn entered(&self) -> Vec<String> {
        let input = self.ctx.pty_manager.test_input(CODEX);
        input
            .chunks(3)
            .filter(|prompt| prompt.len() == 3)
            .map(|prompt| prompt[0].replace("[Peer agent (term-asker)]: ", ""))
            .collect()
    }

    /// Waits until `texts` are the messages entered, and Quay has noted that they were.
    async fn until_entered(&self, texts: &[&str]) {
        until(|| self.entered() == texts, "it was never typed in").await;
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    fn trail(&self, message: &A2AMessage) -> A2AMessage {
        self.ctx.a2a_router.get_messages().into_iter().find(|m| m.id == message.id).unwrap()
    }

    /// What answered `message`, if a turn did.
    fn answer_to(&self, message: &A2AMessage) -> Option<String> {
        self.trail(message).response
    }
}

/// Launches the Codex terminal, which prints something that is no sequence.
fn begin_launch(ctx: &AppContext) -> (LaunchRef, Osc7501Hook) {
    ctx.pty_manager.open_test_input(CODEX);
    let launch = ctx.pty_manager.begin_launch(CODEX, RunKind::Codex);
    ctx.pty_manager.insert_launched(&launch, test_terminal(CODEX, RunKind::Codex, ClaudeStatus::Starting));
    ctx.pty_manager.note_first_output(&launch, Instant::now());
    ctx.pty_manager.apply_first_output_status(&launch);
    let hook = ctx.pty_manager.osc7501_hook(RunKind::Codex, &launch, ctx.webview.clone()).unwrap();
    (launch, hook)
}

fn peer_message(text: &str) -> A2ADispatchRequest {
    A2ADispatchRequest {
        from_terminal: "term-asker".to_string(),
        to_terminal: CODEX.to_string(),
        prompt: text.to_string(),
        as_user: Some(false),
    }
}

/// `text` as Codex reads it.
fn peers(text: &str) -> String {
    format!("[Peer agent (term-asker)]: {text}")
}

/// The id Codex gives a turn that began at `began`.
fn turn_id(began: i64) -> String {
    format!("{:08x}-{:04x}-7d75-8c9b-ab83922cae5d", began >> 16, began & 0xffff)
}

/// Long enough for a later time to be a later millisecond.
fn a_moment() {
    std::thread::sleep(Duration::from_millis(3));
}

async fn until(holds: impl Fn() -> bool, what: &str) {
    let polling = async {
        while !holds() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    };
    tokio::time::timeout(Duration::from_secs(5), polling).await.expect(what);
}

async fn reply(waiting: JoinHandle<Result<WaitOutcome, String>>) -> WaitOutcome {
    let waited = tokio::time::timeout(Duration::from_secs(1), waiting).await;
    waited.expect("the sender was answered at once").unwrap().unwrap()
}

// ---- Status

#[test]
fn the_moments_of_a_turn_show_working_waiting_and_idle_whoever_started_it() {
    let mut codex = Codex::open();
    let moments = [
        ("idle", ClaudeStatus::Idle),
        // A turn the operator typed
        ("working", ClaudeStatus::Working),
        ("blocked", ClaudeStatus::Waiting),
        ("working", ClaudeStatus::Working),
        ("done", ClaudeStatus::Idle),
        // One that Esc ended at a prompt, and one that it ended during an answer
        ("working", ClaudeStatus::Working),
        ("blocked", ClaudeStatus::Waiting),
        ("working", ClaudeStatus::Working),
        ("idle", ClaudeStatus::Idle),
        ("working", ClaudeStatus::Working),
        ("idle", ClaudeStatus::Idle),
    ];
    for (at, (state, status)) in moments.into_iter().enumerate() {
        codex.prints(state);
        assert_eq!(codex.status(), status, "{state} at {at}");
    }
    assert_eq!(
        codex.told(),
        ["working", "waiting", "working", "idle", "working", "waiting", "working", "idle", "working", "idle"],
        "the window is told of each change once"
    );
}

#[test]
fn a_launch_prompts_turn_shows_working_until_it_ends() {
    let mut codex = Codex::open();
    codex.prints("working");
    assert_eq!(codex.status(), ClaudeStatus::Working);
    codex.prints("done");
    assert_eq!(codex.status(), ClaudeStatus::Idle);
}

#[test]
fn a_sequence_split_across_reads_shows_its_status_once_whole() {
    let mut codex = Codex::ready();
    codex.outputs("text\x1b]7501;state=wor");
    assert_eq!(codex.status(), ClaudeStatus::Idle);
    codex.outputs("king:app=codex\x1b");
    assert_eq!(codex.status(), ClaudeStatus::Idle);
    codex.outputs("\\more text");
    assert_eq!(codex.status(), ClaudeStatus::Working);
}

#[tokio::test]
async fn a_report_of_an_exited_or_earlier_launch_changes_nothing() {
    let mut codex = Codex::ready();
    let began = codex.turn_starts("the operator's prompt");
    codex.ctx.pty_manager.exit_launch(&codex.launch, None);
    for state in ["working", "blocked", "done", "idle"] {
        codex.prints(state);
        assert_eq!(codex.status(), ClaudeStatus::Exited, "{state}");
    }
    codex.helper_reports(began, "late");
    assert_eq!(codex.status(), ClaudeStatus::Exited);

    a_moment();
    let (_, mut new_hook) = begin_launch(&codex.ctx);
    codex.sent.lock().clear();
    codex.prints("working");
    assert_eq!(codex.status(), ClaudeStatus::Idle, "the old launch's output");
    let mut scanner = Osc7501Scanner::default();
    scanner.feed("\x1b]7501;state=working:app=codex\x1b\\").into_iter().for_each(&mut new_hook);
    codex.helper_reports(began, "later still");
    assert_eq!(codex.status(), ClaudeStatus::Working);
    assert_eq!(codex.told(), ["working"], "the old launch's turn is not listed as finished");
}

#[test]
fn output_after_a_launch_exits_starts_no_turn() {
    let mut codex = Codex::ready();
    codex.turn_starts("the operator's prompt");
    codex.prints("done");
    codex.ctx.pty_manager.exit_launch(&codex.launch, None);
    codex.prints("working");
    assert!(!codex.ctx.pty_manager.turn_running(CODEX, None));
}

#[tokio::test]
async fn the_helpers_report_moves_no_status_in_a_launch_whose_output_does() {
    let mut codex = Codex::ready();
    let began = codex.turn_starts("the operator's prompt");
    codex.helper_reports(began, "early");
    assert_eq!(codex.status(), ClaudeStatus::Working);
    codex.prints("done");
    assert_eq!(codex.status(), ClaudeStatus::Idle);

    // A report as late as the next turn
    let next = codex.turn_starts("the operator's next prompt");
    codex.helper_reports(began, "again");
    assert_eq!(codex.status(), ClaudeStatus::Working);
    codex.prints("blocked");
    codex.helper_reports(next, "odd");
    assert_eq!(codex.status(), ClaudeStatus::Waiting);
}

// ---- What the window lists as a finished turn: a `turn.completed` with no `working` after it

#[tokio::test]
async fn a_turn_reported_before_its_output_shows_it_over_stays_listed_as_finished() {
    let mut codex = Codex::ready();
    let began = codex.turn_starts("the operator's prompt");
    codex.helper_reports(began, "early");
    codex.prints("done");
    assert_eq!(codex.told(), ["working", "turn.completed", "idle"]);
}

#[tokio::test]
async fn a_turn_reported_after_its_output_shows_it_over_stays_listed_as_finished() {
    let mut codex = Codex::ready();
    let began = codex.turn_starts("the operator's prompt");
    codex.prints("done");
    codex.helper_reports(began, "late");
    assert_eq!(codex.told(), ["working", "idle", "turn.completed", "idle"]);
}

#[tokio::test]
async fn a_turn_reported_once_the_next_one_runs_is_not_left_listed_as_finished() {
    let mut codex = Codex::ready();
    let began = codex.turn_starts("the operator's prompt");
    codex.prints("done");
    codex.turn_starts("the operator's next prompt");
    codex.helper_reports(began, "late");
    assert_eq!(codex.told(), ["working", "idle", "working", "turn.completed", "working"]);
}

#[tokio::test]
async fn a_finished_turn_is_unlisted_as_a_messages_turn_starts() {
    let mut codex = Codex::ready();
    let began = codex.turn_starts("the operator's prompt");
    codex.prints("done");
    codex.helper_reports(began, "done");
    codex.message("What is 2+2?");
    assert_eq!(codex.status(), ClaudeStatus::Working);
    codex.turn_starts(&peers("What is 2+2?"));
    assert_eq!(codex.told().last().unwrap(), "working");
}

#[tokio::test]
async fn the_status_is_sent_as_it_is_when_it_is_sent() {
    let codex = Codex::ready();
    codex.ctx.pty_manager.update_status(CODEX, ClaudeStatus::Waiting);
    let mut sent = None;
    codex.ctx.pty_manager.send_status(CODEX, |status| sent = Some(status.claude_status));
    assert_eq!(sent, Some(ClaudeStatus::Waiting));
}

// ---- Held messages

#[tokio::test]
async fn a_message_sent_during_the_operators_turn_is_held_until_it_ends() {
    let mut codex = Codex::ready();
    let operators = codex.turn_starts("the operator's prompt");
    let message = codex.message("What is 2+2?");
    assert_eq!(message.status, A2AMessageStatus::Queued);

    codex.prints("blocked");
    let second = codex.message("And 3+3?");
    assert_eq!(second.status, A2AMessageStatus::Queued, "a permission prompt holds it too");
    codex.prints("working");
    assert!(codex.entered().is_empty());

    codex.prints("done");
    codex.until_entered(&["What is 2+2?"]).await;
    codex.helper_reports(operators, "the operator's answer");
    assert_eq!(codex.answer_to(&message), None);
    assert_eq!(codex.status(), ClaudeStatus::Working);
    assert_eq!(codex.entered(), ["What is 2+2?"], "one message per turn");

    let began = codex.turn_starts(&peers("What is 2+2?"));
    codex.prints("done");
    codex.helper_reports(began, "4");
    assert_eq!(codex.answer_to(&message).as_deref(), Some("4"));
    codex.until_entered(&["What is 2+2?", "And 3+3?"]).await;
    let began = codex.turn_starts(&peers("And 3+3?"));
    codex.helper_reports(began, "6");
    codex.prints("done");
    assert_eq!(codex.answer_to(&second).as_deref(), Some("6"));
    assert_eq!(codex.status(), ClaudeStatus::Idle);
}

#[tokio::test]
async fn the_idle_that_comes_as_quay_types_a_message_lets_no_other_in() {
    let mut codex = Codex::ready();
    codex.turn_starts("the operator's prompt");
    codex.message("first");
    codex.message("second");
    codex.prints("done");
    // Quay's first key after a `done` makes Codex print it, before the Enter
    until(|| codex.ctx.pty_manager.test_input(CODEX).len() == 2, "nothing was typed").await;
    codex.prints("idle");
    assert_eq!(codex.status(), ClaudeStatus::Working);
    codex.until_entered(&["first"]).await;
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert_eq!(codex.entered(), ["first"]);

    codex.turn_starts(&peers("first"));
    codex.prints("done");
    codex.until_entered(&["first", "second"]).await;
}

#[tokio::test]
async fn esc_frees_the_held_messages_and_the_interrupted_one_gets_no_other_turns_answer() {
    let mut codex = Codex::ready();
    let interrupted = codex.message("long job");
    codex.until_entered(&["long job"]).await;
    let held = codex.message("short job");
    codex.turn_starts(&peers("long job"));
    codex.prints("idle");

    codex.until_entered(&["long job", "short job"]).await;
    let began = codex.turn_starts(&peers("short job"));
    codex.helper_reports(began, "short answer");
    codex.prints("done");
    assert_eq!(codex.answer_to(&held).as_deref(), Some("short answer"));
    assert_eq!(codex.trail(&interrupted).status, A2AMessageStatus::Dispatched);
    assert_eq!(codex.answer_to(&interrupted), None);
    assert_eq!(codex.status(), ClaudeStatus::Idle);
}

#[tokio::test]
async fn an_interrupted_message_is_not_answered_by_the_operators_next_turn() {
    let mut codex = Codex::ready();
    let interrupted = codex.message("long job");
    codex.turn_starts(&peers("long job"));
    codex.prints("idle");
    a_moment();

    // Its report lists the interrupted prompt too
    let began = codex.turn_starts("the operator's prompt");
    codex.helper_reports(began, "the operator's answer");
    codex.prints("done");
    assert_eq!(codex.answer_to(&interrupted), None);
}

#[tokio::test]
async fn a_message_sent_again_after_esc_gets_the_answer_and_the_interrupted_one_does_not() {
    for report_first in [true, false] {
        let mut codex = Codex::ready();
        let interrupted = codex.message("review it");
        codex.turn_starts(&peers("review it"));
        codex.prints("idle");
        a_moment();

        let again = codex.message("review it");
        let began = codex.turn_starts(&peers("review it"));
        if report_first {
            codex.helper_reports(began, "reviewed");
            codex.prints("done");
        } else {
            codex.prints("done");
            codex.helper_reports(began, "reviewed");
        }
        assert_eq!(codex.answer_to(&again).as_deref(), Some("reviewed"));
        assert_eq!(codex.answer_to(&interrupted), None);
    }
}

// ---- Answers

#[tokio::test]
async fn a_waiting_sender_gets_the_helpers_answer_with_the_turn_over_before_it_or_after_it() {
    for report_first in [true, false] {
        let mut codex = Codex::ready();
        let waiting = codex.asked("What is 2+2?").await;
        assert_eq!(codex.status(), ClaudeStatus::Working);
        let began = codex.turn_starts(&peers("What is 2+2?"));
        if report_first {
            codex.helper_reports(began, "4");
            codex.prints("done");
        } else {
            codex.prints("done");
            assert_eq!(codex.status(), ClaudeStatus::Idle);
            tokio::time::sleep(Duration::from_millis(50)).await;
            assert!(!waiting.is_finished(), "the turn's end alone answers nobody");
            codex.helper_reports(began, "4");
        }
        assert_eq!(reply(waiting).await, WaitOutcome::Reply("4".to_string()));
        assert_eq!(codex.status(), ClaudeStatus::Idle);
    }
}

#[tokio::test]
async fn a_report_as_late_as_the_next_messages_turn_answers_its_own_message() {
    for next in ["What is 3+3?", "What is 2+2?"] {
        let mut codex = Codex::ready();
        let first = codex.message("What is 2+2?");
        let first_began = codex.turn_starts(&peers("What is 2+2?"));
        let second = codex.message(next);
        assert_eq!(second.status, A2AMessageStatus::Queued);
        let first_prompts = codex.prompts.clone();
        codex.prints("done");
        codex.until_entered(&["What is 2+2?", next]).await;
        let second_began = codex.turn_starts(&peers(next));

        let late = json!({ "answer": "first", "inputMessages": first_prompts, "turnId": turn_id(first_began) });
        codex.helper_posts(late);
        assert_eq!(codex.answer_to(&first).as_deref(), Some("first"), "{next}");
        assert_eq!(codex.answer_to(&second), None, "{next}");

        codex.prints("done");
        codex.helper_reports(second_began, "second");
        assert_eq!(codex.answer_to(&first).as_deref(), Some("first"), "{next}");
        assert_eq!(codex.answer_to(&second).as_deref(), Some("second"), "{next}");
    }
}

#[tokio::test]
async fn a_message_that_reaches_a_running_turn_is_not_answered_by_it() {
    let mut codex = Codex::ready();
    let began = codex.turn_starts("the operator's prompt");
    // The operator's Enter went in as Quay began to type
    codex.ctx.pty_manager.update_status(CODEX, ClaudeStatus::Idle);
    let message = codex.message("What is 2+2?");
    codex.prompts.push(peers("What is 2+2?"));

    codex.helper_reports(began, "the operator's answer");
    codex.prints("done");
    assert_eq!(codex.answer_to(&message), None);
    a_moment();
    let next = codex.turn_starts("the operator's next prompt");
    codex.helper_reports(next, "another answer");
    assert_eq!(codex.answer_to(&message), None);
}

#[tokio::test]
async fn a_turn_the_operator_steers_still_answers_its_message() {
    let mut codex = Codex::ready();
    let message = codex.message("What is 2+2?");
    let began = codex.turn_starts(&peers("What is 2+2?"));
    codex.prompts.push("in words, please".to_string());
    codex.prints("done");
    codex.helper_reports(began, "four");
    assert_eq!(codex.answer_to(&message).as_deref(), Some("four"));
}

#[tokio::test]
async fn a_turn_whose_id_tells_no_time_is_paired_by_its_prompts_alone() {
    for id in [json!("turn-1"), json!("3f2504e0-4f89-41d3-9a0c-0305e82c3301"), json!(7), Value::Null] {
        let mut codex = Codex::ready();
        let message = codex.message("What is 2+2?");
        codex.turn_starts(&peers("What is 2+2?"));
        codex.prints("done");
        codex.helper_posts(json!({ "answer": "4", "inputMessages": codex.prompts, "turnId": id }));
        assert_eq!(codex.answer_to(&message).as_deref(), Some("4"), "{id}");
        assert_eq!(codex.told().last().unwrap(), "idle", "{id}");
    }
}

// ---- A Codex that prints no OSC 7501

#[tokio::test]
async fn a_codex_that_prints_no_sequences_is_working_from_a_delivery_until_its_helper_reports() {
    let mut codex = Codex::open();
    let waiting = codex.asked("What is 2+2?").await;
    assert_eq!(codex.status(), ClaudeStatus::Working);
    let held = codex.message("And 3+3?");
    assert_eq!(held.status, A2AMessageStatus::Queued);

    codex.prompts.push(peers("What is 2+2?"));
    codex.helper_reports(now_ms(), "4");
    assert_eq!(reply(waiting).await, WaitOutcome::Reply("4".to_string()));
    assert_eq!(codex.told(), ["turn.completed", "idle"]);
    codex.until_entered(&["What is 2+2?", "And 3+3?"]).await;
    assert_eq!(codex.status(), ClaudeStatus::Working);
}

#[tokio::test]
async fn a_codex_that_prints_no_sequences_pairs_a_turn_by_its_prompts_alone() {
    let mut codex = Codex::open();
    let before = now_ms();
    a_moment();
    let message = codex.message("What is 2+2?");
    // Typed into a turn the operator began, which Quay did not see
    codex.prompts = vec!["the operator's prompt".to_string(), peers("What is 2+2?")];
    codex.helper_reports(before, "both");
    assert_eq!(codex.answer_to(&message).as_deref(), Some("both"));
}
