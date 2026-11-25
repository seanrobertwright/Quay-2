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
    surface_id: &'a str,
    title: &'a str,
    place: Place,
}

pub(super) struct Writer {
    folder: PathBuf,
    named: Named,
    /// What each terminal that has not closed was last called.
    names: HashMap<String, TerminalName>,
    lost: Arc<AtomicU64>,
}

impl Writer {
    pub(super) fn new(folder: PathBuf, named: Named, lost: Arc<AtomicU64>) -> Self {
        Self { folder, named, names: HashMap::new(), lost }
    }

    /// Writes what comes until nothing more can.
    pub(super) fn run(mut self, messages: &Receiver<Message>) {
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
        if let Err(e) = self.append(entry) {
            tracing::error!("A line of the surface record could not be written in {}: {e}", self.folder.display());
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
            surface_id: &about.surface_id,
            title: &about.title,
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
