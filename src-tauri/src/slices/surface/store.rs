//! The surface store: every surface, its owner, state and waits, in memory, as one state machine
//! under its own lock. Nothing waits while holding it.

use std::collections::{HashMap, HashSet, VecDeque};
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

/// The most locked surfaces a terminal keeps. Past it the one that locked first leaves at once, which
/// counts as deleted.
const MOST_LOCKED: usize = 10;

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
    pub place: Place,
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
    /// When its terminal exited before it was settled, in milliseconds since the epoch.
    pub ended_at: Option<i64>,
}

/// Why an answer was not taken. The surface is as it was.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnswerRefused {
    /// The terminal has no surface of that id that asks for something.
    NoSuchSurface,
    AlreadyAnswered,
    OlderRevision,
    /// Its terminal exited first, or was relaunched.
    Ended,
    /// No call is open to return it through, and it could not be typed in.
    NotTyped(NotTyped),
}

/// How an answer reaches its agent.
pub enum Answered {
    /// An open call returns it, which settles the surface.
    Returned(Locked),
    /// It is to be typed in. Until `typed` or `not_typed` says how that went, the surface takes no
    /// other answer.
    ToType(ToType),
}

/// A line to type into a terminal, for the launch that asked.
pub struct ToType {
    pub launch: u64,
    pub line: String,
}

/// What dismissing a surface still needs. It has left, and takes nothing more.
pub struct Dismissed {
    /// What its agent is told by, when it asked for something and no open call returns that.
    pub line: Option<ToType>,
}

/// A call that has been opened.
pub struct OpenedCall {
    /// The launch of its terminal.
    pub launch: u64,
    pub number: u64,
    /// Where its answer comes, which closes when its wait ends without one.
    pub rx: oneshot::Receiver<Handed>,
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
    /// Its terminal exited before it was settled.
    Ended,
}

