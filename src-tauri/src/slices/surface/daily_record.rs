//! The surface record: one line of JSON for each thing that became of a surface, in a file for each day,
//! without its content. What an event holds is all that reaches the file, so no typed text, message's
//! content, error's message or unsent answer is ever handed over.
//!
//! An event is queued where it happens, also under the store's lock, so the file has them in that order.
//! A thread of its own writes them, so no call waits for the disk.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use serde::Serialize;

use super::place::Place;
use super::plain_line::plain_line;
use super::typing::TerminalName;

mod fired;
mod given;
mod refusal;
mod writer;

pub use fired::{Fired, Function};
pub use given::Given;
pub use refusal::Refusal;

/// How many events may wait to be written. One past them is lost, which the error log is told.
const MOST_QUEUED: usize = 1024;

/// The most characters of a title, an id or another name.
const MOST_NAMED: usize = 200;

/// The time now, in milliseconds since the epoch.
pub type Clock = Arc<dyn Fn() -> i64 + Send + Sync>;

/// What became of a surface.
#[derive(Debug, Serialize)]
#[serde(tag = "event", rename_all = "lowercase")]
pub enum Event {
    Shown,
    Updated,
    Answered(Given),
    Dismissed,
    /// Its agent deleted it, or it left for another, which counts as that.
    Deleted,
    Withdrawn,
    Ended,
    #[serde(rename = "function fired")]
    Fired(Fired),
    Rejected(Refusal),
}

/// What an event is about. A call that was rejected may be about no surface, and one it would have made has
/// no title or place yet.
#[derive(Debug)]
pub struct About {
    terminal_id: String,
    tool: String,
    surface_id: Option<String>,
    title: Option<String>,
    place: Option<Place>,
}

impl About {
    /// The surface `id` of `terminal_id`. What its agent named is bounded, and in one line.
    pub fn surface(terminal_id: &str, id: &str, tool: &str, title: &str, place: Place) -> Self {
        Self {
            terminal_id: terminal_id.to_string(),
            tool: tool.to_string(),
            surface_id: Some(plain_line(id, MOST_NAMED)),
            title: Some(plain_line(title, MOST_NAMED)),
            place: Some(place),
        }
    }

    /// A call of `tool` by `terminal_id`, about the surface `id` when it is known.
    pub fn call(terminal_id: &str, tool: &str, id: Option<&str>) -> Self {
        Self {
            terminal_id: terminal_id.to_string(),
            tool: tool.to_string(),
            surface_id: id.map(|id| plain_line(id, MOST_NAMED)),
            title: None,
            place: None,
        }
    }
}

/// A line of the file, before its terminal is named.
struct Entry {
    at: i64,
    about: About,
    event: Event,
}

enum Message {
    Entry(Entry),
    /// A terminal closed, of which nothing more comes.
    Closed(String),
    /// Its sender is told, as everything before this is written.
    Finish(SyncSender<()>),
}

struct Queue {
    sender: SyncSender<Message>,
    clock: Clock,
    /// How many events were lost since the error log was last told.
    lost: Arc<AtomicU64>,
}

/// Where events are handed over. They go nowhere until `keep`.
#[derive(Clone, Default)]
pub struct DailyRecord(Arc<OnceLock<Queue>>);

impl DailyRecord {
    /// Keeps the record in `folder` from here on, once. `named` says what a terminal is called, while it
    /// is open.
    pub fn keep(
        &self,
        folder: PathBuf,
        clock: Clock,
        named: impl Fn(&str) -> Option<TerminalName> + Send + 'static,
    ) {
        let (sender, messages) = sync_channel(MOST_QUEUED);
        let lost = Arc::new(AtomicU64::new(0));
        let now = clock();
        if self.0.set(Queue { sender, clock, lost: lost.clone() }).is_err() {
            tracing::error!("The surface record was started twice; the first stays");
            return;
        }
        let writer = writer::Writer::new(folder, Box::new(named), lost);
        // What the thread logs goes where this one's does
        let log = tracing::dispatcher::get_default(Clone::clone);
        let run = move || tracing::dispatcher::with_default(&log, || writer.run(&messages, now));
        if let Err(e) = std::thread::Builder::new().name("surface-record".into()).spawn(run) {
            tracing::error!("The surface record could not be started: {e}");
        }
    }

    /// Queues that `event` has happened, now, to what it is `about`. Never waits.
    pub fn happened(&self, about: About, event: Event) {
        let Some(queue) = self.0.get() else {
            return;
        };
        let entry = Entry { at: (queue.clock)(), about, event };
        if queue.sender.try_send(Message::Entry(entry)).is_err() {
            queue.lost.fetch_add(1, Ordering::Relaxed);
        }
    }

    /// Says that `terminal_id` has closed, after what became of its surfaces. Never waits.
    pub fn closed(&self, terminal_id: &str) {
        if let Some(queue) = self.0.get() {
            // Unheard, only the terminal's name is kept for longer
            let _ = queue.sender.try_send(Message::Closed(terminal_id.to_string()));
        }
    }

    /// Waits until what has happened so far is written, for `limit` at the most.
    pub fn finish(&self, limit: Duration) {
        let Some(queue) = self.0.get() else {
            return;
        };
        let (written, done) = sync_channel(1);
        if queue.sender.try_send(Message::Finish(written)).is_ok() {
            let _ = done.recv_timeout(limit);
        }
    }
}
