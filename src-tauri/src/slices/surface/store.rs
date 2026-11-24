//! The surface store: every surface, its owner, state and waits, in memory, as one state machine
//! under its own lock. Nothing waits while holding it.

use std::collections::{HashMap, VecDeque};
use std::sync::Arc;

use parking_lot::Mutex;
use serde::Serialize;
use serde_json::{json, Value};
use tokio::sync::oneshot;

use super::calls::{Handed, OpenCalls};
use super::check::Accepted;
use super::place::{Place, MOST_LIVE};
use super::typed_line::typed_line;
use super::typing::NotTyped;
use super::unsent::{Page, Unsent, UnsentRefused, UnsentSave};
use crate::dates::now_ms;

/// The most settled surfaces a terminal keeps when another surface is added. What settles after that
/// stays until the next is.
const MOST_SETTLED: usize = 10;

/// How many of a terminal's surfaces that have left can still be read. Past it the one that left first
/// is forgotten, with its answer.
const MOST_READABLE: usize = 100;

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
    /// When it was shown, in milliseconds since the epoch.
    pub shown_at: i64,
    /// The answer, once there is one.
    pub answer: Option<Value>,
    /// When the answer was sent, in milliseconds since the epoch.
    pub answered_at: Option<i64>,
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

/// What dismissing a surface still needs. It has left, and takes nothing more.
pub struct Dismissed {
    /// The line its agent is told by, when it asked for something and no open call returns that.
    pub line: Option<String>,
}

/// Why a surface was not dismissed: its answer is being typed in. The surface is as it was.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BeingSent;

/// Where a surface stands, as its agent is told.
#[derive(Debug, Clone, PartialEq)]
pub enum Standing {
    /// It asks for nothing.
    Shown,
    NoAnswerYet,
    /// What its call returned, or would have.
    Answered(Value),
    Dismissed,
}

impl Standing {
    pub fn state(&self) -> &'static str {
        match self {
            Self::Shown => "shown",
            Self::NoAnswerYet => "no_answer_yet",
            Self::Answered(_) => "answered",
            Self::Dismissed => "dismissed",
        }
    }
}

/// What a call creates, as its agent wrote it.
#[derive(Clone, Copy)]
pub struct Creation<'a> {
    pub tool: &'a str,
    pub arguments: &'a Value,
    /// What the surface is called in the line its answer is typed in as.
    pub title: &'a str,
    pub place: Place,
    /// The call's number, from `open_call`.
    pub call: u64,
}

/// Why a surface was not added. Nothing was.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommitRefused {
    /// The terminal has a surface of that id.
    IdInUse,
    /// The terminal has `MOST_LIVE` live surfaces in this place.
    Full(Place),
}

/// A surface that was added.
pub struct Committed {
    pub record: SurfaceRecord,
    /// The settled surfaces that left as it was added, oldest first.
    pub left: Vec<SurfaceKey>,
}

enum Phase {
    /// It has no action to its agent.
    NotAsking,
    /// It has no answer yet. `waiters` are the calls that wait for it, open or over.
    Asking { waiters: Vec<u64> },
    /// Its one answer is being typed in.
    Typing { answer: Value },
    /// `at` is when it was answered, in milliseconds since the epoch.
    Settled { answer: Value, at: i64 },
}

impl Phase {
    fn standing(&self) -> Standing {
        match self {
            Self::NotAsking => Standing::Shown,
            Self::Asking { .. } | Self::Typing { .. } => Standing::NoAnswerYet,
            Self::Settled { answer, .. } => Standing::Answered(answer.clone()),
        }
    }
}

struct Surface {
    id: String,
    tool: String,
    /// The arguments of the call that created it, which the same call again is told by.
    arguments: Value,
    title: String,
    place: Place,
    state: Value,
    revision: u64,
    order: u64,
    change: u64,
    shown_at: i64,
    phase: Phase,
    /// What the operator has put in it and not sent, while it is live.
    unsent: Option<UnsentSave>,
}

impl Surface {
    /// Whether it is not settled, which keeps it from making room for another.
    fn is_live(&self) -> bool {
        !matches!(self.phase, Phase::Settled { .. })
    }

    /// Settles it, which what is unsent in it does not outlive.
    fn settle(&mut self, answer: Value, change: u64) {
        self.phase = Phase::Settled { answer, at: now_ms() };
        self.change = change;
        self.unsent = None;
    }

    fn unsent(&self, terminal_id: &str) -> Option<Unsent> {
        let UnsentSave { order, revision, values, .. } = self.unsent.as_ref()?;
        Some(Unsent {
            terminal_id: terminal_id.to_string(),
            id: self.id.clone(),
            order: *order,
            revision: *revision,
            values: values.clone(),
        })
    }

