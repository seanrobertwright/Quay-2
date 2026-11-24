//! What the store says of raw surfaces, whose ids their agents choose, and what a raw call changes: all of
//! it at once, or nothing.

use std::collections::HashMap;

use serde_json::{json, Value};

use super::super::carried::{Carried, DataPath};
use super::super::check::Accepted;
use super::super::past_limit::{within_limits, PastLimit};
use super::super::place::{Place, MOST_LIVE};
use super::super::raw::TOOL;
use super::super::raw_changes::{Effect, Held};
use super::{now_ms, Creation, Inner, Phase, Reopened, Surface, SurfaceKey, SurfaceRecord, SurfaceStore, Terminal};

/// What a call does to one surface, with what the webview accepted of one that is there after it.
pub struct RawChange<'a> {
    pub id: &'a str,
    pub effect: Effect,
    pub accepted: Option<Accepted>,
}

/// Why a raw call changed nothing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RawRefused {
    /// The call's launch of its terminal is over, or the terminal has closed.
    TerminalOver,
    /// The operator dismissed the terminal's surface of an id the call names.
    Dismissed,
    /// The terminal has a surface of that id, which does not make way.
    IdInUse(String),
    /// The terminal has no surface of that id that takes an update any more.
    Gone(String),
    /// The operator's answer to a surface is being typed in.
    BeingSent,
    PastLimit(String, PastLimit),
    /// The webview accepted the call without a surface that it makes.
    NoState(String),
}

/// What a raw call changed.
#[derive(Default)]
pub struct RawChanged {
    /// The surfaces to draw again, those that were withdrawn among them.
    pub shown: Vec<SurfaceRecord>,
    /// The surfaces that left.
    pub left: Vec<SurfaceKey>,
    /// Whether a surface is there that the call created or updated.
    pub shows: bool,
    /// The asking surfaces among those, which the call waits on.
    pub asking: Vec<String>,
}

/// A wait that its surface will not end: the calls that had one, and what they return unless another
/// surface is still to answer them.
struct WaitOver {
    calls: Vec<u64>,
    result: Value,
}

impl WaitOver {
    fn of(id: &str, calls: Vec<u64>, state: &str) -> Self {
        Self { calls, result: json!({ "surface_id": id, "state": state }) }
    }
}

impl Surface {
    /// Whether it leaves for what `creation` creates under its id: both are raw, it is settled, and the
    /// same call is made again. An ended or withdrawn one never does, as what the operator typed in it
    /// stays.
    pub(super) fn makes_way(&self, creation: Creation) -> bool {
        let both_raw = self.tool == TOOL && creation.tool == TOOL;
        let settled = matches!(self.phase, Phase::Settled { .. });
        both_raw && settled && self.arguments == *creation.arguments
    }

    fn held(&self, creation: Creation) -> Held {
        Held {
            tool: self.tool.clone(),
            place: self.place,
            title: self.title.clone(),
            standing: self.phase.standing(),
            state: self.state.clone(),
            makes_way: self.makes_way(creation),
        }
    }

    /// Changes it to what its agent's update made of it, at `change`, and opens it again if it was
    /// answered. The call `call` waits for it from here on, if it asks. Returns the waits that are over by
    /// it.
    fn update(&mut self, accepted: Accepted, sets: &[DataPath], call: u64, change: u64) -> Option<WaitOver> {
        self.revision += 1;
        self.change = change;
        self.updated_at = now_ms();
        self.state = accepted.state;
        self.image_paths = accepted.image_paths;
        let mut waiters = Vec::new();
        match std::mem::replace(&mut self.phase, Phase::NotAsking) {
            Phase::Settled { answer, at } => {
                self.reopened = Some(Reopened { at: self.updated_at, answer, answered_at: at });
                self.order = change;
                self.launch_over = false;
                self.carried = Carried::new(self.revision);
            }
            phase => {
                self.carried.set(self.revision, sets);
                self.carry_unsent();
                if let Phase::Asking { waiters: before } = phase {
                    waiters = before;
                }
            }
        }
        if accepted.asks {
            waiters.push(call);
            self.phase = Phase::Asking { waiters };
            return None;
        }
        Some(WaitOver::of(&self.id, waiters, "shown"))
    }

    /// Leaves of what is unsent what its latest revision keeps.
    fn carry_unsent(&mut self) {
        let Some(mut unsent) = self.unsent.take() else {
            return;
        };
        if self.carried.keep(unsent.revision, &mut unsent.values) {
            unsent.revision = self.revision;
            self.unsent = Some(unsent);
        }
    }
}

