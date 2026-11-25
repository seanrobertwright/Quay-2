//! The thread that writes the surface record.

use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::Receiver;
use std::sync::Arc;

use serde::Serialize;

use super::super::place::Place;
use super::super::plain_line::plain_line;
use super::super::typing::TerminalName;
use super::{Entry, Event, Message, MOST_NAMED};
use crate::dates;

/// How many days are kept, the one being written among them.
const DAYS_KEPT: i64 = 30;

/// How long after a surface's update its next one may be written, in milliseconds.
const UPDATE_EVERY: i64 = 60_000;

type Named = Box<dyn Fn(&str) -> Option<TerminalName> + Send>;

/// A line as the file has it.
#[derive(Serialize)]
struct Line<'a> {
    time: String,
    #[serde(flatten)]
    event: &'a Event,
    terminal_id: &'a str,
    terminal: Option<&'a str>,
    cli: Option<&'a str>,
    tool: &'a str,
    surface_id: Option<&'a str>,
    title: Option<&'a str>,
    place: Option<Place>,
}

pub(super) struct Writer {
    folder: PathBuf,
    named: Named,
    /// What each terminal that has not closed was last called.
    names: HashMap<String, TerminalName>,
    /// When each surface's last update was written, by its terminal and id. Those that hold none back any
    /// more go as the next update is written.
    updated: HashMap<(String, Option<String>), i64>,
    /// The day the files were last sorted out on.
    sorted_out: Option<i64>,
    lost: Arc<AtomicU64>,
}

impl Writer {
    pub(super) fn new(folder: PathBuf, named: Named, lost: Arc<AtomicU64>) -> Self {
        Self { folder, named, names: HashMap::new(), updated: HashMap::new(), sorted_out: None, lost }
    }

    /// Writes what comes until nothing more can. `now` is when it starts, in milliseconds since the epoch.
    pub(super) fn run(mut self, messages: &Receiver<Message>, now: i64) {
        self.sort_out(dates::utc_day(now));
        while let Ok(message) = messages.recv() {
            match message {
                Message::Entry(entry) => self.write(&entry),
                Message::Closed(terminal_id) => drop(self.names.remove(&terminal_id)),
                // One that waits no longer is not told
                Message::Finish(written) => drop(written.send(())),
            }
            let lost = self.lost.swap(0, Ordering::Relaxed);
            if lost > 0 {
                tracing::error!("{lost} lines of the surface record were lost: too many waited to be written");
            }
        }
    }

    fn write(&mut self, entry: &Entry) {
        let Entry { at, about, event } = entry;
        let is_update = matches!(event, Event::Updated);
        let of = (about.terminal_id.clone(), about.surface_id.clone());
        // A clock that was set back holds none back
        let holds_back = |last: i64| (0..UPDATE_EVERY).contains(&(at - last));
        if is_update && self.updated.get(&of).is_some_and(|last| holds_back(*last)) {
            return;
        }
        self.sort_out(dates::utc_day(*at));
        match self.append(entry) {
            Ok(()) if is_update => {
                self.updated.retain(|_, last| holds_back(*last));
                self.updated.insert(of, *at);
            }
            Ok(()) => {}
            Err(e) => {
                tracing::error!("A line of the surface record could not be written in {}: {e}", self.folder.display());
            }
        }
    }

    /// Deletes the files of the days that are not kept on the UTC day `day`, once that day. Which day a file is
    /// of is in its name, and one that is named otherwise stays.
    fn sort_out(&mut self, day: i64) {
        if self.sorted_out.replace(day) == Some(day) {
            return;
        }
        let files = match std::fs::read_dir(&self.folder) {
            Ok(files) => files,
            // Nothing was ever written
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return,
            Err(e) => {
                tracing::error!("The surface record's folder, {}, could not be read: {e}", self.folder.display());
                return;
            }
        };
        for file in files.flatten() {
            let is_old = file.file_name().to_str().and_then(day_of).is_some_and(|its| its <= day - DAYS_KEPT);
            if !is_old {
                continue;
            }
            if let Err(e) = std::fs::remove_file(file.path()) {
                tracing::error!("An old surface record, {}, could not be deleted: {e}", file.path().display());
            }
        }
    }

    fn append(&mut self, Entry { at, about, event }: &Entry) -> std::io::Result<()> {
        // One that has just closed is still named, by what it was called before
        if let Some(name) = (self.named)(&about.terminal_id) {
            self.names.insert(about.terminal_id.clone(), name);
        }
        let name = self.names.get(&about.terminal_id);
        let terminal = name.map(|name| plain_line(&name.name, MOST_NAMED));
        let line = Line {
            time: dates::format_timestamp(*at),
            event,
            terminal_id: &about.terminal_id,
            terminal: terminal.as_deref(),
            cli: name.map(|name| name.cli),
            tool: &about.tool,
            surface_id: about.surface_id.as_deref(),
            title: about.title.as_deref(),
            place: about.place,
        };
        let mut line = serde_json::to_string(&line)?;
        line.push('\n');
        std::fs::create_dir_all(&self.folder)?;
        let path = self.folder.join(file_name(dates::utc_day(*at)));
        std::fs::OpenOptions::new().create(true).append(true).open(path)?.write_all(line.as_bytes())
    }
}

/// The file of the UTC day `day`.
fn file_name(day: i64) -> String {
    format!("surfaces.{}.jsonl", dates::day_to_string(day))
}

/// The UTC day whose file is named `name`.
fn day_of(name: &str) -> Option<i64> {
    dates::parse_day(name.strip_prefix("surfaces.")?.strip_suffix(".jsonl")?)
}