    fn record(&self, terminal_id: &str) -> SurfaceRecord {
        let (answer, answered_at) = match &self.phase {
            Phase::Settled { answer, at } => (Some(answer.clone()), Some(*at)),
            Phase::NotAsking | Phase::Asking { .. } | Phase::Typing { .. } => (None, None),
        };
        SurfaceRecord {
            terminal_id: terminal_id.to_string(),
            id: self.id.clone(),
            tool: self.tool.clone(),
            state: self.state.clone(),
            revision: self.revision,
            order: self.order,
            change: self.change,
            asks: !matches!(self.phase, Phase::NotAsking),
            shown_at: self.shown_at,
            answer,
            answered_at,
        }
    }
}

/// Where a terminal's surfaces that have left stand, in the order they left: at most `MOST_READABLE`.
#[derive(Default)]
struct Left(VecDeque<(String, Standing)>);

impl Left {
    fn add(&mut self, id: String, standing: Standing) {
        if self.0.len() == MOST_READABLE {
            self.0.pop_front();
        }
        self.0.push_back((id, standing));
    }

    /// Where the last surface of that id stood.
    fn standing(&self, id: &str) -> Option<Standing> {
        self.0.iter().rev().find(|(left, _)| left == id).map(|(_, standing)| standing.clone())
    }
}

/// One terminal's surfaces, in the order they were committed, where those that have left stand, how
/// many asks have been named, its rejected calls, and the calls that are open.
#[derive(Default)]
struct Terminal {
    asks: u64,
    /// By tool, how many of its calls have been rejected since one was accepted.
    rejected: HashMap<String, u32>,
    surfaces: Vec<Surface>,
    left: Left,
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
    last_page: u64,
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

    /// Where the surface `key` stands, also once it has left the screen. `None` when its terminal
    /// never had it, or has had `MOST_READABLE` leave since it left.
    pub fn standing(&self, key: &SurfaceKey) -> Option<Standing> {
        let inner = self.0.lock();
        let terminal = inner.terminals.get(&key.terminal_id)?;
        let surface = terminal.surfaces.iter().find(|surface| surface.id == key.id);
        surface.map(|surface| surface.phase.standing()).or_else(|| terminal.left.standing(&key.id))
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
        let Terminal { surfaces, calls, rejected, .. } = inner.terminals.get_mut(terminal_id)?;
        surfaces.iter_mut().find_map(|surface| match &mut surface.phase {
            Phase::Asking { waiters } if surface.tool == creation.tool && surface.arguments == *creation.arguments => {
                waiters.retain(|call| calls.is_open(*call));
                waiters.push(creation.call);
                rejected.remove(creation.tool);
                Some(SurfaceKey::new(terminal_id, &surface.id))
            }
            _ => None,
        })
    }

    /// Counts a rejected call of `tool`, and says how many of the terminal's are now in a row. A call
    /// that is accepted ends the row.
    pub fn rejected(&self, terminal_id: &str, tool: &str) -> u32 {
        let mut inner = self.0.lock();
        let terminal = inner.terminals.entry(terminal_id.to_string()).or_default();
        let run = terminal.rejected.entry(tool.to_string()).or_default();
        *run = run.saturating_add(1);
        *run
    }

    /// Ends `tool`'s row of rejected calls, for a call that is accepted and shows nothing.
    pub fn accepted(&self, terminal_id: &str, tool: &str) {
        if let Some(terminal) = self.0.lock().terminals.get_mut(terminal_id) {
            terminal.rejected.remove(tool);
        }
    }

