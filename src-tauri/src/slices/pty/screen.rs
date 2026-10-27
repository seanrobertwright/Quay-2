//! A terminal's screen as it looks, kept beside its raw log so a dormant terminal can be
//! shown again after Quay restarts.
//!
//! Replaying raw PTY output only works at the size it was written for and from the screen
//! state before it: in-place redraws (Claude Code, PowerShell's line editor, anything built
//! on Ink) are cursor moves and line erases. A `ScreenRecorder` parses the output as it
//! arrives, at the PTY's real size, and renders what it shows as text with colours and
//! line breaks only, which any pane width can lay out again.

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// Scrollback rows a recorder keeps above the screen. Each cell is 32 bytes, so at 160
/// columns this is about 5 MB for a terminal that has filled it; the pane's own 5,000 rows
/// would be five times that for every terminal.
pub const SNAPSHOT_SCROLLBACK_ROWS: usize = 1000;

/// What a terminal showed, rendered at `rows` x `cols`: its scrollback and screen as text,
/// with SGR codes and `\r\n` line ends and no cursor movement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScreenSnapshot {
    pub rows: u16,
    pub cols: u16,
    pub data: String,
}

/// The DEC private modes that switch to the alternate screen: 1049, 1047 and 47.
const ENTER_ALTERNATE: [&str; 3] = ["\x1b[?1049h", "\x1b[?1047h", "\x1b[?47h"];

/// Parses a terminal's output at the PTY's size, following its resizes.
///
/// A full-screen program such as Claude Code draws on the alternate screen, which hides the
/// normal screen and its scrollback, and the parser can't render the normal screen again
/// until the program switches back. So the recorder renders the normal screen at the moment
/// of the switch and keeps it while the program runs.
pub struct ScreenRecorder {
    parser: vt100::Parser,
    /// The normal screen's text from when a program switched to the alternate screen.
    covered: Option<String>,
    /// The end of the last output when it could be the start of a switch, fed with the next.
    held: String,
}

/// A PTY dimension as the parser takes it. A PTY is never 0 rows or columns; 1 stands in.
fn dimension(n: u16) -> std::num::NonZeroU16 {
    std::num::NonZeroU16::new(n).unwrap_or(std::num::NonZeroU16::MIN)
}

impl ScreenRecorder {
    pub fn new(rows: u16, cols: u16) -> Self {
        Self {
            parser: vt100::Parser::new(dimension(rows), dimension(cols), SNAPSHOT_SCROLLBACK_ROWS),
            covered: None,
            held: String::new(),
        }
    }

    pub fn feed(&mut self, text: &str) {
        let text = std::mem::take(&mut self.held) + text;
        let mut rest = text.as_str();
        while let Some((at, len)) = next_switch(rest) {
            self.parser.process(&rest.as_bytes()[..at]);
            if !self.on_alternate_screen() {
                self.covered = Some(self.render());
            }
            self.parser.process(&rest.as_bytes()[at..at + len]);
            rest = &rest[at + len..];
        }
        let keep = partial_switch_len(rest);
        self.parser.process(&rest.as_bytes()[..rest.len() - keep]);
        self.held = rest[rest.len() - keep..].to_string();
        if !self.on_alternate_screen() {
            self.covered = None;
        }
    }

    pub fn resize(&mut self, rows: u16, cols: u16) {
        self.parser.set_size(dimension(rows), dimension(cols));
    }

    /// Whether a full-screen program has switched to the alternate screen, which has no
    /// scrollback and hides the normal screen until it switches back.
    pub fn on_alternate_screen(&self) -> bool {
        self.parser.screen().alternate_screen()
    }

    /// The scrollback and screen, with trailing blank lines and spaces dropped. A row that
    /// wrapped onto the next is joined to it, so the text wraps again at any width. While a
    /// program is on the alternate screen, its screen follows the normal screen it covers.
    pub fn snapshot(&self) -> ScreenSnapshot {
        let (rows, cols) = self.parser.screen().size();
        let shown = self.render();
        let body = match self.covered.as_deref() {
            Some(covered) if self.on_alternate_screen() && !covered.is_empty() && !shown.is_empty() => {
                format!("{covered}\x1b[0m\r\n{shown}")
            }
            Some(covered) if self.on_alternate_screen() && shown.is_empty() => covered.to_string(),
            _ => shown,
        };
        ScreenSnapshot { rows: rows.get(), cols: cols.get(), data: format!("\x1b[0m{body}\x1b[0m") }
    }

