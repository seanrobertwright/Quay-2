//! The operator's move of a raw companion surface to a stage tab, and back.

use super::super::place::Place;
use super::super::raw::TOOL;
use super::{SurfaceKey, SurfaceRecord, SurfaceStore};

/// Why a surface was not moved. It is as it was.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MoveRefused {
    /// The terminal has no surface of that id.
    NoSuchSurface,
    /// It is no raw one whose place is the companion.
    NotMovable,
    /// It is locked.
    Locked,
}

impl SurfaceStore {
    /// Has the surface `key` drawn as a stage tab, or back in the companion. Its place is as its agent gave
    /// it, so nothing the agent is told changes, and what it counts towards does not.
    pub fn move_surface(&self, key: &SurfaceKey, as_tab: bool) -> Result<SurfaceRecord, MoveRefused> {
        let mut inner = self.0.lock();
        let change = inner.next_change();
        let surface = inner.terminals.get_mut(&key.terminal_id).and_then(|terminal| terminal.find(&key.id));
        let surface = surface.ok_or(MoveRefused::NoSuchSurface)?;
        if surface.tool != TOOL || surface.place != Place::Companion {
            return Err(MoveRefused::NotMovable);
        }
        if surface.is_locked() {
            return Err(MoveRefused::Locked);
        }
        surface.as_tab = as_tab;
        surface.change = change;
        Ok(surface.record(&key.terminal_id))
    }
}
