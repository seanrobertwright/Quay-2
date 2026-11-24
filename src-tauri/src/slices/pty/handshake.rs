//! How a terminal's launch stands with Quay's MCP server, and the grace it has to shake hands. The
//! handshake itself is kept with its launch (see `PluginWatch`).

use std::time::{Duration, Instant};

use serde::Serialize;

/// How long after its launch a CLI has to shake hands before Quay says that it has not.
pub const HANDSHAKE_GRACE: Duration = Duration::from_secs(60);

/// How a terminal's launch stands with Quay's MCP server.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Handshake {
    /// Whether the launch's CLI has shaken hands.
    pub seen: bool,
    /// How much of the launch's grace is left, in milliseconds.
    pub grace_left_ms: u64,
    /// How much of the grace is left to a CLI that is connected and starts its servers at the launch's
    /// first prompt, in milliseconds from that prompt: `None` before it. The same as `grace_left_ms` for
    /// a CLI that connects as it starts.
    pub prompted_grace_left_ms: Option<u64>,
}

impl Handshake {
    /// The handshake, at `now`, of a launch that began at `began` and whose CLI connects from
    /// `connects_from`, when that has come.
    pub fn at(now: Instant, began: Instant, connects_from: Option<Instant>, seen: bool) -> Self {
        let left = |from| HANDSHAKE_GRACE.saturating_sub(now.saturating_duration_since(from)).as_millis() as u64;
        Self { seen, grace_left_ms: left(began), prompted_grace_left_ms: connects_from.map(left) }
    }
}