impl Terminal {
    /// The live surfaces in each place once `changes` are made, or the change whose surface has no room.
    fn check_room(&self, changes: &[RawChange], place: Place) -> Result<(), RawRefused> {
        let named = |id: &str| changes.iter().find(|change| change.id == id);
        let mut live: HashMap<Place, usize> = HashMap::new();
        for surface in self.surfaces.iter().filter(|surface| !surface.is_locked()) {
            // Of those the call names, an update leaves a live one in its place
            if named(&surface.id).is_none_or(|change| matches!(change.effect, Effect::Update { .. })) {
                *live.entry(surface.place).or_default() += 1;
            }
        }
        for change in changes {
            let there = self.surfaces.iter().find(|surface| surface.id == change.id);
            let place = match (&change.effect, there) {
                (Effect::Create { .. }, _) => place,
                (Effect::Update { .. }, Some(there)) if there.is_locked() => there.place,
                _ => continue,
            };
            let live = live.entry(place).or_default();
            if *live == MOST_LIVE {
                return Err(RawRefused::PastLimit(change.id.to_string(), PastLimit::Live(place)));
            }
            *live += 1;
        }
        Ok(())
    }

    /// Whether `changes`, which the call of `creation` makes, can all be made.
    fn check_changes(&mut self, creation: Creation, changes: &[RawChange]) -> Result<(), RawRefused> {
        if changes.iter().any(|change| self.is_dismissed(change.id, creation.tool)) {
            return Err(RawRefused::Dismissed);
        }
        for RawChange { id, effect, accepted } in changes {
            let there = self.surfaces.iter().find(|surface| surface.id == *id);
            if there.is_some_and(|there| matches!(there.phase, Phase::Typing { .. })) {
                return Err(RawRefused::BeingSent);
            }
            match effect {
                Effect::Create { replaces: false } if there.is_some_and(|there| !there.makes_way(creation)) => {
                    return Err(RawRefused::IdInUse(id.to_string()));
                }
                Effect::Update { .. } if !there.is_some_and(|there| there.held(creation).takes_updates()) => {
                    return Err(RawRefused::Gone(id.to_string()));
                }
                _ => {}
            }
            if *effect != Effect::Delete {
                let accepted = accepted.as_ref().ok_or_else(|| RawRefused::NoState(id.to_string()))?;
                within_limits(accepted).map_err(|past| RawRefused::PastLimit(id.to_string(), past))?;
            }
        }
        self.check_room(changes, creation.place)
    }

    /// Deletes its surface `id`: one that asks is withdrawn, and any other leaves.
    fn delete(&mut self, terminal_id: &str, id: &str, change: u64, changed: &mut RawChanged) -> Option<WaitOver> {
        let at = self.surfaces.iter().position(|surface| surface.id == id)?;
        let surface = &mut self.surfaces[at];
        if let Phase::Asking { waiters } = &mut surface.phase {
            let waiters = std::mem::take(waiters);
            surface.phase = Phase::Withdrawn { at: now_ms() };
            surface.change = change;
            changed.shown.push(surface.record(terminal_id));
            return Some(WaitOver::of(id, waiters, "withdrawn"));
        }
        let surface = self.surfaces.remove(at);
        changed.left.push(SurfaceKey::new(terminal_id, id));
        self.left.add(surface.id, surface.phase.standing());
        None
    }

    /// Changes its surface `id` to what the call of `creation` made of it.
    fn update(&mut self, id: &str, creation: Creation, accepted: Accepted, sets: &[DataPath], change: u64) -> Option<WaitOver> {
        let Terminal { surfaces, calls, .. } = self;
        let surface = surfaces.iter_mut().find(|surface| surface.id == id)?;
        if let Phase::Asking { waiters } = &mut surface.phase {
            waiters.retain(|call| calls.is_open(*call));
        }
        surface.update(accepted, sets, creation.call, change)
    }

    /// Puts in what the call of `creation` creates as its surface `id`, in place of the one of that id.
    fn create(&mut self, id: &str, creation: Creation, accepted: Accepted, change: u64) -> Option<WaitOver> {
        let phase = match accepted.asks {
            true => Phase::Asking { waiters: vec![creation.call] },
            false => Phase::NotAsking,
        };
        let mut surface = Surface { phase, ..Surface::new(id, creation, accepted, change) };
        let Some(at) = self.surfaces.iter().position(|there| there.id == id) else {
            self.surfaces.push(surface);
            return None;
        };
        let there = self.surfaces.remove(at);
        // An answer the operator gives to what it replaces is one to an older revision
        surface.revision = there.revision + 1;
        surface.carried = Carried::new(surface.revision);
        surface.began = there.began;
        if !there.is_locked() {
            surface.order = there.order;
        }
        self.surfaces.push(surface);
        match there.phase {
            Phase::Asking { waiters } => Some(WaitOver::of(id, waiters, "withdrawn")),
            _ => None,
        }
    }

