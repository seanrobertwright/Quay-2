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
    /// No call of the agent's is open to return the answer through.
    CallEnded,
}

enum Phase {
    /// It has no action to its agent.
    NotAsking,
    /// It has no answer yet. `waiter` is the open call, if there is one.
    Asking { waiter: Option<oneshot::Sender<Value>> },
    Settled { answer: Value },
}

struct Surface {
    id: String,
    tool: String,
    state: Value,
    revision: u64,
    order: u64,
    change: u64,
    phase: Phase,
}

impl Surface {
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
                Phase::NotAsking | Phase::Asking { .. } => None,
            },
        }
    }
}

/// One terminal's surfaces, in the order they were committed, and how many asks have been named.
#[derive(Default)]
struct Terminal {
    asks: u64,
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
    pub fn name_ask(&self, terminal_id: &str) -> String {
        let mut inner = self.0.lock();
        let terminal = inner.terminals.entry(terminal_id.to_string()).or_default();
        loop {
            terminal.asks += 1;
            let id = format!("ask_{}", terminal.asks);
            if terminal.find(&id).is_none() {
                return id;
            }
        }
    }

    /// Adds the surface `id` as the webview accepted it. With it, the call's wait when the surface
    /// asks for something. `None` when the terminal has a surface of that id.
    pub fn commit(
        &self,
        terminal_id: &str,
        id: &str,
        tool: &str,
        accepted: Accepted,
    ) -> Option<(SurfaceRecord, Option<Wait>)> {
        let mut inner = self.0.lock();
        let change = inner.next_change();
        let terminal = inner.terminals.entry(terminal_id.to_string()).or_default();
        if terminal.find(id).is_some() {
            return None;
        }
        let (phase, wait) = if accepted.asks {
            let (tx, rx) = oneshot::channel();
            let wait = Wait { store: self.clone(), terminal_id: terminal_id.to_string(), id: id.to_string(), rx };
            (Phase::Asking { waiter: Some(tx) }, Some(wait))
        } else {
            (Phase::NotAsking, None)
        };
        let surface = Surface {
            id: id.to_string(),
            tool: tool.to_string(),
            state: accepted.state,
            revision: 1,
            order: change,
            change,
            phase,
        };
        let record = surface.record(terminal_id);
        terminal.surfaces.push(surface);
        Some((record, wait))
    }

    /// The operator's answer to `revision` of a surface. The first one returned through an open call
    /// settles it.
    pub fn answer(
        &self,
        terminal_id: &str,
        id: &str,
        revision: u64,
        answer: Value,
    ) -> Result<SurfaceRecord, AnswerRefused> {
        let mut inner = self.0.lock();
        let change = inner.next_change();
        let surface = inner
            .terminals
            .get_mut(terminal_id)
            .and_then(|terminal| terminal.find(id))
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
        surface.phase = Phase::Settled { answer };
        surface.change = change;
        Ok(surface.record(terminal_id))
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

    /// Ends the wait on a surface that is not settled. The surface stays up.
    fn end_wait(&self, terminal_id: &str, id: &str) {
        let mut inner = self.0.lock();
        let surface = inner.terminals.get_mut(terminal_id).and_then(|terminal| terminal.find(id));
        if let Some(Phase::Asking { waiter }) = surface.map(|surface| &mut surface.phase) {
            *waiter = None;
        }
    }
}

/// An open call's wait for its surface's answer. It holds no lock.
pub struct Wait {
    store: SurfaceStore,
    terminal_id: String,
    id: String,
    rx: oneshot::Receiver<Value>,
}

impl Wait {
    /// The answer, or `None` when none came within `limit`.
    pub async fn answer(mut self, limit: Duration) -> Option<Value> {
        match tokio::time::timeout(limit, &mut self.rx).await {
            Ok(answer) => answer.ok(),
            Err(_) => {
                self.store.end_wait(&self.terminal_id, &self.id);
                // An answer that settled the surface as the wait ran out was sent under the lock
                self.rx.try_recv().ok()
            }
        }
    }
}
