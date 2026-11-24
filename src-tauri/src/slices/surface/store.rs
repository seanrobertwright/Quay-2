//! The surface store: every surface, its owner, state and wait, in memory, as one state machine
//! under its own lock. Nothing waits while holding it.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use serde::Serialize;
use serde_json::Value;
use tokio::sync::oneshot;

use super::check::Accepted;
use super::place::{Place, MOST_LIVE};
use super::unsent::{Page, Unsent, UnsentRefused, UnsentSave};
use crate::dates::now_ms;

/// The most settled surfaces a terminal keeps when another surface is added. What settles after that
/// stays until the next is.
const MOST_SETTLED: usize = 10;

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
    /// No call of the agent's is open to return the answer through.
    CallEnded,
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
    /// The call's wait, when the surface asks for something.
    pub wait: Option<Wait>,
    /// The settled surfaces that left as it was added, oldest first.
    pub left: Vec<SurfaceKey>,
}

enum Phase {
    /// It has no action to its agent.
    NotAsking,
    /// It has no answer yet. `waiter` is the open call, if there is one.
    Asking { waiter: Option<oneshot::Sender<Value>> },
    /// `at` is when, in milliseconds since the epoch.
    Settled { answer: Value, at: i64 },
}

struct Surface {
    id: String,
    tool: String,
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
            Phase::NotAsking | Phase::Asking { .. } => (None, None),
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

/// One terminal's surfaces, in the order they were committed, how many asks have been named, and its
/// rejected calls.
#[derive(Default)]
struct Terminal {
    asks: u64,
    /// By tool, how many of its calls have been rejected since one was accepted.
    rejected: HashMap<String, u32>,
    surfaces: Vec<Surface>,
}

impl Terminal {
    fn find(&mut self, id: &str) -> Option<&mut Surface> {
        self.surfaces.iter_mut().find(|surface| surface.id == id)
    }
}

#[derive(Default)]
struct Inner {
    last_change: u64,
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

    /// Counts a rejected call of `tool`, and says how many of the terminal's are now in a row. A call
    /// that is accepted ends the row.
    pub fn rejected(&self, terminal_id: &str, tool: &str) -> u32 {
        let mut inner = self.0.lock();
        let terminal = inner.terminals.entry(terminal_id.to_string()).or_default();
        let run = terminal.rejected.entry(tool.to_string()).or_default();
        *run = run.saturating_add(1);
        *run
    }

    /// Adds the surface `key` as the webview accepted it, if `place` has room for it. The terminal's
    /// settled surfaces past `MOST_SETTLED` leave, oldest first.
    pub fn commit(
        &self,
        key: &SurfaceKey,
        tool: &str,
        place: Place,
        accepted: Accepted,
    ) -> Result<Committed, CommitRefused> {
        let mut inner = self.0.lock();
        let change = inner.next_change();
        let terminal = inner.terminals.entry(key.terminal_id.clone()).or_default();
        if terminal.find(&key.id).is_some() {
            return Err(CommitRefused::IdInUse);
        }
        let live = terminal.surfaces.iter().filter(|surface| surface.is_live() && surface.place == place);
        if live.count() >= MOST_LIVE {
            return Err(CommitRefused::Full(place));
        }
        let settled = terminal.surfaces.iter().filter(|surface| !surface.is_live()).count();
        let mut past = settled.saturating_sub(MOST_SETTLED);
        let mut left = Vec::new();
        terminal.surfaces.retain(|surface| {
            let leaves = past > 0 && !surface.is_live();
            if leaves {
                past -= 1;
                left.push(SurfaceKey::new(&key.terminal_id, &surface.id));
            }
            !leaves
        });
        let (phase, wait) = if accepted.asks {
            let (tx, rx) = oneshot::channel();
            let wait = Wait { store: self.clone(), key: key.clone(), rx };
            (Phase::Asking { waiter: Some(tx) }, Some(wait))
        } else {
            (Phase::NotAsking, None)
        };
        let surface = Surface {
            id: key.id.clone(),
            tool: tool.to_string(),
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
        terminal.rejected.remove(tool);
        Ok(Committed { record, wait, left })
    }

    /// The operator's answer to `revision` of a surface. The first one returned through an open call
    /// settles it.
    pub fn answer(&self, key: &SurfaceKey, revision: u64, answer: Value) -> Result<SurfaceRecord, AnswerRefused> {
        let mut inner = self.0.lock();
        let change = inner.next_change();
        let surface = inner
            .terminals
            .get_mut(&key.terminal_id)
            .and_then(|terminal| terminal.find(&key.id))
            .ok_or(AnswerRefused::NoSuchSurface)?;
        let waiter = match &mut surface.phase {
            Phase::NotAsking => return Err(AnswerRefused::NoSuchSurface),
            Phase::Settled { .. } => return Err(AnswerRefused::AlreadyAnswered),
            Phase::Asking { waiter } => waiter,
        };
        if revision != surface.revision {
            return Err(AnswerRefused::OlderRevision);
        }
        let waiter = waiter.take().ok_or(AnswerRefused::CallEnded)?;
        // Fails when the call was dropped with its connection
        waiter.send(answer.clone()).map_err(|_| AnswerRefused::CallEnded)?;
        surface.settle(answer, change);
        Ok(surface.record(&key.terminal_id))
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

    /// Ends the wait on a surface that is not settled. The surface stays up.
    fn end_wait(&self, key: &SurfaceKey) {
        let mut inner = self.0.lock();
        let surface = inner.terminals.get_mut(&key.terminal_id).and_then(|terminal| terminal.find(&key.id));
        if let Some(Phase::Asking { waiter }) = surface.map(|surface| &mut surface.phase) {
            *waiter = None;
        }
    }
}

/// An open call's wait for its surface's answer. It holds no lock.
pub struct Wait {
    store: SurfaceStore,
    key: SurfaceKey,
    rx: oneshot::Receiver<Value>,
}

impl Wait {
    /// The answer, or `None` when none came within `limit`.
    pub async fn answer(mut self, limit: Duration) -> Option<Value> {
        match tokio::time::timeout(limit, &mut self.rx).await {
            Ok(answer) => answer.ok(),
            Err(_) => {
                self.store.end_wait(&self.key);
                // An answer that settled the surface as the wait ran out was sent under the lock
                self.rx.try_recv().ok()
            }
        }
    }
}