    /// The screen the parser shows, with its scrollback, as `snapshot` lays it out.
    fn render(&self) -> String {
        let mut basic = String::new();
        let range = vt100::capture::BasicFormattedCaptureRange::Full(&mut Default::default());
        // Writing to a String can't fail
        let _ = self.parser.screen().write_contents_formatted_basic(&mut basic, range);
        let lines: Vec<&str> = basic.split('\n').collect();
        let last = lines.iter().rposition(|line| !is_blank(line)).map_or(0, |i| i + 1);
        lines[..last].iter().map(|line| line.trim_end_matches(' ')).collect::<Vec<_>>().join("\r\n")
    }
}

/// Where the first switch to the alternate screen in `text` starts, and its length.
fn next_switch(text: &str) -> Option<(usize, usize)> {
    ENTER_ALTERNATE.iter().filter_map(|seq| text.find(seq).map(|at| (at, seq.len()))).min()
}

/// How many bytes at the end of `text` could begin a switch to the alternate screen.
fn partial_switch_len(text: &str) -> usize {
    ENTER_ALTERNATE
        .iter()
        .flat_map(|seq| (1..seq.len()).filter(|&n| text.ends_with(&seq[..n])))
        .max()
        .unwrap_or(0)
}

/// Whether a captured line shows nothing: only spaces and SGR codes.
fn is_blank(line: &str) -> bool {
    let mut rest = line;
    while let Some(at) = rest.find('\x1b') {
        if !rest[..at].trim_matches(' ').is_empty() {
            return false;
        }
        rest = rest[at..].split_once('m').map_or("", |(_, after)| after);
    }
    rest.trim_matches(' ').is_empty()
}

/// How long a terminal's output must pause before its screen is saved.
pub const SAVE_AFTER_IDLE: Duration = Duration::from_secs(2);

/// The longest unsaved output may wait while it keeps arriving, for a terminal that never
/// pauses, such as an agent redrawing its spinner. A crash loses at most this much.
pub const SAVE_AT_LEAST_EVERY: Duration = Duration::from_secs(30);

/// One terminal's recorder and the rules for saving it: after output pauses for
/// `SAVE_AFTER_IDLE` or has waited `SAVE_AT_LEAST_EVERY`, and on demand. Once discarded,
/// because the terminal was closed or replaced, it never writes again, so a reader finishing
/// late can't bring back a file the close deleted.
pub struct ScreenKeeper {
    dir: PathBuf,
    terminal_id: String,
    state: Mutex<KeeperState>,
    /// Held across a whole save, so saves land in order and a discard waits for one in
    /// flight. The file is written outside `state`, so the reader never waits on the disk.
    write_lock: Mutex<()>,
}

struct KeeperState {
    recorder: ScreenRecorder,
    /// When the oldest and newest output no save has covered arrived.
    unsaved: Option<(Instant, Instant)>,
    discarded: bool,
}

impl ScreenKeeper {
    /// A keeper for a PTY of `rows` x `cols`. `earlier` is what the terminal showed before,
    /// from a previous run: a saved screen's text, or an older Quay's raw log. It goes into
    /// the scrollback, so a new console clearing its screen leaves it in place.
    pub fn new(dir: &Path, terminal_id: &str, rows: u16, cols: u16, earlier: Option<&str>) -> Self {
        let mut recorder = ScreenRecorder::new(rows, cols);
        if let Some(earlier) = earlier {
            recorder.feed(earlier);
            recorder.feed(&"\r\n".repeat(usize::from(rows.max(1))));
        }
        Self {
            dir: dir.to_path_buf(),
            terminal_id: terminal_id.to_string(),
            state: Mutex::new(KeeperState { recorder, unsaved: None, discarded: false }),
            write_lock: Mutex::new(()),
        }
    }

    pub fn feed(&self, text: &str, now: Instant) {
        let mut state = self.state.lock();
        state.recorder.feed(text);
        state.unsaved = Some(match state.unsaved {
            Some((first, _)) => (first, now),
            None => (now, now),
        });
    }

    pub fn resize(&self, rows: u16, cols: u16) {
        self.state.lock().recorder.resize(rows, cols);
    }

    /// Saves the screen if unsaved output has been quiet for `SAVE_AFTER_IDLE` or waiting
    /// for `SAVE_AT_LEAST_EVERY`. Returns whether it saved.
    pub fn save_if_idle(&self, now: Instant) -> bool {
        self.save_when(|unsaved| {
            unsaved.is_some_and(|(first, last)| {
                now.duration_since(last) >= SAVE_AFTER_IDLE || now.duration_since(first) >= SAVE_AT_LEAST_EVERY
            })
        })
    }

