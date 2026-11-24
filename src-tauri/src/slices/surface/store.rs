//! The surface store: every surface, its owner, state and waits, in memory, as one state machine
//! under its own lock. Nothing waits while holding it.

use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::Mutex;
use serde::Serialize;
use serde_json::Value;
use tokio::sync::oneshot;

use super::calls::{Handed, OpenCalls};
use super::check::Accepted;
use super::typed_line::typed_line;
use super::typing::NotTyped;

/// The most surfaces a terminal keeps: the spec's four live and ten locked, not told apart yet.
pub const MOST_KEPT: usize = 14;

/// Which surface: its id is one among its terminal's.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SurfaceKey {
    pub terminal_id: String,
    pub id: String,
}

impl SurfaceKey {
    pub fn new(terminal_id: impl Into<String>, id: impl Into<String>) -> Self {
        Self { terminal_id: terminal_id.into(), id: id.into() }
    }
}

/// A surface as the webview draws it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SurfaceRecord {
    pub terminal_id: String,
    pub id: String,
    pub tool: String,
    /// The accepted state as one compact `createSurface`.
    pub state: Value,
    /// Which version of the content `state` is. An answer names the one it was given to.
    pub revision: u64,
    /// Where it stands among the surfaces: one committed later has a higher order.
    pub order: u64,
    /// Rises with every change to any surface, so an older record of a surface can be told.
    pub change: u64,
    /// Whether the surface has an action to its agent.
    pub asks: bool,
    /// The answer, once there is one.
    pub answer: Option<Value>,
}

/// Why an answer was not taken. The surface is as it was.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnswerRefused {
    /// The terminal has no surface of that id that asks for something.
    NoSuchSurface,
    AlreadyAnswered,
    OlderRevision,
    /// No call is open to return it through, and it could not be typed in.
    NotTyped(NotTyped),
}

/// How an answer reaches its agent.
pub enum Answered {
    /// An open call returns it, which settles the surface.
    Returned(SurfaceRecord),
    /// It is to be typed into the terminal as this line. Until `typed` or `not_typed` says how that
    /// went, the surface takes no other answer.
    ToType(String),
}

/// What a call creates, as its agent wrote it.
#[derive(Clone, Copy)]
pub struct Creation<'a> {
    pub tool: &'a str,
    pub arguments: &'a Value,
    /// What the surface is called in the line its answer is typed in as.
    pub title: &'a str,
    /// The call's number, from `open_call`.
    pub call: u64,
}

/// Why a surface was not added. Nothing was.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommitRefused {
    /// The terminal has a surface of that id.
    IdInUse,
    /// The terminal has `MOST_KEPT` surfaces, and each still asks for something.
    Full,
}

/// A surface that was added.
pub struct Committed {
    pub record: SurfaceRecord,
    /// The surface that left to make room for it.
    pub left: Option<SurfaceKey>,
}

enum Phase {
    /// It has no action to its agent.
    NotAsking,
    /// It has no answer yet. `waiters` are the calls that wait for it, open or over.
    Asking { waiters: Vec<u64> },
    /// Its one answer is being typed in.
    Typing { answer: Value },
    Settled { answer: Value },
}

struct Surface {
    id: String,
    tool: String,
    /// The arguments of the call that created it, which the same call again is told by.
    arguments: Value,
    title: String,
    state: Value,
    revision: u64,
    order: u64,
    change: u64,
    phase: Phase,
}

impl Surface {
    /// Whether it asks for something and has no answer, which keeps it from making room for another.
    fn is_open(&self) -> bool {
        matches!(self.phase, Phase::Asking { .. } | Phase::Typing { .. })
    }

    fn record(&self, terminal_id: &str) -> SurfaceRecord {
        SurfaceRecord {
            terminal_id: terminal_id.to_string(),
            id: self.id.clone(),
            tool: self.tool.clone(),
            state: self.state.clone(),
            revision: self.revision,
            order: self.order,
            change: self.change,
            asks: !matches!(self.phase, Phase::NotAsking),
            answer: match &self.phase {
                Phase::Settled { answer } => Some(answer.clone()),
                Phase::NotAsking | Phase::Asking { .. } | Phase::Typing { .. } => None,
            },
        }
    }
}