    /// Adds the surface `key` as the webview accepted it, if its place has room for it. The terminal's
    /// settled surfaces past `MOST_SETTLED` leave, oldest first.
    pub fn commit(&self, key: &SurfaceKey, creation: Creation, accepted: Accepted) -> Result<Committed, CommitRefused> {
        let mut inner = self.0.lock();
        let change = inner.next_change();
        let terminal = inner.terminals.entry(key.terminal_id.clone()).or_default();
        if terminal.find(&key.id).is_some() {
            return Err(CommitRefused::IdInUse);
        }
        let place = creation.place;
        let live = terminal.surfaces.iter().filter(|surface| surface.is_live() && surface.place == place);
        if live.count() >= MOST_LIVE {
            return Err(CommitRefused::Full(place));
        }
        let settled = terminal.surfaces.iter().filter(|surface| !surface.is_live()).count();
        let mut past = settled.saturating_sub(MOST_SETTLED);
        let mut left = Vec::new();
        let Terminal { surfaces, left: readable, .. } = terminal;
        surfaces.retain(|surface| {
            let leaves = past > 0 && !surface.is_live();
            if leaves {
                past -= 1;
                left.push(SurfaceKey::new(&key.terminal_id, &surface.id));
                readable.add(surface.id.clone(), surface.phase.standing());
            }
            !leaves
        });
        let phase = match accepted.asks {
            true => Phase::Asking { waiters: vec![creation.call] },
            false => Phase::NotAsking,
        };
        let surface = Surface {
            id: key.id.clone(),
            tool: creation.tool.to_string(),
            arguments: creation.arguments.clone(),
            title: creation.title.to_string(),
            place,
            state: accepted.state,
            revision: 1,
            order: change,
            change,
            shown_at: now_ms(),
            phase,
            unsent: None,
        };
        let record = surface.record(&key.terminal_id);
        terminal.surfaces.push(surface);
        terminal.rejected.remove(creation.tool);
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
            surface.settle(answer, change);
            return Ok(Answered::Returned(surface.record(&key.terminal_id)));
        }
        surface.phase = Phase::Typing { answer };
        Ok(Answered::ToType(line))
    }

    /// The operator's dismissal of a surface, which leaves. One that asks for something is answered by
    /// it. `None` when the terminal has no such surface.
    pub fn dismiss(&self, key: &SurfaceKey) -> Result<Option<Dismissed>, BeingSent> {
        let mut inner = self.0.lock();
        let Some(terminal) = inner.terminals.get_mut(&key.terminal_id) else {
            return Ok(None);
        };
        let Terminal { surfaces, calls, left, .. } = terminal;
        let Some(at) = surfaces.iter().position(|surface| surface.id == key.id) else {
            return Ok(None);
        };
        let line = match &surfaces[at].phase {
            Phase::Typing { .. } => return Err(BeingSent),
            Phase::NotAsking | Phase::Settled { .. } => None,
            Phase::Asking { waiters } => {
                let result = json!({ "dismissed": true });
                let line = typed_line(&surfaces[at].title, &key.id, &result);
                (!calls.hand(waiters, &result, &line)).then_some(line)
            }
        };
        let surface = surfaces.remove(at);
        // What an agent was answered stays readable
        let standing = match surface.phase {
            Phase::Settled { answer, .. } => Standing::Answered(answer),
            _ => Standing::Dismissed,
        };
        left.add(surface.id, standing);
        Ok(Some(Dismissed { line }))
    }

    /// Settles a surface whose answer has been typed in. `None` when it has left meanwhile.
    pub fn typed(&self, key: &SurfaceKey) -> Option<SurfaceRecord> {
        self.end_typing(key, Surface::settle)
    }

    /// Opens a surface again whose answer could not be typed in.
    pub fn not_typed(&self, key: &SurfaceKey) {
        self.end_typing(key, |surface, _, change| {
            surface.phase = Phase::Asking { waiters: Vec::new() };
            surface.change = change;
        });
    }

    fn end_typing(&self, key: &SurfaceKey, end: impl FnOnce(&mut Surface, Value, u64)) -> Option<SurfaceRecord> {
        let mut inner = self.0.lock();
        let change = inner.next_change();
        let surface = inner.terminals.get_mut(&key.terminal_id)?.find(&key.id)?;
        let Phase::Typing { answer } = &mut surface.phase else {
            return None;
        };
        let answer = answer.take();
        end(surface, answer, change);
        Some(surface.record(&key.terminal_id))
    }

    /// The surface `key` as it is now.
    pub fn record(&self, key: &SurfaceKey) -> Option<SurfaceRecord> {
        let mut inner = self.0.lock();
        let surface = inner.terminals.get_mut(&key.terminal_id)?.find(&key.id)?;
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

    /// Opens a page of the webview, and gives it what is unsent in every surface, in no order.
    pub fn open_page(&self) -> Page {
        let mut inner = self.0.lock();
        inner.last_page += 1;
        let unsent = inner
            .terminals
            .iter()
            .flat_map(|(terminal_id, terminal)| {
                terminal.surfaces.iter().filter_map(|surface| surface.unsent(terminal_id))
            })
            .collect();
        Page { page: inner.last_page, unsent }
    }

    /// Keeps what is unsent in a surface, in place of what was kept. Saves may arrive in any order: one
    /// made before the one that is kept is refused.
    pub fn save_unsent(&self, key: &SurfaceKey, save: UnsentSave) -> Result<(), UnsentRefused> {
        if save.is_too_large() {
            return Err(UnsentRefused::TooLarge);
        }
        let mut inner = self.0.lock();
        let surface = inner
            .terminals
            .get_mut(&key.terminal_id)
            .and_then(|terminal| terminal.find(&key.id))
            .filter(|surface| surface.is_live() && surface.order == save.order)
            .ok_or(UnsentRefused::NoSuchSurface)?;
        if save.revision != surface.revision {
            return Err(UnsentRefused::OtherRevision);
        }
        if surface.unsent.as_ref().is_some_and(|kept| (kept.page, kept.save) >= (save.page, save.save)) {
            return Err(UnsentRefused::OlderSave);
        }
        surface.unsent = Some(save);
        Ok(())
    }
}