    /// Ends the waits that are over, of the calls that no other surface is still to answer.
    fn end_waits(&mut self, over: Vec<WaitOver>) {
        let Terminal { surfaces, calls, .. } = self;
        for WaitOver { calls: waiting, result } in over {
            for call in waiting {
                let waits = |surface: &Surface| matches!(&surface.phase, Phase::Asking { waiters } if waiters.contains(&call));
                if !surfaces.iter().any(waits) {
                    calls.tell(call, &result);
                }
            }
        }
    }
}

impl SurfaceStore {
    /// What the terminal has as the surface `key`, for a message of `creation`'s call.
    pub fn held(&self, key: &SurfaceKey, creation: Creation) -> Option<Held> {
        let mut inner = self.0.lock();
        Some(inner.terminals.get_mut(&key.terminal_id)?.find(&key.id)?.held(creation))
    }

    /// Whether the operator dismissed a surface of one of `ids`, which a later message for it is told. The
    /// message is then accepted, which ends the row of rejected calls of the creation's tool.
    pub fn is_any_dismissed(&self, terminal_id: &str, ids: &[&str], creation: Creation) -> bool {
        ids.iter().any(|id| self.is_dismissed(&SurfaceKey::new(terminal_id, *id), creation))
    }

    /// Whether the same call as `creation`'s made the surface `id`, which is there and not locked. The call
    /// then waits on those of its surfaces `shows` that ask, whose ids are returned.
    pub fn rejoin_raw(&self, terminal_id: &str, id: &str, creation: Creation, shows: &[&str]) -> Option<Vec<String>> {
        let mut inner = self.0.lock();
        let terminal = inner.terminals.get_mut(terminal_id).filter(|terminal| terminal.calls.has(creation.call))?;
        let same = terminal.find(id)?;
        let is_live = matches!(same.phase, Phase::NotAsking | Phase::Asking { .. });
        if !is_live || same.tool != creation.tool || same.arguments != *creation.arguments {
            return None;
        }
        let mut asking = Vec::new();
        let Terminal { surfaces, calls, rejected, .. } = terminal;
        for surface in surfaces.iter_mut().filter(|surface| shows.contains(&surface.id.as_str())) {
            if let Phase::Asking { waiters } = &mut surface.phase {
                waiters.retain(|call| calls.is_open(*call));
                waiters.push(creation.call);
                asking.push(surface.id.clone());
            }
        }
        rejected.remove(creation.tool);
        Some(asking)
    }

    /// Makes all of `changes`, which the call of `creation` makes of `terminal_id`'s surfaces, or none.
    pub fn commit_raw(
        &self,
        terminal_id: &str,
        creation: Creation,
        changes: Vec<RawChange>,
    ) -> Result<RawChanged, RawRefused> {
        let mut inner = self.0.lock();
        let Inner { last_change, terminals, .. } = &mut *inner;
        let terminal = terminals.get_mut(terminal_id).filter(|terminal| terminal.calls.has(creation.call));
        let terminal = terminal.ok_or(RawRefused::TerminalOver)?;
        terminal.check_changes(creation, &changes)?;
        let mut changed = RawChanged::default();
        let mut over = Vec::new();
        let mut shows = Vec::new();
        for RawChange { id, effect, accepted } in changes {
            *last_change += 1;
            over.extend(match (effect, accepted) {
                (Effect::Create { .. }, Some(accepted)) => {
                    shows.push(id);
                    terminal.create(id, creation, accepted, *last_change)
                }
                (Effect::Update { sets }, Some(accepted)) => {
                    shows.push(id);
                    terminal.update(id, creation, accepted, &sets, *last_change)
                }
                _ => terminal.delete(terminal_id, id, *last_change, &mut changed),
            });
        }
        terminal.end_waits(over);
        terminal.rejected.remove(creation.tool);
        for surface in shows.iter().filter_map(|id| terminal.surfaces.iter().find(|surface| surface.id == *id)) {
            changed.shown.push(surface.record(terminal_id));
            if matches!(surface.phase, Phase::Asking { .. }) {
                changed.asking.push(surface.id.clone());
            }
        }
        changed.shows = !shows.is_empty();
        changed.left.extend(terminal.drop_past_most_locked(terminal_id));
        Ok(changed)
    }
}