/// One terminal's surfaces, in the order they were committed, how many asks have been named, and the
/// calls that are open.
#[derive(Default)]
struct Terminal {
    asks: u64,
    surfaces: Vec<Surface>,
    calls: OpenCalls,
}

impl Terminal {
    fn find(&mut self, id: &str) -> Option<&mut Surface> {
        self.surfaces.iter_mut().find(|surface| surface.id == id)
    }
}

#[derive(Default)]
struct Inner {
    last_change: u64,
    last_call: u64,
    terminals: HashMap<String, Terminal>,
}

impl Inner {
    fn next_change(&mut self) -> u64 {
        self.last_change += 1;
        self.last_change
    }
}

#[derive(Clone, Default)]
pub struct SurfaceStore(Arc<Mutex<Inner>>);

impl SurfaceStore {
    /// A name for `terminal_id`'s next ask: `ask_1` and on, counted per terminal, never one in use.
    pub fn name_ask(&self, terminal_id: &str) -> SurfaceKey {
        let mut inner = self.0.lock();
        let terminal = inner.terminals.entry(terminal_id.to_string()).or_default();
        loop {
            terminal.asks += 1;
            let id = format!("ask_{}", terminal.asks);
            if terminal.find(&id).is_none() {
                return SurfaceKey::new(terminal_id, id);
            }
        }
    }

    /// Opens a call of `terminal_id` whose JSON-RPC request has the id `request`. Returns its number
    /// and where its answer comes, which closes when its wait ends without one.
    pub fn open_call(&self, terminal_id: &str, request: &Value) -> (u64, oneshot::Receiver<Handed>) {
        let mut inner = self.0.lock();
        inner.last_call += 1;
        let number = inner.last_call;
        let terminal = inner.terminals.entry(terminal_id.to_string()).or_default();
        (number, terminal.calls.open(number, request.clone()))
    }

    /// Ends the wait of one call. Its surface stays up and answerable.
    pub fn end_call(&self, terminal_id: &str, number: u64) {
        self.with_calls(terminal_id, |calls| calls.end(number));
    }

    /// Ends the waits of `terminal_id`'s calls whose request id is `request`. One that has returned
    /// is open no longer, so a later call with the same id is not mistaken for it.
    pub fn cancel_calls(&self, terminal_id: &str, request: &Value) {
        self.with_calls(terminal_id, |calls| calls.end_named(request));
    }

    /// Ends the waits of all `terminal_id`'s calls.
    pub fn end_calls(&self, terminal_id: &str) {
        self.with_calls(terminal_id, OpenCalls::end_all);
    }

    fn with_calls(&self, terminal_id: &str, change: impl FnOnce(&mut OpenCalls)) {
        if let Some(terminal) = self.0.lock().terminals.get_mut(terminal_id) {
            change(&mut terminal.calls);
        }
    }

    /// Has the call wait on the unanswered surface that the same call created, if its terminal has
    /// one. Returns that surface's key.
    pub fn rejoin(&self, terminal_id: &str, creation: Creation) -> Option<SurfaceKey> {
        let mut inner = self.0.lock();
        let Terminal { surfaces, calls, .. } = inner.terminals.get_mut(terminal_id)?;
        surfaces.iter_mut().find_map(|surface| match &mut surface.phase {
            Phase::Asking { waiters } if surface.tool == creation.tool && surface.arguments == *creation.arguments => {
                waiters.retain(|call| calls.is_open(*call));
                waiters.push(creation.call);
                Some(SurfaceKey::new(terminal_id, &surface.id))
            }
            _ => None,
        })
    }

