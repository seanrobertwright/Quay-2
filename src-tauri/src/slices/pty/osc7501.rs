//! The turn reports a CLI prints in its own output: an OSC 7501 sequence,
//! `ESC ] 7501 ; state=<state>:key=value:...` and a terminator, each time its turn moves. Quay
//! reads them from the PTY output to show the terminal's status. What they say of a turn differs
//! by CLI, which `TurnReader` tells apart.
//!
//! - Antigravity prints them when `AGY_CLI_OSC7501=on`: `working` when a turn starts, `done` when
//!   it ends, `blocked` when it waits on a prompt, `idle` when it is ready. `done` and `blocked`
//!   carry a base64 `msg`, the answer or what it waits on, with which Quay answers a waiting sender.
//! - Codex prints them unasked, in some versions (0.163.0, 0.164.0 and 0.172.0 do, 0.154.0 does
//!   not), and with no `msg` that Quay has seen: `working` when a turn starts, `blocked` at a
//!   permission prompt, and at a turn's end `done`, or `idle` when the turn was interrupted. `idle`
//!   also comes outside a turn: when Codex is ready after its start, and with the first key after a
//!   `done`, so as Quay types the next message in, before that message's turn. Quay takes its
//!   answers from its turn-end helper.

use base64::Engine;

use super::models::{ClaudeStatus, RunKind};

/// Turns Antigravity's sequences on.
pub const ENABLE_VAR: &str = "AGY_CLI_OSC7501";

/// Set to `brief`, it drops `msg` from every sequence of Antigravity's, so Quay never passes it on.
pub const MESSAGES_VAR: &str = "AGY_CLI_OSC7501_MESSAGES";

const INTRO: &str = "\x1b]7501;";

/// Longest sequence body kept while waiting for its terminator. A `msg` is at most 200
/// characters, well under this once base64-encoded; anything longer isn't a sequence Quay reads.
const MAX_BODY: usize = 8 * 1024;

/// How many characters of a `msg` Antigravity sends at most, its last one `CUT_MARK` when
/// the text was longer.
const MSG_CAP: usize = 200;
const CUT_MARK: char = '\u{2026}';

/// What a sender reads after a reply Antigravity cut off.
const CUT_NOTE: &str = "[Quay: Antigravity cut this reply off. It sends at most 199 characters of an answer, so ask it to write a longer one to a file.]";

/// The answer a `done` with no `msg` gives, as a Claude turn without one does.
const NO_MSG_ANSWER: &str = "Turn completed";

/// One OSC 7501 sequence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Osc7501 {
    pub state: String,
    /// What a `blocked` state waits on, such as `permission` or `auth`.
    pub kind: Option<String>,
    /// The decoded `msg`.
    pub msg: Option<String>,
}

impl Osc7501 {
    /// Reads a sequence body, `state=<state>` then colon-separated `key=value` pairs.
    /// `None` when it doesn't start with a state.
    pub fn parse(body: &str) -> Option<Self> {
        let mut fields = body.split(':');
        let state = fields.next()?.strip_prefix("state=")?.to_string();
        let mut seq = Self { state, kind: None, msg: None };
        for (key, value) in fields.filter_map(|field| field.split_once('=')) {
            match key {
                "kind" => seq.kind = Some(value.to_string()),
                "msg" => seq.msg = decode_msg(value),
                _ => {}
            }
        }
        Some(seq)
    }

    /// Whether Antigravity cut `msg` off: it is exactly the cap long and ends in the cut
    /// mark. Either sign alone is an answer that happens to look that way.
    pub fn cut_off(&self) -> bool {
        self.msg
            .as_deref()
            .is_some_and(|msg| msg.chars().count() == MSG_CAP && msg.ends_with(CUT_MARK))
    }

    /// `msg` as a sender reads it, with a note after it when it was cut off.
    fn marked_msg(&self) -> Option<String> {
        let msg = self.msg.as_deref()?;
        Some(if self.cut_off() { format!("{}\n\n{}", msg, CUT_NOTE) } else { msg.to_string() })
    }

    /// What a sender waiting on this turn is told: the answer for `done`, and for
    /// `blocked` what the turn waits on, as `blocked (permission): Trust this folder?`.
    /// `None` for any other state.
    pub fn answer(&self) -> Option<String> {
        match self.state.as_str() {
            "done" => Some(self.marked_msg().unwrap_or_else(|| NO_MSG_ANSWER.to_string())),
            "blocked" => {
                let head = match &self.kind {
                    Some(kind) => format!("blocked ({})", kind),
                    None => "blocked".to_string(),
                };
                Some(match self.marked_msg() {
                    Some(msg) => format!("{}: {}", head, msg),
                    None => head,
                })
            }
            _ => None,
        }
    }
}