    /// Saves the screen as it is.
    pub fn save_now(&self) {
        self.save_when(|_| true);
    }

    /// Stops all further saves, once any save in flight has finished.
    pub fn discard(&self) {
        let _writing = self.write_lock.lock();
        self.state.lock().discarded = true;
    }

    /// Saves when `due` says so, unless the keeper was discarded. Returns whether it saved.
    fn save_when(&self, due: impl FnOnce(Option<(Instant, Instant)>) -> bool) -> bool {
        let _writing = self.write_lock.lock();
        let snapshot = {
            let mut state = self.state.lock();
            if state.discarded || !due(state.unsaved) {
                return false;
            }
            state.unsaved = None;
            state.recorder.snapshot()
        };
        if let Err(e) = save_screen(&self.dir, &self.terminal_id, &snapshot) {
            tracing::warn!("Could not save the screen of {}: {}", self.terminal_id, e);
        }
        true
    }
}

/// Where `terminal_id`'s snapshot is kept in `dir`, beside its `.log`.
pub fn screen_path(dir: &Path, terminal_id: &str) -> PathBuf {
    dir.join(format!("{}.screen", terminal_id))
}

/// Saves `snapshot` for `terminal_id` in `dir`, atomically.
pub fn save_screen(dir: &Path, terminal_id: &str, snapshot: &ScreenSnapshot) -> Result<(), String> {
    let path = screen_path(dir, terminal_id);
    let json = serde_json::to_vec(snapshot).map_err(|e| e.to_string())?;
    crate::atomic_file::write_atomic(&path, &json).map_err(|e| format!("cannot write {}: {}", path.display(), e))
}