impl Standing {
    pub fn state(&self) -> &'static str {
        match self {
            Self::Shown => "shown",
            Self::NoAnswerYet => "no_answer_yet",
            Self::Answered(_) => "answered",
            Self::Dismissed => "dismissed",
            Self::Ended => "ended",
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
    /// The call's launch of its terminal is over, or the terminal has closed.
    TerminalOver,
    /// The operator dismissed the terminal's surface of that id.
    Dismissed,
    /// The terminal has a surface of that id.
    IdInUse,
    /// The terminal has `MOST_LIVE` live surfaces in this place.
    Full(Place),
}

/// A surface that has just locked: it was settled, or it ended.
pub struct Locked {
    pub record: SurfaceRecord,
    /// The locked surface that left for it, past `MOST_LOCKED`.
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
    /// Its terminal exited first, at `at`, in milliseconds since the epoch. `asked` is whether it had
    /// an action to its agent.
    Ended { asked: bool, at: i64 },
}

impl Phase {
    fn standing(&self) -> Standing {
        match self {
            Self::NotAsking => Standing::Shown,
            Self::Asking { .. } | Self::Typing { .. } => Standing::NoAnswerYet,
            Self::Settled { answer, .. } => Standing::Answered(answer.clone()),
            Self::Ended { .. } => Standing::Ended,
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
    /// Whether the launch that created it is over.
    launch_over: bool,
    /// What the operator has put in it and not sent, until it is settled.
    unsent: Option<UnsentSave>,
}

impl Surface {
    /// Whether it is settled or ended. It takes nothing more, and its `change` stays as it is.
    fn is_locked(&self) -> bool {
        matches!(self.phase, Phase::Settled { .. } | Phase::Ended { .. })
    }

    /// Settles it, which what is unsent in it does not outlive.
    fn settle(&mut self, answer: Value, change: u64) {
        self.phase = Phase::Settled { answer, at: now_ms() };
        self.change = change;
        self.unsent = None;
    }

    /// Ends it, as its terminal exited before it was settled. What is unsent in it stays.
    fn end(&mut self, change: u64) {
        let asked = !matches!(self.phase, Phase::NotAsking);
        self.phase = Phase::Ended { asked, at: now_ms() };
        self.change = change;
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
        let (answer, answered_at, ended_at) = match &self.phase {
            Phase::Settled { answer, at } => (Some(answer.clone()), Some(*at), None),
            Phase::Ended { at, .. } => (None, None, Some(*at)),
            Phase::NotAsking | Phase::Asking { .. } | Phase::Typing { .. } => (None, None, None),
        };
        SurfaceRecord {
            terminal_id: terminal_id.to_string(),
            id: self.id.clone(),
            tool: self.tool.clone(),
            place: self.place,
            state: self.state.clone(),
            revision: self.revision,
            order: self.order,
            change: self.change,
            asks: !matches!(self.phase, Phase::NotAsking | Phase::Ended { asked: false, .. }),
            shown_at: self.shown_at,
            answer,
            answered_at,
            ended_at,
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

/// A terminal that has been listed and not closed: its surfaces, in the order they were committed,
/// where those that have left stand, the ids the operator dismissed, how many of its surfaces Quay has
/// named, its rejected calls, and its calls that have not returned.
#[derive(Default)]
struct Terminal {
    /// Its latest launch.
    launch: u64,
    /// Whether that launch is not over.
    running: bool,
    /// How many surfaces have been named by each word. Also counted on by a later launch, so no id
    /// names a second surface while the terminal is open.
    named: HashMap<&'static str, u64>,
    /// By tool, how many of its calls have been rejected since one was accepted.
    rejected: HashMap<String, u32>,
    surfaces: Vec<Surface>,
    left: Left,
    /// The ids of the surfaces of its launch that the operator dismissed. Each took a click of theirs.
    dismissed: HashSet<String>,
    calls: OpenCalls,
}

impl Terminal {
    fn find(&mut self, id: &str) -> Option<&mut Surface> {
        self.surfaces.iter_mut().find(|surface| surface.id == id)
    }

    /// `SurfaceStore::is_dismissed`, of its surface `id` and a message through `tool`.
    fn is_dismissed(&mut self, id: &str, tool: &str) -> bool {
        let dismissed = self.dismissed.contains(id);
        if dismissed {
            self.rejected.remove(tool);
        }
        dismissed
    }

    /// Takes the locked surfaces past `MOST_LOCKED` out, the one that locked first first. `terminal_id`
    /// is its own id.
    fn drop_past_most_locked(&mut self, terminal_id: &str) -> Vec<SurfaceKey> {
        let mut left = Vec::new();
        loop {
            let locked = || self.surfaces.iter().enumerate().filter(|(_, surface)| surface.is_locked());
            if locked().count() <= MOST_LOCKED {
                return left;
            }
            let Some((first, _)) = locked().min_by_key(|(_, surface)| surface.change) else {
                return left;
            };
            let surface = self.surfaces.remove(first);
            left.push(SurfaceKey::new(terminal_id, &surface.id));
            self.left.add(surface.id, surface.phase.standing());
        }
    }

    /// Takes out the surface at `at`, which the operator dismissed. Its agent cannot use the id again,
    /// unless it was an earlier launch's.
    fn remove_dismissed(&mut self, at: usize) {
        let surface = self.surfaces.remove(at);
        if !surface.launch_over {
            self.dismissed.insert(surface.id.clone());
        }
        // What an agent was answered stays readable, and so does that a surface ended
        let standing = match surface.is_locked() {
            true => surface.phase.standing(),
            false => Standing::Dismissed,
        };
        self.left.add(surface.id, standing);
    }

    /// Ends its launch, and what its agent had: each surface that is not locked, its calls, where the
    /// surfaces that have left stand, the dismissed ids, and what was counted of it. Returns the
    /// surfaces that ended.
    fn end_launch(&mut self, terminal_id: &str, mut next_change: impl FnMut() -> u64) -> Vec<SurfaceRecord> {
        self.running = false;
        self.calls.forget_all();
        self.rejected.clear();
        self.dismissed.clear();
        self.left = Left::default();
        let mut ended = Vec::new();
        for surface in &mut self.surfaces {
            surface.launch_over = true;
            if !surface.is_locked() {
                surface.end(next_change());
                ended.push(surface.record(terminal_id));
            }
        }
        ended
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
    /// Says that `terminal_id` is listed with its launch `launch` running, from which on its calls are
    /// taken. An earlier launch than the terminal's latest changes nothing.
    pub fn launched(&self, terminal_id: &str, launch: u64) {
        let mut inner = self.0.lock();
        let terminal = inner.terminals.entry(terminal_id.to_string()).or_default();
        if launch > terminal.launch {
            terminal.launch = launch;
            terminal.running = true;
        }
    }

    /// Ends `terminal_id`'s launch `launch`, if it is running: its live surfaces, its open waits, and
    /// what was counted of it. Returns the surfaces that ended, and the locked ones that left for them.
    pub fn launch_over(&self, terminal_id: &str, launch: u64) -> (Vec<SurfaceRecord>, Vec<SurfaceKey>) {
        let mut inner = self.0.lock();
        let Inner { last_change, terminals, .. } = &mut *inner;
        let Some(terminal) = terminals.get_mut(terminal_id).filter(|t| t.running && t.launch == launch) else {
            return Default::default();
        };
        let ended = terminal.end_launch(terminal_id, || {
            *last_change += 1;
            *last_change
        });
        (ended, terminal.drop_past_most_locked(terminal_id))
    }

    /// Forgets `terminal_id`, which has closed, with all it had. Returns its surfaces.
    pub fn close(&self, terminal_id: &str) -> Vec<SurfaceKey> {
        let closed = self.0.lock().terminals.remove(terminal_id).unwrap_or_default();
        closed.surfaces.into_iter().map(|surface| SurfaceKey::new(terminal_id, surface.id)).collect()
    }

    /// A name for `terminal_id`'s next surface named by `word`: `ask_1` and on, counted per terminal and
    /// word, never one in use or one the operator dismissed. `None` when the terminal has closed.
    pub fn name(&self, terminal_id: &str, word: &'static str) -> Option<SurfaceKey> {
        let mut inner = self.0.lock();
        let terminal = inner.terminals.get_mut(terminal_id)?;
        loop {
            let named = terminal.named.entry(word).or_default();
            *named += 1;
            let id = format!("{word}_{named}");
            if terminal.find(&id).is_none() && !terminal.dismissed.contains(&id) {
                return Some(SurfaceKey::new(terminal_id, id));
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

    /// Opens a call of `terminal_id` whose JSON-RPC request has the id `request`. `None` when no launch
    /// of the terminal runs.
    pub fn open_call(&self, terminal_id: &str, request: &Value) -> Option<OpenedCall> {
        let mut inner = self.0.lock();
        inner.last_call += 1;
        let number = inner.last_call;
        let terminal = inner.terminals.get_mut(terminal_id).filter(|terminal| terminal.running)?;
        Some(OpenedCall { launch: terminal.launch, number, rx: terminal.calls.open(number, request.clone()) })
    }

    /// Ends the wait of one call. Its surface stays up and answerable.
    pub fn end_call(&self, terminal_id: &str, number: u64) {
        self.with_calls(terminal_id, |calls| calls.end(number));
    }

    /// Forgets a call, which has returned or was dropped.
    pub fn forget_call(&self, terminal_id: &str, number: u64) {
        self.with_calls(terminal_id, |calls| calls.forget(number));
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
        let terminal = inner.terminals.get_mut(terminal_id).filter(|terminal| terminal.calls.has(creation.call))?;
        let Terminal { surfaces, calls, rejected, .. } = terminal;
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
    /// that is accepted ends the row, and so does an exit. Nothing is counted while no launch runs.
    pub fn rejected(&self, terminal_id: &str, tool: &str) -> u32 {
        let mut inner = self.0.lock();
        let Some(terminal) = inner.terminals.get_mut(terminal_id).filter(|terminal| terminal.running) else {
            return 1;
        };
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

    /// Whether the operator dismissed the surface `key`, which a later message for it is told. The message
    /// is then accepted, which ends the row of rejected calls of the creation's tool.
    pub fn is_dismissed(&self, key: &SurfaceKey, creation: Creation) -> bool {
        let mut inner = self.0.lock();
        let terminal = inner.terminals.get_mut(&key.terminal_id).filter(|terminal| terminal.calls.has(creation.call));
        terminal.is_some_and(|terminal| terminal.is_dismissed(&key.id, creation.tool))
    }

    /// Adds the surface `key` as the webview accepted it, if its place has room for it. Returns it.
    pub fn commit(
        &self,
        key: &SurfaceKey,
        creation: Creation,
        accepted: Accepted,
    ) -> Result<SurfaceRecord, CommitRefused> {
        let mut inner = self.0.lock();
        let change = inner.next_change();
        let terminal = inner.terminals.get_mut(&key.terminal_id).filter(|terminal| terminal.calls.has(creation.call));
        let terminal = terminal.ok_or(CommitRefused::TerminalOver)?;
        if terminal.is_dismissed(&key.id, creation.tool) {
            return Err(CommitRefused::Dismissed);
        }
        if terminal.find(&key.id).is_some() {
            return Err(CommitRefused::IdInUse);
        }
        let place = creation.place;
        let live = terminal.surfaces.iter().filter(|surface| !surface.is_locked() && surface.place == place);
        if live.count() >= MOST_LIVE {
            return Err(CommitRefused::Full(place));
        }
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
            launch_over: false,
            unsent: None,
        };
        let record = surface.record(&key.terminal_id);
        terminal.surfaces.push(surface);
        terminal.rejected.remove(creation.tool);
        Ok(record)
    }

    /// The operator's answer to `revision` of a surface, which takes one. It goes back through the open
    /// calls that wait for it, or is to be typed in when there is none.
    pub fn answer(&self, key: &SurfaceKey, revision: u64, answer: Value) -> Result<Answered, AnswerRefused> {
        let mut inner = self.0.lock();
        let change = inner.next_change();
        let terminal = inner.terminals.get_mut(&key.terminal_id).ok_or(AnswerRefused::NoSuchSurface)?;
        let Terminal { surfaces, calls, launch, .. } = terminal;
        let surface = surfaces.iter_mut().find(|surface| surface.id == key.id).ok_or(AnswerRefused::NoSuchSurface)?;
        let waiters = match &surface.phase {
            Phase::NotAsking => return Err(AnswerRefused::NoSuchSurface),
            Phase::Typing { .. } | Phase::Settled { .. } => return Err(AnswerRefused::AlreadyAnswered),
            Phase::Ended { .. } => return Err(AnswerRefused::Ended),
            Phase::Asking { waiters } => waiters,
        };
        if revision != surface.revision {
            return Err(AnswerRefused::OlderRevision);
        }
        let line = typed_line(&surface.title, &surface.id, &answer);
        if calls.hand(waiters, &answer, &line) {
            surface.settle(answer, change);
            let record = surface.record(&key.terminal_id);
            let left = terminal.drop_past_most_locked(&key.terminal_id);
            return Ok(Answered::Returned(Locked { record, left }));
        }
        surface.phase = Phase::Typing { answer };
        Ok(Answered::ToType(ToType { launch: *launch, line }))
    }

    /// The operator's dismissal of a surface, which leaves. One that asks for something is answered by
    /// it. `None` when the terminal has no such surface.
    pub fn dismiss(&self, key: &SurfaceKey) -> Result<Option<Dismissed>, BeingSent> {
        let mut inner = self.0.lock();
        let Some(terminal) = inner.terminals.get_mut(&key.terminal_id) else {
            return Ok(None);
        };
        let Terminal { surfaces, calls, launch, .. } = terminal;
        let Some(at) = surfaces.iter().position(|surface| surface.id == key.id) else {
            return Ok(None);
        };
        let line = match &surfaces[at].phase {
            Phase::Typing { .. } => return Err(BeingSent),
            Phase::NotAsking | Phase::Settled { .. } | Phase::Ended { .. } => None,
            Phase::Asking { waiters } => {
                let result = json!({ "dismissed": true });
                let line = typed_line(&surfaces[at].title, &key.id, &result);
                (!calls.hand(waiters, &result, &line)).then_some(ToType { launch: *launch, line })
            }
        };
        terminal.remove_dismissed(at);
        Ok(Some(Dismissed { line }))
    }

    /// The operator's dismissal of those of `terminal_id`'s surfaces `ids` that are locked, of which no
    /// agent is told. Returns those that left.
    pub fn dismiss_locked(&self, terminal_id: &str, ids: &[String]) -> Vec<SurfaceKey> {
        let mut inner = self.0.lock();
        let Some(terminal) = inner.terminals.get_mut(terminal_id) else {
            return Vec::new();
        };
        let mut left = Vec::new();
        let is_to_leave = |surface: &Surface| surface.is_locked() && ids.contains(&surface.id);
        while let Some(at) = terminal.surfaces.iter().position(is_to_leave) {
            left.push(SurfaceKey::new(terminal_id, &terminal.surfaces[at].id));
            terminal.remove_dismissed(at);
        }
        left
    }

    /// Settles a surface whose answer has been typed in. `None` when it has left or ended meanwhile.
    pub fn typed(&self, key: &SurfaceKey) -> Option<Locked> {
        let mut inner = self.0.lock();
        let change = inner.next_change();
        let terminal = inner.terminals.get_mut(&key.terminal_id)?;
        let surface = terminal.find(&key.id)?;
        let Phase::Typing { answer } = &mut surface.phase else {
            return None;
        };
        let answer = answer.take();
        surface.settle(answer, change);
        let record = surface.record(&key.terminal_id);
        Some(Locked { record, left: terminal.drop_past_most_locked(&key.terminal_id) })
    }

    /// Opens a surface again whose answer could not be typed in, unless it has left or ended meanwhile.
    pub fn not_typed(&self, key: &SurfaceKey) {
        let mut inner = self.0.lock();
        let change = inner.next_change();
        let surface = inner.terminals.get_mut(&key.terminal_id).and_then(|terminal| terminal.find(&key.id));
        if let Some(surface) = surface.filter(|surface| matches!(surface.phase, Phase::Typing { .. })) {
            surface.phase = Phase::Asking { waiters: Vec::new() };
            surface.change = change;
        }
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

    /// Keeps what is unsent in a surface that is not settled, in place of what was kept. Saves may arrive in any order: one
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
            .filter(|surface| !matches!(surface.phase, Phase::Settled { .. }) && surface.order == save.order)
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