/// `value` base64-decoded as UTF-8 text, or `None` when it isn't base64.
fn decode_msg(value: &str) -> Option<String> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(value).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// Finds OSC 7501 sequences in a terminal's output, read in chunks that may split one.
#[derive(Debug, Default)]
pub struct Osc7501Scanner {
    /// The end of the last chunk, from where a sequence may have started but not finished.
    carry: String,
}

impl Osc7501Scanner {
    /// The sequences that end in `text`, in order, including one a previous chunk began.
    /// A sequence ends with BEL or with ST (`ESC \`).
    pub fn feed(&mut self, text: &str) -> Vec<Osc7501> {
        let mut buf = std::mem::take(&mut self.carry);
        buf.push_str(text);
        let mut found = Vec::new();
        let mut rest = buf.as_str();
        while let Some(at) = rest.find(INTRO) {
            let body = &rest[at + INTRO.len()..];
            let Some((end, terminator)) = terminator(body) else {
                if body.len() <= MAX_BODY {
                    self.carry = rest[at..].to_string();
                }
                return found;
            };
            found.extend(Osc7501::parse(&body[..end]));
            rest = &body[end + terminator..];
        }
        // Keep a tail that could still grow into the start of a sequence
        if let Some(at) = rest.rfind('\x1b').filter(|at| INTRO.starts_with(&rest[*at..])) {
            self.carry = rest[at..].to_string();
        }
        found
    }
}

/// Where the sequence body `body` ends, and its terminator's length, if it has ended.
fn terminator(body: &str) -> Option<(usize, usize)> {
    let bel = body.find('\x07').map(|at| (at, 1));
    let st = body.find("\x1b\\").map(|at| (at, 2));
    match (bel, st) {
        (Some(b), Some(s)) => Some(if b.0 < s.0 { b } else { s }),
        (one, other) => one.or(other),
    }
}

/// What one sequence means for the terminal it was printed in.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TurnReport {
    /// The status it puts the terminal in, if any.
    pub status: Option<ClaudeStatus>,
    /// Whether a terminal that is Working stays so all the same: the report ends no turn, so the
    /// terminal is Working for a message whose turn has yet to start.
    pub leaves_working: bool,
    /// Whether a turn starts with it, and takes the message typed in before it.
    pub starts_turn: bool,
    /// What a sender waiting on the running turn is told, if it hears now.
    pub answer: Option<String>,
    /// Whether a turn ends with it, after its answer.
    pub ends_turn: bool,
    /// Whether it shows the running turn over, while the turn's answer comes another way: before
    /// it, after it, or never.
    pub stops_turn: bool,
}

/// Follows one launch's turns through its sequences, by what they mean for its CLI.
#[derive(Debug)]
pub enum TurnReader {
    Antigravity(AntigravityTurn),
    Codex(CodexTurn),
}

impl TurnReader {
    /// The reader for one launch of `run_kind`, or `None` for a CLI whose sequences Quay doesn't read.
    pub fn for_launch(run_kind: RunKind) -> Option<Self> {
        match run_kind {
            RunKind::Antigravity => Some(Self::Antigravity(AntigravityTurn::default())),
            RunKind::Codex => Some(Self::Codex(CodexTurn::default())),
            _ => None,
        }
    }

    /// Reads the launch's next sequence.
    pub fn read(&mut self, seq: &Osc7501) -> TurnReport {
        match self {
            Self::Antigravity(turn) => turn.read(seq),
            Self::Codex(turn) => turn.read(seq),
        }
    }
}

/// Follows one launch of a Codex terminal through its sequences, so it can tell the `idle` that
/// ends a turn from one outside a turn.
#[derive(Debug, Default)]
pub struct CodexTurn {
    in_turn: bool,
}

impl CodexTurn {
    /// Reads the next sequence. `working` and `blocked` show the terminal Working and Waiting, and
    /// the `done` or `idle` after them stops the turn. Outside a turn, `done` and `idle` show it
    /// Idle, unless a message made it Working. No report answers a sender, or starts or ends a turn
    /// for those who wait on one: Codex's turn-end helper does (`A2ARouter::turn_completed`).
    pub fn read(&mut self, seq: &Osc7501) -> TurnReport {
        let (status, in_turn_after) = match seq.state.as_str() {
            "working" => (ClaudeStatus::Working, true),
            "blocked" => (ClaudeStatus::Waiting, true),
            "done" | "idle" => (ClaudeStatus::Idle, false),
            _ => return TurnReport::default(),
        };
        let was_in_turn = std::mem::replace(&mut self.in_turn, in_turn_after);
        TurnReport {
            status: Some(status),
            leaves_working: !in_turn_after && !was_in_turn,
            stops_turn: !in_turn_after && was_in_turn,
            ..TurnReport::default()
        }
    }
}

