//! What the store says of raw surfaces, whose ids their agents choose.

use super::super::raw::{Held, TOOL};
use super::{Creation, Phase, Surface, SurfaceKey, SurfaceStore};

impl Surface {
    /// Whether it leaves for what `creation` creates under its id: both are raw, it is settled, and the
    /// same call is made again. An ended one never does, as what the operator typed in it stays.
    pub(super) fn makes_way(&self, creation: Creation) -> bool {
        let both_raw = self.tool == TOOL && creation.tool == TOOL;
        let settled = matches!(self.phase, Phase::Settled { .. });
        both_raw && settled && self.arguments == *creation.arguments
    }
}

impl SurfaceStore {
    /// What the terminal has as the surface `key`, for a message of `creation`'s call.
    pub fn held(&self, key: &SurfaceKey, creation: Creation) -> Option<Held> {
        let mut inner = self.0.lock();
        let surface = inner.terminals.get_mut(&key.terminal_id)?.find(&key.id)?;
        Some(Held { place: surface.place, title: surface.title.clone(), in_use: !surface.makes_way(creation) })
    }

    /// Whether the surface `key` is one that the same call created, which asks for nothing and has not
    /// ended.
    pub fn is_shown_already(&self, key: &SurfaceKey, creation: Creation) -> bool {
        let mut inner = self.0.lock();
        let surface = inner.terminals.get_mut(&key.terminal_id).and_then(|terminal| terminal.find(&key.id));
        surface.is_some_and(|surface| {
            surface.tool == creation.tool
                && surface.arguments == *creation.arguments
                && matches!(surface.phase, Phase::NotAsking)
        })
    }
}