    /// Adds the surface `key` as the webview accepted it. A terminal that has `MOST_KEPT` loses its
    /// oldest one that has or wants no answer.
    pub fn commit(&self, key: &SurfaceKey, creation: Creation, accepted: Accepted) -> Result<Committed, CommitRefused> {
        let mut inner = self.0.lock();
        let change = inner.next_change();
        let terminal = inner.terminals.entry(key.terminal_id.clone()).or_default();
        if terminal.find(&key.id).is_some() {
            return Err(CommitRefused::IdInUse);
        }
        let left = if terminal.surfaces.len() < MOST_KEPT {
            None
        } else {
            let oldest = terminal.surfaces.iter().position(|surface| !surface.is_open());
            let left = terminal.surfaces.remove(oldest.ok_or(CommitRefused::Full)?);
            Some(SurfaceKey::new(&key.terminal_id, left.id))
        };
        let phase = match accepted.asks {
            true => Phase::Asking { waiters: vec![creation.call] },
            false => Phase::NotAsking,
        };
        let surface = Surface {
            id: key.id.clone(),
            tool: creation.tool.to_string(),
            arguments: creation.arguments.clone(),
            title: creation.title.to_string(),
            state: accepted.state,
            revision: 1,
            order: change,
            change,
            phase,
        };
        let record = surface.record(&key.terminal_id);
        terminal.surfaces.push(surface);
        Ok(Committed { record, left })
    }

    /// The operator's answer to `revision` of a surface, which takes one. It goes back through the open
    /// calls that wait for it, or is to be typed in when there is none.
    pub fn answer(&self, key: &SurfaceKey, revision: u64, answer: Value) -> Result<Answered, AnswerRefused> {
        let mut inner = self.0.lock();
        let change = inner.next_change();
        let terminal = inner.terminals.get_mut(&key.terminal_id).ok_or(AnswerRefused::NoSuchSurface)?;
        let Terminal { surfaces, calls, .. } = terminal;
        let surface = surfaces.iter_mut().find(|surface| surface.id == key.id).ok_or(AnswerRefused::NoSuchSurface)?;
        let waiters = match &surface.phase {
            Phase::NotAsking => return Err(AnswerRefused::NoSuchSurface),
            Phase::Typing { .. } | Phase::Settled { .. } => return Err(AnswerRefused::AlreadyAnswered),
            Phase::Asking { waiters } => waiters,
        };
        if revision != surface.revision {
            return Err(AnswerRefused::OlderRevision);
        }
        let line = typed_line(&surface.title, &surface.id, &answer);
        if calls.hand(waiters, &answer, &line) {
            surface.phase = Phase::Settled { answer };
            surface.change = change;
            return Ok(Answered::Returned(surface.record(&key.terminal_id)));
        }
        surface.phase = Phase::Typing { answer };
        Ok(Answered::ToType(line))
    }

    /// Settles a surface whose answer has been typed in. `None` when it has left meanwhile.
    pub fn typed(&self, key: &SurfaceKey) -> Option<SurfaceRecord> {
        self.end_typing(key, |answer| Phase::Settled { answer })
    }

    /// Opens a surface again whose answer could not be typed in.
    pub fn not_typed(&self, key: &SurfaceKey) {
        self.end_typing(key, |_| Phase::Asking { waiters: Vec::new() });
    }

    fn end_typing(&self, key: &SurfaceKey, next: impl FnOnce(Value) -> Phase) -> Option<SurfaceRecord> {
        let mut inner = self.0.lock();
        let change = inner.next_change();
        let surface = inner.terminals.get_mut(&key.terminal_id)?.find(&key.id)?;
        let Phase::Typing { answer } = &mut surface.phase else {
            return None;
        };
        surface.phase = next(answer.take());
        surface.change = change;
        Some(surface.record(&key.terminal_id))
    }

    /// Every surface, in no order.
    pub fn list(&self) -> Vec<SurfaceRecord> {
        let inner = self.0.lock();
        inner
            .terminals
            .iter()
            .flat_map(|(terminal_id, terminal)| terminal.surfaces.iter().map(|surface| surface.record(terminal_id)))
            .collect()
    }
}