/// The snapshot saved for `terminal_id` in `dir`, or None when there is none or it can't
/// be read. One that can't be parsed is logged.
pub fn load_screen(dir: &Path, terminal_id: &str) -> Option<ScreenSnapshot> {
    let path = screen_path(dir, terminal_id);
    let bytes = std::fs::read(&path).ok()?;
    match serde_json::from_slice(&bytes) {
        Ok(snapshot) => Some(snapshot),
        Err(e) => {
            tracing::warn!("Saved screen {} is unreadable ({}); using the raw log", path.display(), e);
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ESC: &str = "\x1b";

    /// The snapshot's text without SGR codes, one entry per line.
    fn plain_lines(snapshot: &ScreenSnapshot) -> Vec<String> {
        let mut plain = String::new();
        let mut rest = snapshot.data.as_str();
        while let Some(at) = rest.find(ESC) {
            plain.push_str(&rest[..at]);
            rest = &rest[at..];
            let end = rest.find('m').map(|i| i + 1).unwrap_or(rest.len());
            rest = &rest[end..];
        }
        plain.push_str(rest);
        plain.split("\r\n").map(str::to_string).collect()
    }

    /// Draws `frames` frames of a box `height` rows tall in place, as Ink does: after the
    /// first, move up `height` rows, then erase and draw each row at the full width.
    fn in_place_redraws(frames: usize, height: usize, width: usize) -> String {
        let mut out = String::new();
        for frame in 1..=frames {
            if frame > 1 {
                out.push_str(&format!("{ESC}[{height}A"));
            }
            for row in 1..=height {
                let label = format!("row {row} of frame {frame} ");
                out.push_str(&format!("{ESC}[2K|{:.<w$}|\r\n", label, w = width - 2));
            }
        }
        out
    }

    #[test]
    fn an_in_place_redraw_leaves_only_its_last_frame() {
        let mut recorder = ScreenRecorder::new(24, 60);
        recorder.feed("PS C:\\demo> ./frames.ps1\r\n");
        recorder.feed(&in_place_redraws(500, 10, 60));
        recorder.feed("done\r\nPS C:\\demo> ");

        let lines = plain_lines(&recorder.snapshot());
        assert_eq!(lines[0], "PS C:\\demo> ./frames.ps1");
        for (row, line) in (1..=10).zip(&lines[1..=10]) {
            let label = format!("row {row} of frame 500 ");
            assert_eq!(line, &format!("|{:.<58}|", label));
        }
        assert_eq!(lines[11], "done");
        assert_eq!(lines[12], "PS C:\\demo>");
        assert_eq!(lines.len(), 13, "no blank rows below the prompt: {lines:?}");
        assert!(!recorder.snapshot().data.contains("frame 499"));
    }

    #[test]
    fn the_snapshot_holds_no_cursor_movement_and_records_its_size() {
        let mut recorder = ScreenRecorder::new(24, 60);
        recorder.feed(&in_place_redraws(20, 5, 60));
        recorder.feed(&format!("{ESC}[31mred{ESC}[0m plain\r\n"));

        let snapshot = recorder.snapshot();
        assert_eq!((snapshot.rows, snapshot.cols), (24, 60));
        assert!(snapshot.data.contains(&format!("{ESC}[31mred")), "colours survive: {:?}", snapshot.data);
        let without_sgr = plain_lines(&snapshot).join("\n");
        assert!(!without_sgr.contains(ESC), "only SGR codes may remain: {without_sgr:?}");
    }

    #[test]
    fn a_line_that_wrapped_stays_one_line_so_a_narrower_pane_can_wrap_it_again() {
        let mut recorder = ScreenRecorder::new(10, 20);
        let long = "x".repeat(50);
        recorder.feed(&format!("{long}\r\nnext\r\n"));

        let lines = plain_lines(&recorder.snapshot());
        assert_eq!(lines[0], long);
        assert_eq!(lines[1], "next");
    }

    #[test]
    fn output_after_a_resize_is_laid_out_at_the_new_size() {
        let mut recorder = ScreenRecorder::new(10, 20);
        recorder.feed("before\r\n");
        recorder.resize(12, 40);
        recorder.feed(&format!("{}\r\n", "y".repeat(40)));

        let snapshot = recorder.snapshot();
        assert_eq!((snapshot.rows, snapshot.cols), (12, 40));
        assert_eq!(plain_lines(&snapshot)[..2], ["before".to_string(), "y".repeat(40)]);
    }

    #[test]
    fn scrollback_is_capped() {
        let mut recorder = ScreenRecorder::new(10, 30);
        let total = SNAPSHOT_SCROLLBACK_ROWS + 500;
        for n in 1..=total {
            recorder.feed(&format!("line {n}\r\n"));
        }

        let lines = plain_lines(&recorder.snapshot());
        assert!(lines.len() <= SNAPSHOT_SCROLLBACK_ROWS + 10, "{} lines kept", lines.len());
        assert_eq!(lines.last().unwrap(), &format!("line {total}"));
        assert!(!lines.contains(&"line 1".to_string()));
    }

    #[test]
    fn feeding_a_snapshot_into_a_new_recorder_carries_it_on() {
        let mut first = ScreenRecorder::new(10, 30);
        first.feed("old run\r\n");
        let mut second = ScreenRecorder::new(10, 30);
        second.feed(&first.snapshot().data);
        second.feed("\r\nnew run\r\n");

        let lines = plain_lines(&second.snapshot());
        assert_eq!(lines[..2], ["old run".to_string(), "new run".to_string()]);
    }

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("quay2-screen-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn saved_lines(dir: &Path, id: &str) -> Option<Vec<String>> {
        load_screen(dir, id).map(|snapshot| plain_lines(&snapshot))
    }

    #[test]
    fn a_keeper_saves_once_output_has_been_quiet_for_the_idle_time() {
        let dir = temp_dir();
        let start = Instant::now();
        let keeper = ScreenKeeper::new(&dir, "term-idle", 10, 30, None);
        keeper.feed("first\r\n", start);

        assert!(!keeper.save_if_idle(start + SAVE_AFTER_IDLE / 2), "too soon");
        assert_eq!(saved_lines(&dir, "term-idle"), None);
        assert!(keeper.save_if_idle(start + SAVE_AFTER_IDLE));
        assert_eq!(saved_lines(&dir, "term-idle").unwrap(), ["first"]);
        assert!(!keeper.save_if_idle(start + SAVE_AFTER_IDLE * 3), "nothing new to save");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_now_writes_whatever_the_screen_shows() {
        let dir = temp_dir();
        let keeper = ScreenKeeper::new(&dir, "term-now", 10, 30, None);
        keeper.feed("still running\r\n", Instant::now());
        keeper.save_now();
        assert_eq!(saved_lines(&dir, "term-now").unwrap(), ["still running"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_discarded_keeper_never_writes_again() {
        let dir = temp_dir();
        let start = Instant::now();
        let keeper = ScreenKeeper::new(&dir, "term-closed", 10, 30, None);
        keeper.feed("bye\r\n", start);
        keeper.discard();

        keeper.save_now();
        assert!(!keeper.save_if_idle(start + SAVE_AFTER_IDLE * 2));
        assert_eq!(saved_lines(&dir, "term-closed"), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// What a new ConPTY console writes first: hide the cursor, clear the screen, go home.
    const CONSOLE_START: &str = "\x1b[?25l\x1b[2J\x1b[m\x1b[H";

    #[test]
    fn earlier_output_survives_a_new_console_clearing_its_screen() {
        let dir = temp_dir();
        let keeper = ScreenKeeper::new(&dir, "term-again", 10, 30, Some("\x1b[0mold run\r\nsecond line\x1b[0m"));
        keeper.feed(CONSOLE_START, Instant::now());
        keeper.feed("new run\r\n", Instant::now());
        keeper.save_now();
        assert_eq!(saved_lines(&dir, "term-again").unwrap(), ["old run", "second line", "new run"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn output_that_never_pauses_is_still_saved_every_so_often() {
        let dir = temp_dir();
        let start = Instant::now();
        let keeper = ScreenKeeper::new(&dir, "term-spinner", 10, 30, None);
        let tick = Duration::from_millis(100);
        let mut now = start;
        while now < start + SAVE_AT_LEAST_EVERY - tick {
            keeper.feed("\r-\r\\\r|\r/", now);
            assert!(!keeper.save_if_idle(now), "never quiet, not yet due at {:?}", now - start);
            now += tick;
        }
        keeper.feed("\rworking", start + SAVE_AT_LEAST_EVERY);
        assert!(keeper.save_if_idle(start + SAVE_AT_LEAST_EVERY));
        assert_eq!(saved_lines(&dir, "term-spinner").unwrap(), ["working"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_full_screen_app_is_saved_below_the_normal_screen_it_covers() {
        let dir = temp_dir();
        let keeper = ScreenKeeper::new(&dir, "term-alt", 10, 30, None);
        keeper.feed("PS> history\r\n", Instant::now());
        keeper.feed("\x1b[?1049h\x1b[Hfull-screen frame", Instant::now());
        keeper.feed("\x1b[2J\x1b[Hlast frame\r\n> prompt", Instant::now());
        keeper.save_now();
        assert_eq!(saved_lines(&dir, "term-alt").unwrap(), ["PS> history", "last frame", "> prompt"]);

        keeper.feed("\x1b[?1049lPS> back", Instant::now());
        keeper.save_now();
        assert_eq!(saved_lines(&dir, "term-alt").unwrap(), ["PS> history", "PS> back"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn output_just_before_the_switch_in_the_same_chunk_is_kept() {
        let mut recorder = ScreenRecorder::new(10, 30);
        recorder.feed("trust this folder? yes\r\n\x1b[?1049h\x1b[Hagent at work");
        assert_eq!(plain_lines(&recorder.snapshot()), ["trust this folder? yes", "agent at work"]);
    }

    #[test]
    fn a_switch_split_across_chunks_still_keeps_the_normal_screen() {
        let mut recorder = ScreenRecorder::new(10, 30);
        recorder.feed("PS> claude\r\n\x1b[?10");
        recorder.feed("49h\x1b[Hagent at work");
        assert_eq!(plain_lines(&recorder.snapshot()), ["PS> claude", "agent at work"]);
    }

    #[test]
    fn a_keeper_follows_the_pty_size() {
        let dir = temp_dir();
        let keeper = ScreenKeeper::new(&dir, "term-size", 10, 30, None);
        keeper.resize(20, 50);
        keeper.save_now();
        let snapshot = load_screen(&dir, "term-size").unwrap();
        assert_eq!((snapshot.rows, snapshot.cols), (20, 50));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_saved_snapshot_loads_back_and_a_missing_or_broken_one_is_none() {
        let dir = std::env::temp_dir().join(format!("quay2-screen-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let snapshot = ScreenSnapshot { rows: 24, cols: 80, data: "hello\r\nworld".to_string() };

        save_screen(&dir, "term-a", &snapshot).unwrap();
        assert_eq!(load_screen(&dir, "term-a"), Some(snapshot));
        assert_eq!(load_screen(&dir, "term-missing"), None);
        std::fs::write(screen_path(&dir, "term-broken"), b"not json").unwrap();
        assert_eq!(load_screen(&dir, "term-broken"), None);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
