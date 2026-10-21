//! Antigravity's turn reports. With `AGY_CLI_OSC7501=on`, `agy` prints an OSC 7501
//! sequence, `ESC ] 7501 ; state=<state>:key=value:... BEL`, each time its turn moves:
//! `working` when a turn starts, `done` when it ends, `blocked` when it waits on a prompt,
//! `idle` when it is ready. `done` and `blocked` carry a base64 `msg`: the answer, or what
//! it is waiting on. Quay reads them from the PTY output to show Antigravity's status and to
//! answer a sender waiting on it.

use base64::Engine;

use super::models::ClaudeStatus;

/// Turns the sequences on.
pub const ENABLE_VAR: &str = "AGY_CLI_OSC7501";

/// Set to `brief`, it drops `msg` from every sequence, so Quay never passes it on.
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

/// What one sequence means for an Antigravity terminal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TurnReport {
    /// The status it puts the terminal in, if any.
    pub status: Option<ClaudeStatus>,
    /// Whether a turn starts with it.
    pub starts_turn: bool,
    /// What a sender waiting on the running turn is told, if it hears now.
    pub answer: Option<String>,
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
            _ => return TurnReport { status: None, starts_turn: false, answer: None },
        };
        let starts_turn = !self.in_turn && seq.state != "idle";
        self.in_turn = in_turn_after;
        TurnReport { status: Some(status), starts_turn, answer: seq.answer() }
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
                TurnReport { status: Some(ClaudeStatus::Idle), starts_turn: false, answer: None },
                TurnReport { status: Some(ClaudeStatus::Working), starts_turn: true, answer: None },
                TurnReport {
                    status: Some(ClaudeStatus::Idle),
                    starts_turn: false,
                    answer: Some("pong".to_string())
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
        assert_eq!(reports[1].status, Some(ClaudeStatus::Waiting));
        assert_eq!(reports[1].answer.as_deref(), Some("blocked (permission): Trust this folder?"));
    }

    #[test]
    fn a_done_or_blocked_with_no_working_before_it_starts_the_turn_it_ends() {
        assert!(read_all(&["state=done:msg=cG9uZw=="])[0].starts_turn);
        let reports = read_all(&["state=idle", "state=blocked:kind=auth", "state=idle", "state=done"]);
        let starts: Vec<bool> = reports.iter().map(|r| r.starts_turn).collect();
        assert_eq!(starts, [false, true, false, true]);
    }

    #[test]
    fn an_unknown_state_changes_nothing() {
        let mut turn = AntigravityTurn::default();
        turn.read(&seq("state=working"));
        assert_eq!(
            turn.read(&seq("state=thinking")),
            TurnReport { status: None, starts_turn: false, answer: None }
        );
        assert!(!turn.read(&seq("state=done")).starts_turn);
    }
}