/// Follows one launch of an Antigravity terminal through its sequences, so it can tell a
/// turn's start from the `working` that follows an approved prompt in the same turn.
#[derive(Debug, Default)]
pub struct AntigravityTurn {
    in_turn: bool,
}

impl AntigravityTurn {
    /// Reads the next sequence. `working` starts a turn and `done` ends it with its answer.
    /// `blocked` shows the terminal Waiting and tells a waiting sender what the turn waits
    /// on, but the turn goes on once the prompt is answered. A `done` or `blocked` with no
    /// `working` before it, as when a message lands on a dialog, starts the turn too, so the
    /// message it answers is paired with it. `idle` leaves any turn.
    pub fn read(&mut self, seq: &Osc7501) -> TurnReport {
        let (status, in_turn_after) = match seq.state.as_str() {
            "working" => (ClaudeStatus::Working, true),
            "blocked" => (ClaudeStatus::Waiting, true),
            "done" | "idle" => (ClaudeStatus::Idle, false),
            _ => return TurnReport::default(),
        };
        let starts_turn = !self.in_turn && seq.state != "idle";
        let ends_turn = (self.in_turn || starts_turn) && !in_turn_after;
        self.in_turn = in_turn_after;
        TurnReport { status: Some(status), starts_turn, answer: seq.answer(), ends_turn, ..TurnReport::default() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn osc(body: &str) -> String {
        format!("\x1b]7501;{}\x07", body)
    }

    fn b64(text: &str) -> String {
        base64::engine::general_purpose::STANDARD.encode(text)
    }

    fn seq(body: &str) -> Osc7501 {
        Osc7501::parse(body).unwrap()
    }

    #[test]
    fn the_live_tests_sequences_read_as_they_were_captured() {
        let mut scanner = Osc7501Scanner::default();
        let stream = [
            osc("state=blocked:kind=auth:app=antigravity:msg=U2lnbiBpbiByZXF1aXJlZA=="),
            "\x1b]0;agy\x07Signing in...".to_string(),
            osc("state=idle:app=antigravity"),
            osc("state=working:app=antigravity"),
            "pong\r\n".to_string(),
            osc("state=done:app=antigravity:msg=cG9uZw=="),
        ]
        .concat();

        let found = scanner.feed(&stream);

        let states: Vec<&str> = found.iter().map(|s| s.state.as_str()).collect();
        assert_eq!(states, ["blocked", "idle", "working", "done"]);
        assert_eq!(found[0].kind.as_deref(), Some("auth"));
        assert_eq!(found[0].msg.as_deref(), Some("Sign in required"));
        assert_eq!(found[3].msg.as_deref(), Some("pong"));
        assert_eq!(found[1].msg, None);
    }

    #[test]
    fn a_sequence_split_across_reads_is_read_once_whole() {
        let whole = osc("state=done:app=antigravity:msg=cG9uZw==");
        for split in 1..whole.len() {
            let mut scanner = Osc7501Scanner::default();
            let mut found = scanner.feed(&format!("before{}", &whole[..split]));
            found.extend(scanner.feed(&format!("{}after", &whole[split..])));
            assert_eq!(found, [seq("state=done:msg=cG9uZw==")], "split at {}", split);
        }
    }

    #[test]
    fn a_sequence_may_end_with_st_instead_of_bel() {
        let mut scanner = Osc7501Scanner::default();
        let found = scanner.feed("\x1b]7501;state=working:app=antigravity\x1b\\text");
        assert_eq!(found, [seq("state=working")]);
    }

    #[test]
    fn other_escape_sequences_and_text_are_not_sequences() {
        let mut scanner = Osc7501Scanner::default();
        assert!(scanner.feed("\x1b]0;title\x07\x1b]11;?\x07\x1b[2Jstate=done\x07\x1b]75010;x\x07").is_empty());
        assert!(scanner.feed("\x1b]7501;app=antigravity\x07").is_empty());
    }

    #[test]
    fn an_unterminated_sequence_too_long_to_be_one_is_dropped() {
        let mut scanner = Osc7501Scanner::default();
        scanner.feed(&format!("\x1b]7501;state=done:msg={}", "A".repeat(MAX_BODY)));
        assert!(scanner.carry.is_empty());
        assert_eq!(scanner.feed(&osc("state=idle")), [seq("state=idle")]);
    }

    #[test]
    fn msg_is_base64_utf8_and_ignored_when_it_isnt_base64() {
        assert_eq!(seq(&format!("state=done:msg={}", b64("naïve"))).msg.as_deref(), Some("naïve"));
        assert_eq!(seq("state=done:msg=not base64!").msg, None);
    }

    #[test]
    fn a_reply_is_cut_off_only_when_it_is_200_characters_and_ends_in_an_ellipsis() {
        let cut = format!("{}…", "ï".repeat(199));
        assert!(seq(&format!("state=done:msg={}", b64(&cut))).cut_off());

        // 200 characters without the mark, or the mark on a shorter reply, is a whole answer
        let full = "x".repeat(200);
        assert!(!seq(&format!("state=done:msg={}", b64(&full))).cut_off());
        assert!(!seq(&format!("state=done:msg={}", b64("Wait for it…"))).cut_off());
        let long = format!("{}…", "x".repeat(200));
        assert!(!seq(&format!("state=done:msg={}", b64(&long))).cut_off());
    }

    #[test]
    fn a_cut_off_answer_keeps_its_text_and_says_it_was_cut_off() {
        let cut = format!("{}…", "1 ".repeat(100).chars().take(199).collect::<String>());
        let answer = seq(&format!("state=done:msg={}", b64(&cut))).answer().unwrap();
        assert!(answer.starts_with(&cut));
        assert!(answer.ends_with(CUT_NOTE));

        let whole = seq(&format!("state=done:msg={}", b64("pong"))).answer();
        assert_eq!(whole.as_deref(), Some("pong"));
    }

    #[test]
    fn a_blocked_answer_names_its_kind_and_message() {
        let trust = seq("state=blocked:kind=permission:app=antigravity:msg=VHJ1c3QgdGhpcyBmb2xkZXI/");
        assert_eq!(trust.answer().as_deref(), Some("blocked (permission): Trust this folder?"));

        let command = format!("state=blocked:kind=permission:msg={}", b64("Approve RunCommand: python -c \"x\""));
        assert_eq!(
            seq(&command).answer().as_deref(),
            Some("blocked (permission): Approve RunCommand: python -c \"x\"")
        );
        assert_eq!(seq("state=blocked:kind=auth").answer().as_deref(), Some("blocked (auth)"));
        assert_eq!(seq("state=blocked").answer().as_deref(), Some("blocked"));
    }

    #[test]
    fn only_done_and_blocked_answer() {
        assert_eq!(seq("state=done").answer().as_deref(), Some(NO_MSG_ANSWER));
        assert_eq!(seq("state=working").answer(), None);
        assert_eq!(seq(&format!("state=idle:msg={}", b64("hi"))).answer(), None);
    }

    fn read_all(states: &[&str]) -> Vec<TurnReport> {
        let mut turn = AntigravityTurn::default();
        states.iter().map(|body| turn.read(&seq(body))).collect()
    }

    #[test]
    fn working_starts_a_turn_and_done_ends_it_with_its_answer() {
        let reports = read_all(&["state=idle", "state=working", "state=done:msg=cG9uZw=="]);
        assert_eq!(
            reports,
            [
                TurnReport { status: Some(ClaudeStatus::Idle), ..TurnReport::default() },
                TurnReport { status: Some(ClaudeStatus::Working), starts_turn: true, ..TurnReport::default() },
                TurnReport {
                    status: Some(ClaudeStatus::Idle),
                    answer: Some("pong".to_string()),
                    ends_turn: true,
                    ..TurnReport::default()
                },
            ]
        );
    }

    #[test]
    fn a_prompt_mid_turn_answers_the_sender_without_starting_a_new_turn() {
        let reports = read_all(&[
            "state=working",
            "state=blocked:kind=permission:msg=VHJ1c3QgdGhpcyBmb2xkZXI/",
            "state=working",
            "state=done:msg=cG9uZw==",
        ]);
        let starts: Vec<bool> = reports.iter().map(|r| r.starts_turn).collect();
        assert_eq!(starts, [true, false, false, false]);
        let ends: Vec<bool> = reports.iter().map(|r| r.ends_turn).collect();
        assert_eq!(ends, [false, false, false, true]);
        assert_eq!(reports[1].status, Some(ClaudeStatus::Waiting));
        assert_eq!(reports[1].answer.as_deref(), Some("blocked (permission): Trust this folder?"));
    }

    #[test]
    fn a_done_or_blocked_with_no_working_before_it_starts_the_turn_it_ends() {
        assert!(read_all(&["state=done:msg=cG9uZw=="])[0].starts_turn);
        let reports = read_all(&["state=idle", "state=blocked:kind=auth", "state=idle", "state=done"]);
        let starts: Vec<bool> = reports.iter().map(|r| r.starts_turn).collect();
        assert_eq!(starts, [false, true, false, true]);
        let ends: Vec<bool> = reports.iter().map(|r| r.ends_turn).collect();
        assert_eq!(ends, [false, false, true, true]);
    }

    #[test]
    fn an_unknown_state_changes_nothing() {
        let mut turn = AntigravityTurn::default();
        turn.read(&seq("state=working"));
        assert_eq!(turn.read(&seq("state=thinking")), TurnReport::default());
        assert!(!turn.read(&seq("state=done")).starts_turn);
    }

    /// What Codex 0.164.0 prints, as bodies: ready, a turn, the next turn's first key, that turn
    /// with a permission prompt that Esc ends, and a turn that Esc ends.
    const CODEX_BODIES: [&str; 10] = [
        "state=idle:app=codex",
        "state=working:app=codex",
        "state=done:app=codex",
        "state=idle:app=codex",
        "state=working:app=codex",
        "state=blocked:app=codex:kind=permission",
        "state=working:app=codex",
        "state=idle:app=codex",
        "state=working:app=codex",
        "state=idle:app=codex",
    ];

    /// `CODEX_BODIES` as printed, each sequence ended with ST as Codex does.
    fn codex_stream() -> String {
        CODEX_BODIES.iter().map(|body| format!("\x1b]7501;{}\x1b\\pong", body)).collect()
    }

    /// The reports of `codex_stream`, read in two parts of which the first is `split` bytes long.
    fn codex_reports(split: usize) -> Vec<TurnReport> {
        let stream = codex_stream();
        let mut scanner = Osc7501Scanner::default();
        let mut reader = TurnReader::for_launch(RunKind::Codex).unwrap();
        let (first, second) = stream.split_at(split);
        [first, second].iter().flat_map(|part| scanner.feed(part)).map(|seq| reader.read(&seq)).collect()
    }

    #[test]
    fn codexs_sequences_show_its_status_wherever_a_read_splits_them() {
        for split in 0..=codex_stream().len() {
            let statuses: Vec<ClaudeStatus> =
                codex_reports(split).into_iter().map(|report| report.status.unwrap()).collect();
            assert_eq!(
                statuses,
                [
                    ClaudeStatus::Idle,
                    ClaudeStatus::Working,
                    ClaudeStatus::Idle,
                    ClaudeStatus::Idle,
                    ClaudeStatus::Working,
                    ClaudeStatus::Waiting,
                    ClaudeStatus::Working,
                    ClaudeStatus::Idle,
                    ClaudeStatus::Working,
                    ClaudeStatus::Idle,
                ],
                "split at {split}"
            );
        }
    }

    #[test]
    fn a_codex_turn_stops_at_done_or_idle_and_an_idle_outside_a_turn_leaves_a_message_working() {
        let reports = codex_reports(0);
        let stops: Vec<bool> = reports.iter().map(|r| r.stops_turn).collect();
        assert_eq!(stops, [false, false, true, false, false, false, false, true, false, true]);
        let leaves: Vec<bool> = reports.iter().map(|r| r.leaves_working).collect();
        assert_eq!(leaves, [true, false, false, true, false, false, false, false, false, false]);
    }

    #[test]
    fn no_codex_report_answers_or_starts_or_ends_a_turn() {
        let mut reader = TurnReader::for_launch(RunKind::Codex).unwrap();
        for body in ["state=working", "state=blocked:kind=permission:msg=cG9uZw==", "state=done:msg=cG9uZw==", "state=idle"] {
            let report = reader.read(&seq(body));
            assert!(!report.starts_turn && !report.ends_turn && report.answer.is_none(), "{body}");
        }
    }

    #[test]
    fn an_unknown_codex_state_changes_nothing() {
        let mut reader = TurnReader::for_launch(RunKind::Codex).unwrap();
        reader.read(&seq("state=working"));
        assert_eq!(reader.read(&seq("state=thinking")), TurnReport::default());
        assert!(reader.read(&seq("state=done")).stops_turn);
    }

    #[test]
    fn quay_reads_the_sequences_of_antigravity_and_codex_alone() {
        let kinds: Vec<RunKind> = crate::slices::pty::models::ALL_RUN_KINDS
            .into_iter()
            .filter(|kind| TurnReader::for_launch(*kind).is_some())
            .collect();
        assert_eq!(kinds, [RunKind::Antigravity, RunKind::Codex]);
    }
}
